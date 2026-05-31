// Feature: sahayak-multi-agent-router, Property 37: Token-estimation fallback is monotonic, deterministic, and non-negative
//
// File: tests/properties/token-estimator.property.test.ts
//
// **Validates: Requirements 18.15, 30.8** (Design §Property 37, §v1.1.16)
//
// ─── What Property 37 says ─────────────────────────────────────────────────────
// The local token estimator (src/lib/tokens/estimateTokens.ts) is the deterministic
// fallback the Budget_Tracker uses when `agent_invocations.tokens_used IS NULL`
// (Req 18.15, 30.8). For it to be a safe fallback it must guarantee:
//
//   1. NON-NEGATIVITY  — `estimate(x) >= 0` for ALL inputs, including '', null and
//      undefined. (A negative estimate would corrupt the per-session 24h token cap.)
//   2. DETERMINISM     — same input → same output across repeated calls (so a row's
//      estimated cost never drifts between the live Logger and the nightly roll-up).
//   3. MONOTONICITY    — appending text never DECREASES the estimate:
//      `estimate(a + b) >= estimate(a)`. (Adding prompt/response content can only
//      add to the accounted token budget, never refund it.)
//
// ─── Why monotonicity is framed as "append", not "by raw length" ───────────────
// The estimator weights scripts differently (~4 chars/token Latin, ~2.5 chars/token
// Devanagari+Bengali), so a *longer* string is not always *more* tokens — e.g. 4
// Latin chars = ceil(4/4) = 1 token, but 3 Devanagari chars = ceil(3/2.5) = 2
// tokens. The genuine guarantee the code makes (and the one documented in the
// source's own doc-comment and Design §Property 37) is monotonicity under
// APPENDING: extending p→p+Δ and r→r+Δ can only grow the per-script char counts,
// and `ceil(latin/4 + indic/2.5)` is non-decreasing in both. Appending also
// necessarily satisfies `len(p2) >= len(p1)` and `len(r2) >= len(r1)`, so this is
// the faithful, non-degenerate reading of the task's length condition.
//
// Library: fast-check + Vitest (per Design §Testing Strategy). 200+ iterations.

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimatePromptTokens,
  estimateResponseTokens,
  estimateTotal,
} from '../../src/lib/tokens/estimateTokens';

// ─── Generators ────────────────────────────────────────────────────────────────

/** A spread of Latin letters, digits, whitespace and punctuation. */
const latinCharArb = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?-\n\t'.split(''),
);

/** Devanagari (Hindi) code points U+0900–U+097F. */
const devanagariCharArb = fc
  .integer({ min: 0x0900, max: 0x097f })
  .map((cp) => String.fromCodePoint(cp));

/** Bengali / Bangla code points U+0980–U+09FF. */
const bengaliCharArb = fc
  .integer({ min: 0x0980, max: 0x09ff })
  .map((cp) => String.fromCodePoint(cp));

/** A few multi-code-unit characters (emoji) to exercise surrogate pairs. */
const emojiCharArb = fc.constantFrom('🩸', '🙏', '😀', '👍', '❤️');

/** Mixed multilingual single "character" (may be >1 UTF-16 code unit for emoji). */
const multilingualCharArb = fc.oneof(
  { weight: 5, arbitrary: latinCharArb },
  { weight: 3, arbitrary: devanagariCharArb },
  { weight: 3, arbitrary: bengaliCharArb },
  { weight: 1, arbitrary: emojiCharArb },
);

/** Arbitrary multilingual string (includes '' since minLength defaults to 0). */
const multilingualString = (maxLength = 400) =>
  fc.array(multilingualCharArb, { maxLength }).map((chars) => chars.join(''));

/** Strings plus the nullish inputs the estimator must tolerate (Req 18.15). */
const nullableString = fc.oneof(
  { weight: 8, arbitrary: multilingualString() },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.constantFrom(null, undefined) },
);

/** Non-empty extension used to grow a base string (guarantees a strict length bump). */
const extensionString = fc.array(multilingualCharArb, { minLength: 1, maxLength: 200 }).map((c) => c.join(''));

// Call sites cast nullish through `string` because the public signatures are typed
// `(text: string)` / `(prompt, response)`, yet the runtime contract (Req 18.15)
// explicitly tolerates null/undefined via internal `?? ''` / falsy guards.
const asStr = (v: string | null | undefined): string => v as unknown as string;

// ─── Property 37a: non-negativity (incl. '', null, undefined) ──────────────────

