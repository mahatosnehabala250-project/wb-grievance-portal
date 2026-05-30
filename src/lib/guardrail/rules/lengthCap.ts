/**
 * Guardrail rule: reply length cap.
 *
 * Pure function. Truncates overly long replies so WhatsApp sends stay within a
 * sane bound (Req 25.5). The design caps at 1500 chars and truncates at 1450 +
 * ellipsis; this module exposes a configurable `maxChars` (default 1000 per the
 * task signature) and truncates on a word boundary where possible, appending an
 * ellipsis.
 *
 * Idempotence (Property 25): after truncation the reply length is ≤ maxChars, so
 * re-running the rule reports `violated: false` and returns the same string. The
 * appended ellipsis is counted inside the budget, so a second pass never trims
 * further.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.6 (lengthCheck)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirement 25.5
 */

export const DEFAULT_MAX_CHARS = 1000;

const ELLIPSIS = '...';

export interface LengthResult {
  violated: boolean;
  repaired: string;
}

/**
 * Truncate `reply` to at most `maxChars` characters (ellipsis included in the
 * budget). Prefers cutting at the last whitespace before the limit so words are
 * not split; falls back to a hard cut when no whitespace is available.
 *
 * @param reply The outbound agent reply.
 * @param maxChars Maximum allowed length, default {@link DEFAULT_MAX_CHARS}.
 */
export function enforceLength(reply: string, maxChars: number = DEFAULT_MAX_CHARS): LengthResult {
  const text = reply ?? '';

  if (text.length <= maxChars) {
    return { violated: false, repaired: text };
  }

  const budget = Math.max(0, maxChars - ELLIPSIS.length);
  let cut = text.slice(0, budget);

  // Prefer a word boundary if one exists reasonably close to the end.
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > budget * 0.6) {
    cut = cut.slice(0, lastSpace);
  }

  const repaired = cut.trimEnd() + ELLIPSIS;
  return { violated: true, repaired };
}
