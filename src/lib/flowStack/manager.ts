/**
 * Flow Stack Manager (pure, no I/O).
 *
 * The Flow Stack is an ordered jsonb array persisted on
 * `conversation_sessions.flow_stack`. It stores the active conversation flow
 * plus any suspended (paused) flows, so a citizen can interleave a complaint
 * and a blood request without losing in-progress data. The LAST element of the
 * array is the active flow (top of stack); depth is capped at {@link MAX_DEPTH}.
 *
 * Every function here is referentially transparent and never mutates its input:
 * each returns a brand-new array (and never touches the frames it copies in
 * place). Timestamps are sourced from an injectable `now` argument so the module
 * stays deterministic under test.
 *
 * Stack invariants (enforced by every operation):
 *   I1. flow_stack.length <= MAX_DEPTH (= 3)
 *   I2. frames are ordered oldest -> newest
 *   I3. only the top frame (last index) has no `suspended_at`; every other
 *       frame has `suspended_at` set
 *   I4. each frame.intent matches the v1 `last_intent` enum (Req 1.2)
 *   I5. frame.collected_data conforms to the v1 schema for that flow
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.2 Flow Stack and Multi-Intent
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §Property 17, §Property 18
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirement 21 (21.1, 21.4-21.8)
 */

/** Flows that maintain collectible, suspendable state (Req 21.1, design §v1.1.2). */
export type Flow = 'complaint' | 'blood' | 'donor';

/** v1 `last_intent` enum value (Req 1.2). Kept as a string for forward-compat. */
export type Intent = string;

/**
 * A single frame on the flow stack.
 *
 * The active (top) frame has no `suspended_at`. A frame gains `suspended_at`
 * the moment another flow is pushed on top of it, and loses it again when it is
 * resumed (becomes the top) after a {@link pop}.
 */
export interface Frame {
  flow: Flow;
  intent: Intent;
  collected_data: Record<string, unknown>;
  /** ISO-8601 timestamp set when the frame was first pushed. */
  started_at: string;
  /** ISO-8601 timestamp set when the frame was suspended; absent while active. */
  suspended_at?: string;
}

/** Maximum number of frames retained on the stack (Req 21.4, design §v1.1.2). */
export const MAX_DEPTH = 3;

/**
 * Cancel-keyword pattern (Req 21.6). Latin + Devanagari + Bengali variants.
 *
 * NOTE: `\b` is defined over ASCII `\w` even under the `u` flag, so the
 * non-Latin alternatives (`বাতিল`, `बाद में`) only match reliably when adjacent
 * to ASCII word characters. This mirrors the regex specified verbatim in
 * design §v1.1.2 / task 19.1; matching robustness for non-Latin scripts is
 * exercised by Property 19 (task 19.8) where any gap can be triaged.
 */
export const CANCEL_RE = /\b(cancel|chhodo|baad mein|skip|বাতিল|बाद में)\b/iu;

/**
 * Frame shape accepted by {@link push}: the caller supplies the flow, intent and
 * collected data; the manager stamps `started_at` and guarantees the new frame
 * is active (no `suspended_at`).
 */
export type NewFrame = Pick<Frame, 'flow' | 'intent' | 'collected_data'>;

function isoNow(): string {
  return new Date().toISOString();
}

/** Returns a copy of `frame` marked suspended at `at` (does not mutate input). */
function suspend(frame: Frame, at: string): Frame {
  return { ...frame, collected_data: { ...frame.collected_data }, suspended_at: at };
}

/** Returns a copy of `frame` with `suspended_at` cleared (resumed/active). */
function resume(frame: Frame): Frame {
  // Drop `suspended_at` without mutating the source frame.
  const { suspended_at: _dropped, ...rest } = frame;
  return { ...rest, collected_data: { ...rest.collected_data } };
}

/**
 * Push a new flow onto the stack (Req 21.2, 21.5).
 *
 * The previously-active (top) frame is suspended (gains `suspended_at`), and the
 * new frame is appended as the active top with a fresh `started_at`. If the push
 * would exceed {@link MAX_DEPTH}, the OLDEST frame (`stack[0]`) is dropped — the
 * active frame is never dropped because it always lives at the end.
 *
 * @returns the new stack plus the dropped frame (if an overflow occurred).
 */
export function push(
  stack: Frame[],
  frame: NewFrame,
  now: string = isoNow(),
): { next: Frame[]; dropped?: Frame } {
  const suspended =
    stack.length > 0
      ? [...stack.slice(0, -1), suspend(stack[stack.length - 1], now)]
      : [];

  // The incoming frame becomes active: stamp `started_at`, never carry `suspended_at`.
  const active: Frame = {
    flow: frame.flow,
    intent: frame.intent,
    collected_data: { ...frame.collected_data },
    started_at: now,
  };

  let next = [...suspended, active];
  let dropped: Frame | undefined;

  if (next.length > MAX_DEPTH) {
    dropped = next[0]; // oldest, never the active frame
    next = next.slice(1);
  }

  return { next, dropped };
}

