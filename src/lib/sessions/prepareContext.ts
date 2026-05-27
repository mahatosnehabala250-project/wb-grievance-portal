/**
 * Prepare Context — stale-session detection and reset logic.
 *
 * This module exposes the stale-session logic as a testable, pure-ish function
 * with an injectable DB client interface. It is the canonical source of truth
 * for the n8n Code Node body in `n8n-workflows/code-nodes/prepare-context.js`
 * and the API endpoint at `POST /api/sessions/prepare-context`.
 *
 * Flow (Req 1.7-1.9):
 *   1. Load session row by phone (session_id)
 *   2. Check if `now() - last_activity_at > 30 minutes`
 *   3. If stale: atomic UPDATE conversation_sessions SET last_intent='idle',
 *      collected_data='{}'::jsonb, flow_stack='[]'::jsonb, last_activity_at=NOW()
 *      + INSERT routing_decisions row with reason='session_stale_reset',
 *      agent_dispatched=NULL
 *   4. If fresh: just bump last_activity_at = NOW()
 *   5. Return { session, was_reset, prev_last_intent }
 *
 * Idempotence (Property 34): running this twice in a row is safe — the second
 * invocation sees `last_activity_at = now()` from the first and the stale
 * branch does not fire. Only one routing_decisions row is inserted.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §Components → Prepare Context
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirements 1.7, 1.8, 1.9
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** 30 minutes in milliseconds — the stale-session threshold (Req 1.6, 1.7). */
export const STALE_MS = 30 * 60 * 1000;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Shape of a conversation_sessions row as returned by the DB. */
export interface SessionRow {
  session_id: string;
  state?: string | null;
  last_intent: string;
  active_agent: string;
  collected_data: Record<string, unknown>;
  language: string;
  last_activity_at: string;
  flow_stack: unknown[];
  created_at?: string;
  updated_at?: string;
}

/** Input to the prepareContext function. */
export interface PrepareContextInput {
  phone: string;
  trace_id?: string;
  message_text?: string;
}

/** Output from the prepareContext function. */
export interface PrepareContextResult {
  session: SessionRow;
  was_reset: boolean;
  prev_last_intent: string | null;
}

/**
 * Injectable DB client interface.
 *
 * Consumers provide an implementation that talks to Supabase, Postgres, or
 * an in-memory store (for tests). Each method maps to a single SQL statement
 * from the design pseudocode.
 */
export interface DbClient {
  /** Load a session row by session_id (phone). Returns null if not found. */
  getSession(sessionId: string): Promise<SessionRow | null>;

  /**
   * Reset a stale session: set last_intent='idle', collected_data='{}',
   * flow_stack='[]', last_activity_at=NOW().
   */
  resetStaleSession(sessionId: string): Promise<void>;

  /** Bump last_activity_at=NOW() for a fresh session. */
  bumpActivity(sessionId: string): Promise<void>;

  /**
   * Insert a routing_decisions audit row for the stale-session reset.
   * agent_dispatched is NULL for stale-reset rows (Req 1.9).
   */
  logStaleReset(params: {
    sessionId: string;
    messageText: string;
    lastIntentBefore: string | null;
    traceId?: string;
  }): Promise<void>;
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Prepare Context — performs the stale-session check and reset.
 *
 * This is the FIRST decision in the request lifecycle (before the CEO Router)
 * so the router and all specialist agents always operate on a fresh state.
 *
 * Idempotence: running this twice in a row is safe — the second invocation
 * sees `last_activity_at = now()` from the first and the stale branch does
 * not fire. Enforced by Property 34.
 *
 * @param input  - phone, trace_id, message_text from the Parse Message node
 * @param db     - injectable DB client
 * @param now    - injectable current time (defaults to Date.now()) for testability
 */
export async function prepareContext(
  input: PrepareContextInput,
  db: DbClient,
  now: Date = new Date(),
): Promise<PrepareContextResult> {
  const { phone, trace_id, message_text } = input;

  // 1. Load session row by session_id = phone
  const session = await db.getSession(phone);

  if (!session) {
    // No session found — this shouldn't happen if Upsert Session ran before us,
    // but handle gracefully by returning a default idle session.
    const defaultSession: SessionRow = {
      session_id: phone,
      last_intent: 'idle',
      active_agent: 'ceo',
      collected_data: {},
      language: 'hi',
      last_activity_at: now.toISOString(),
      flow_stack: [],
    };
    return {
      session: defaultSession,
      was_reset: false,
      prev_last_intent: null,
    };
  }

  const prevLastIntent = session.last_intent;

  // 2. Check staleness: now() - last_activity_at > 30 minutes
  const lastActivityMs = session.last_activity_at
    ? new Date(session.last_activity_at).getTime()
    : 0;
  const isStale = lastActivityMs > 0 && (now.getTime() - lastActivityMs > STALE_MS);

  if (isStale) {
    // 3. Stale session — reset fields (Req 1.8)
    await db.resetStaleSession(phone);

    // Insert routing_decisions audit row (Req 1.9)
    await db.logStaleReset({
      sessionId: phone,
      messageText: (message_text ?? '').slice(0, 200),
      lastIntentBefore: prevLastIntent,
      traceId: trace_id,
    });

    // Update the in-memory session object to reflect the reset
    session.last_intent = 'idle';
    session.collected_data = {};
    session.flow_stack = [];
    session.last_activity_at = now.toISOString();

    return {
      session,
      was_reset: true,
      prev_last_intent: prevLastIntent,
    };
  }

  // 4. Fresh session — just bump last_activity_at
  await db.bumpActivity(phone);
  session.last_activity_at = now.toISOString();

  return {
    session,
    was_reset: false,
    prev_last_intent: prevLastIntent,
  };
}
