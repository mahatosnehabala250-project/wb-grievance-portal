/**
 * Barrel re-export for all guardrail rule modules.
 *
 * Each rule is a pure function (no I/O, no LLM, no DB) returning a small result
 * object. The umbrella `checkReply` (src/lib/guardrail/check.ts) composes them.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.6 Output Guardrail
 */

export { detectPiiLeak } from './piiLeak';
export type { PiiLeakResult } from './piiLeak';

export { checkLanguage } from './languageMismatch';
export type { LanguageResult, Language } from './languageMismatch';

export { detectRefusal, REFUSAL_PHRASES, REFUSAL_FALLBACK } from './refusalText';
export type { RefusalResult } from './refusalText';

export { enforceLength, DEFAULT_MAX_CHARS } from './lengthCap';
export type { LengthResult } from './lengthCap';

export { checkUrls, DEFAULT_ALLOWED_DOMAINS } from './urlAllowlist';
export type { UrlResult } from './urlAllowlist';

export {
  detectJsonLeak,
  REGISTERED_TOOL_NAMES,
  TOOL_SENTINELS,
} from './jsonLeak';
export type { JsonLeakResult } from './jsonLeak';
