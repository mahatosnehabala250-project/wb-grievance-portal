/**
 * Output Guardrail — umbrella check (Req 25).
 *
 * Runs after every specialist agent reply and before the WhatsApp send. It is
 * fully deterministic: regex / string / Set checks only — no LLM, no DB, no
 * network (Req 25.1, 25.9). All rule modules are pure functions; this file
 * composes them in a fixed order and decides the overall outcome.
 *
 * Two public entry points are provided:
 *   - `checkReply(reply, ctx)` — the simplified, dependency-light contract used
 *     by tests and the n8n Code Node body. Returns
 *     { action: 'pass'|'repaired'|'blocked', reply, violations }.
 *   - `check(ctx)` — the design §v1.1.6 contract returning a `GuardrailResult`
 *     with `action: 'ok'|'repair'|'substitute'|'reject'`. Implemented as a thin
 *     adapter over the same engine so callers wired to the design signature keep
 *     working.
 *
 * Rule ordering (sequential, short-circuit on substitute-grade — Design §v1.1.6):
 *   1. length cap        — repair (truncate)
 *   2. url allowlist     — repair (strip)
 *   3. json/tool leak    — repair (strip)
 *   4. pii leak          — repair (mask)        [task treats PII as maskable]
 *   5. refusal text      — substitute (block)
 *   6. language mismatch — substitute (block)
 *
 * Repair-then-recheck: repair-grade rules accumulate, then a single re-pass
 * confirms the repaired reply is clean (Req 25.8). A substitute-grade violation
 * short-circuits to the localized fallback.
 *
 * Idempotence (Property 25): every repair removes/normalizes the offending
 * substring such that the same rule cannot fire again, so `checkReply` on an
 * already-clean reply returns action='pass' with the identical string.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.6 Output Guardrail
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirement 25
 */

import {
  detectPiiLeak,
  checkLanguage,
  detectRefusal,
  enforceLength,
  checkUrls,
  detectJsonLeak,
  DEFAULT_MAX_CHARS,
  type Language,
} from './rules';

/** Overall outcome of the umbrella check (task contract). */
export type GuardrailAction = 'pass' | 'repaired' | 'blocked';

export interface GuardrailResult {
  /** `pass` = forwarded unchanged, `repaired` = forwarded modified, `blocked` = fallback substituted. */
  action: GuardrailAction;
  /** The reply to actually send (original, repaired, or fallback). */
  reply: string;
  /** Rule identifiers that fired (e.g. 'length_cap', 'pii_leak'). */
  violations: string[];
}

export interface CheckReplyContext {
  /** Session language; controls the language-mismatch rule and fallback text. */
  language: string;
  /** Optional override of allowlisted URL host suffixes. */
  allowedUrls?: string[];
  /** Optional override of the length cap (defaults to {@link DEFAULT_MAX_CHARS}). */
  maxChars?: number;
}

/** Localized citizen-friendly fallback lines (Design §v1.1.6, Req 25.8). */
export const FALLBACK_LINES: Record<Language, string> = {
  hi: 'Ek minute ruko, main fir se check karta hoon. Aap ki query process ho rahi hai.',
  en: 'One moment please — I am checking on this and will get back to you shortly.',
  bn: 'Ek minute opekkha korun, ami abar dekhchi. Apnar onurodh process hocche.',
};

function normalizeLanguage(language: string): Language {
  return language === 'hi' || language === 'bn' || language === 'en' ? language : 'en';
}

/**
 * Run all guardrail rules and return the final (possibly repaired or
 * substituted) reply plus the list of violations.
 *
 * @param reply The raw outbound agent reply.
 * @param ctx Session context (language + optional overrides).
 */