describe('Property 37: estimator is non-negative for all inputs', () => {
  it('estimateTokens returns a non-negative integer for any string/nullish input', () => {
    fc.assert(
      fc.property(nullableString, (text) => {
        const t = estimateTokens(asStr(text));
        expect(Number.isInteger(t)).toBe(true);
        expect(t).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });

  it('estimatePromptTokens / estimateResponseTokens / estimateTotal are non-negative integers', () => {
    fc.assert(
      fc.property(nullableString, nullableString, nullableString, (sys, user, resp) => {
        const prompt = estimatePromptTokens(asStr(sys), asStr(user));
        const response = estimateResponseTokens(asStr(resp));
        const total = estimateTotal(asStr(sys), asStr(user), asStr(resp));

        for (const v of [prompt, response, total]) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
        // estimateTotal is exactly prompt + response by construction.
        expect(total).toBe(prompt + response);
      }),
      { numRuns: 300 },
    );
  });

  it('empty / null / undefined all estimate to 0', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(asStr(null))).toBe(0);
    expect(estimateTokens(asStr(undefined))).toBe(0);
    expect(estimatePromptTokens(asStr(null), asStr(undefined))).toBe(0);
    expect(estimateResponseTokens(asStr(null))).toBe(0);
    expect(estimateTotal('', asStr(null), asStr(undefined))).toBe(0);
  });
});

// ─── Property 37b: determinism (same input → same output) ──────────────────────

describe('Property 37: estimator is deterministic', () => {
  it('repeated calls with the same input return an identical value', () => {
    fc.assert(
      fc.property(nullableString, (text) => {
        const a = estimateTokens(asStr(text));
        const b = estimateTokens(asStr(text));
        const c = estimateTokens(asStr(text));
        expect(b).toBe(a);
        expect(c).toBe(a);
      }),
      { numRuns: 300 },
    );
  });

  it('the (prompt, response) pair form is deterministic across repeated calls', () => {
    fc.assert(
      fc.property(nullableString, nullableString, (prompt, response) => {
        const first = estimatePromptTokens(asStr(prompt), asStr(response));
        const second = estimatePromptTokens(asStr(prompt), asStr(response));
        expect(second).toBe(first);
      }),
      { numRuns: 300 },
    );
  });

  it('the global INDIC_RANGE regex carries no lastIndex state between calls', () => {
    // A /g regex used with String#match resets per call; this guards against a
    // regression to .test()/.exec() that WOULD leak lastIndex and break determinism.
    fc.assert(
      fc.property(multilingualString(), (text) => {
        const reference = estimateTokens(text);
        for (let i = 0; i < 5; i++) {
          expect(estimateTokens(text)).toBe(reference);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 37c: monotonicity (appending never decreases the estimate) ───────

describe('Property 37: estimator is monotonic under appending', () => {
  it('estimateTokens(a + b) >= estimateTokens(a) for any base a and extension b', () => {
    fc.assert(
      fc.property(multilingualString(), extensionString, (base, ext) => {
        const extended = base + ext;
        expect(extended.length).toBeGreaterThanOrEqual(base.length);
        expect(estimateTokens(extended)).toBeGreaterThanOrEqual(estimateTokens(base));
      }),
      { numRuns: 300 },
    );
  });

  it('pair estimate is monotonic when BOTH prompt and response are extended', () => {
    fc.assert(
      fc.property(
        multilingualString(),
        multilingualString(),
        extensionString,
        extensionString,
        (p1, r1, pe, re) => {
          const p2 = p1 + pe;
          const r2 = r1 + re;
          expect(p2.length).toBeGreaterThanOrEqual(p1.length);
          expect(r2.length).toBeGreaterThanOrEqual(r1.length);
          expect(estimatePromptTokens(p2, r2)).toBeGreaterThanOrEqual(estimatePromptTokens(p1, r1));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('monotonicity holds even when the appended chunk is a different script', () => {
    fc.assert(
      fc.property(
        fc.array(latinCharArb, { maxLength: 100 }).map((c) => c.join('')),
        fc.array(devanagariCharArb, { minLength: 1, maxLength: 100 }).map((c) => c.join('')),
        (latinBase, indicExt) => {
          // Append Indic text to a Latin base — the cross-script boundary is where a
          // naive implementation could non-monotonically re-bucket characters.
          expect(estimateTokens(latinBase + indicExt)).toBeGreaterThanOrEqual(
            estimateTokens(latinBase),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Example-based anchors (complement the properties) ─────────────────────────

describe('Property 37: representative examples', () => {
  it('approximates Latin text at ~4 chars/token', () => {
    expect(estimateTokens('abcd')).toBe(1); // 4/4 = 1
    expect(estimateTokens('abcdefgh')).toBe(2); // 8/4 = 2
  });

  it('approximates Indic text at ~2.5 chars/token (more tokens than Latin)', () => {
    // 3 Devanagari chars => ceil(3/2.5) = ceil(1.2) = 2 tokens.
    expect(estimateTokens('नमस')).toBe(2);
    // Demonstrates why length-monotonicity does NOT hold: 4 Latin chars (1 token)
    // is fewer tokens than 3 Devanagari chars (2 tokens) despite being longer.
    expect(estimateTokens('abcd')).toBeLessThan(estimateTokens('नमस'));
  });

  it('appending strictly grows or preserves the estimate', () => {
    const base = 'Hello, this is a test message';
    expect(estimateTokens(base + ' और कुछ टेक्स्ट')).toBeGreaterThanOrEqual(estimateTokens(base));
    expect(estimateTokens(base + '')).toBe(estimateTokens(base)); // empty append: equal
  });

  it('estimateTotal == estimatePromptTokens + estimateResponseTokens', () => {
    const sys = 'You are a helpful assistant.';
    const user = 'মানে কী?';
    const resp = 'Iska matlab hai...';
    expect(estimateTotal(sys, user, resp)).toBe(
      estimatePromptTokens(sys, user) + estimateResponseTokens(resp),
    );
  });
});
