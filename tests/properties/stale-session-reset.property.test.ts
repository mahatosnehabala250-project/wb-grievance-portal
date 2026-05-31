// Feature: sahayak-multi-agent-router, Property 34: Stale-session reset is idempotent
//
// Property 34 (Design §Property 34, §v1.1.16): For any starting `conversation_sessions`
// row, running the Prepare Context stale-session reset twice in a row produces the same
// final (last_intent, collected_data, flow_stack) tuple as running it once, AND only one
// `routing_decisions` row with reason='session_stale_reset' is inserted across both
// invocations.
//
// Validates: Requirements 1.7, 1.8, 1.9
//
// We exercise the canonical shared module `src/lib/sessions/prepareContext.ts` against an
// in-memory mock of `conversation_sessions` and `routing_decisions`. The mock models the
// SQL `UPDATE ... SET last_activity_at = NOW()` semantics by reading a shared clock that
// is advanced in lockstep with the `now` argument passed into `prepareContext`.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  prepareContext,
  STALE_MS,
  type DbClient,
  type SessionRow,
} from '../../src/lib/sessions/prepareContext';

// ─── Constants ───────────────────────────────────────────────────────────────

/** last_intent enum values per Requirement 1.2. */
const LAST_INTENTS = [
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

/** active_agent enum values per Requirement 1.3. */
const ACTIVE_AGENTS = ['ceo', 'complaint', 'blood', 'donor', 'info'] as const;

/** Supported languages. */
const LANGUAGES = ['en', 'hi', 'bn'] as const;

// ─── In-memory DB mock ───────────────────────────────────────────────────────

interface RoutingDecisionRow {
  sessionId: string;
  messageText: string;
  lastIntentBefore: string | null;
  agentDispatched: null;
  reason: string;
  traceId?: string;
}

/**
 * A mutable clock shared between the test driver and the DB mock so the mock's
 * `NOW()`-equivalent writes line up exactly with the `now` passed to prepareContext.
 */
interface Clock {
  now: Date;
}

/**
 * In-memory model of `conversation_sessions` + `routing_decisions`.
 *
 * `getSession` returns the stored row by reference (as a real driver hydrates a row
 * object), and the mutating methods update that same row, faithfully reproducing the
 * atomic UPDATE statements in the design pseudocode.
 */
class InMemoryDb implements DbClient {
  readonly sessions = new Map<string, SessionRow>();
  readonly routingDecisions: RoutingDecisionRow[] = [];
  private readonly clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  async getSession(sessionId: string): Promise<SessionRow | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async resetStaleSession(sessionId: string): Promise<void> {
    const row = this.sessions.get(sessionId);
    if (!row) return;
    // UPDATE conversation_sessions SET last_intent='idle', collected_data='{}'::jsonb,
    //   flow_stack='[]'::jsonb, last_activity_at = NOW() WHERE session_id = $1
    row.last_intent = 'idle';
    row.collected_data = {};
    row.flow_stack = [];
    row.last_activity_at = this.clock.now.toISOString();
  }

  async bumpActivity(sessionId: string): Promise<void> {
    const row = this.sessions.get(sessionId);
    if (!row) return;
    // UPDATE conversation_sessions SET last_activity_at = NOW() WHERE session_id = $1
    row.last_activity_at = this.clock.now.toISOString();
  }

  async logStaleReset(params: {
    sessionId: string;
    messageText: string;
    lastIntentBefore: string | null;
    traceId?: string;
  }): Promise<void> {
    // INSERT routing_decisions (..., reason='session_stale_reset', agent_dispatched=NULL)
    this.routingDecisions.push({
      sessionId: params.sessionId,
      messageText: params.messageText,
      lastIntentBefore: params.lastIntentBefore,
      agentDispatched: null,
      reason: 'session_stale_reset',
      traceId: params.traceId,
    });
  }

  staleResetCount(): number {
    return this.routingDecisions.filter((r) => r.reason === 'session_stale_reset').length;
  }
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** A small JSON-ish value for collected_data / flow_stack payloads. */
const arbScalar = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.integer(),
  fc.boolean(),
);

/** collected_data: a small JSONB object. */
const arbCollectedData = fc.dictionary(fc.string({ maxLength: 8 }), arbScalar, {
  maxKeys: 5,
});

/** flow_stack: a small array of suspended-flow frames. */
const arbFlowStack = fc.array(
  fc.record({ intent: fc.constantFrom(...LAST_INTENTS), data: arbCollectedData }),
  { maxLength: 4 },
);

/**
 * A starting conversation_sessions row plus the timing parameters that decide whether
 * it is stale relative to the first invocation.
 *
 * - now1:   the wall-clock at the first prepareContext call.
 * - ageMs:  how long ago last_activity_at was set, straddling the 30-min boundary so we
 *           cover both fresh and stale starting rows.
 * - gapMs:  the delay before the SECOND invocation (kept < 30 min so the second call is
 *           always fresh — the "twice in a row" scenario from the design).
 */
const arbScenario = fc.record({
  sessionId: fc.string({ minLength: 1, maxLength: 16 }).map((s) => `phone-${s}`),
  lastIntent: fc.constantFrom(...LAST_INTENTS),
  activeAgent: fc.constantFrom(...ACTIVE_AGENTS),
  language: fc.constantFrom(...LANGUAGES),
  collectedData: arbCollectedData,
  flowStack: arbFlowStack,
  now1: fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2035-01-01T00:00:00Z') }),
  ageMs: fc.oneof(
    fc.integer({ min: 0, max: 120 * 60 * 1000 }),
    // Bias toward the 30-minute boundary so shrinking explores the critical edge.
    fc.constantFrom(0, STALE_MS - 1, STALE_MS, STALE_MS + 1, 30 * 60 * 1000),
  ),
  gapMs: fc.integer({ min: 0, max: STALE_MS - 1 }),
  traceId: fc.uuid(),
  messageText: fc.string({ maxLength: 40 }),
});

interface Scenario {
  sessionId: string;
  lastIntent: string;
  activeAgent: string;
  language: string;
  collectedData: Record<string, unknown>;
  flowStack: unknown[];
  now1: Date;
  ageMs: number;
  gapMs: number;
  traceId: string;
  messageText: string;
}

/** Build a fresh, deep-cloned starting row for a scenario (so the two runs are independent). */
function makeStartingRow(s: Scenario): SessionRow {
  return {
    session_id: s.sessionId,
    last_intent: s.lastIntent,
    active_agent: s.activeAgent,
    collected_data: structuredClone(s.collectedData),
    language: s.language,
    last_activity_at: new Date(s.now1.getTime() - s.ageMs).toISOString(),
    flow_stack: structuredClone(s.flowStack),
  };
}

type Tuple = { last_intent: string; collected_data: Record<string, unknown>; flow_stack: unknown[] };

function tupleOf(row: SessionRow): Tuple {
  return {
    last_intent: row.last_intent,
    collected_data: row.collected_data,
    flow_stack: row.flow_stack,
  };
}

/** Run prepareContext once and return the final tuple + stale-reset row count. */
async function runOnce(s: Scenario): Promise<{ tuple: Tuple; resets: number }> {
  const clock: Clock = { now: s.now1 };
  const db = new InMemoryDb(clock);
  db.sessions.set(s.sessionId, makeStartingRow(s));

  await prepareContext(
    { phone: s.sessionId, trace_id: s.traceId, message_text: s.messageText },
    db,
    clock.now,
  );

  return { tuple: tupleOf(db.sessions.get(s.sessionId)!), resets: db.staleResetCount() };
}

/** Run prepareContext twice in a row and return the final tuple + stale-reset row count. */
async function runTwice(s: Scenario): Promise<{ tuple: Tuple; resets: number }> {
  const clock: Clock = { now: s.now1 };
  const db = new InMemoryDb(clock);
  db.sessions.set(s.sessionId, makeStartingRow(s));

  await prepareContext(
    { phone: s.sessionId, trace_id: s.traceId, message_text: s.messageText },
    db,
    clock.now,
  );

  // Second invocation, slightly later but still inside the freshness window.
  clock.now = new Date(s.now1.getTime() + s.gapMs);
  await prepareContext(
    { phone: s.sessionId, trace_id: s.traceId, message_text: s.messageText },
    db,
    clock.now,
  );

  return { tuple: tupleOf(db.sessions.get(s.sessionId)!), resets: db.staleResetCount() };
}

// ─── Property 34 ───────────────────────────────────────────────────────────────

describe('Property 34: Stale-session reset is idempotent', () => {
  it('twice-in-a-row yields the same (last_intent, collected_data, flow_stack) and at most one stale-reset row', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario, async (s) => {
        const once = await runOnce(s);
        const twice = await runTwice(s);

        // 1. Idempotence of the persisted tuple: twice === once.
        expect(twice.tuple).toEqual(once.tuple);

        // 2. The second invocation inserts no additional stale-reset row.
        expect(twice.resets).toBe(once.resets);

        // 3. A given starting row triggers at most one stale-reset across both calls.
        expect(twice.resets).toBeLessThanOrEqual(1);

        // 4. Branch-specific expectations tie the count to the documented 30-min rule.
        const startedStale = s.ageMs > STALE_MS;
        if (startedStale) {
          expect(once.resets).toBe(1);
          // After a reset the tuple is the canonical idle/empty state (Req 1.8).
          expect(twice.tuple).toEqual({ last_intent: 'idle', collected_data: {}, flow_stack: [] });
        } else {
          expect(once.resets).toBe(0);
          // Fresh sessions are untouched apart from the activity bump.
          expect(twice.tuple).toEqual({
            last_intent: s.lastIntent,
            collected_data: s.collectedData,
            flow_stack: s.flowStack,
          });
        }
      }),
      { numRuns: 200 },
    );
  });

  // ─── Focused unit cases (specific, non-random anchors) ──────────────────────

  it('resets exactly once for a clearly stale session (45 min idle)', async () => {
    const now1 = new Date('2026-02-01T10:00:00Z');
    const clock: Clock = { now: now1 };
    const db = new InMemoryDb(clock);
    db.sessions.set('phone-1', {
      session_id: 'phone-1',
      last_intent: 'complaint_collecting',
      active_agent: 'complaint',
      collected_data: { name: 'Asha', step: 2 },
      language: 'hi',
      last_activity_at: new Date(now1.getTime() - 45 * 60 * 1000).toISOString(),
      flow_stack: [{ intent: 'blood_collecting' }],
    });

    const first = await prepareContext({ phone: 'phone-1', message_text: 'hi' }, db, clock.now);
    expect(first.was_reset).toBe(true);
    expect(first.prev_last_intent).toBe('complaint_collecting');

    clock.now = new Date(now1.getTime() + 1000);
    const second = await prepareContext({ phone: 'phone-1', message_text: 'hi again' }, db, clock.now);
    expect(second.was_reset).toBe(false);

    const row = db.sessions.get('phone-1')!;
    expect(row.last_intent).toBe('idle');
    expect(row.collected_data).toEqual({});
    expect(row.flow_stack).toEqual([]);
    expect(db.staleResetCount()).toBe(1);
  });

  it('never resets a fresh session (5 min idle)', async () => {
    const now1 = new Date('2026-02-01T10:00:00Z');
    const clock: Clock = { now: now1 };
    const db = new InMemoryDb(clock);
    db.sessions.set('phone-2', {
      session_id: 'phone-2',
      last_intent: 'blood_confirming',
      active_agent: 'blood',
      collected_data: { units: 2 },
      language: 'bn',
      last_activity_at: new Date(now1.getTime() - 5 * 60 * 1000).toISOString(),
      flow_stack: [],
    });

    await prepareContext({ phone: 'phone-2', message_text: 'haan' }, db, clock.now);
    clock.now = new Date(now1.getTime() + 2000);
    await prepareContext({ phone: 'phone-2', message_text: 'haan' }, db, clock.now);

    const row = db.sessions.get('phone-2')!;
    expect(row.last_intent).toBe('blood_confirming');
    expect(row.collected_data).toEqual({ units: 2 });
    expect(db.staleResetCount()).toBe(0);
  });
});
