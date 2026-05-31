import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/sessions/escalate
 *
 * Admin-only endpoint that lets a human operator force a conversation session
 * into the human-handoff queue without waiting for the three-strike counter to
 * fire. Inserts a `pending` row into `human_handoff_queue` — which the CEO
 * Router treats as a dispatch pause (task 22.4 queries
 * `human_handoff_queue WHERE session_id = $1 AND status IN ('pending','claimed')`)
 * — and best-effort flags `conversation_sessions.handoff_active = true`.
 *
 * The DB-level `reason` column is constrained to ('strike_3','manual','system'),
 * so manual escalations always write `reason = 'manual'`; the operator's free-text
 * justification (and `strikes = 0`, since no strikes accumulated) is captured in
 * the `snapshot` jsonb per the HandoffSnapshot shape.
 *
 * Auth: Admin JWT (Bearer token / cookie).
 *
 * Request body:
 * {
 *   session_id: string (required — phone number / session key),
 *   reason?: string  (optional free-text justification, stored in snapshot.reason)
 * }
 *
 * Response: { ok: true, data: { handoff_id } }
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md §v1.1.5, §v1.1.15
 * @see Requirements 24.7
 */
export async function POST(request: NextRequest) {
  try {
    // ─── Auth: admin JWT only ───
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { ok: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    if (payload.role !== 'ADMIN') {
      return NextResponse.json(
        { ok: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    // ─── Parse body ───
    let body: { session_id?: string; reason?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { session_id, reason } = body;

    // ─── Validation ───
    if (!session_id || typeof session_id !== 'string' || session_id.trim() === '') {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_FAILED', message: 'session_id is required' } },
        { status: 400 }
      );
    }

    if (reason !== undefined && typeof reason !== 'string') {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_FAILED', message: 'reason must be a string' } },
        { status: 400 }
      );
    }

    const reasonText = (reason && reason.trim()) || 'Manual escalation by admin';

    // ─── Load the session so the snapshot carries real conversation context ───
    const { data: session, error: sessionError } = await supabase
      .from('conversation_sessions')
      .select('session_id, last_intent, flow_stack, collected_data, history_summary, language')
      .eq('session_id', session_id)
      .single();

    if (sessionError || !session) {
      // PGRST116 = no rows returned
      if (!sessionError || sessionError.code === 'PGRST116') {
        return NextResponse.json(
          { ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } },
          { status: 404 }
        );
      }
      console.error('[sessions/escalate] Session lookup error:', sessionError);
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load session', details: sessionError.message } },
        { status: 500 }
      );
    }

    // ─── Build the handoff snapshot (Design §v1.1.5 HandoffSnapshot shape) ───
    // strikes is always 0 on a manual force-escalation since no strikes accrued.
    const historySummary = Array.isArray(session.history_summary) ? session.history_summary : [];
    const snapshot = {
      session_id: session.session_id,
      reason: reasonText,
      flow_stack: Array.isArray(session.flow_stack) ? session.flow_stack : [],
      collected_data: session.collected_data ?? {},
      history_summary_recent: historySummary.slice(-5),
      last_intent: session.last_intent ?? null,
      language: session.language ?? 'hi',
      strikes: 0,
      escalated_by: payload.userId,
      escalated_at: new Date().toISOString(),
    };

    // ─── Insert the handoff row (status='pending' pauses agent dispatch) ───
    const { data: handoff, error: insertError } = await supabase
      .from('human_handoff_queue')
      .insert({
        session_id,
        reason: 'manual',
        snapshot,
        status: 'pending',
      })
      .select('id, session_id, status, created_at')
      .single();

    if (insertError || !handoff) {
      console.error('[sessions/escalate] Handoff insert error:', insertError);
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to create handoff',
            details: insertError?.message,
          },
        },
        { status: 500 }
      );
    }

    // ─── Flag the session as handed off (best-effort, non-blocking) ───
    const { error: flagError } = await supabase
      .from('conversation_sessions')
      .update({ handoff_active: true })
      .eq('session_id', session_id);

    if (flagError) {
      // Non-fatal: the pending queue row already pauses dispatch (task 22.4).
      console.warn('[sessions/escalate] Failed to set handoff_active flag:', flagError);
    }

    // ─── Audit log to activity_logs (Req 24.7) ───
    const { error: logError } = await supabase
      .from('activity_logs')
      .insert({
        complaintId: null,
        action: 'SESSION_FORCE_ESCALATION',
        description: `Admin force-escalated session ${session_id} to human handoff: ${reasonText}`,
        actorId: payload.userId,
        actorName: payload.username,
      });

    if (logError) {
      // Non-blocking — log but don't fail the request.
      console.error('[sessions/escalate] Audit log error:', logError);
    }

    return NextResponse.json({
      ok: true,
      data: {
        handoff_id: handoff.id,
        session_id: handoff.session_id,
        status: handoff.status,
      },
    });
  } catch (error) {
    console.error('[sessions/escalate] Error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
