// Feature: sahayak-multi-agent-router, Property 18: Stack overflow drops oldest
//
// Validates: Requirements 21.5 — Design §v1.1.2, §Property 18
//
// Property 18: for any depth-3 stack and any new frame f, push(stack, f)
// returns a length-3 stack with f as the active top, stack[0] (the oldest) is
// dropped, and the dropped frame is returned so the caller can audit-log it
// (activity_logs action='flow_stack_drop_oldest'). The active frame is never
// dropped because it always lives at the end.

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  push,
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

const arbNewFrame: fc.Arbitrary<NewFrame> = fc.constantFrom(...FLOWS).map((flow) => ({
  flow,
  intent: INTENT_BY_FLOW[flow],
  collected_data: { k: flow },
}));

/** Build a full depth-3 stack via three sequential pushes. */
function buildFullStack(a: NewFrame, b: NewFrame, c: NewFrame): Frame[] {
  let s = push([], a, '2026-05-01T10:00:00.000Z').next;
  s = push(s, b, '2026-05-01T10:01:00.000Z').next;
  s = push(s, c, '2026-05-01T10:02:00.000Z').next;
  return s;
}

describe('Property 18 — Stack overflow drops oldest (Req 21.5)', () => {
  it('push onto a depth-3 stack returns length 3 with f on top and stack[0] dropped', () => {
    fc.assert(
      fc.property(
        arbNewFrame,
        arbNewFrame,
        arbNewFrame,
        arbNewFrame,
        (a, b, c, f) => {
          const full = buildFullStack(a, b, c);
          expect(full.length).toBe(MAX_DEPTH);
          const oldest = full[0];

          const { next, dropped } = push(full, f, '2026-05-01T10:03:00.000Z');

          // Length stays capped at MAX_DEPTH.
          expect(next.length).toBe(MAX_DEPTH);
          // The new frame is the active top.
          expect(next[next.length - 1].flow).toBe(f.flow);
          expect(next[next.length - 1].suspended_at).toBeUndefined();
          // The oldest frame was dropped and returned.
          expect(dropped).toBeDefined();
          expect(dropped?.flow).toBe(oldest.flow);
          expect(dropped?.started_at).toBe(oldest.started_at);
          // The dropped frame is no longer present at the bottom.
          expect(next[0].started_at).not.toBe(oldest.started_at);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('does not drop when the stack is below MAX_DEPTH', () => {
    fc.assert(
      fc.property(arbNewFrame, arbNewFrame, (a, b) => {
        const s = push([], a, '2026-05-01T10:00:00.000Z').next;
        const { next, dropped } = push(s, b, '2026-05-01T10:01:00.000Z');
        expect(next.length).toBe(2);
        expect(dropped).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
