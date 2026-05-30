/**
 * Guardrail rule: raw JSON / tool-call fragment leak.
 *
 * Pure function. Strips machine-oriented artifacts that occasionally leak into
 * a citizen-facing reply (Req 25.7):
 *   - fenced code blocks (```json ... ``` or bare ``` ... ```)
 *   - raw JSON object literals (`{ "key": ... }`)
 *   - tool / system sentinels: `system:`, `tools:`, `function_call`, and the
 *     names of registered agent tools (`ValidateBlock`, `RegisterComplaint`, ...)
 *
 * This merges the design's `toolFragmentCheck` and `jsonFragmentCheck`
 * (§v1.1.6) into the single `jsonLeak` rule named by the task.
 *
 * Idempotence (Property 25): every detected fragment is removed outright, so a
 * second pass finds nothing and returns the same (trimmed) string with
 * `violated: false`. Stripping order is fences → JSON literals → tokens so a
 * `{...}` inside a fence is not double-counted.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.6 (tool/json checks)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirement 25.7
 */

/** Registered agent tool names (Design §JS-01v2 Node Map / Specialist Agents). */
export const REGISTERED_TOOL_NAMES: readonly string[] = [
  'ValidateBlock',
  'CheckDuplicate',
  'RegisterComplaint',
  'CreateBloodRequest',
  'DonorRespond',
  'SeekerConfirm',
  'SaveSessionState',
  'RegisterDonor',
  'UpdateDonorStatus',
  'RecordDonation',
  'DeferDonor',
];

/** Bare sentinel tokens that should never appear in a citizen reply. */
export const TOOL_SENTINELS: readonly string[] = ['function_call', 'system:', 'tools:'];

/** Fenced code block, optional language tag, lazy body (handles unbalanced too). */
const FENCE_RE = /```[a-zA-Z0-9]*[\s\S]*?(?:```|$)/g;
const FENCE_TEST = /```/;

/** JSON-ish object literal: a brace block that contains a "key": pattern. */
const JSON_OBJ_RE = /\{[^{}]*"[^"]*"\s*:[^{}]*\}/g;
const JSON_OBJ_TEST = /\{[^{}]*"[^"]*"\s*:[^{}]*\}/;

/** Case-insensitive matcher for sentinels + tool names, escaped for regex. */
const TOKEN_RE = new RegExp(
  [...TOOL_SENTINELS, ...REGISTERED_TOOL_NAMES]
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'),
  'gi',
);
const TOKEN_TEST = new RegExp(TOKEN_RE.source, 'i');

export interface JsonLeakResult {
  violated: boolean;
  repaired: string;
}

/**
 * Detect and strip JSON / tool-call fragments from the reply.
 *
 * @param reply The outbound agent reply.
 * @returns `violated` true when any fragment was present; `repaired` is the
 *          cleaned reply (equal to `reply` when nothing was found).
 */
export function detectJsonLeak(reply: string): JsonLeakResult {
  const text = reply ?? '';

  const violated = FENCE_TEST.test(text) || JSON_OBJ_TEST.test(text) || TOKEN_TEST.test(text);
  if (!violated) {
    return { violated: false, repaired: text };
  }

  let repaired = text;
  repaired = repaired.replace(FENCE_RE, '');
  repaired = repaired.replace(JSON_OBJ_RE, '');
  repaired = repaired.replace(TOKEN_RE, '');

  // Tidy whitespace left behind by removed fragments without eating newlines.
  repaired = repaired
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n{3,} */g, '\n\n')
    .trim();

  return { violated: true, repaired };
}
