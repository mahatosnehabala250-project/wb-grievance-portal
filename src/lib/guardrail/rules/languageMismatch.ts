/**
 * Guardrail rule: language / script mismatch.
 *
 * Pure function. Uses Unicode-block detection (no `franc-min` dependency) to
 * guess the dominant script of the reply and flags when that script does not
 * belong to the session language (Design §v1.1.6, Req 25.3).
 *
 * Script blocks:
 *   - Devanagari `[\u0900-\u097F]` → Hindi
 *   - Bengali    `[\u0980-\u09FF]` → Bengali
 *   - Latin      `[A-Za-z]`        → English OR romanized Hindi/Bengali
 *
 * Key product reality: JanSeva replies to `hi` and `bn` citizens are routinely
 * written in **romanized (Latin) script** — the design's own `hi` fallback line
 * ("Ek minute ruko, main fir se check karta hoon") is Latin. Latin is therefore
 * a valid script for every language and is never a mismatch on its own. Only a
 * non-Latin script that belongs to a *different* language is flagged:
 *
 *   expected en → allowed dominant scripts: { Latin }
 *   expected hi → allowed dominant scripts: { Latin, Devanagari }
 *   expected bn → allowed dominant scripts: { Latin, Bengali }
 *
 * Mixed-script replies are tolerated as long as the dominant script is allowed
 * (Design §v1.1.6). This rule never repairs — a wrong-language reply cannot be
 * salvaged by string surgery — so the umbrella maps it to a substitute.
 *
 * Idempotence (Property 25): the localized fallback lines are Latin-script, and
 * Latin is allowed for every language, so re-checking a substituted fallback
 * always reports `violated: false`.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.6 (languageCheck)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirement 25.3
 */

export type Language = 'en' | 'hi' | 'bn';

type Script = 'devanagari' | 'bengali' | 'latin';

const DEVANAGARI = /[\u0900-\u097F]/g;
const BENGALI = /[\u0980-\u09FF]/g;
const LATIN = /[A-Za-z]/g;

/** Dominant scripts that are acceptable for each session language. */
const ALLOWED_SCRIPTS: Record<Language, ReadonlySet<Script>> = {
  en: new Set<Script>(['latin']),
  hi: new Set<Script>(['latin', 'devanagari']),
  bn: new Set<Script>(['latin', 'bengali']),
};

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

export interface LanguageResult {
  violated: boolean;
}

/**
 * Detect whether the dominant script of `reply` is valid for `expectedLang`.
 *
 * Replies with no script-bearing characters (pure digits / punctuation / emoji)
 * are non-violating — there is nothing to mismatch.
 *
 * @param reply The outbound agent reply.
 * @param expectedLang The session language to compare against.
 */
export function checkLanguage(reply: string, expectedLang: Language): LanguageResult {
  const text = reply ?? '';

  const counts: Record<Script, number> = {
    devanagari: countMatches(text, DEVANAGARI),
    bengali: countMatches(text, BENGALI),
    latin: countMatches(text, LATIN),
  };

  const total = counts.devanagari + counts.bengali + counts.latin;
  if (total === 0) {
    return { violated: false };
  }

  // Pick the dominant script. Ties break toward a non-Latin script so a reply
  // with equal Latin and Devanagari characters is judged as Devanagari (Hindi).
  let dominant: Script = 'latin';
  let best = -1;
  for (const script of ['devanagari', 'bengali', 'latin'] as Script[]) {
    if (counts[script] > best) {
      best = counts[script];
      dominant = script;
    }
  }

  const allowed = ALLOWED_SCRIPTS[expectedLang] ?? ALLOWED_SCRIPTS.en;
  return { violated: !allowed.has(dominant) };
}
