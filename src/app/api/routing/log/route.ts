import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Valid values for agent_dispatched (null is also allowed for stale-reset rows). */
const VALID_AGENTS = ['complaint', 'blood', 'donor', 'info', 'welcome'] as const;

/**
 * POST /api/routing/log
 *
 * Called by the CEO Router (n8n Code Node) to append a routing decision row
 * to the `routing_decisions` table for observability.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET env var.
 *
 * Body: { session_id, message_text, last_intent_before, agent_dispatched, reason, trace_id }
 *
 * - message_text is truncated to 200 chars (PII minimization).
 * - agent_dispatched must be null or one of: complaint, blood, donor, info, welcome.
 *
 * Returns: { ok: true, data: { id } } on success.
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
      message_text,
      last_intent_before,
      agent_dispatched,
      reason,
      trace_id,
    } = body;

    // ─── Validation ───
    if (!session_id) {
      return NextResponse.json(
        { ok: false, error: 'session_id is required' },
        { status: 400 }
      );
    }

    if (!reason) {
      return NextResponse.json(
        { ok: false, error: 'reason is required' },
        { status: 400 }
      );
    }

    // agent_dispatched must be null or a valid enum value
    if (agent_dispatched !== null && agent_dispatched !== undefined) {
      if (!VALID_AGENTS.includes(agent_dispatched)) {
        return NextResponse.json(
          {
            ok: false,
            error: `agent_dispatched must be null or one of: ${VALID_AGENTS.join(', ')}`,
          },
          { status: 400 }
        );
      }
    }

    // ─── Truncate message_text to 200 chars (PII minimization) ───
    const truncatedMessage = message_text
      ? String(message_text).slice(0, 200)
      : null;

    // ─── Insert into routing_decisions ───
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data, error } = await supabase
      .from('routing_decisions')
      .insert({
        session_id,
        message_text: truncatedMessage,
        last_intent_before: last_intent_before || null,
        agent_dispatched: agent_dispatched || null,
        reason: reason || null,
        trace_id: trace_id || null,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[routing/log] Supabase insert error:', error);
      return NextResponse.json(
        { ok: false, error: 'Failed to log routing decision', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data: { id: data.id } });
  } catch (error) {
    console.error('[routing/log] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