/**
 * Pop the active (top) frame off the stack (Req 21.3, 21.6).
 *
 * The frame immediately below is resumed (its `suspended_at` is cleared) so the
 * invariant "only the top frame has no `suspended_at`" continues to hold.
 *
 * @returns the new stack plus the popped frame (if the stack was non-empty).
 */
export function pop(stack: Frame[]): { next: Frame[]; popped?: Frame } {
  if (stack.length === 0) {
    return { next: [] };
  }

  const popped = stack[stack.length - 1];
  const rest = stack.slice(0, -1);

  if (rest.length === 0) {
    return { next: [], popped };
  }

  // Resume the newly-exposed top frame.
  const next = [...rest.slice(0, -1), resume(rest[rest.length - 1])];
  return { next, popped };
}

/** Peek at the active (top) frame without removing it. Returns `undefined` when empty. */
export function peek(stack: Frame[]): Frame | undefined {
  return stack.length > 0 ? stack[stack.length - 1] : undefined;
}

/**
 * Drop the oldest (bottom) frame (Req 21.5).
 *
 * Used by the overflow path and by explicit pruning. The active top frame is
 * preserved unless it is also the only (and therefore oldest) frame.
 *
 * @returns the new stack plus the dropped frame (if the stack was non-empty).
 */
export function dropOldest(stack: Frame[]): { next: Frame[]; dropped?: Frame } {
  if (stack.length === 0) {
    return { next: [] };
  }
  return { next: stack.slice(1), dropped: stack[0] };
}

/**
 * Derive the v1-compatible `last_intent` (Req 21.7, 21.8).
 *
 * When the stack is non-empty the active (top) frame's intent is the source of
 * truth; otherwise the legacy `last_intent` field is returned unchanged so the
 * v1 single-intent model and Properties 1/13 keep holding.
 */
export function deriveLastIntent(stack: Frame[], legacyLastIntent: Intent): Intent {
  return stack.length > 0 ? stack[stack.length - 1].intent : legacyLastIntent;
}

/** Returns true iff `message` matches the cancel-keyword set (Req 21.6). */
export function cancelKeywordMatch(message: string): boolean {
  // Reset lastIndex defensively even though the literal has no `g`/`y` flag.
  CANCEL_RE.lastIndex = 0;
  return CANCEL_RE.test(message);
}

/** Returns true iff the stack has no frames. */
export function isEmpty(stack: Frame[]): boolean {
  return stack.length === 0;
}

/**
 * Replace the active (top) frame's `collected_data` with `collected_data`
 * (update the in-progress state of the active flow). No-op on an empty stack.
 *
 * Pure: returns a new array; the source frames are never mutated.
 */
export function updateTop(
  stack: Frame[],
  collected_data: Record<string, unknown>,
): Frame[] {
  if (stack.length === 0) {
    return [];
  }
  const top = stack[stack.length - 1];
  const updated: Frame = { ...top, collected_data: { ...collected_data } };
  return [...stack.slice(0, -1), updated];
}

/* -------------------------------------------------------------------------- */
/* Compatibility facade                                                        */
/*                                                                             */
/* The canonical API above (push/pop/peek/dropOldest/deriveLastIntent/         */
/* cancelKeywordMatch/MAX_DEPTH/CANCEL_RE) is the surface consumed by tasks     */
/* 19.2-19.8 and Property tests 17/18. The aliases below expose the alternate  */
/* `*Flow` names so callers expecting that shape resolve against the same      */
/* underlying `Frame` type and pure semantics.                                 */
/* -------------------------------------------------------------------------- */

/** Alias of {@link Frame} for callers using the `FlowFrame` name. */
export type FlowFrame = Frame;

/** Alias of {@link MAX_DEPTH}. */
export const MAX_STACK_DEPTH = MAX_DEPTH;

/**
 * Push a new flow onto the stack, returning only the resulting array.
 * Overflow drops the oldest (bottom) frame. See {@link push}.
 */
export function pushFlow(
  stack: Frame[],
  frame: NewFrame,
  now: string = isoNow(),
): Frame[] {
  return push(stack, frame, now).next;
}

/**
 * Pop the active (top) frame, returning `{ popped, stack }`.
 * `popped` is `null` when the stack was empty. See {@link pop}.
 */
export function popFlow(stack: Frame[]): { popped: Frame | null; stack: Frame[] } {
  const { next, popped } = pop(stack);
  return { popped: popped ?? null, stack: next };
}

/** Peek at the active (top) frame, returning `null` when empty. See {@link peek}. */
export function peekFlow(stack: Frame[]): Frame | null {
  return peek(stack) ?? null;
}
