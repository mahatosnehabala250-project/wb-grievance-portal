/**
 * Gemini Flash Intent Classifier (task 18.1).
 *
 * Thin wrapper around the Google Gemini `gemini-1.5-flash` REST endpoint that
 * classifies a single inbound WhatsApp message into one of five intents. This
 * is the *fallback* path of the Hybrid CEO Router (Design §v1.1.1): it only
 * runs when the deterministic v1 rules in `ceoRouter.ts` produce no confident
 * decision and the message is not in a hot-locked state.
 *
 * Design goals:
 *   - JSON-only output (we force `responseMimeType: application/json`).
 *   - Strict parsing: any malformed / unexpected output collapses to the safe
 *     fallback `{ intent: 'welcome', confidence: 0 }` (Req 20.8 — never throw
 *     into the user-facing path).
 *   - Bounded latency: an AbortController timeout guarantees the classifier can
 *     never hang the router. Timeouts also collapse to the safe fallback.
 *
 * Env:
 *   - GEMINI_API_KEY — Google Generative Language API key.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.1 Hybrid CEO Router
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 20.2, 20.7, 20.8
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** The five terminal intents the router can dispatch to. */
export type Intent = 'complaint' | 'blood' | 'donor' | 'info' | 'welcome';

/** The set of valid intents, used for strict validation of model output. */
export const INTENTS: readonly Intent[] = [
  'complaint',
  'blood',
  'donor',
  'info',
  'welcome',
] as const;

/** Minimal result returned by {@link classifyIntent}. */
export interface IntentResult {
  intent: Intent;
  /** Coarse confidence signal in [0, 1]. 0 means "fallback / not classified". */
  confidence: number;
}

/** Structured input matching Design §v1.1.1 `ClassifierInput`. */
export interface ClassifierInput {
  message: string;
  language: 'en' | 'hi' | 'bn';
  traceId?: string;
}

/** Structured output matching Design §v1.1.1 `ClassifierOutput`. */
export interface ClassifierOutput {
  agent: Intent;
  confidence: number;
  secondary_agent?: Intent | null;
  rationale: string;
  latency_ms: number;
  total_tokens: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const GEMINI_MODEL = 'gemini-1.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/** Hard ceiling on a single classifier call. The router must never block. */
const DEFAULT_TIMEOUT_MS = 4000;

/** Safe fallback returned on any error, timeout, or malformed response. */
const SAFE_FALLBACK: IntentResult = { intent: 'welcome', confidence: 0 };

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
  { "intent": <class>, "confidence": <number in [0,1]> }

Rules:
  - If you are < 60% sure, set confidence accordingly so we can ask the user.
  - Code-mixed Hindi/Bengali/English is normal; classify on intent, not language.
  - Never include any field outside the schema. Never include markdown.

Message language hint: ${language}
Message:
${normalized}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Type guard: is `v` one of the five valid intents? */
function isIntent(v: unknown): v is Intent {
  return typeof v === 'string' && (INTENTS as readonly string[]).includes(v);
}

/** Clamp an arbitrary value into a confidence number in [0, 1]; NaN → 0. */
function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Extract the text payload from a Gemini `generateContent` response.
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
 * Parse the model's JSON text into a validated {@link IntentResult}.
 *
 * Tolerates a stray markdown code-fence (```json ... ```) even though the
 * prompt forbids it. Any other deviation returns the safe fallback.
 */
export function parseClassifierText(text: string | null): IntentResult {
  if (!text) return { ...SAFE_FALLBACK };

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
    return { ...SAFE_FALLBACK };
  }

  const obj = parsed as { intent?: unknown; agent?: unknown; confidence?: unknown };
  // Accept either `intent` (our schema) or `agent` (design alias) defensively.
  const rawIntent = obj.intent ?? obj.agent;
  if (!isIntent(rawIntent)) return { ...SAFE_FALLBACK };

  return { intent: rawIntent, confidence: clampConfidence(obj.confidence) };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Classify a WhatsApp message into one of the five router intents.
 *
 * Always resolves (never rejects). On any failure — missing API key, network
 * error, non-200 response, timeout, or malformed body — it returns the safe
 * fallback `{ intent: 'welcome', confidence: 0 }`.
 *
 * @param message   Raw inbound text (will be NFC-normalized for the prompt).
 * @param language  Language hint ('en' | 'hi' | 'bn' or any locale string).
 * @param timeoutMs Optional override for the abort timeout (default 4000 ms).
 */
export async function classifyIntent(
  message: string,
  language: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<IntentResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // No key configured — fail safe rather than throwing.
    return { ...SAFE_FALLBACK };
  }

  // Empty / whitespace-only messages are unclear → welcome menu, no LLM call.
  if (!message || message.trim().length === 0) {
    return { ...SAFE_FALLBACK };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(message, language) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          maxOutputTokens: 64,
        },
      }),
    });

    if (!res.ok) {
      return { ...SAFE_FALLBACK };
    }

    const payload: unknown = await res.json();
    return parseClassifierText(extractText(payload));
  } catch {
    // Network error, abort/timeout, or JSON read failure → safe fallback.
    return { ...SAFE_FALLBACK };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Design-compatible adapter (Design §v1.1.1 `classify`).
 *
 * Wraps {@link classifyIntent} to produce the richer `ClassifierOutput` shape
 * consumed by `decideHybrid` (task 18.3) and `POST /api/router/classify`
 * (task 18.5). Records `latency_ms`; `total_tokens` is best-effort (0 when the
 * provider does not surface usage — downstream falls back to `estimateTokens`).
 */
export async function classify(input: ClassifierInput): Promise<ClassifierOutput> {
  const start = Date.now();
  const { intent, confidence } = await classifyIntent(input.message, input.language);
  return {
    agent: intent,
    confidence,
    secondary_agent: null,
    rationale: confidence === 0 ? 'parse_failure' : `classified_as_${intent}`,
    latency_ms: Date.now() - start,
    total_tokens: 0,
  };
}
