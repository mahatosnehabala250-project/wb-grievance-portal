import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  prepareContext,
  type DbClient,
  type SessionRow,
} from '@/lib/sessions/prepareContext';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * POST /api/sessions/prepare-context
 *
 * Called by the n8n Prepare Context Code Node to perform the stale-session
 * check and persist the result atomically.
 *
 * Responsibilities (Req 1.7-1.9):
 *   - Load session row by phone (session_id)
 *   - 30-minute freshness check against last_activity_at
 *   - On stale: atomic UPDATE conversation_sessions SET last_intent='idle',
 *     collected_data='{}'::jsonb, flow_stack='[]'::jsonb, last_activity_at=NOW()
 *     + INSERT routing_decisions row (reason='session_stale_reset', agent_dispatched=NULL)
 *   - On fresh: just bump last_activity_at = NOW()
 *   - Return { session, was_reset, prev_last_intent }
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET env var.
 *
 * Body: { phone, message_text, trace_id, session }
 *   - phone: session_id (WhatsApp phone number)
 *   - message_text: raw message text (truncated to 200 chars for PII minimization)
 *   - trace_id: UUIDv7 from Parse Message node
 *   - session: the session row loaded by Upsert Session (used as fallback if DB read fails)
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
    const { phone, message_text, trace_id, session: inputSession } = body;

    if (!phone) {
      return NextResponse.json(
        { ok: false, error: 'phone is required' },
        { status: 400 }
      );
    }

    // ─── Create Supabase client ───
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // ─── Build the injectable DB client ───
    const dbClient: DbClient = {
      async getSession(sessionId: string): Promise<SessionRow | null> {
        const { data, error } = await supabase
          .from('conversation_sessions')
          .select('*')
          .eq('session_id', sessionId)
          .single();

        if (error) {
          // PGRST116 = no rows found
          if (error.code === 'PGRST116') {
            // Fall back to the session passed in from the n8n node
            // (Upsert Session should have created it, but handle gracefully)
            if (inputSession && inputSession.session_id) {
              return inputSession as SessionRow;
            }
            return null;
          }
          console.error('[prepare-context] getSession error:', error);
          // Fall back to input session if available
          if (inputSession && inputSession.session_id) {
            return inputSession as SessionRow;
          }
          return null;
        }

        return data as SessionRow;
      },

      async resetStaleSession(sessionId: string): Promise<void> {
        // Atomic UPDATE: reset last_intent, collected_data, flow_stack, bump last_activity_at
        const { error } = await supabase
          .from('conversation_sessions')
          .update({
            last_intent: 'idle',
            collected_data: {},
            flow_stack: [],
            last_activity_at: new Date().toISOString(),
          })
          .eq('session_id', sessionId);

        if (error) {
          console.error('[prepare-context] resetStaleSession error:', error);
          throw new Error(`Failed to reset stale session: ${error.message}`);
        }
      },

      async bumpActivity(sessionId: string): Promise<void> {
        const { error } = await supabase
          .from('conversation_sessions')
          .update({
            last_activity_at: new Date().toISOString(),
          })
          .eq('session_id', sessionId);

        if (error) {
          console.error('[prepare-context] bumpActivity error:', error);
          throw new Error(`Failed to bump activity: ${error.message}`);
        }
      },

      async logStaleReset(params: {
        sessionId: string;
        messageText: string;
        lastIntentBefore: string | null;
        traceId?: string;
      }): Promise<void> {
        const { error } = await supabase
          .from('routing_decisions')
          .insert({
            session_id: params.sessionId,
            message_text: params.messageText.slice(0, 200),
            last_intent_before: params.lastIntentBefore,
            agent_dispatched: null,
            reason: 'session_stale_reset',
            trace_id: params.traceId || null,
            created_at: new Date().toISOString(),
          });

        if (error) {
          console.error('[prepare-context] logStaleReset error:', error);
          throw new Error(`Failed to log stale reset: ${error.message}`);
        }
      },
    };

    // ─── Execute the prepare context logic ───
    const result = await prepareContext(
      {
        phone,
        trace_id,
        message_text,
      },
      dbClient,
    );

    return NextResponse.json({
      ok: true,
      session: result.session,
      was_reset: result.was_reset,
      prev_last_intent: result.prev_last_intent,
    });
  } catch (error) {
    console.error('[prepare-context] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
