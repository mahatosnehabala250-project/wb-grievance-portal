import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Valid values for last_intent per Requirement 1.2 */
const VALID_INTENTS = [
  'idle',
  'welcome',
  'complaint_collecting',
  'complaint_confirming',
  'blood_collecting',
  'blood_confirming',
  'donor_pending_response',
  'seeker_confirming',
  'donor_registration',
  'donor_confirming',
  'status_check',
  'info_query',
] as const;

/** Valid values for active_agent per Requirement 1.3 */
const VALID_AGENTS = ['ceo', 'complaint', 'blood', 'donor', 'info'] as const;

/**
 * POST /api/sessions/save
 *
 * Called by n8n specialist agents (via SaveSessionState tool) to persist
 * session state after each conversation turn.
 *
 * Upserts conversation_sessions row keyed by session_id (phone number).
 * When flow_complete is true, resets collected_data to '{}' and last_intent to 'idle'.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET env var.
 *
 * Request body:
 * {
 *   session_id: string (phone number, required),
 *   last_intent?: string,
 *   active_agent?: string,
 *   collected_data?: object,
 *   language?: string,
 *   flow_complete?: boolean
 * }
 *
 * Response: { ok: true, data: { session_id, last_intent, active_agent } }
 */
export async function POST(request: NextRequest) {
  try {
    // ─── Auth: verify n8n webhook secret ───
    const secret = request.headers.get('x-n8n-secret');
    const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // ─── Parse body ───
    const body = await request.json();
    const {
      session_id,
      last_intent,
      active_agent,
      collected_data,
      language,
      flow_complete,
    } = body;

    // ─── Validation ───
    if (!session_id || typeof session_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'session_id is required and must be a string' },
        { status: 400 }
      );
    }

    if (last_intent !== undefined && !VALID_INTENTS.includes(last_intent)) {
      return NextResponse.json(
        { ok: false, error: `last_intent must be one of: ${VALID_INTENTS.join(', ')}` },
        { status: 400 }
      );
    }

    if (active_agent !== undefined && !VALID_AGENTS.includes(active_agent)) {
      return NextResponse.json(
        { ok: false, error: `active_agent must be one of: ${VALID_AGENTS.join(', ')}` },
        { status: 400 }
      );
    }

    // ─── Build upsert data ───
    const upsertData: Record<string, unknown> = {
      session_id,
      last_activity_at: new Date().toISOString(),
    };

    if (flow_complete) {
      // Flow completed — reset to idle state (Requirement 1.5)
      upsertData.last_intent = 'idle';
      upsertData.collected_data = {};
    } else {
      // Normal save — persist provided values
      if (last_intent !== undefined) upsertData.last_intent = last_intent;
      if (collected_data !== undefined) upsertData.collected_data = collected_data;
    }

    if (active_agent !== undefined) upsertData.active_agent = active_agent;
    if (language !== undefined) upsertData.language = language;

    // ─── Upsert conversation_sessions row keyed by session_id (phone) ───
    const { data: session, error } = await supabase
      .from('conversation_sessions')
      .upsert(upsertData, { onConflict: 'session_id' })
      .select('session_id, last_intent, active_agent')
      .single();

    if (error) {
      console.error('[sessions/save] Supabase upsert error:', error);
      return NextResponse.json(
        { ok: false, error: 'Failed to save session', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        session_id: session.session_id,
        last_intent: session.last_intent,
        active_agent: session.active_agent,
      },
    });
  } catch (error) {
    console.error('[sessions/save] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
