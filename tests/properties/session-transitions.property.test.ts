// Feature: sahayak-multi-agent-router, Property 13: Session state transitions
//
// Property 13 (Design §Property 13): For any `conversation_sessions` row in a
// flow-completion state (`complaint_confirming -> register success`,
// `blood_confirming -> create success`, `donor_confirming -> register success`),
// after a flow-complete save the row satisfies `last_intent = 'idle'` AND
// `collected_data = '{}'::jsonb`. Additionally, for any row whose
// `last_activity_at` is older than 30 minutes, the next CEO Router invocation
// routes as if `last_intent = 'idle'`.
//
// Validates: Requirements 1.5, 1.6
//
// This suite has two halves matching the two clauses of Property 13:
//
//   (A) Flow-complete reset semantics. We model the upsert logic in
//       `src/app/api/sessions/save/route.ts` as a pure transition function
//       `applySave(existingRow, payload, now)` that mirrors the route handler's
//       `upsertData` construction (Postgres INSERT ... ON CONFLICT DO UPDATE only
//       touches the columns named in the payload). The property asserts that a
//       `flow_complete: true` save always lands on the canonical idle/empty
//       state, overriding any in-progress data or adversarial payload fields.
//
//   (B) Stale-routing semantics. We exercise the real `decide(...)` from
//       `src/lib/router/ceoRouter.ts` and assert that a session whose
//       `last_activity_at` is older than 30 minutes routes byte-identically to a
//       fresh idle session for the same message — i.e. the router treats a stale
//       row as if `last_intent = 'idle'` (Req 1.6).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  decide,
  STALE_MS,
  type SessionInput,
  type MessageInput,
} from '../../src/lib/router/ceoRouter';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Fixed reference "now" so the stale-belt branch is fully deterministic. */
const NOW = new Date('2026-02-01T12:00:00.000Z');

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

/**
 * The three flow-completion states called out in Property 13 — the states a flow
 * is in immediately before it completes and triggers a flow-complete save.
 */
const FLOW_COMPLETION_INTENTS = [
  'complaint_confirming',
  'blood_confirming',
  'donor_confirming',
] as const;

/** active_agent enum values per Requirement 1.3. */
const ACTIVE_AGENTS = ['ceo', 'complaint', 'blood', 'donor', 'info'] as const;

/** Supported languages. */
const LANGUAGES = ['en', 'hi', 'bn'] as const;

// ─── Part A: pure model of POST /api/sessions/save ───────────────────────────

/** A conversation_sessions row (the subset the save route reads / writes). */
interface SessionRow {
  session_id: string;
  last_intent: string;
  active_agent: string;
  collected_data: Record<string, unknown>;
  language: string;
  last_activity_at: string;
}

/** The body accepted by POST /api/sessions/save. */
interface SavePayload {
  session_id: string;
  last_intent?: string;
  active_agent?: string;
  collected_data?: Record<string, unknown>;
  language?: string;
  flow_complete?: boolean;
}

/**
 * Pure transition mirroring the `upsertData` construction in
 * `src/app/api/sessions/save/route.ts`.
 *
 * Faithfully reproduces the route handler:
 *   - always stamps `last_activity_at = now`
 *   - when `flow_complete` is truthy → force `last_intent='idle'`,
 *     `collected_data={}` and IGNORE any provided last_intent / collected_data
 *   - otherwise → persist provided last_intent / collected_data when present
 *   - active_agent / language pass through when provided
 *
 * The merge with `existing` models Postgres `ON CONFLICT DO UPDATE`, which only
 * overwrites the columns named in the upsert object and leaves the rest intact.
 */
function applySave(
  existing: SessionRow,
  payload: SavePayload,
  now: Date,
): SessionRow {
  const upsert: Partial<SessionRow> = {
    session_id: payload.session_id,
    last_activity_at: now.toISOString(),
  };

  if (payload.flow_complete) {
    // Flow completed — reset to idle state (Requirement 1.5).
    upsert.last_intent = 'idle';
    upsert.collected_data = {};
  } else {
    if (payload.last_intent !== undefined) upsert.last_intent = payload.last_intent;
    if (payload.collected_data !== undefined) upsert.collected_data = payload.collected_data;
  }

  if (payload.active_agent !== undefined) upsert.active_agent = payload.active_agent;
  if (payload.language !== undefined) upsert.language = payload.language;

  return { ...existing, ...upsert };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const arbScalar = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.integer(),
  fc.boolean(),
);

/** A non-trivial collected_data payload (so the reset to `{}` is observable). */
const arbCollectedData = fc.dictionary(fc.string({ maxLength: 8 }), arbScalar, {
  maxKeys: 6,
});

const arbSessionId = fc.string({ minLength: 1, maxLength: 16 }).map((s) => `+9100${s}`);

