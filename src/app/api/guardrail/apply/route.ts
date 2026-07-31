import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkReply, type GuardrailAction } from '@/lib/guardrail/check';
import { withTelegramInvite } from '@/lib/telegram-invite';

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
 * Body: { reply: string, language?: 'bn'|'hi'|'en', session_id?: string, trace_id?: string }
 * Response: { ok: true, data: { reply, action, violations } }
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * Map a guardrail action to the `guardrail_violations.action` CHECK domain
 * ({ repaired | blocked | flagged }) and a severity bucket. A `pass` is not
 * logged (nothing happened). A repair is low/medium; a block is high.
 */
const ACTION_TO_DB: Partial<Record<GuardrailAction, { action: string; severity: string }>> = {
  repaired: { action: 'repaired', severity: 'low' },
  blocked: { action: 'blocked', severity: 'high' },
};

/** trace_id is a uuid column — only pass through values that actually look like one. */
function isUuid(v: string | undefined): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Fire-and-forget audit write to `guardrail_violations`. One row per fired rule
 * so the admin dashboard can group by rule_name. NEVER throws into the request
 * path — observability must not be able to drop a citizen reply (NFR Reliability).
 */
async function logViolations(args: {
  violations: string[];
  action: GuardrailAction;
  original: string;
  repaired: string;
  sessionId?: string;
  traceId?: string;
}): Promise<void> {
  try {
    const map = ACTION_TO_DB[args.action];
    if (!map || args.violations.length === 0) return; // pass → nothing to log
    if (!supabaseUrl || !supabaseServiceRoleKey) return;

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const rows = args.violations.map((rule) => ({
      session_id: args.sessionId ?? null,
      trace_id: isUuid(args.traceId) ? args.traceId : null,
      rule_name: rule,
      original_reply: args.original.slice(0, 2000),
      repaired_reply: args.repaired.slice(0, 2000),
      action: map.action,
      // refusal/language blocks are higher severity than a length/url repair.
      severity:
        args.action === 'blocked'
          ? 'high'
          : rule === 'pii_leak'
            ? 'medium'
            : 'low',
    }));
    await supabase.from('guardrail_violations').insert(rows);
  } catch (err) {
    console.error('[guardrail/apply] violation log failed (non-fatal):', err);
  }
}

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

/**
 * Is this citizen already on Telegram? Never throws into the reply path — an
 * unanswered lookup just means the invite is offered once more.
 */
async function isTelegramLinked(phone: string): Promise<boolean> {
  try {
    if (!supabaseUrl || !supabaseServiceRoleKey) return false;
    const last10 = phone.replace(/\D/g, '').slice(-10);
    if (last10.length < 10) return false;
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data } = await supabase
      .from('citizen_telegram_links')
      .select('phone')
      .eq('is_active', true)
      .like('phone', `%${last10}`)
      .limit(1);
    return Boolean(data && data.length);
  } catch {
    return false;
  }
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

    // Audit non-pass outcomes (fire-and-forget; never blocks the reply).
    const sessionIdRaw = (body as Record<string, unknown>).session_id;
    const traceIdRaw = (body as Record<string, unknown>).trace_id;
    if (result.action !== 'pass') {
      await logViolations({
        violations: result.violations,
        action: result.action,
        original: cleaned,
        repaired: result.reply,
        sessionId: typeof sessionIdRaw === 'string' ? sessionIdRaw : undefined,
        traceId: typeof traceIdRaw === 'string' && traceIdRaw ? traceIdRaw : undefined,
      });
    }

    // Invite the citizen onto Telegram, after the guardrail rather than before:
    // t.me is not on the URL allowlist, so a link added earlier would be
    // stripped by the very check meant to protect the citizen. Optional `phone`
    // lets the caller skip the invite for someone already linked; without it the
    // invite is simply offered again, which is harmless.
    const phoneRaw = (body as Record<string, unknown>).phone;
    const alreadyLinked = typeof phoneRaw === 'string' && phoneRaw
      ? await isTelegramLinked(phoneRaw)
      : false;
    const reply = withTelegramInvite(result.reply, lang, { alreadyLinked });

    return NextResponse.json({
      ok: true,
      data: {
        reply,
        action: result.action,
        violations: result.violations,
      },
    });
  } catch (error) {
    console.error('[guardrail/apply] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
