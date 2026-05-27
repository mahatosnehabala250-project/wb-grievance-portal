/**
 * Deterministic local token estimator.
 *
 * Used as a fallback when n8n's Gemini node does not expose `tokenUsage`
 * (Req 18.15). The `agent_invocations` table stores `tokens_used` as NULLABLE —
 * when NULL, downstream consumers (Budget_Tracker per Req 30.8) use this
 * estimator instead.
 *
 * Heuristic:
 * - English / Latin script: ~4 characters per token
 * - Hindi / Bengali (Devanagari / Bangla scripts): ~2.5 characters per token
 * - Mixed content: weighted average based on detected script ratio
 *
 * For Gemini models the average is approximately:
 * - English: 1 token ≈ 4 chars
 * - Hindi/Bengali: 1 token ≈ 2.5 chars (Devanagari/Bangla scripts use more tokens)
 * - Mixed: 1 token ≈ 3 chars
 *
 * Properties (verified by Property 37):
 * - Non-negative: always returns >= 0
 * - Deterministic: same input → same output
 * - Monotonic: longer text → more tokens (estimateTokens(a + b) >= estimateTokens(a))
 * - Empty string → 0
 *
 * Pure function — no I/O.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §Observability → Local token estimator
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §Property 37
 */

// Unicode ranges for Indic scripts (Devanagari + Bengali/Bangla)
const INDIC_RANGE = /[\u0900-\u097F\u0980-\u09FF]/g;

// Characters per token by script type
const CHARS_PER_TOKEN_LATIN = 4;
const CHARS_PER_TOKEN_INDIC = 2.5;

/**
 * Estimate token count for a text string.
 *
 * Uses a simple heuristic: ~4 characters per token for English,
 * ~2.5 characters per token for Hindi/Bengali (due to Unicode).
 * This is a rough approximation — actual tokenization depends on the model.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  const totalChars = text.length;
  const indicMatches = text.match(INDIC_RANGE);
  const indicChars = indicMatches ? indicMatches.length : 0;
  const latinChars = totalChars - indicChars;

  // Compute tokens for each script portion separately
  const latinTokens = latinChars / CHARS_PER_TOKEN_LATIN;
  const indicTokens = indicChars / CHARS_PER_TOKEN_INDIC;

  return Math.ceil(latinTokens + indicTokens);
}

/**
 * Estimate total input tokens for a prompt (system prompt + user message).
 */
export function estimatePromptTokens(
  systemPrompt: string,
  userMessage: string
): number {
  const promptText = (systemPrompt ?? '') + (userMessage ?? '');
  return estimateTokens(promptText);
}

/**
 * Estimate output tokens for a response string.
 */
export function estimateResponseTokens(response: string): number {
  return estimateTokens(response ?? '');
}

/**
 * Estimate total tokens (input + output) for a full agent invocation.
 *
 * This is the primary fallback used by the Budget_Tracker (Req 30.8)
 * when `agent_invocations.tokens_used IS NULL`.
 */
export function estimateTotal(
  systemPrompt: string,
  userMessage: string,
  response: string
): number {
  return estimatePromptTokens(systemPrompt, userMessage) + estimateResponseTokens(response);
}