/** An existing row sitting in a flow-completion (or any) state with in-progress data. */
function arbExistingRow(intents: readonly string[]) {
  return fc.record({
    session_id: arbSessionId,
    last_intent: fc.constantFrom(...intents),
    active_agent: fc.constantFrom(...ACTIVE_AGENTS),
    collected_data: arbCollectedData,
    language: fc.constantFrom(...LANGUAGES),
    last_activity_at: fc
      .date({ min: new Date('2025-01-01T00:00:00Z'), max: NOW })
      .map((d) => d.toISOString()),
  });
}

/** Non-idle intents — used as adversarial payload values that must NOT survive. */
const NON_IDLE_INTENTS = LAST_INTENTS.filter((i) => i !== 'idle');

/** A non-empty collected_data payload (so "reset to {}" is observable as a change). */
const arbNonEmptyCollectedData = fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), arbScalar, {
  minKeys: 1,
  maxKeys: 6,
});

/**
 * A flow-complete save payload. We deliberately ALSO populate `last_intent` with
 * a NON-IDLE value and `collected_data` with a NON-EMPTY object to prove
 * `flow_complete` overrides them (the route's flow_complete branch ignores those
 * fields). Using non-idle / non-empty adversarial values makes the override
 * observable — a payload that coincidentally sent 'idle' / {} would not.
 */
const arbFlowCompletePayload = fc.record({
  flow_complete: fc.constant(true as const),
  last_intent: fc.option(fc.constantFrom(...NON_IDLE_INTENTS), { nil: undefined }),
  collected_data: fc.option(arbNonEmptyCollectedData, { nil: undefined }),
  active_agent: fc.option(fc.constantFrom(...ACTIVE_AGENTS), { nil: undefined }),
  language: fc.option(fc.constantFrom(...LANGUAGES), { nil: undefined }),
});

// ─── Part B: message generator for the router ─────────────────────────────────

const BLOOD_TOKENS = ['blood', 'need blood', 'khoon chahiye', 'রক্ত লাগবে', 'A+'];
const DONOR_TOKENS = ['become a donor', 'register as donor', 'raktdaan karna', 'ডোনার'];
const COMPLAINT_TOKENS = ['complaint', 'no water', 'road', 'समस्या', 'অভিযোগ'];
const GREETING_TOKENS = ['hi', 'hello', 'namaskar', 'নমস্কার', 'नमस्ते'];
const NOISE_TOKENS = ['thanks', 'okay', 'xyz', 'foobar', 'please'];

const ticketArb = fc
  .tuple(fc.integer({ min: 2020, max: 2099 }), fc.integer({ min: 0, max: 99999 }))
  .map(([y, s]) => `WB-${y}-${String(s).padStart(5, '0')}`);

/** Multilingual / mixed message generator exercising every routing branch. */
const messageArb: fc.Arbitrary<MessageInput> = fc
  .oneof(
    { weight: 5, arbitrary: fc.constantFrom(...BLOOD_TOKENS, ...DONOR_TOKENS, ...COMPLAINT_TOKENS) },
    { weight: 2, arbitrary: fc.constantFrom(...GREETING_TOKENS) },
    { weight: 1, arbitrary: ticketArb },
    { weight: 1, arbitrary: fc.constantFrom(...NOISE_TOKENS) },
  )
  .map((original) => ({ original_text: original, text: original.toLowerCase() }));

/** Activity ages strictly OLDER than 30 minutes (the stale regime of Req 1.6). */
const staleAgeMsArb = fc.oneof(
  { weight: 1, arbitrary: fc.constantFrom(STALE_MS + 1, 31 * 60_000, 45 * 60_000, 120 * 60_000) },
  { weight: 2, arbitrary: fc.integer({ min: STALE_MS + 1, max: 24 * 60 * 60_000 }) },
);

// ─── Property 13A: flow-complete save lands on idle / empty ──────────────────

