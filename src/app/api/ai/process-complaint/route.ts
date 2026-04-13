import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

// ── Types ────────────────────────────────────────────────────────────────────

interface ProcessComplaintRequest {
  text: string;
  block?: string;
  district?: string;
  language?: 'en' | 'bn';
}

interface AIAnalysisResponse {
  category: string;
  urgency: string;
  sentiment: string;
  summary: string;
  suggestedAction: string;
  language: string;
  confidence: number;
  keywords: string[];
  department: string;
}

// ── Defaults (used when JSON parsing fails) ──────────────────────────────────

const DEFAULT_RESPONSE: AIAnalysisResponse = {
  category: 'Other',
  urgency: 'MEDIUM',
  sentiment: 'NEUTRAL',
  summary: '',
  suggestedAction: 'Review and forward to the appropriate department.',
  language: 'en',
  confidence: 30,
  keywords: [],
  department: 'General',
};

const VALID_CATEGORIES = [
  'Water Supply',
  'Road Damage',
  'Electricity',
  'Sanitation',
  'Healthcare',
  'Education',
  'Public Transport',
  'Agriculture',
  'Housing',
  'Other',
];

const VALID_URGENCIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const VALID_SENTIMENTS = ['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'FRUSTRATED', 'URGENT'];

// ── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI Complaint Analysis Agent for the West Bengal Government Grievance Portal. You analyze citizen complaints in English, Bengali, and Hindi. Your job is to:

1. Categorize the complaint into one of: Water Supply, Road Damage, Electricity, Sanitation, Healthcare, Education, Public Transport, Agriculture, Housing, Other
2. Determine urgency: LOW (minor inconvenience), MEDIUM (affects daily life), HIGH (urgent, affecting many people), CRITICAL (life-threatening or emergency)
3. Analyze sentiment: POSITIVE, NEGATIVE, NEUTRAL, FRUSTRATED, URGENT
4. Write a clear English summary (even if complaint is in Bengali/Hindi)
5. Suggest what action the officer should take
6. Detect the input language
7. Extract key keywords
8. Suggest the responsible government department (PHE=Public Health Engineering for water, PWD=Public Works for roads, WBSEDCL for electricity, Health Dept, Education Dept, etc.)

IMPORTANT: Respond with ONLY valid JSON. No markdown, no explanation, just raw JSON.`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildUserPrompt(body: ProcessComplaintRequest): string {
  return `Analyze this citizen complaint and respond in JSON format:
{ "text": ${JSON.stringify(body.text)}, "block": ${JSON.stringify(body.block || 'unknown')}, "district": ${JSON.stringify(body.district || 'unknown')} }

Required JSON fields:
{
  "category": "one of the 10 categories",
  "urgency": "LOW|MEDIUM|HIGH|CRITICAL",
  "sentiment": "POSITIVE|NEGATIVE|NEUTRAL|FRUSTRATED|URGENT",
  "summary": "clear English summary in 1-2 sentences",
  "suggestedAction": "what the officer should do",
  "language": "en|bn|hi",
  "confidence": 85,
  "keywords": ["keyword1", "keyword2"],
  "department": "PHE|PWD|WBSEDCL|Health|Education|..."
}`;
}

/**
 * Strip markdown code fences that LLMs sometimes wrap around JSON.
 * Handles ```json ... ``` and ``` ... ``` blocks.
 */
function stripMarkdownFences(raw: string): string {
  let cleaned = raw.trim();
  // Remove opening fence
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
  // Remove closing fence
  cleaned = cleaned.replace(/\n?```\s*$/i, '');
  return cleaned.trim();
}

function sanitizeResponse(parsed: Record<string, unknown>): AIAnalysisResponse {
  return {
    category: VALID_CATEGORIES.includes(parsed.category as string)
      ? (parsed.category as string)
      : DEFAULT_RESPONSE.category,
    urgency: VALID_URGENCIES.includes(parsed.urgency as string)
      ? (parsed.urgency as string)
      : DEFAULT_RESPONSE.urgency,
    sentiment: VALID_SENTIMENTS.includes(parsed.sentiment as string)
      ? (parsed.sentiment as string)
      : DEFAULT_RESPONSE.sentiment,
    summary: typeof parsed.summary === 'string' ? parsed.summary : bodyFallback('text'),
    suggestedAction:
      typeof parsed.suggestedAction === 'string'
        ? parsed.suggestedAction
        : DEFAULT_RESPONSE.suggestedAction,
    language: ['en', 'bn', 'hi'].includes(parsed.language as string)
      ? (parsed.language as string)
      : DEFAULT_RESPONSE.language,
    confidence:
      typeof parsed.confidence === 'number' &&
      parsed.confidence >= 0 &&
      parsed.confidence <= 100
        ? parsed.confidence
        : DEFAULT_RESPONSE.confidence,
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((k: unknown) => typeof k === 'string').slice(0, 10)
      : DEFAULT_RESPONSE.keywords,
    department:
      typeof parsed.department === 'string'
        ? parsed.department
        : DEFAULT_RESPONSE.department,
  };
}

/** Helper to reference the original complaint text for fallback summary */
let _requestText = '';

function bodyFallback(_field: string): string {
  return _requestText
    ? `Citizen complaint: ${_requestText.slice(0, 120)}${_requestText.length > 120 ? '…' : ''}`
    : DEFAULT_RESPONSE.summary;
}

// ── Route Handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body: ProcessComplaintRequest = await request.json();

    if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Complaint text is required' },
        { status: 400 },
      );
    }

    _requestText = body.text.trim();

    // ── Call LLM with a 15-second timeout ──
    const completion = await Promise.race([
      (async () => {
        const zai = await ZAI.create();
        return zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(body) },
          ],
          thinking: { type: 'disabled' },
        });
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LLM request timed out after 15 seconds')), 15_000),
      ),
    ]);

    const rawContent = completion.choices[0]?.message?.content;

    if (!rawContent || rawContent.trim().length === 0) {
      console.warn('[AI Brain] Empty response from LLM — returning defaults');
      return NextResponse.json({
        ...DEFAULT_RESPONSE,
        summary: bodyFallback('text'),
        _fallback: true,
        _reason: 'empty_response',
      });
    }

    // ── Parse JSON (with fence-stripping fallback) ──
    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(rawContent);
    } catch {
      // Try stripping markdown code fences
      try {
        parsed = JSON.parse(stripMarkdownFences(rawContent));
      } catch {
        console.warn('[AI Brain] Failed to parse LLM JSON response — returning defaults');
        console.warn('[AI Brain] Raw response:', rawContent.slice(0, 300));
        return NextResponse.json({
          ...DEFAULT_RESPONSE,
          summary: bodyFallback('text'),
          _fallback: true,
          _reason: 'json_parse_error',
        });
      }
    }

    // ── Sanitize & validate fields ──
    const analysis = sanitizeResponse(parsed);

    return NextResponse.json(analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AI Brain] Error processing complaint:', message);

    // Return a graceful fallback instead of 500 so the n8n workflow doesn't break
    return NextResponse.json(
      {
        ...DEFAULT_RESPONSE,
        summary: _requestText
          ? `Citizen complaint: ${_requestText.slice(0, 120)}${_requestText.length > 120 ? '…' : ''}`
          : '',
        _fallback: true,
        _reason: 'server_error',
        _error: message,
      },
      { status: 200 }, // Intentionally 200 so n8n can still proceed
    );
  }
}
