// Feature: sahayak-multi-agent-router, Task 19.1 — Flow Stack Manager (Req 21.1, 21.4-21.8)
//
// Unit tests for the pure flow-stack manager (src/lib/flowStack/manager.ts).
// These verify push/pop/peek/dropOldest algebra, overflow-drops-oldest,
// deriveLastIntent backward-compat, and the cancel-keyword matcher.
// Property tests for the same module live in tasks 19.6-19.8.
//
// Pure-logic tests — no DB, no network.

import { describe, it, expect } from 'vitest';
import {
  CANCEL_RE,
  cancelKeywordMatch,
  deriveLastIntent,
  dropOldest,
  type Frame,
  MAX_DEPTH,
  peek,
  pop,
  push,
} from '../../src/lib/flowStack/manager';

const T0 = '2026-05-26T10:00:00.000Z';
const T1 = '2026-05-26T10:02:00.000Z';
const T2 = '2026-05-26T10:04:00.000Z';
const T3 = '2026-05-26T10:06:00.000Z';

function frame(flow: Frame['flow'], intent: string, data: Record<string, unknown> = {}): Frame {
  return { flow, intent, collected_data: data, started_at: T0 };
}

describe('flowStack/manager constants', () => {
  it('caps depth at 3', () => {
    expect(MAX_DEPTH).toBe(3);
  });

  it('uses the exact cancel regex from the design', () => {
    expect(CANCEL_RE.source).toBe('\\b(cancel|chhodo|baad mein|skip|বাতিল|बाद में)\\b');
    expect(CANCEL_RE.flags).toContain('i');
    expect(CANCEL_RE.flags).toContain('u');
  });
});

describe('push', () => {
  it('appends the new frame as the active top and stamps started_at', () => {
    const { next, dropped } = push(
      [],
      { flow: 'complaint', intent: 'complaint_collecting', collected_data: {} },
      T0,
    );
    expect(dropped).toBeUndefined();
    expect(next).toHaveLength(1);
    expect(next[0].started_at).toBe(T0);
    expect(next[0].suspended_at).toBeUndefined();
  });

  it('suspends the previously active frame on push', () => {
    const start = push(
      [],
      { flow: 'complaint', intent: 'complaint_collecting', collected_data: { naam: 'Ravi' } },
      T0,
    ).next;
    const { next } = push(
      start,
      { flow: 'blood', intent: 'blood_collecting', collected_data: { units: 2 } },
      T1,
    );
    expect(next).toHaveLength(2);
    expect(next[0].suspended_at).toBe(T1); // bottom frame suspended
    expect(next[1].suspended_at).toBeUndefined(); // top frame active
    expect(next[1].flow).toBe('blood');
  });

  it('drops the OLDEST frame on overflow beyond MAX_DEPTH and keeps the active frame', () => {
    let stack: Frame[] = [];
    stack = push(stack, { flow: 'complaint', intent: 'c1', collected_data: { a: 1 } }, T0).next;
    stack = push(stack, { flow: 'blood', intent: 'b1', collected_data: { b: 1 } }, T1).next;
    stack = push(stack, { flow: 'donor', intent: 'd1', collected_data: { d: 1 } }, T2).next;
    expect(stack).toHaveLength(3);

    const { next, dropped } = push(
      stack,
      { flow: 'complaint', intent: 'c2', collected_data: { e: 1 } },
      T3,
    );
    expect(next).toHaveLength(MAX_DEPTH);
    expect(dropped?.intent).toBe('c1'); // oldest dropped
    expect(next[next.length - 1].intent).toBe('c2'); // new frame is active top
    expect(next[next.length - 1].suspended_at).toBeUndefined();
  });

  it('does not mutate the input stack', () => {
    const original = push([], { flow: 'complaint', intent: 'c1', collected_data: {} }, T0).next;
    const snapshot = JSON.stringify(original);
    push(original, { flow: 'blood', intent: 'b1', collected_data: {} }, T1);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('pop', () => {
  it('returns empty + no popped frame on an empty stack', () => {
    expect(pop([])).toEqual({ next: [] });
  });

  it('removes the top frame and resumes the next frame', () => {
    let stack: Frame[] = [];
    stack = push(stack, { flow: 'complaint', intent: 'c1', collected_data: { a: 1 } }, T0).next;
    stack = push(stack, { flow: 'blood', intent: 'b1', collected_data: { b: 1 } }, T1).next;

    const { next, popped } = pop(stack);
    expect(popped?.flow).toBe('blood');
    expect(next).toHaveLength(1);
    // resumed frame must no longer be suspended (invariant I3)
    expect(next[0].flow).toBe('complaint');
    expect(next[0].suspended_at).toBeUndefined();
  });
});

describe('peek', () => {
  it('returns undefined on empty', () => {
    expect(peek([])).toBeUndefined();
  });

  it('returns the active top frame', () => {
    const stack = [frame('complaint', 'c1'), frame('blood', 'b1')];
    expect(peek(stack)?.flow).toBe('blood');
  });
});

describe('dropOldest', () => {
  it('returns empty on empty stack', () => {
    expect(dropOldest([])).toEqual({ next: [] });
  });

  it('drops stack[0] and reports it', () => {
    const stack = [frame('complaint', 'c1'), frame('blood', 'b1')];
    const { next, dropped } = dropOldest(stack);
    expect(dropped?.flow).toBe('complaint');
    expect(next).toHaveLength(1);
    expect(next[0].flow).toBe('blood');
  });
});

describe('deriveLastIntent', () => {
  it('returns the legacy intent when the stack is empty (Req 21.8)', () => {
    expect(deriveLastIntent([], 'idle')).toBe('idle');
  });

  it("returns the top frame's intent when non-empty (Req 21.7)", () => {
    const stack = [frame('complaint', 'complaint_collecting'), frame('blood', 'blood_collecting')];
    expect(deriveLastIntent(stack, 'idle')).toBe('blood_collecting');
  });
});

describe('cancelKeywordMatch', () => {
  it.each(['cancel', 'CANCEL', 'please cancel this', 'skip', 'baad mein', 'chhodo'])(
    'matches latin cancel keyword: %s',
    (msg) => {
      expect(cancelKeywordMatch(msg)).toBe(true);
    },
  );

  it('does not match unrelated text', () => {
    expect(cancelKeywordMatch('blood chahiye urgent')).toBe(false);
    expect(cancelKeywordMatch('cancellation policy')).toBe(false);
  });
});
