/**
 * Gemini Flash Intent Classifier (task 18.1).
 *
 * Thin, injectable wrapper around the Google Gemini Flash `generateContent`
 * REST endpoint that classifies a single inbound WhatsApp message into one of
 * five agents. This is the *fallback* path of the Hybrid CEO Router
 * (Design §v1.1.1): it only runs when the deterministic v1 rules in
 * `ceoRouter.ts` produce no confident decision and the message is not in a
 * hot-locked state.
 *
 * Design contract (Design §v1.1.1):
 *   - `classify(input: ClassifierInput): Promise<ClassifierOutput>`.
 *   - JSON-only output (we force `responseMimeType: application/json` and use
 *     the verbatim 5-class prompt template).
 *   - Strict parsing: any malformed / unparseable / unexpected output collapses
 *     to the safe fallback `{ agent: 'welcome', confidence: 0,
 *     rationale: 'parse_failure', ... }`. `classify` NEVER throws into the
 *     user-facing router path.
 *   - Every call records `latency_ms` and `total_tokens` (Req 20.8). On a
 *     fallback path where no Gemini tokens were consumed, `total_tokens` is 0.
 *   - Bounded latency: an AbortController timeout guarantees the classifier can
 *     never hang the router. Timeouts also collapse to the safe fallback.
 *
 * Circuit breaker (task 27.2, Req 29.1):
 *   The Gemini fetch call is wrapped with the `gemini` circuit breaker from
 *   `src/lib/breaker/breaker.ts`. When the breaker is open, `classify` returns
 *   the safe fallback `{ agent: 'welcome', confidence: 0, rationale:
 *   'breaker_open' }` without making any network call. The breaker store is
 *   injectable via `deps.breakerStore` for testing.
 *
 * Testability: the network transport is injectable via the optional second
 * `deps` argument (`fetchImpl`, `now`, `apiKey`, `model`, `endpoint`,
 * `timeoutMs`) so unit tests can exercise the parsing / latency / token-cost
 * logic without a live API. No live API call is made at module load.
 *
 * Env:
 *   - GEMINI_API_KEY — Google Generative Language API key.
 *   - GEMINI_MODEL   — optional model override (default `gemini-1.5-flash`).
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.1 Hybrid CEO Router
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.10 Circuit Breakers
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 20.2, 20.7, 20.8, 29.1
 */

import { withBreaker, isBreakerOpenError, type BreakerStore } from '../breaker/breaker';

// ─── Types ───────────────────────────────────────────────────────────────────

/** The five terminal agents the router can dispatch to (Design §v1.1.1). */
export type Agent = 'complaint' | 'blood' | 'donor' | 'info' | 'welcome';

/** The set of valid agents, used for strict validation of model output. */
export const AGENTS: readonly Agent[] = [
  'complaint',
  'blood',
  'donor',
  'info',
  'welcome',
] as const;

/** Language hints the router passes through (Design §v1.1.1). */
export type Language = 'en' | 'hi' | 'bn';

/** Structured input matching Design §v1.1.1 `ClassifierInput`. */
export interface ClassifierInput {
  /** Raw inbound text (NFC-normalized for the prompt). */
  message: string;
  language: Language;
  /** Trace id for cross-node correlation (Design §v1.1.8). */
  traceId: string;
}

/** Structured output matching Design §v1.1.1 `ClassifierOutput`. */
export interface ClassifierOutput {
  agent: Agent;
  /** Coarse confidence signal in [0, 1]. 0 means "fallback / not classified". */
  confidence: number;
  /** Optional runner-up class; `null` when the model omits it. */
  secondary_agent?: Agent | null;
  /** One short sentence; surfaced on `routing_decisions.reason`. */
  rationale: string;
  /** Wall-clock latency of the whole `classify` call in milliseconds (Req 20.8). */
  latency_ms: number;
  /** Token cost reported by Gemini `usageMetadata.totalTokenCount` (Req 20.8); 0 when unknown. */
  total_tokens: number;
}

/** The decision portion of {@link ClassifierOutput} (no latency / tokens). */
type ClassifierDecision = Pick<ClassifierOutput, 'agent' | 'confidence' | 'secondary_agent' | 'rationale'>;

