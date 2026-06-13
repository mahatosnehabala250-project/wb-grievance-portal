/**
 * nlp/enrich.ts — NLP Brain (Level 4): read the RAW complaint text with an LLM
 * and extract intelligence that category/urgency alone can't capture.
 *
 * Extracts per complaint:
 *   - anger_score (0-100): how distressed/angry the citizen actually sounds
 *   - emotion: desperate | angry | frustrated | anxious | neutral | hopeful
 *   - root_cause + root_cause_key: the underlying cause (for clustering —
 *     "8 complaints share ONE broken pump" → 1 fix, 8 resolutions)
 *   - entities: officers / schemes / infrastructure / places named in the text
 *   - severity_flags: child_safety | health_risk | water | repeat | vulnerable | safety
 *   - summary_en: 1-line English summary
 *
 * PROVIDER-FLEXIBLE (picks the first configured):
 *   1. GEMINI_API_KEY  → Gemini (default model gemini-2.5-flash-lite — cheapest,
 *      same model the n8n agents use). Set GEMINI_MODEL to override.
 *   2. ANTHROPIC_API_KEY → Claude (ANTHROPIC_MODEL, default claude-haiku-4-5).
 *
 * Graceful: if neither key is set, enrichOne() returns null and the caller
 * skips — the rest of the system works without NLP.
 *
 * ETHICS LINE: aggregate civic intelligence only. Issue-level signal, NOT
 * individual-citizen psychological profiles for targeting. Output is used in
 * scope-locked aggregates (clusters, hotspots) — never to profile a named voter.
 */

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

export interface NlpResult {
  anger_score: number;
  emotion: string;
  root_cause: string;
  root_cause_key: string;
  entities: { officers: string[]; schemes: string[]; infrastructure: string[]; places: string[] };
  summary_en: string;
  severity_flags: string[];
  model: string;
}

export interface ComplaintForNlp {
  issue: string;
  description?: string | null;
  category?: string | null;
  village?: string | null;
  block?: string | null;
}

export function nlpEnabled(): boolean {
  return !!(GEMINI_KEY || ANTHROPIC_KEY);
}

export function nlpProvider(): 'gemini' | 'anthropic' | null {
  if (GEMINI_KEY) return 'gemini';
  if (ANTHROPIC_KEY) return 'anthropic';
  return null;
}

const EMOTIONS = ['desperate', 'angry', 'frustrated', 'anxious', 'neutral', 'hopeful'];
const FLAGS = ['child_safety', 'health_risk', 'water', 'repeat', 'vulnerable', 'safety'];

const SYSTEM = `You are an analyst for a West Bengal citizen-grievance system. You read raw complaints written in Bengali, Hindi, or English (often transliterated) and extract STRUCTURED, AGGREGATE-LEVEL signal.

Rules:
- anger_score (0-100): how distressed/angry/desperate the citizen sounds in their OWN words. 0 = calm factual report, 100 = furious or desperate (children sick, days of neglect, threats to protest).
- emotion: one of desperate, angry, frustrated, anxious, neutral, hopeful.
- root_cause: the UNDERLYING cause in <=8 plain-English words (e.g. "village tube-well broken 15 days"). Two complaints about the same broken pump must produce the SAME root_cause wording.
- root_cause_key: a lowercase hyphenated slug of the root cause, place-anchored (e.g. "jangidiri-tubewell-broken"). Identical underlying problems MUST get identical keys so they cluster.
- entities: names of officers, government schemes, infrastructure (pump/road/transformer/PHC/school), and places mentioned. Empty arrays if none.
- severity_flags: any of [child_safety, health_risk, water, repeat, vulnerable, safety] that genuinely apply. Empty if none.
- summary_en: one neutral English sentence.

Do NOT psychologically profile the individual. Extract issue-level facts only.

Respond with ONLY a JSON object of this exact shape (no markdown, no prose):
{"anger_score":0,"emotion":"neutral","root_cause":"","root_cause_key":"","entities":{"officers":[],"schemes":[],"infrastructure":[],"places":[]},"summary_en":"","severity_flags":[]}`;

function clampScore(n: unknown): number {
  const v = typeof n === 'number' ? n : parseInt(String(n), 10);
  return Math.max(0, Math.min(100, isNaN(v) ? 0 : Math.round(v)));
}
function slug(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unknown';
}
function buildUser(c: ComplaintForNlp): string {
  return [
    `Category: ${c.category || 'unknown'}`,
    c.village || c.block ? `Location: ${[c.village, c.block].filter(Boolean).join(', ')}` : '',
    `Complaint: ${c.issue || ''}`,
    c.description ? `Details: ${c.description}` : '',
  ].filter(Boolean).join('\n');
}

function parseJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { /* try cleaning */ }
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* give up */ }
  }
  return null;
}

// ── Gemini (REST, no SDK) ──
async function callGemini(system: string, user: string): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1024, temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[NLP/gemini] HTTP ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// ── Anthropic (SDK) ──
async function callAnthropic(system: string, user: string): Promise<string | null> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const resp = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: user + '\n\nRespond with ONLY the JSON object.' }],
  });
  const block = resp.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : null;
}

/** Enrich a single complaint. Returns null if NLP is not configured or the call fails. */
export async function enrichOne(c: ComplaintForNlp): Promise<NlpResult | null> {
  const provider = nlpProvider();
  if (!provider) return null;

  const user = buildUser(c);
  let raw: string | null = null;
  let modelName = '';
  try {
    if (provider === 'gemini') { raw = await callGemini(SYSTEM, user); modelName = GEMINI_MODEL; }
    else { raw = await callAnthropic(SYSTEM, user); modelName = ANTHROPIC_MODEL; }
  } catch (err) {
    console.error('[NLP] provider call failed:', err instanceof Error ? err.message : err);
    return null;
  }

  const parsed = parseJson(raw || '');
  if (!parsed) return null;

  const ent = (parsed.entities || {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 10) : []);

  return {
    anger_score: clampScore(parsed.anger_score),
    emotion: EMOTIONS.includes(parsed.emotion as string) ? (parsed.emotion as string) : 'neutral',
    root_cause: typeof parsed.root_cause === 'string' ? parsed.root_cause.slice(0, 200) : '',
    root_cause_key: slug(typeof parsed.root_cause_key === 'string' ? parsed.root_cause_key : String(parsed.root_cause || '')),
    entities: {
      officers: arr(ent.officers), schemes: arr(ent.schemes),
      infrastructure: arr(ent.infrastructure), places: arr(ent.places),
    },
    summary_en: typeof parsed.summary_en === 'string' ? parsed.summary_en.slice(0, 300) : '',
    severity_flags: Array.isArray(parsed.severity_flags)
      ? (parsed.severity_flags as unknown[]).filter((f) => FLAGS.includes(f as string)) as string[]
      : [],
    model: modelName,
  };
}
