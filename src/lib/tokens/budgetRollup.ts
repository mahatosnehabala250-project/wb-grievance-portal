/**
 * v1.1.11 Budget_Tracker — token-usage rollup with estimator fallback.
 *
 * The Budget_Tracker rolls up per-invocation token usage into
 * `conversation_sessions.session_tokens_24h` over a rolling 24-hour window so the
 * per-session token cap (Req 30.3, default 30 000) stays enforced.
 *
 * The upstream design (§v1.1.11) describes the nightly roll as a pure SQL
 * aggregate:
 *
 *   UPDATE conversation_sessions cs
 *      SET session_tokens_24h = COALESCE(s.total, 0)
 *     FROM (SELECT session_id, SUM(tokens_used) AS total
 *             FROM agent_invocations
 *            WHERE started_at > now() - interval '24 hours'
 *            GROUP BY session_id) s
 *    WHERE cs.session_id = s.session_id;
 *
 * Postgres `SUM(tokens_used)` silently SKIPS rows where `tokens_used IS NULL`
 * (Req 18.15 — n8n's Gemini node does not always expose `tokenUsage`). That
 * under-counts sessions whose invocations had no provider token usage, which
 * would let a runaway conversation slip past the 24-hour cap.
 *
 * Req 30.8 fixes this: when `tokens_used IS NULL`, the Budget_Tracker increments
 * by a deterministic local estimate instead of skipping the row. This module
 * wires the task-7.12 token estimator (`src/lib/tokens/estimateTokens.ts`) into
 * that rollup.
 *
 * The change is feature-flagged so it is a NO-OP for v1 (preserving the original
 * SUM-skips-NULL behaviour) and ACTIVE for v1.1.
 *
 * Pure functions — no I/O — so the rollup logic is unit-testable without a DB.
 * The async `resolveEstimatorFallbackEnabled()` helper resolves the flag at the
 * boundary; the nightly job (task 28.3) and Logger (task 28.2) call it once and
 * pass the boolean into the pure functions below.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.11 Token Budget per Session
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §Observability → Local token estimator
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Req 18.15, 30.3, 30.8
 */

import { estimateTotal } from './estimateTokens';

/**
 * Feature flag key that activates the Req 30.8 estimator fallback.
 *
 * Resolved through the standard `getFeatureFlag` chain (system_config → env →
 * DEFAULTS → caller default). It is NOT registered in the hardcoded DEFAULTS map,
 * so when unset it resolves to `'false'` — i.e. v1 behaviour (skip NULL rows).
 * v1.1 deployments set this to `'true'` (system_config row or env var).
 */
export const TOKEN_ESTIMATOR_FALLBACK_FLAG = 'TOKEN_ESTIMATOR_FALLBACK_ENABLED';

/**
 * One agent invocation's contribution to the token rollup.
 *
 * `tokens_used` mirrors `agent_invocations.tokens_used` (NULLABLE per Req 18.15).
 * When it is NULL, the fallback source fields drive the local estimate (Req 30.8):
 *   - `estimatedTokens` — a value already computed by the Logger (task 7.12) and
 *     forwarded alongside the invocation; preferred when present so we do not
 *     re-estimate.
 *   - otherwise `prompt` + `response` are fed to the task-7.12 estimator.
 */
export interface InvocationTokenInput {
  /** Session this invocation belongs to (rollup grouping key). */
  sessionId: string;
  /** Provider-reported total tokens, or NULL when not captured (Req 18.15). */
  tokensUsed: number | null | undefined;
  /** Full prompt text (system prompt + user message) — fallback source. */
  prompt?: string | null;
  /** Agent reply text — fallback source. */
  response?: string | null;
  /**
   * Pre-computed local estimate forwarded by the Logger (task 7.12).
   * Used in preference to re-estimating from prompt/response when present.
   */
  estimatedTokens?: number | null;
}

export interface ResolveTokenOptions {
  /**
   * When true (v1.1), a NULL `tokensUsed` falls back to the local estimate.
   * When false (v1), a NULL `tokensUsed` contributes 0 (original SUM behaviour).
   */
  estimatorFallbackEnabled: boolean;
}

/**
 * True for a usable, non-negative, finite token count.
 */
function isUsableTokenCount(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Resolve the token contribution of a SINGLE invocation for the rollup.
 *
 * Resolution order:
 *   1. `tokensUsed` present (provider reported it) → use it. Applies in both v1
 *      and v1.1 — the estimator is only ever a fallback, never an override.
 *   2. `tokensUsed` NULL and fallback DISABLED (v1) → 0 (skip, matches SQL SUM).
 *   3. `tokensUsed` NULL and fallback ENABLED (v1.1):
 *        a. `estimatedTokens` already computed by the Logger → use it.
 *        b. otherwise estimate from `prompt` + `response` via the task-7.12
 *           estimator (`estimateTotal`).
 *
 * Always returns a non-negative integer.
 *
 * Req 30.8 — Design §v1.1.11.
 */
export function resolveInvocationTokens(
  invocation: InvocationTokenInput,
  options: ResolveTokenOptions,
): number {
  // (1) Provider-reported usage always wins.
  if (isUsableTokenCount(invocation.tokensUsed)) {
    return invocation.tokensUsed;
  }

  // (2) v1 / fallback disabled — NULL contributes nothing (SUM skips the row).
  if (!options.estimatorFallbackEnabled) {
    return 0;
  }

  // (3a) Logger already estimated it (task 7.12) — reuse to avoid double work.
  if (isUsableTokenCount(invocation.estimatedTokens)) {
    return invocation.estimatedTokens;
  }

  // (3b) Estimate locally from prompt + response (Req 30.8). estimateTotal is
  // estimateTokens(prompt) + estimateTokens(response); the leading systemPrompt
  // arg is '' so the full prompt text is supplied as the user-message slot.
  return estimateTotal('', invocation.prompt ?? '', invocation.response ?? '');
}

/**
 * Roll up a batch of invocations into per-session token totals.
 *
 * This is the in-application equivalent of the nightly SQL aggregate, but it
 * applies the Req 30.8 estimator fallback for NULL `tokensUsed` rows (which the
 * raw SQL `SUM` cannot do — `agent_invocations` stores no prompt/response).
 *
 * Returns a Map of `sessionId → total tokens` (non-negative integers). Sessions
 * with no usable contributions still appear with a total of 0 so the caller can
 * overwrite `session_tokens_24h` to 0 (rolling old usage out of the window).
 */
export function rollupSessionTokens(
  invocations: InvocationTokenInput[],
  options: ResolveTokenOptions,
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const invocation of invocations) {
    const current = totals.get(invocation.sessionId) ?? 0;
    const contribution = resolveInvocationTokens(invocation, options);
    totals.set(invocation.sessionId, current + contribution);
  }

  return totals;
}

/**
 * Resolve whether the Req 30.8 estimator fallback is active for this deployment.
 *
 * Thin async boundary over the feature-flag system. Defaults to `false` (v1
 * no-op) when the flag is unset. Call this once at the start of the nightly job
 * (task 28.3) / Logger accounting (task 28.2) and thread the boolean through the
 * pure functions above.
 */
export async function resolveEstimatorFallbackEnabled(): Promise<boolean> {
  // Imported lazily so the pure rollup functions stay importable in unit tests
  // without pulling in the Supabase client that getFeatureFlag constructs at
  // module load.
  const { getFeatureFlag } = await import('../featureFlags/getFeatureFlag');
  const value = await getFeatureFlag(TOKEN_ESTIMATOR_FALLBACK_FLAG, 'false');
  return value === 'true';
}
