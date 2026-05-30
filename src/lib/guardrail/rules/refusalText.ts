/**
 * Guardrail rule: LLM refusal text.
 *
 * Pure function. Detects canned model-refusal phrases ("I cannot", "As an AI",
 * "I'm unable to", ...) and replaces the whole reply with a helpful fallback so
 * the citizen never sees an assistant-voice refusal (Req 25.4).
 *
 * Substring bank is a `Set<string>` of lowercased phrases, scanned against the
 * lowercased reply (Design §v1.1.6 performance note).
 *
 * Idempotence (Property 25): the fallback string contains none of the refusal
 * phrases, so re-running the rule on a repaired reply reports `violated: false`.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.6 (refusalPatternCheck)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirement 25.4
 */

/** Case-insensitive refusal markers (Design §v1.1.6, Req 25.4). */
export const REFUSAL_PHRASES: ReadonlySet<string> = new Set<string>([
  'i cannot',
  'i can not',
  "i can't",
  'as an ai',
  'i am unable to',
  "i'm unable to",
  "i don't have",
  'i do not have',
  "i'm sorry, but i",
  'i am sorry, but i',
  'as a language model',
  'as an artificial intelligence',
]);

/**
 * Neutral, helpful fallback that carries no refusal markers. Kept language-
 * agnostic-ish (plain Hinglish) because the umbrella owns localized
 * substitution; this is the rule's own repair default.
 */
export const REFUSAL_FALLBACK =
  'Main aap ki madad karne ke liye yahan hoon. Kripya thoda aur detail batayein taaki main aage badh sakun.';

export interface RefusalResult {
  violated: boolean;
  repaired: string;
}

/**
 * Detect refusal phrasing and, if found, replace the reply with a fallback.
 *
 * @param reply The outbound agent reply.
 * @returns `violated` true when a refusal phrase was present; `repaired` is the
 *          fallback when violated, otherwise the original reply.
 */
export function detectRefusal(reply: string): RefusalResult {
  const text = reply ?? '';
  const haystack = text.toLowerCase();

  for (const phrase of REFUSAL_PHRASES) {
    if (haystack.includes(phrase)) {
      return { violated: true, repaired: REFUSAL_FALLBACK };
    }
  }

  return { violated: false, repaired: text };
}
