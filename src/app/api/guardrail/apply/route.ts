import { NextRequest, NextResponse } from 'next/server';
import { checkReply } from '@/lib/guardrail/check';

/**
 * POST /api/guardrail/apply  (n8n internal, Phase 1 P0)
 *
 * Output safety gate for citizen-facing replies. The WhatsApp agent (JS-01) can
 * call this just before "Send Reply" to sanitise the AI's text:
 *   • strips internal metadata blocks (progress_signal JSON the agent appends)
 *   • length cap, URL allowlist, JSON/tool-leak strip, PII masking (repair-grade)
 *   • refusal-text / language-mismatch (substitute-grade)
 *
 * Returns the cleaned `reply` to actually send. Unlike a blocking guardrail,
 * this endpoint ALWAYS returns a usable reply: on a substitute-grade violation
 * it returns a localized fallback line, never an empty string — so it can never
 * silently drop a citizen reply.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET.
 *
 * Body: { reply: string, language?: 'bn'|'hi'|'en' }
 * Response: { ok: true, data: { reply, action, violations } }
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Strip a trailing `progress_signal` JSON block (fenced or bare) the specialist
 * prompts append as internal metadata. This is NOT a leak and must never reach
 * the citizen — remove it before the guardrail's json-leak rule sees it.
 */
function stripProgressSignal(text: string): string {
  let t = String(text || '');
  t = t.replace(/```(?:json)?\s*\{[\s\S]*?progress_signal[\s\S]*?\}\s*```/gi, '');
  t = t.replace(/\{[\s\S]*?progress_signal[\s\S]*?\}\s*$/i, '');
  t = t.replace(/```+\s*$/g, '').replace(/\s+$/g, '');
  return t.trim();
}

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get('x-n8n-secret');
    const expected = process.env.N8N_WEBHOOK_SECRET;
    if (!expected || secret !== expected) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'request body must be a JSON object' },
        { status: 400 }
      );
    }

    const rawReply = (body as Record<string, unknown>).reply;
    const language = (body as Record<string, unknown>).language;
    if (typeof rawReply !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'reply is required and must be a string' },
        { status: 400 }
      );
    }

    const cleaned = stripProgressSignal(rawReply);
    const lang = language === 'hi' || language === 'bn' || language === 'en' ? language : 'bn';

    const result = await checkReply(cleaned, { language: lang });

    return NextResponse.json({
      ok: true,
      data: {
        reply: result.reply,
        action: result.action,
        violations: result.violations,
      },
    });
  } catch (error) {
    console.error('[guardrail/apply] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
