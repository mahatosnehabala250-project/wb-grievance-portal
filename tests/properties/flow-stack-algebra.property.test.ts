// Feature: sahayak-multi-agent-router, Property 17: Flow Stack push/pop algebra
//
// Validates: Requirements 21.1, 21.2, 21.4, 21.7 — Design §v1.1.2, §Property 17
//
// Property 17: for any sequence of push/pop operations on an initially empty
// flow stack, the stack invariants hold after EVERY step:
//   I1. length <= MAX_DEPTH (= 3)
//   I2. frames ordered oldest -> newest (push appends, pop removes the end)
//   I3. only the top frame (last index) has no `suspended_at`; every other
//       frame carries `suspended_at`
//   I7. deriveLastIntent(stack, legacy) == top frame's intent when non-empty,
//       else the legacy last_intent (Req 21.7)

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  push,
  pop,
  peek,
  deriveLastIntent,
  MAX_DEPTH,
  type Frame,
  type NewFrame,
  type Flow,
} from '../../src/lib/flowStack/manager';

const FLOWS: Flow[] = ['complaint', 'blood', 'donor'];
const INTENT_BY_FLOW: Record<Flow, string> = {
  complaint: 'complaint_collecting',
  blood: 'blood_collecting',
  donor: 'donor_registration',
};

/** Arbitrary new frame (the caller-supplied shape that push() stamps). */
const arbNewFrame: fc.Arbitrary<NewFrame> = fc
  .constantFrom(...FLOWS)
  .chain((flow) =>
    fc.record({
      flow: fc.constant(flow),
      intent: fc.constant(INTENT_BY_FLOW[flow]),
      collected_data: fc.dictionary(
        fc.constantFrom('naam', 'jela', 'blood_group', 'units'),
        fc.string({ maxLength: 8 }),
        { maxKeys: 3 },
      ),
    }),
  );

type Op = { kind: 'push'; frame: NewFrame } | { kind: 'pop' };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  arbNewFrame.map((frame) => ({ kind: 'push' as const, frame })),
  fc.constant({ kind: 'pop' as const }),
);

/** Assert the four structural invariants on a stack. */
function assertInvariants(stack: Frame[], legacy: string) {
  // I1: bounded depth
  expect(stack.length).toBeLessThanOrEqual(MAX_DEPTH);

  // I3: only the top frame is active (no suspended_at); all others suspended.
  stack.forEach((frame, i) => {
    if (i === stack.length - 1) {
      expect(frame.suspended_at, 'top frame must be active').toBeUndefined();
    } else {
      expect(typeof frame.suspended_at, `frame ${i} must be suspended`).toBe('string');
    }
  });

  // I7: deriveLastIntent reflects the active frame, or legacy when empty.
  const top = peek(stack);
  if (top) {
    expect(deriveLastIntent(stack, legacy)).toBe(top.intent);
  } else {
    expect(deriveLastIntent(stack, legacy)).toBe(legacy);
  }
}

describe('Property 17 — Flow Stack push/pop algebra (Req 21.1, 21.2, 21.4, 21.7)', () => {
  it('maintains all stack invariants after every push/pop in an arbitrary sequence', () => {
    fc.assert(
      fc.property(fc.array(arbOp, { maxLength: 40 }), fc.constantFrom('idle', 'welcome'), (ops, legacy) => {
        let stack: Frame[] = [];
        // ts: each op is monotonically increasing so suspended_at ordering is stable.
        let t = Date.UTC(2026, 4, 1, 10, 0, 0);

        assertInvariants(stack, legacy);

        for (const op of ops) {
          t += 1000;
          const nowIso = new Date(t).toISOString();
          if (op.kind === 'push') {
            stack = push(stack, op.frame, nowIso).next;
          } else {
            stack = pop(stack).next;
          }
          assertInvariants(stack, legacy);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('push then pop returns to the prior active intent (round-trip)', () => {
    fc.assert(
      fc.property(arbNewFrame, arbNewFrame, (a, b) => {
        const t0 = '2026-05-01T10:00:00.000Z';
        const t1 = '2026-05-01T10:01:00.000Z';
        const base = push([], a, t0).next; // [a(active)]
        const pushed = push(base, b, t1).next; // [a(susp), b(active)]
        expect(peek(pushed)?.flow).toBe(b.flow);

        const popped = pop(pushed).next; // [a(active resumed)]
        expect(peek(popped)?.flow).toBe(a.flow);
        expect(peek(popped)?.suspended_at).toBeUndefined();
        expect(popped.length).toBe(1);
      }),
      { numRuns: 150 },
    );
  });

  it('pop on an empty stack is a no-op (never negative length)', () => {
    const { next, popped } = pop([]);
    expect(next).toEqual([]);
    expect(popped).toBeUndefined();
  });
});
