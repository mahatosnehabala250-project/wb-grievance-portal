/**
 * Guardrail rule: third-party PII leak (phone numbers + email).
 *
 * Pure function. No I/O, no LLM, no DB. Compiled regexes live at module load
 * so the check is O(reply_length) with small constants (Req 25.9, ≤ 30 ms p95).
 *
 * The agent sometimes emits another person's phone number / email that the
 * citizen never supplied. Because the umbrella `checkReply` context does not
 * carry the inbound message (per the simplified task signature), this rule
 * masks every phone number and email it finds rather than exempting ones that
 * also appear in the input. Masking (rather than deleting) keeps the reply
 * readable while removing the sensitive value.
 *
 * Idempotence (Property 25): masked output contains `X` characters inside the
 * digit run, so the phone regex (which requires `\d`) cannot match it again,
 * and the email placeholder contains no `@x.y` pattern. Running the rule on an
 * already-masked reply therefore reports `violated: false`.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.6 (piiCheck)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirement 25.2
 */

/** Indian mobile with a +91 / 91 country code, optional space or hyphen. */
const PHONE_CC_STRIP = /(\+?91[\s-]?)([6-9]\d{9})\b/g;

/** Bare 10-digit Indian mobile (starts 6-9), bounded so it is a standalone token. */
const PHONE_BARE_STRIP = /\b[6-9]\d{9}\b/g;

/** Detection-only variants (no `g` flag so `.test()` is stateless). */
const PHONE_CC_TEST = /(\+?91[\s-]?)([6-9]\d{9})\b/;
const PHONE_BARE_TEST = /\b[6-9]\d{9}\b/;

/** Loose email matcher. */
const EMAIL_STRIP = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_TEST = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

const EMAIL_PLACEHOLDER = '[email hidden]';

/**
 * Mask the middle digits of a 10-digit number, keeping the first 2 and last 2.
 * e.g. `9876543210` -> `98XXXXXX10`.
 */
function maskTenDigits(core: string): string {
  return core.slice(0, 2) + 'X'.repeat(core.length - 4) + core.slice(-2);
}

export interface PiiLeakResult {
  violated: boolean;
  repaired: string;
}

/**
 * Detect and mask third-party phone numbers (10-digit / +91) and emails.
 *
 * @param reply The outbound agent reply.
 * @returns `violated` true if any PII was found; `repaired` is the masked reply
 *          (equal to `reply` when nothing was found).
 */
export function detectPiiLeak(reply: string): PiiLeakResult {
  const text = reply ?? '';

  const violated =
    PHONE_CC_TEST.test(text) ||
    PHONE_BARE_TEST.test(text) ||
    EMAIL_TEST.test(text);

  if (!violated) {
    return { violated: false, repaired: text };
  }

  let repaired = text;
  // Mask emails first so an email-embedded number is not partially masked.
  repaired = repaired.replace(EMAIL_STRIP, EMAIL_PLACEHOLDER);
  // Country-code form first (keeps the visible prefix), then bare numbers.
  repaired = repaired.replace(PHONE_CC_STRIP, (_m, cc: string, core: string) => cc + maskTenDigits(core));
  repaired = repaired.replace(PHONE_BARE_STRIP, (m) => maskTenDigits(m));

  return { violated: true, repaired };
}