/**
 * Injectable dependencies for {@link classify}. All optional — production calls
 * `classify(input)` and falls back to `globalThis.fetch`, `Date.now`, and the
 * `GEMINI_API_KEY` / `GEMINI_MODEL` environment variables.
 */
export interface ClassifyDeps {
  /** Transport. Defaults to `globalThis.fetch`. Injected by unit tests. */
  fetchImpl?: typeof fetch;
  /** Clock for latency measurement. Defaults to `Date.now`. */
  now?: () => number;
  /** API key override. Defaults to `process.env.GEMINI_API_KEY`. */
  apiKey?: string;
  /** Model override. Defaults to `process.env.GEMINI_MODEL` or `gemini-1.5-flash`. */
  model?: string;
  /** Base `generateContent` endpoint override (without `?key=`). */
  endpoint?: string;
  /** Abort timeout in ms. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Injectable breaker store for the `gemini` circuit breaker (task 27.2, Req 29.1).
   * Defaults to the lazy Supabase-backed store from `src/lib/breaker/breaker.ts`.
   * Inject an in-memory fake in tests to avoid a live DB.
   */
  breakerStore?: BreakerStore;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'gemini-1.5-flash';

/** Hard ceiling on a single classifier call. The router must never block. */
const DEFAULT_TIMEOUT_MS = 4000;

/** Build the Gemini `generateContent` endpoint for a given model. */
function endpointForModel(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

/**
 * Build the single-shot, JSON-only classification prompt (Design §v1.1.1).
 * The message is NFC-normalized and the language hint is passed verbatim.
 */
export function buildPrompt(message: string, language: string): string {
  const normalized = (message ?? '').normalize('NFC');
  return `You are a deterministic classifier for an Indian government WhatsApp assistant
(West Bengal). You receive ONE inbound message. Return JSON only — no prose.

Classes (pick exactly one):
  - complaint  : grievance about a public service (road, water, pension, school, hostel, ...)
  - blood      : a request for blood (need blood, want to receive blood, blood emergency)
  - donor      : intent to register/manage as a blood donor
  - info       : asks about a scheme, ticket status, or how something works
  - welcome    : empty / greeting / unclear, route to welcome menu

Output schema (strict):
  { "agent": <class>, "confidence": <number in [0,1]>, "secondary_agent": <class or null>, "rationale": "<one short sentence>" }

Rules:
  - If you are < 60% sure, set confidence accordingly so we can ask the user.
  - Code-mixed Hindi/Bengali/English is normal; classify on intent, not language.
  - Never include any field outside the schema. Never include markdown.

Message language hint: ${language}
Message:
${normalized}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Type guard: is `v` one of the five valid agents? */
function isAgent(v: unknown): v is Agent {
  return typeof v === 'string' && (AGENTS as readonly string[]).includes(v);
}

/** Clamp an arbitrary value into a confidence number in [0, 1]; non-finite → 0. */
function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** The safe fallback decision, with an explanatory `rationale`. */
function fallbackDecision(rationale: string): ClassifierDecision {
  return { agent: 'welcome', confidence: 0, secondary_agent: null, rationale };
}

/**
 * Extract the first text part from a Gemini `generateContent` response.
 * Returns null when the response shape is unexpected.
 */
function extractText(payload: unknown): string | null {
  const candidates = (payload as { candidates?: unknown })?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const text = (parts[0] as { text?: unknown })?.text;
  return typeof text === 'string' ? text : null;
}

/**
 * Extract `usageMetadata.totalTokenCount` from a Gemini response.
 * Returns 0 when the provider does not surface usage (downstream consumers fall
 * back to `estimateTokens` per Req 30.8).
 */
function extractTotalTokens(payload: unknown): number {
  const usage = (payload as { usageMetadata?: { totalTokenCount?: unknown } })?.usageMetadata;
  const n = Number(usage?.totalTokenCount);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Strict-parse the model's JSON text into a validated {@link ClassifierDecision}.
 *
 * Tolerates a stray markdown code-fence (```json ... ```) even though the prompt
 * forbids it. Any other deviation — non-JSON, missing/invalid `agent`, etc. —
 * returns the safe fallback with `rationale: 'parse_failure'` (task 18.1).
 */
export function parseClassifierOutput(text: string | null): ClassifierDecision {
  if (text == null || text.trim().length === 0) {
    return fallbackDecision('parse_failure');
  }

  // Strip an accidental ```json ... ``` fence if present.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return fallbackDecision('parse_failure');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fallbackDecision('parse_failure');
  }

  const obj = parsed as {
    agent?: unknown;
    intent?: unknown;
    confidence?: unknown;
    secondary_agent?: unknown;
    rationale?: unknown;
  };

  // Accept `agent` (design schema) or `intent` (defensive alias) for the class.
  const rawAgent = obj.agent ?? obj.intent;
  if (!isAgent(rawAgent)) {
    return fallbackDecision('parse_failure');
  }

  // `secondary_agent` is optional: null / absent allowed; any other non-agent value is ignored.
  const secondary = isAgent(obj.secondary_agent) ? obj.secondary_agent : null;

  const rationale =
    typeof obj.rationale === 'string' && obj.rationale.trim().length > 0
      ? obj.rationale.trim()
      : `classified_as_${rawAgent}`;

  return {
    agent: rawAgent,
    confidence: clampConfidence(obj.confidence),
    secondary_agent: secondary,
    rationale,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Classify a WhatsApp message into one of the five router agents (Design §v1.1.1).
 *
 * Always resolves (never rejects). On any failure — missing API key, empty
 * message, network error, non-200 response, timeout, or malformed body — it
 * returns the safe fallback `{ agent: 'welcome', confidence: 0, ... }` with a
 * `rationale` describing the cause (`'parse_failure'` for malformed/unparseable
 * model output). `latency_ms` and `total_tokens` are recorded on every call
 * (Req 20.8).
 *
 * @param input  The {@link ClassifierInput} (message, language, traceId).
 * @param deps   Optional injectable transport/clock/config for testing.
 */
export async function classify(
  input: ClassifierInput,
  deps: ClassifyDeps = {},
): Promise<ClassifierOutput> {
  const now = deps.now ?? Date.now;
  const start = now();
  const finalize = (decision: ClassifierDecision, totalTokens: number): ClassifierOutput => ({
    ...decision,
    latency_ms: Math.max(0, now() - start),
    total_tokens: totalTokens,
  });

  const apiKey = deps.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // No key configured — fail safe rather than throwing.
    return finalize(fallbackDecision('no_api_key'), 0);
  }

  // Empty / whitespace-only messages are unclear → welcome menu, no LLM call.
  if (!input.message || input.message.trim().length === 0) {
    return finalize(fallbackDecision('empty_message'), 0);
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return finalize(fallbackDecision('no_fetch'), 0);
  }

  const model = deps.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const endpoint = deps.endpoint ?? endpointForModel(model);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // ── Circuit breaker: gemini (task 27.2, Req 29.1) ──────────────────────
    // Wrap the Gemini fetch in the `gemini` breaker. When the breaker is open,
    // `withBreaker` throws `BreakerOpenError` which we catch below and convert
    // to the safe fallback `{ agent: 'welcome', confidence: 0, rationale:
    // 'breaker_open' }` — no network call is made.
    const { decision, totalTokens } = await withBreaker(
      'gemini',
      async () => {
        const res = await fetchImpl(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              { role: 'user', parts: [{ text: buildPrompt(input.message, input.language) }] },
            ],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              maxOutputTokens: 128,
            },
          }),
        });

        if (!res.ok) {
          throw new Error(`http_${res.status}`);
        }

        const payload: unknown = await res.json();
        return {
          decision: parseClassifierOutput(extractText(payload)),
          totalTokens: extractTotalTokens(payload),
        };
      },
      { store: deps.breakerStore },
    );

    return finalize(decision, totalTokens);
  } catch (err) {
    // Breaker open — short-circuit with safe fallback (no LLM call made).
    if (isBreakerOpenError(err)) {
      return finalize(fallbackDecision('breaker_open'), 0);
    }
    // Distinguish an abort/timeout from a generic network error for observability.
    const aborted =
      controller.signal.aborted ||
      (err instanceof Error && err.name === 'AbortError');
    // Surface the original HTTP error code if available.
    const rationale =
      err instanceof Error && err.message.startsWith('http_')
        ? err.message
        : aborted
          ? 'timeout'
          : 'network_error';
    return finalize(fallbackDecision(rationale), 0);
  } finally {
    clearTimeout(timer);
  }
}
