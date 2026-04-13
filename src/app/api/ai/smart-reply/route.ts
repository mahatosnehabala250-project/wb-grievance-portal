import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';

// ── Types ────────────────────────────────────────────────────────────────────

interface SmartReplyRequest {
  complaintId: string;
  language?: 'en' | 'bn';
}

interface SmartReplyResponse {
  en: string;
  bn: string;
}

// ── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a helpful government officer assistant for West Bengal. Generate empathetic, professional replies to citizen complaints. Always be respectful and provide helpful information. Generate replies in both English and Bengali.

Guidelines:
- Acknowledge the citizen's issue specifically (use details from the complaint)
- State what action is being taken
- Provide a realistic timeline for resolution
- Be empathetic and professional
- Keep replies concise but informative (2-4 sentences each)
- In Bengali reply, use standard formal Bengali (not transliteration)
- Include the ticket number if provided

IMPORTANT: Respond with ONLY valid JSON in this exact format, no markdown, no explanation:
{ "en": "English reply here", "bn": "Bengali reply here" }`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildUserPrompt(
  complaint: {
    ticketNo: string;
    issue: string;
    category: string;
    block: string;
    district: string;
    urgency: string;
    status: string;
    citizenName: string | null;
  },
): string {
  return `Generate professional, empathetic replies for this citizen complaint:

Ticket: ${complaint.ticketNo}
Citizen: ${complaint.citizenName || 'Anonymous'}
Category: ${complaint.category}
Urgency: ${complaint.urgency}
Status: ${complaint.status}
Block: ${complaint.block}
District: ${complaint.district}

Complaint: ${complaint.issue}

Generate replies that acknowledge the specific issue, mention the action being taken, and provide a timeline. Reply in both English (en) and Bengali (bn).`;
}

/**
 * Strip markdown code fences that LLMs sometimes wrap around JSON.
 */
function stripMarkdownFences(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
  cleaned = cleaned.replace(/\n?```\s*$/i, '');
  return cleaned.trim();
}

function parseReplies(raw: string): SmartReplyResponse | null {
  // Try direct parse
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.en === 'string' && typeof parsed.bn === 'string') {
      return { en: parsed.en, bn: parsed.bn };
    }
  } catch {
    // fall through
  }

  // Try stripping fences
  try {
    const parsed = JSON.parse(stripMarkdownFences(raw));
    if (typeof parsed.en === 'string' && typeof parsed.bn === 'string') {
      return { en: parsed.en, bn: parsed.bn };
    }
  } catch {
    // fall through
  }

  return null;
}

function generateFallbackReplies(complaint: {
  ticketNo: string;
  category: string;
  block: string;
}): SmartReplyResponse {
  const ticketNo = complaint.ticketNo;
  const category = complaint.category;

  return {
    en: `Thank you for reaching out regarding your ${category.toLowerCase()} concern in ${complaint.block}. Your complaint (${ticketNo}) has been registered and is being reviewed by the concerned department. We will keep you updated on the progress. For urgent issues, please contact the Block Development Office.`,
    bn: `আপনার ${complaint.block}-এ ${category.toLowerCase()} সম্পর্কিত অভিযোগের জন্য ধন্যবাদ। আপনার অভিযোগ (${ticketNo}) নিবন্ধিত হয়েছে এবং সংশ্লিষ্ট বিভাগ দ্বারা পর্যালোচনা করা হচ্ছে। আমরা আপনাকে অগ্রগতির বিষয়ে অবহিত রাখব। জরুরি বিষয়ের জন্য অনুগ্রহ করে ব্লক উন্নয়ন অফিসে যোগাযোগ করুন।`,
  };
}

// ── Route Handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body: SmartReplyRequest = await request.json();

    if (!body.complaintId || typeof body.complaintId !== 'string') {
      return NextResponse.json(
        { error: 'complaintId is required' },
        { status: 400 },
      );
    }

    // ── Fetch complaint from DB ──
    const complaint = await db.complaint.findUnique({
      where: { id: body.complaintId },
      select: {
        ticketNo: true,
        issue: true,
        category: true,
        block: true,
        district: true,
        urgency: true,
        status: true,
        citizenName: true,
      },
    });

    if (!complaint) {
      return NextResponse.json(
        { error: 'Complaint not found' },
        { status: 404 },
      );
    }

    // ── Call LLM with a 15-second timeout ──
    let rawContent: string;

    try {
      const completion = await Promise.race([
        (async () => {
          const zai = await ZAI.create();
          return zai.chat.completions.create({
            messages: [
              { role: 'assistant', content: SYSTEM_PROMPT },
              { role: 'user', content: buildUserPrompt(complaint) },
            ],
            thinking: { type: 'disabled' },
          });
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('LLM request timed out after 15 seconds')),
            15_000,
          ),
        ),
      ]);

      rawContent = completion.choices[0]?.message?.content || '';
    } catch (llmError) {
      const msg = llmError instanceof Error ? llmError.message : 'Unknown LLM error';
      console.warn('[Smart Reply] LLM error, using fallback:', msg);

      const fallback = generateFallbackReplies(complaint);
      return NextResponse.json({
        replies: fallback,
        _fallback: true,
        _reason: 'llm_error',
      });
    }

    if (!rawContent.trim()) {
      console.warn('[Smart Reply] Empty response from LLM — using fallback');
      const fallback = generateFallbackReplies(complaint);
      return NextResponse.json({
        replies: fallback,
        _fallback: true,
        _reason: 'empty_response',
      });
    }

    // ── Parse JSON response ──
    const replies = parseReplies(rawContent);

    if (!replies) {
      console.warn('[Smart Reply] Failed to parse LLM JSON — using fallback');
      console.warn('[Smart Reply] Raw response:', rawContent.slice(0, 300));
      const fallback = generateFallbackReplies(complaint);
      return NextResponse.json({
        replies: fallback,
        _fallback: true,
        _reason: 'json_parse_error',
      });
    }

    return NextResponse.json({ replies });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Smart Reply] Error generating reply:', message);

    return NextResponse.json(
      { error: 'Failed to generate smart reply' },
      { status: 500 },
    );
  }
}