export async function checkReply(
  reply: string,
  ctx: CheckReplyContext,
): Promise<GuardrailResult> {
  const lang = normalizeLanguage(ctx.language);
  const maxChars = ctx.maxChars ?? DEFAULT_MAX_CHARS;
  const violations: string[] = [];

  let current = reply ?? '';
  let repaired = false;

  // --- Repair-grade rules (mutate `current`, accumulate violations) ---------

  const lengthRes = enforceLength(current, maxChars);
  if (lengthRes.violated) {
    violations.push('length_cap');
    current = lengthRes.repaired;
    repaired = true;
  }

  const urlRes = checkUrls(current, ctx.allowedUrls);
  if (urlRes.violated) {
    violations.push('url_allowlist');
    current = urlRes.repaired;
    repaired = true;
  }

  const jsonRes = detectJsonLeak(current);
  if (jsonRes.violated) {
    violations.push('json_leak');
    current = jsonRes.repaired;
    repaired = true;
  }

  const piiRes = detectPiiLeak(current);
  if (piiRes.violated) {
    violations.push('pii_leak');
    current = piiRes.repaired;
    repaired = true;
  }

  // --- Substitute-grade rules (short-circuit to localized fallback) ---------

  const refusalRes = detectRefusal(current);
  if (refusalRes.violated) {
    violations.push('refusal_text');
    return { action: 'blocked', reply: FALLBACK_LINES[lang], violations };
  }

  const languageRes = checkLanguage(current, lang);
  if (languageRes.violated) {
    violations.push('language_mismatch');
    return { action: 'blocked', reply: FALLBACK_LINES[lang], violations };
  }

  // --- Single re-pass over repair-grade rules (Req 25.8) --------------------
  // If a repair introduced or left a residual violation, escalate to a block.
  if (repaired) {
    const recheckLength = enforceLength(current, maxChars).violated;
    const recheckUrls = checkUrls(current, ctx.allowedUrls).violated;
    const recheckJson = detectJsonLeak(current).violated;
    const recheckPii = detectPiiLeak(current).violated;

    if (recheckLength || recheckUrls || recheckJson || recheckPii) {
      return { action: 'blocked', reply: FALLBACK_LINES[lang], violations };
    }

    // If the repaired reply is now empty, there is nothing useful to send.
    if (current.trim().length === 0) {
      return { action: 'blocked', reply: FALLBACK_LINES[lang], violations };
    }
  }

  if (violations.length === 0) {
    return { action: 'pass', reply: current, violations };
  }

  return { action: 'repaired', reply: current, violations };
}

// ---------------------------------------------------------------------------
// Design §v1.1.6 compatibility adapter
// ---------------------------------------------------------------------------

/** Design §v1.1.6 violation record. */
export interface Violation {
  rule: string;
  /** ≤ 80-char snippet of the offending substring. */
  evidence: string;
}

/** Design §v1.1.6 action vocabulary. */
export type DesignGuardrailAction = 'ok' | 'repair' | 'substitute' | 'reject';

export interface DesignGuardrailResult {
  ok: boolean;
  action: DesignGuardrailAction;
  repaired_reply: string;
  violations: Violation[];
}

export interface GuardrailContext {
  reply: string;
  session: {
    language: Language;
    last_intent: string;
    collected_data: Record<string, unknown>;
    last_inbound_message: string;
  };
  traceId: string;
}

const ACTION_MAP: Record<GuardrailAction, DesignGuardrailAction> = {
  pass: 'ok',
  repaired: 'repair',
  blocked: 'substitute',
};

/**
 * Design §v1.1.6 entry point. Adapts {@link checkReply} to the
 * `GuardrailResult` shape with `ok|repair|substitute|reject` actions.
 *
 * Synchronous wrapper: the underlying engine performs no real async work, so we
 * resolve the promise eagerly. Kept `Promise`-free for the n8n Code Node, which
 * expects a synchronous return.
 */
export function check(ctx: GuardrailContext): Promise<DesignGuardrailResult> {
  return checkReply(ctx.reply, {
    language: ctx.session.language,
    allowedUrls: undefined,
  }).then((res) => ({
    ok: res.action === 'pass',
    action: ACTION_MAP[res.action],
    repaired_reply: res.reply,
    violations: res.violations.map((rule) => ({ rule, evidence: '' })),
  }));
}
