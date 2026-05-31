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
 * POST /api/handoffs/claim
 *
 * Admin-only endpoint that lets a support officer claim a pending human-handoff
 * so that no two officers work the same conversation. Uses the race-safe
 * conditional UPDATE from Design §v1.1.5:
 *
 *   UPDATE human_handoff_queue
 *      SET claimed_by = $1, claimed_at = now(), status = 'claimed'
 *    WHERE id = $2 AND status = 'pending'
 *   RETURNING id, session_id, snapshot, claimed_by, claimed_at, status;
 *
 * Only one of N concurrent claims wins — Postgres re-checks the `status='pending'`
 * predicate under the row lock (EvalPlanQual), so the losers match zero rows.
 *
 * Auth: Admin JWT (Bearer token / cookie).
 *
 * Request body: `{ handoff_id }` (alias `id` accepted).
 *
 * Responses:
 *   200 `{ ok: true, data: HandoffRow }`
 *   400 `VALIDATION_FAILED`         — missing / malformed id
 *   401 / 403                       — auth
 *   404 `NOT_FOUND`                 — no such handoff row
 *   409 `HANDOFF_ALREADY_CLAIMED`   — row exists but is not `pending`
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
    let body: { handoff_id?: string; id?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const handoffId = (body.handoff_id ?? body.id ?? '').trim();

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

    // ─── Race-safe conditional claim: pending → claimed ───
    const { data: claimed, error: updateError } = await supabase
      .from('human_handoff_queue')
      .update({
        claimed_by: payload.userId,
        claimed_at: new Date().toISOString(),
        status: 'claimed',
      })
      .eq('id', handoffId)
      .eq('status', 'pending')
      .select('id, session_id, snapshot, claimed_by, claimed_at, status')
      .maybeSingle();

    if (updateError) {
      console.error('[handoffs/claim] Update error:', updateError);
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to claim handoff', details: updateError.message } },
        { status: 500 }
      );
    }

    // ─── Zero rows ⇒ disambiguate 404 (no row) vs 409 (illegal transition) ───
    if (!claimed) {
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
            message: `Handoff is not pending (current status: ${existing.status})`,
          },
        },
        { status: 409 }
      );
    }

    // ─── Audit log to activity_logs (Req 24.7, non-blocking) ───
    const { error: logError } = await supabase.from('activity_logs').insert({
      complaintId: null,
      action: 'HANDOFF_CLAIM',
      description: `Admin claimed handoff ${handoffId} for session ${claimed.session_id}`,
      actorId: payload.userId,
      actorName: payload.username,
    });
    if (logError) {
      console.error('[handoffs/claim] Audit log error:', logError);
    }

    return NextResponse.json({ ok: true, data: claimed });
  } catch (error) {
    console.error('[handoffs/claim] Error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
