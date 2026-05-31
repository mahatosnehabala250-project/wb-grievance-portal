// Feature: sahayak-multi-agent-router, Task 31.1 — sticky A/B selection (Req 33.2, Design §v1.1.14)
//
// Unit tests for the pure, deterministic, weighted sticky version picker.
// Verifies: stickiness (same key → same version), weight-respecting filtering,
// the cumulative-weight bucket walk, the no-active-version throw, and the
// FNV-1a `hashU32` / non-negative `mod` helpers.
//
// The named Property 33 (two consecutive calls return the same version across
// arbitrary inputs) is covered separately by task 31.8.
//
// Pure-logic tests — no DB, no network.

import { describe, it, expect } from 'vitest';
import { pickVersion, hashU32, mod, type Versioned } from '../../src/lib/abtest/sticky';

function v(version: string, weight: number, active = true): Versioned<string> {
  return { id: `id-${version}`, version, weight, active, payload: `payload-${version}` };
}

describe('hashU32 — FNV-1a 32-bit', () => {
  it('is deterministic for the same input', () => {
    expect(hashU32('session-abc')).toBe(hashU32('session-abc'));
  });

  it('always returns an unsigned 32-bit integer', () => {
    for (const s of ['', 'a', 'session-1', '9876543210', '🩸blood']) {
      const h = hashU32(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });

  it('produces different hashes for different inputs (no trivial collisions)', () => {
    expect(hashU32('aaa')).not.toBe(hashU32('aab'));
    expect(hashU32('1')).not.toBe(hashU32('2'));
  });
});

describe('mod — non-negative modulo', () => {
  it('matches % for non-negative dividends', () => {
    expect(mod(7, 3)).toBe(1);
    expect(mod(0, 5)).toBe(0);
  });

  it('returns a value in [0, m) even for negative dividends', () => {
    expect(mod(-1, 3)).toBe(2);
    expect(mod(-7, 5)).toBe(3);
  });
});

describe('pickVersion — eligibility', () => {
  it('throws when the version set is empty', () => {
    expect(() => pickVersion('s1', [])).toThrow('no active version registered');
  });

  it('throws when every version is inactive', () => {
    expect(() => pickVersion('s1', [v('a', 1, false), v('b', 2, false)])).toThrow(
      'no active version registered',
    );
  });

  it('throws when all active versions have zero/negative weight', () => {
    expect(() => pickVersion('s1', [v('a', 0), v('b', -3)])).toThrow(
      'no active version registered',
    );
  });

  it('ignores inactive and zero-weight versions when choosing', () => {
    const versions = [v('inactive', 100, false), v('zero', 0), v('only', 5)];
    // The only eligible entry must always win regardless of key.
    for (const key of ['s1', 's2', 'phone-12345', '']) {
      expect(pickVersion(key, versions).version).toBe('only');
    }
  });
});

describe('pickVersion — stickiness (referential transparency)', () => {
  it('returns the same version for repeated calls with the same key', () => {
    const versions = [v('A', 1), v('B', 1), v('C', 1)];
    const first = pickVersion('session-xyz', versions);
    for (let i = 0; i < 10; i++) {
      expect(pickVersion('session-xyz', versions).version).toBe(first.version);
    }
  });

  it('is unaffected by the order of inactive/zero-weight entries in the set', () => {
    const a = pickVersion('k', [v('A', 1), v('B', 1)]);
    const b = pickVersion('k', [v('A', 1), v('B', 1), v('X', 0), v('Y', 1, false)]);
    expect(b.version).toBe(a.version);
  });
});

describe('pickVersion — bucket walk over weights', () => {
  it('maps the hashed slot through cumulative weights deterministically', () => {
    // Single eligible 50/50 split; pick is a pure function of the key's hash.
    const versions = [v('A', 50), v('B', 50)];
    const slotA = mod(hashU32('user-A-key'), 100);
    const expected = slotA < 50 ? 'A' : 'B';
    expect(pickVersion('user-A-key', versions).version).toBe(expected);
  });

  it('respects weights across many distinct keys (approx distribution)', () => {
    // 80/20 split. Over many uniformly-hashed keys, ~80% should land on A.
    const versions = [v('A', 80), v('B', 20)];
    let aCount = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      if (pickVersion(`session-${i}`, versions).version === 'A') aCount++;
    }
    const ratio = aCount / N;
    // Generous tolerance — this asserts the weighting is honoured, not exactness.
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(0.9);
  });

  it('returns the full payload of the chosen version', () => {
    const picked = pickVersion('k', [v('only', 1)]);
    expect(picked).toEqual({
      id: 'id-only',
      version: 'only',
      weight: 1,
      active: true,
      payload: 'payload-only',
    });
  });

  it('handles fractional weights without falling off the end', () => {
    const versions = [v('A', 0.3), v('B', 0.7)];
    for (let i = 0; i < 200; i++) {
      const picked = pickVersion(`s-${i}`, versions);
      expect(['A', 'B']).toContain(picked.version);
    }
  });
});
