/**
 * Token Estimator — n8n Code Node (JavaScript)
 *
 * Deterministic local token estimator for use inside n8n Code Nodes.
 * Same logic as src/lib/tokens/estimateTokens.ts but self-contained
 * (no npm imports — n8n Code Nodes run in a sandboxed VM).
 *
 * Used as fallback when the upstream Gemini node does not expose tokenUsage.
 * The agent_invocations table stores tokens_used as NULLABLE — when NULL,
 * downstream consumers use this estimator (Req 18.15, 30.8).
 *
 * Properties (Property 37):
 * - Non-negative: always returns >= 0
 * - Deterministic: same input → same output
 * - Monotonic: longer text → more tokens
 * - Empty string → 0
 */

// Unicode ranges for Indic scripts (Devanagari + Bengali/Bangla)
const INDIC_RANGE = /[\u0900-\u097F\u0980-\u09FF]/g;

// Characters per token by script type
const CHARS_PER_TOKEN_LATIN = 4;
const CHARS_PER_TOKEN_INDIC = 2.5;

/**
 * Estimate token count for a text string.
 */
function estimateTokens(text) {
  if (!text || text.length === 0) return 0;

  const totalChars = text.length;
  const indicMatches = text.match(INDIC_RANGE);
  const indicChars = indicMatches ? indicMatches.length : 0;
  const latinChars = totalChars - indicChars;

  const latinTokens = latinChars / CHARS_PER_TOKEN_LATIN;
  const indicTokens = indicChars / CHARS_PER_TOKEN_INDIC;

  return Math.ceil(latinTokens + indicTokens);
}

/**
 * Estimate total input tokens for a prompt (system prompt + user message).
 */
function estimatePromptTokens(systemPrompt, userMessage) {
  const promptText = (systemPrompt || '') + (userMessage || '');
  return estimateTokens(promptText);
}

/**
 * Estimate output tokens for a response string.
 */
function estimateResponseTokens(response) {
  return estimateTokens(response || '');
}

/**
 * Estimate total tokens (input + output) for a full agent invocation.
 */
function estimateTotal(systemPrompt, userMessage, response) {
  return estimatePromptTokens(systemPrompt, userMessage) + estimateResponseTokens(response);
}

// --- n8n Code Node entry point ---
// Usage in n8n: call estimateTotal(systemPrompt, userMessage, agentReply)
// to get the fallback token count when tokenUsage is not available.

const systemPrompt = $json.systemPrompt || $json.system_prompt || '';
const userMessage = $json.userMessage || $json.user_message || $json.message || '';
const response = $json.response || $json.reply || $json.output || '';

const tokens = estimateTotal(systemPrompt, userMessage, response);

return [{
  json: {
    ...$json,
    estimated_tokens: tokens,
    estimated_prompt_tokens: estimatePromptTokens(systemPrompt, userMessage),
    estimated_response_tokens: estimateResponseTokens(response),
  }
}];
