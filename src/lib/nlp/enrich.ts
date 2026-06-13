/**
 * nlp/enrich.ts — NLP Brain (Level 4): read the RAW complaint text with Claude
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
 * Model is configurable via ANTHROPIC_MODEL (default: claude-haiku-4-5 — the
 * cost-right choice for per-complaint enrichment at scale; ~₹0.3/complaint.
 * Set to claude-opus-4-8 or claude-sonnet-4-6 for higher quality at higher cost).
 *
 * Graceful: if ANTHROPIC_API_KEY is unset, enrichOne() returns null and the
 * caller skips — the rest of the system works without NLP.
 *
 * ETHICS LINE: aggregate civic intelligence only. We extract issue-level signal,
 * NOT individual-citizen psychological profiles for targeting. Output is used in
 * scope-locked aggregates (clusters, hotspots) — never to profile a named voter.
 */

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

export interface NlpResult {
  anger_score: number;
  emotion: string;
  root_cause: string;
  root_cause_key: string;
  entities: {
    officers: string[];
    schemes: string[];
    infrastructure: string[];
    places: string[];
  };
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

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic();
  return _client;
}

export function nlpEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
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

Do NOT psychologically profile the individual. Extract issue-level facts only. Respond with ONLY the JSON object.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    anger_score: { type: 'integer' },
    emotion: { type: 'string', enum: EMOTIONS },
    root_cause: { type: 'string' },
    root_cause_key: { type: 'string' },
    entities: {
      type: 'object',
      additionalProperties: false,
      properties: {
        officers: { type: 'array', items: { type: 'string' } },
        schemes: { type: 'array', items: { type: 'string' } },
        infrastructure: { type: 'array', items: { type: 'string' } },
        places: { type: 'array', items: { type: 'string' } },
      },
      required: ['officers', 'schemes', 'infrastructure', 'places'],
    },
    summary_en: { type: 'string' },
    severity_flags: { type: 'array', items: { type: 'string', enum: FLAGS } },
  },
  required: ['anger_score', 'emotion', 'root_cause', 'root_cause_key', 'entities', 'summary_en', 'severity_flags'],
} as const;

function clampScore(n: unknown): number {
  const v = typeof n === 'number' ? n : 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function slug(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'unknown';
}

/** Enrich a single complaint. Returns null if NLP is not configured or the call fails. */
export async function enrichOne(c: ComplaintForNlp): Promise<NlpResult | null> {
  const client = getClient();
  if (!client) return null;

  const userText = [
    `Category: ${c.category || 'unknown'}`,
    c.village || c.block ? `Location: ${[c.village, c.block].filter(Boolean).join(', ')}` : '',
    `Complaint: ${c.issue || ''}`,
    c.description ? `Details: ${c.description}` : '',
  ].filter(Boolean).join('\n');

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages: [{ role: 'user', content: userText }],
    } as Anthropic.MessageCreateParamsNonStreaming);

    const block = resp.content.find((b) => b.type === 'text');
    const raw = block && block.type === 'text' ? block.text : '';
    if (!raw) return null;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    }

    const ent = (parsed.entities || {}) as Record<string, unknown>;
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 10) : [];

    return {
      anger_score: clampScore(parsed.anger_score),
      emotion: EMOTIONS.includes(parsed.emotion as string) ? (parsed.emotion as string) : 'neutral',
      root_cause: typeof parsed.root_cause === 'string' ? parsed.root_cause.slice(0, 200) : '',
      root_cause_key: slug(typeof parsed.root_cause_key === 'string' ? parsed.root_cause_key : String(parsed.root_cause || '')),
      entities: {
        officers: arr(ent.officers),
        schemes: arr(ent.schemes),
        infrastructure: arr(ent.infrastructure),
        places: arr(ent.places),
      },
      summary_en: typeof parsed.summary_en === 'string' ? parsed.summary_en.slice(0, 300) : '',
      severity_flags: Array.isArray(parsed.severity_flags)
        ? (parsed.severity_flags as unknown[]).filter((f) => FLAGS.includes(f as string)) as string[]
        : [],
      model: MODEL,
    };
  } catch (err) {
    console.error('[NLP] enrichOne failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
