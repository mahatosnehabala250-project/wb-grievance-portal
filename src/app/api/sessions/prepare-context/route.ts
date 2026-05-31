import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  prepareContext,
  type DbClient,
  type SessionRow,
} from '@/lib/sessions/prepareContext';
import {
  pop,
  peek,
  deriveLastIntent,
  cancelKeywordMatch,
  type Frame,
} from '@/lib/flowStack/manager';

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

    // ─── Flow Stack handling (v1.1.2 — Req 21.3, 21.6, 21.7) ───
    // Runs after the stale check so a stale-reset (which clears flow_stack to [])
    // is already reflected. Three responsibilities, all driven by the pure
    // Flow Stack Manager so the n8n CEO Router Code Node stays thin:
    //   19.5 Cancel keyword → pop the active frame BEFORE the router dispatches.
    //   19.3 Derive the v1-compatible last_intent from the (possibly popped) stack.
    //   19.4 Expose resume_context (previous flow + last captured field) for the
    //        specialist agent's resume sentence.
    const sessionRow = (result.session ?? {}) as SessionRow & {
      flow_stack?: unknown;
      collected_data?: Record<string, unknown>;
    };
    const currentStack: Frame[] = Array.isArray(sessionRow.flow_stack)
      ? (sessionRow.flow_stack as Frame[])
      : [];

    let flowStack: Frame[] = currentStack;
    let flowStackOp: 'pop' | null = null;
    let resumeContext: { previous_flow: string; last_captured_field: string | null } | null = null;

    const isCancel =
      !result.was_reset &&
      typeof message_text === 'string' &&
      cancelKeywordMatch(message_text);

    if (isCancel && currentStack.length > 0) {
      // 19.5: pop the active frame; persist the new stack atomically.
      const { next } = pop(currentStack);
      flowStack = next;
      flowStackOp = 'pop';

      const { error: stackError } = await supabase
        .from('conversation_sessions')
        .update({
          flow_stack: next,
          last_intent: deriveLastIntent(next, 'idle'),
          last_activity_at: new Date().toISOString(),
        })
        .eq('session_id', phone);
      if (stackError) {
        console.error('[prepare-context] cancel pop persist error:', stackError);
      }

      // 19.4: when a frame remains after the pop, surface resume context so the
      // newly-active specialist agent opens with the localized resume sentence.
      const resumed = peek(next);
      if (resumed) {
        const fields = Object.keys(resumed.collected_data ?? {});
        resumeContext = {
          previous_flow: resumed.flow,
          last_captured_field: fields.length > 0 ? fields[fields.length - 1] : null,
        };
      }
    }

    // 19.3: the active intent the CEO Router should route on is derived from the
    // flow stack when non-empty, else the legacy last_intent (backward compat).
    const derivedLastIntent = deriveLastIntent(
      flowStack,
      (sessionRow.last_intent as string) ?? 'idle',
    );

    // Keep the returned session coherent with the derived/popped state so the
    // CEO Router node reads the right last_intent and flow_stack.
    const session = {
      ...sessionRow,
      flow_stack: flowStack,
      last_intent: derivedLastIntent,
    };

    return NextResponse.json({
      ok: true,
      session,
      was_reset: result.was_reset,
      prev_last_intent: result.prev_last_intent,
      // v1.1.2 outputs consumed by the CEO Router / specialist agents.
      derived_last_intent: derivedLastIntent,
      flow_stack_op: flowStackOp,
      resume_context: resumeContext,
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
