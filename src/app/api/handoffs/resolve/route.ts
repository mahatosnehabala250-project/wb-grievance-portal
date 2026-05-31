import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Localized closing templates sent to the citizen when an officer resolves the
 * handoff (Req 24.5 mirrors the handoff-open notice; this is its close-out).
 */
const CLOSING_TEMPLATES: Record<'en' | 'hi' | 'bn', string> = {
  en: 'Your request has been resolved by our support officer. Thank you for your patience. You can message again anytime.',
  hi: 'Aap ki samasya hamare officer dwara hal kar di gayi hai. Dhanyavaad. Aap kabhi bhi dobara message kar sakte hain.',
  bn: 'আপনার অনুরোধটি আমাদের অফিসার সমাধান করেছেন। ধন্যবাদ। আপনি যেকোনো সময় আবার বার্তা পাঠাতে পারেন।',
};

function normalizeLanguage(value: unknown): 'en' | 'hi' | 'bn' {
  return value === 'en' || value === 'bn' ? value : 'hi';
}

/**
 * POST /api/handoffs/resolve
 *
 * Admin-only endpoint that closes a human handoff. Race-safe conditional UPDATE
 * per Design §v1.1.5 — a handoff can be resolved from either the `claimed` or
 * `pending` state (`WHERE id = $1 AND status IN ('claimed','pending')`):
 *
 *   UPDATE human_handoff_queue
 *      SET status = 'resolved', resolved_at = now(), resolution_notes = $2
 *    WHERE id = $1 AND status IN ('claimed','pending')
 *   RETURNING id, session_id, status, resolved_at;
 *
 * After the row flips to `resolved`, the conversation is handed back to the bot:
 *   - clears `conversation_sessions.handoff_active` so the CEO Router resumes
 *     specialist dispatch (the inverse of task 22.4's pause),
 *   - resets `conversation_sessions.strike_count` to 0 so the three-strike
 *     counter starts fresh (Design §v1.1.5),
 *   - queues a localized closing message to the citizen via `whatsapp_outbox`.
 *
 * Auth: Admin JWT (Bearer token / cookie).
 *
 * Request body: `{ handoff_id, resolution? }` (aliases `id`, `notes` accepted).
 *
 * Responses:
 *   200 `{ ok: true, data: HandoffRow }`
 *   400 `VALIDATION_FAILED`
 *   401 / 403                       — auth
 *   404 `NOT_FOUND`                 — no such handoff row
 *   409 `HANDOFF_ALREADY_CLAIMED`   — row already `resolved`
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md §v1.1.5, §v1.1.15
 * @see Requirements 24.7
 */
export async function POST(request: NextRequest) {
  try {
    // ─── Auth: admin JWT only ───
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 401 });
    }

    if (payload.role !== 'ADMIN') {
      return NextResponse.json({ ok: false, error: 'Admin access required' }, { status: 403 });
    }

    // ─── Parse body ───
    let body: { handoff_id?: string; id?: string; resolution?: string; notes?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const handoffId = (body.handoff_id ?? body.id ?? '').trim();
    const resolution = body.resolution ?? body.notes;

    // ─── Validation ───
    if (!handoffId) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_FAILED', message: 'handoff_id is required' } },
        { status: 400 }
      );
    }
    if (!UUID_RE.test(handoffId)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_FAILED', message: 'handoff_id must be a UUID' } },
        { status: 400 }
      );
    }
    if (resolution !== undefined && typeof resolution !== 'string') {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_FAILED', message: 'resolution must be a string' } },
        { status: 400 }
      );
    }

    // ─── Race-safe conditional resolve: claimed|pending → resolved ───
    const { data: resolved, error: updateError } = await supabase
      .from('human_handoff_queue')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolution_notes: resolution ?? null,
      })
      .eq('id', handoffId)
      .in('status', ['claimed', 'pending'])
      .select('id, session_id, status, resolved_at, resolution_notes')
      .maybeSingle();

    if (updateError) {
      console.error('[handoffs/resolve] Update error:', updateError);
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve handoff', details: updateError.message } },
        { status: 500 }
      );
    }

    // ─── Zero rows ⇒ disambiguate 404 (no row) vs 409 (already resolved) ───
    if (!resolved) {
      const { data: existing } = await supabase
        .from('human_handoff_queue')
        .select('id, status')
        .eq('id', handoffId)
        .maybeSingle();

      if (!existing) {
        return NextResponse.json(
          { ok: false, error: { code: 'NOT_FOUND', message: 'Handoff not found' } },
          { status: 404 }
        );
      }

      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'HANDOFF_ALREADY_CLAIMED',
            message: `Handoff is already ${existing.status}`,
          },
        },
        { status: 409 }
      );
    }

    // ─── Resume the bot: clear handoff_active + reset strike_count ───
    // Read language first so the closing message is localized correctly.
    const { data: session, error: sessionError } = await supabase
      .from('conversation_sessions')
      .select('session_id, language')
      .eq('session_id', resolved.session_id)
      .maybeSingle();

    if (sessionError) {
      console.warn('[handoffs/resolve] Session lookup error:', sessionError);
    }

    const { error: resumeError } = await supabase
      .from('conversation_sessions')
      .update({ handoff_active: false, strike_count: 0 })
      .eq('session_id', resolved.session_id);

    if (resumeError) {
      // Non-fatal: the handoff is resolved; the router pause is keyed on the
      // queue row status which is now 'resolved'. Log for follow-up.
      console.warn('[handoffs/resolve] Failed to clear handoff_active flag:', resumeError);
    }

    // ─── Queue the localized closing message to the citizen ───
    const language = normalizeLanguage(session?.language);
    const { error: outboxError } = await supabase.from('whatsapp_outbox').insert({
      recipient_phone: resolved.session_id,
      message_body: { type: 'text', text: CLOSING_TEMPLATES[language] },
      status: 'pending',
    });

    if (outboxError) {
      // Non-blocking — the officer's manual chat already covered the citizen.
      console.warn('[handoffs/resolve] Failed to queue closing message:', outboxError);
    }

    // ─── Audit log to activity_logs (Req 24.7, non-blocking) ───
    const { error: logError } = await supabase.from('activity_logs').insert({
      complaintId: null,
      action: 'HANDOFF_RESOLVE',
      description: `Admin resolved handoff ${handoffId} for session ${resolved.session_id}${
        resolution ? `: ${resolution}` : ''
      }`,
      actorId: payload.userId,
      actorName: payload.username,
    });
    if (logError) {
      console.error('[handoffs/resolve] Audit log error:', logError);
    }

    return NextResponse.json({ ok: true, data: resolved });
  } catch (error) {
    console.error('[handoffs/resolve] Error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