describe('Property 13A: flow-complete save resets to idle with empty collected_data', () => {
  it('forces last_intent=idle and collected_data={} from any flow-completion state (Req 1.5)', () => {
    fc.assert(
      fc.property(
        arbExistingRow(FLOW_COMPLETION_INTENTS),
        arbFlowCompletePayload,
        (existing, partial) => {
          const payload: SavePayload = { session_id: existing.session_id, ...partial };
          const result = applySave(existing, payload, NOW);

          // Core invariant of Property 13 / Req 1.5.
          expect(result.last_intent).toBe('idle');
          expect(result.collected_data).toEqual({});

          // The reset is authoritative: any non-idle last_intent or non-empty
          // collected_data supplied in the payload does NOT leak through the
          // flow_complete branch.
          if (partial.last_intent !== undefined) {
            expect(result.last_intent).not.toBe(partial.last_intent);
          }
          if (partial.collected_data !== undefined) {
            expect(result.collected_data).not.toEqual(partial.collected_data);
          }

          // The save always refreshes activity (so the row is no longer stale).
          expect(result.last_activity_at).toBe(NOW.toISOString());
        },
      ),
      { numRuns: 300 },
    );
  });

  it('holds for ANY starting last_intent, not just the confirming states', () => {
    fc.assert(
      fc.property(
        arbExistingRow(LAST_INTENTS),
        arbFlowCompletePayload,
        (existing, partial) => {
          const result = applySave(existing, { session_id: existing.session_id, ...partial }, NOW);
          expect(result.last_intent).toBe('idle');
          expect(result.collected_data).toEqual({});
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a non-flow-complete save preserves provided in-progress data (negative control)', () => {
    fc.assert(
      fc.property(
        arbExistingRow(LAST_INTENTS),
        fc.constantFrom(...FLOW_COMPLETION_INTENTS),
        arbCollectedData,
        (existing, intent, data) => {
          const result = applySave(
            existing,
            { session_id: existing.session_id, last_intent: intent, collected_data: data },
            NOW,
          );
          // Without flow_complete, the in-progress flow is NOT reset.
          expect(result.last_intent).toBe(intent);
          expect(result.collected_data).toEqual(data);
        },
      ),
      { numRuns: 150 },
    );
  });
});

// ─── Property 13B: stale rows route as if idle ───────────────────────────────

describe('Property 13B: a row older than 30 minutes routes as if last_intent=idle (Req 1.6)', () => {
  it('stale session decision is byte-identical to a fresh idle session for the same message', () => {
    fc.assert(
      fc.property(
        messageArb,
        fc.constantFrom(...LANGUAGES),
        fc.constantFrom(...LAST_INTENTS),
        staleAgeMsArb,
        (message, language, staleIntent, ageMs) => {
          // A stale row: last_activity_at older than 30 min, any last_intent.
          const staleSession: SessionInput = {
            last_intent: staleIntent,
            last_activity_at: new Date(NOW.getTime() - ageMs).toISOString(),
            language,
          };

          // The reference: a fresh idle session that should route the same way.
          const idleSession: SessionInput = {
            last_intent: 'idle',
            last_activity_at: NOW.toISOString(),
            language,
          };

          const fromStale = decide(staleSession, message, NOW);
          const fromIdle = decide(idleSession, message, NOW);

          // Agent, reason AND rulesEvaluated must all match.
          expect(fromStale).toStrictEqual(fromIdle);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('a row exactly AT the 30-minute boundary is NOT treated as stale (boundary control)', () => {
    fc.assert(
      fc.property(
        messageArb,
        fc.constantFrom(...LANGUAGES),
        // Only non-idle, non-prefix-collision states would actually differ; use
        // the state-locked intents which clearly diverge from idle routing.
        fc.constantFrom('donor_pending_response', 'seeker_confirming', 'blood_collecting'),
        (message, language, nonIdleIntent) => {
          const boundarySession: SessionInput = {
            last_intent: nonIdleIntent,
            // exactly 30 min — NOT > 30 min, so the belt must not fire.
            last_activity_at: new Date(NOW.getTime() - STALE_MS).toISOString(),
            language,
          };
          const decision = decide(boundarySession, message, NOW);
          // The non-idle state still governs routing → blood agent, never the
          // idle/content-based path.
          expect(decision.agent).toBe('blood');
        },
      ),
      { numRuns: 150 },
    );
  });
});

// ─── Concrete anchors ────────────────────────────────────────────────────────

describe('Property 13 — concrete examples', () => {
  const baseRow: SessionRow = {
    session_id: '+919900000001',
    last_intent: 'complaint_confirming',
    active_agent: 'complaint',
    collected_data: { naam: 'Asha', jela: 'Nadia', samasya: 'no water' },
    language: 'bn',
    last_activity_at: new Date(NOW.getTime() - 60_000).toISOString(),
  };

  it('complaint_confirming → flow_complete save → idle + {}', () => {
    const result = applySave(baseRow, { session_id: baseRow.session_id, flow_complete: true }, NOW);
    expect(result.last_intent).toBe('idle');
    expect(result.collected_data).toEqual({});
  });

  it('blood_confirming → flow_complete save → idle + {} (ignores stray collected_data)', () => {
    const result = applySave(
      { ...baseRow, last_intent: 'blood_confirming', collected_data: { units: 2 } },
      { session_id: baseRow.session_id, flow_complete: true, collected_data: { units: 99 } },
      NOW,
    );
    expect(result.last_intent).toBe('idle');
    expect(result.collected_data).toEqual({});
  });

  it('a 45-min-stale blood_collecting session greets "hi" as welcome (routes as idle)', () => {
    const stale: SessionInput = {
      last_intent: 'blood_collecting',
      last_activity_at: new Date(NOW.getTime() - 45 * 60_000).toISOString(),
      language: 'en',
    };
    expect(decide(stale, { original_text: 'hi', text: 'hi' }, NOW)).toMatchObject({
      agent: 'welcome',
      reason: 'greeting_on_idle',
    });
  });
});
