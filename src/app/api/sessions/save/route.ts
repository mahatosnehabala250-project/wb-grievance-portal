import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { withIdempotency } from '@/lib/idempotency/middleware';
import {
  push,
  pop,
  dropOldest,
  deriveLastIntent,
  type Frame,
  type NewFrame,
} from '@/lib/flowStack/manager';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// pg Pool used exclusively for the idempotency middleware DB client.
const idempotencyPool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

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

/** Valid flow_stack mutation ops (design §v1.1.2 / §v1.1.15, Req 21.2/21.5). */
const VALID_FLOW_STACK_OPS = ['push', 'pop', 'dropOldest'] as const;
type FlowStackOpName = (typeof VALID_FLOW_STACK_OPS)[number];

/** Flows that maintain suspendable state on the stack (Req 21.1). */
const VALID_FLOWS = ['complaint', 'blood', 'donor'] as const;

/** Shape of the optional `flow_stack_op` body field. */
interface FlowStackOp {
  op: FlowStackOpName;
  frame?: NewFrame;
}

const ENDPOINT = '/api/sessions/save';

/**
 * Validate the optional `flow_stack_op` field.
 * Returns an error string when invalid, or `null` when valid/absent.
 */
function validateFlowStackOp(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return 'flow_stack_op must be an object';
  }

  const op = (raw as { op?: unknown }).op;
  if (typeof op !== 'string' || !VALID_FLOW_STACK_OPS.includes(op as FlowStackOpName)) {
    return `flow_stack_op.op must be one of: ${VALID_FLOW_STACK_OPS.join(', ')}`;
  }

  // Only `push` consumes a frame; pop/dropOldest ignore it.
  if (op === 'push') {
    const frame = (raw as { frame?: unknown }).frame;
    if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) {
      return 'flow_stack_op.frame is required for op "push" and must be an object';
    }
    const { flow, intent, collected_data } = frame as Record<string, unknown>;
    if (typeof flow !== 'string' || !VALID_FLOWS.includes(flow as (typeof VALID_FLOWS)[number])) {
      return `flow_stack_op.frame.flow must be one of: ${VALID_FLOWS.join(', ')}`;
    }
    if (typeof intent !== 'string' || !VALID_INTENTS.includes(intent as (typeof VALID_INTENTS)[number])) {
      return `flow_stack_op.frame.intent must be one of: ${VALID_INTENTS.join(', ')}`;
    }
    if (
      collected_data !== undefined &&
      (typeof collected_data !== 'object' || collected_data === null || Array.isArray(collected_data))
    ) {
      return 'flow_stack_op.frame.collected_data must be an object';
    }
  }

  return null;
}

/** Apply a pure flow-stack op to the current stack (no I/O). */
function applyFlowStackOp(stack: Frame[], opData: FlowStackOp): Frame[] {
  switch (opData.op) {
    case 'push':
      return push(stack, {
        flow: opData.frame!.flow,
        intent: opData.frame!.intent,
        collected_data: opData.frame!.collected_data ?? {},
      }).next;
    case 'pop':
      return pop(stack).next;
    case 'dropOldest':
      return dropOldest(stack).next;
  }
}

/**
 * POST /api/sessions/save
 *
 * Called by n8n specialist agents (via SaveSessionState tool) to persist
 * session state after each conversation turn.
 *
 * Upserts conversation_sessions row keyed by session_id (phone number).
 * When flow_complete is true, resets collected_data to '{}' and last_intent to 'idle'.
 *
 * Optionally accepts a `flow_stack_op` that mutates conversation_sessions.flow_stack
 * via the pure Flow Stack Manager (design §v1.1.2 / §v1.1.15, Req 21.2/21.5). The
 * current flow_stack is loaded from the row, the pure op (push/pop/dropOldest) is
 * applied, the new flow_stack is persisted, and last_intent is re-derived via
 * deriveLastIntent so the v1 single-intent invariants (Properties 1/13) still hold.
 * This is additive and optional — callers that omit it keep exact v1 behavior.
 *
 * Wrapped with idempotency middleware (Req 28.1–28.4): an optional
 * `Idempotency-Key` header dedupes retries for 24 hours.
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
 *   flow_complete?: boolean,
 *   flow_stack_op?: { op: 'push'|'pop'|'dropOldest', frame?: { flow, intent, collected_data? } }
 * }
 *
 * Response: { ok: true, data: { session_id, last_intent, active_agent, flow_stack? } }
 */
export async function POST(request: NextRequest) {
  return withIdempotency(
    request,
    ENDPOINT,
    () => handleSaveSession(request),
    idempotencyPool,
  );
}

async function handleSaveSession(request: NextRequest): Promise<Response> {
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
      flow_stack_op,
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

    const flowStackOpError = validateFlowStackOp(flow_stack_op);
    if (flowStackOpError) {
      return NextResponse.json(
        { ok: false, error: flowStackOpError },
        { status: 400 }
      );
    }

    // ─── Flow Stack mutation (optional, additive — Req 21.2/21.5) ───
    // Load the current flow_stack, apply the pure manager op, and let the
    // resulting stack drive last_intent via deriveLastIntent so the v1
    // single-intent invariants (Properties 1/13) keep holding. The flow stack
    // is mutated in the same upsert that updates last_intent (one row write),
    // so the v1 invariants stay coherent.
    let nextFlowStack: Frame[] | undefined;
    if (flow_stack_op && !flow_complete) {
      const { data: current, error: loadError } = await supabase
        .from('conversation_sessions')
        .select('flow_stack')
        .eq('session_id', session_id)
        .maybeSingle();

      if (loadError) {
        console.error('[sessions/save] Supabase flow_stack load error:', loadError);
        return NextResponse.json(
          { ok: false, error: 'Failed to load session', details: loadError.message },
          { status: 500 }
        );
      }

      const currentStack: Frame[] = Array.isArray(current?.flow_stack)
        ? (current!.flow_stack as Frame[])
        : [];
      nextFlowStack = applyFlowStackOp(currentStack, flow_stack_op as FlowStackOp);
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

    // When a flow_stack op was applied, persist the new stack and derive the
    // v1-compatible last_intent from it (Req 21.7). The derived value takes
    // precedence over any caller-supplied last_intent so the stack and the
    // legacy field never diverge.
    if (nextFlowStack !== undefined) {
      upsertData.flow_stack = nextFlowStack;
      upsertData.last_intent = deriveLastIntent(
        nextFlowStack,
        (upsertData.last_intent as string) ?? 'idle'
      );
    }

    // ─── Upsert conversation_sessions row keyed by session_id (phone) ───
    const { data: session, error } = await supabase
      .from('conversation_sessions')
      .upsert(upsertData, { onConflict: 'session_id' })
      .select('session_id, last_intent, active_agent, flow_stack')
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
        flow_stack: session.flow_stack,
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
