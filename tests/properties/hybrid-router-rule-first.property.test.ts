// Feature: sahayak-multi-agent-router, Property 15: Hybrid Router rule-first invariance
//
// Validates: Requirements 20.1, 20.6 — Design §v1.1.1, §Property 15
//
// Property 15: when the deterministic v1 rule fires confidently — OR the session
// is in a hot-locked state (HOT_STATES, Req 20.6) — the Gemini Flash classifier
// MUST NEVER be invoked. The hybrid router (`decideHybrid`) reaches the
// classifier only through `lookupOrClassify`, which is the sole consumer of the
// injected DB client. So "classifier never invoked" is observable as "the DB
// client's `query` was called zero times". We assert call count = 0 on every
// rule-first / hot-state path, and we additionally confirm the classifier IS
// consulted on the genuine no-confident-rule path (so the zero-call assertion
// is meaningful, not vacuous).

import fc from 'fast-check';
import { describe, it, expect, vi } from 'vitest';
import {
  decideHybrid,
  HOT_STATES,
  type SessionInput,
  type MessageInput,
} from '../../src/lib/router/ceoRouter';
import type { DbClient } from '../../src/lib/router/cache';

/** Fixed reference "now" so the stale-belt branch is deterministic. */
const NOW = new Date('2026-02-01T12:00:00.000Z');
const FRESH = new Date(NOW.getTime() - 60_000).toISOString(); // 1 min ago → fresh

/**
 * A DB client whose `query` is a spy. If `decideHybrid` reaches the classifier,
 * `lookupOrClassify` will call `query` (LOOKUP_SQL). On the rule-first / hot-state
 * paths it must stay at zero calls. The lookup branch resolves to an empty row
 * set (cache miss) and the write branch resolves to an empty result; the miss
 * path would then call the real Gemini wrapper, which has no API key in tests and
 * fails soft — but for rule-first cases we never get there.
 */
function spyDb(): { db: DbClient; queryCalls: () => number } {
  const query = vi.fn(async () => ({ rows: [] as Record<string, unknown>[] }));
  return {
    db: { query } as unknown as DbClient,
    queryCalls: () => query.mock.calls.length,
  };
}

const LANGS = ['en', 'hi', 'bn'] as const;

/** Messages that trigger a confident v1 rule (greeting, ticket, idle keywords). */
const ruleFiringMessages = [
  'Hi',
  'namaste',
  'Status of WB-2026-00042 please',
  'blood chahiye urgent',
  'I want to become a donor',
  'there is no water in my area',
  'राशन की समस्या है',
  'রক্ত লাগবে',
];

/** Messages that should NOT trigger any v1 rule (force the classifier path). */
const nonRuleMessages = [
  'asdf qwerty zxcv',
  'kal kya plan hai',
  '12345',
  'lorem ipsum dolor',
];

describe('Property 15 — Hybrid Router rule-first invariance (Req 20.1, 20.6)', () => {
  it('never invokes the classifier when a confident v1 rule fires (from idle)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ruleFiringMessages),
        fc.constantFrom(...LANGS),
        async (text, language) => {
          const session: SessionInput = {
            last_intent: 'idle',
            last_activity_at: FRESH,
            language,
          };
          const message: MessageInput = { text: text.toLowerCase(), original_text: text };
          const { db, queryCalls } = spyDb();

          const decision = await decideHybrid(session, message, {}, db, NOW);

          // A confident rule fired → classifier (DB) was never consulted.
          expect(queryCalls()).toBe(0);
          expect(decision.classifierUsed).toBe(false);
          expect(decision.confidence).toBe(1);
          // The decision is never the low-confidence clarification branch here.
          expect(decision.agent).not.toBe('clarification');
        },
      ),
      { numRuns: 120 },
    );
  });

  it('never invokes the classifier when last_intent is a hot-locked state (Req 20.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...Array.from(HOT_STATES)),
        // Even an otherwise-ambiguous message must not reach the classifier.
        fc.constantFrom(...nonRuleMessages, ...ruleFiringMessages),
        fc.constantFrom(...LANGS),
        async (lastIntent, text, language) => {
          const session: SessionInput = {
            last_intent: lastIntent,
            last_activity_at: FRESH,
            language,
          };
          const message: MessageInput = { text: text.toLowerCase(), original_text: text };
          const { db, queryCalls } = spyDb();

          const decision = await decideHybrid(session, message, {}, db, NOW);

          expect(queryCalls()).toBe(0);
          expect(decision.classifierUsed).toBe(false);
        },
      ),
      { numRuns: 120 },
    );
  });

  it('never invokes the classifier when rule-only routing is forced (Req 29.3/30.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...nonRuleMessages),
        fc.constantFrom(...LANGS),
        async (text, language) => {
          const session: SessionInput = {
            last_intent: 'idle',
            last_activity_at: FRESH,
            language,
          };
          const message: MessageInput = { text: text.toLowerCase(), original_text: text };
          const { db, queryCalls } = spyDb();

          const decision = await decideHybrid(session, message, { ruleOnlyRouting: true }, db, NOW);

          expect(queryCalls()).toBe(0);
          expect(decision.classifierUsed).toBe(false);
        },
      ),
      { numRuns: 80 },
    );
  });

  it('DOES consult the classifier on a genuine no-confident-rule path (anti-vacuity)', async () => {
    // This guards against the zero-call assertions above being vacuously true:
    // with an ambiguous message from idle, the classifier MUST be reached
    // (the DB lookup runs at least once).
    for (const text of nonRuleMessages) {
      const session: SessionInput = { last_intent: 'idle', last_activity_at: FRESH, language: 'en' };
      const message: MessageInput = { text: text.toLowerCase(), original_text: text };
      const { db, queryCalls } = spyDb();

      await decideHybrid(session, message, {}, db, NOW);

      expect(queryCalls()).toBeGreaterThanOrEqual(1);
    }
  });
});
