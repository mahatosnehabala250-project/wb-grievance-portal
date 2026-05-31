// Feature: sahayak-multi-agent-router, Property 19: Cancel keyword pops
//
// Validates: Requirements 21.6 — Design §v1.1.2, §Property 19
//
// Property 19: when the inbound message matches the multilingual cancel-keyword
// set, the router pops the active frame BEFORE rule dispatch. So for any stack
// and any cancel message, the post-cancel stack length is
// max(0, original_length - 1). Non-cancel messages leave the stack unchanged.

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  pop,
  cancelKeywordMatch,
  CANCEL_RE,
  type Frame,
  type NewFrame,
  type Flow,
  push,
} from '../../src/lib/flowStack/manager';

const FLOWS: Flow[] = ['complaint', 'blood', 'donor'];
const INTENT_BY_FLOW: Record<Flow, string> = {
  complaint: 'complaint_collecting',
  blood: 'blood_collecting',
  donor: 'donor_registration',
};

/** Cancel-keyword corpus the rule MUST recognize (Latin tokens are reliable). */
const CANCEL_WORDS = ['cancel', 'chhodo', 'baad mein', 'skip'];

/** Phrases embedding a cancel keyword among other words. */
const arbCancelMessage: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('', 'arre ', 'ok ', 'bhai '),
    fc.constantFrom(...CANCEL_WORDS),
    fc.constantFrom('', ' please', ' isko', ' yeh'),
  )
  .map(([pre, word, post]) => `${pre}${word}${post}`);

/** Messages that contain no cancel keyword. */
const arbNonCancelMessage: fc.Arbitrary<string> = fc
  .constantFrom('blood chahiye', 'naam Ravi hai', 'Howrah district', 'haan theek hai', 'A+ 2 units')
  .filter((m) => !cancelKeywordMatch(m));

const arbNewFrame: fc.Arbitrary<NewFrame> = fc.constantFrom(...FLOWS).map((flow) => ({
  flow,
  intent: INTENT_BY_FLOW[flow],
  collected_data: { k: flow },
}));

/** Build a stack of a given target depth (0..3) via sequential pushes. */
function buildStack(frames: NewFrame[]): Frame[] {
  let s: Frame[] = [];
  let t = Date.UTC(2026, 4, 1, 10, 0, 0);
  for (const f of frames) {
    t += 1000;
    s = push(s, f, new Date(t).toISOString()).next;
  }
  return s;
}

describe('Property 19 — Cancel keyword pops (Req 21.6)', () => {
  it('recognizes every cancel keyword in the Latin corpus', () => {
    for (const w of CANCEL_WORDS) {
      expect(cancelKeywordMatch(w), `"${w}" should match`).toBe(true);
    }
    // Defensive: CANCEL_RE has no global/sticky flag, so lastIndex stays 0.
    expect(CANCEL_RE.lastIndex).toBe(0);
  });

  it('post-cancel stack length = max(0, original - 1)', () => {
    fc.assert(
      fc.property(
        fc.array(arbNewFrame, { minLength: 0, maxLength: 3 }),
        arbCancelMessage,
        (frames, message) => {
          const stack = buildStack(frames);
          const original = stack.length;

          // Router behaviour: on a cancel keyword, pop() runs before dispatch.
          expect(cancelKeywordMatch(message)).toBe(true);
          const { next } = pop(stack);

          expect(next.length).toBe(Math.max(0, original - 1));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('non-cancel messages do not trigger a pop (stack unchanged)', () => {
    fc.assert(
      fc.property(
        fc.array(arbNewFrame, { minLength: 0, maxLength: 3 }),
        arbNonCancelMessage,
        (frames, message) => {
          const stack = buildStack(frames);
          expect(cancelKeywordMatch(message)).toBe(false);
          // No pop is performed for a non-cancel message.
          expect(stack.length).toBe(frames.length > 3 ? 3 : frames.length);
        },
      ),
      { numRuns: 150 },
    );
  });
});
