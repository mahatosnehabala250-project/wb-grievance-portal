// Feature: sahayak-multi-agent-router, Task 25.1 — UUIDv7 generator (Req 27.1, Design §v1.1.8)
//
// Unit + property tests for the time-ordered trace-id generator. Verifies the
// RFC 9562 §5.7 bit layout (48-bit ms timestamp, version nibble 7, RFC 4122
// variant), that isUuid7 round-trips every generated value, that the timestamp
// prefix makes ids lexicographically sortable by creation time, and that
// isUuid7 rejects non-v7 / malformed inputs.
//
// Pure-logic tests — no DB, no network.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { uuid7, uuidv7, isUuid7 } from '../../src/lib/trace/uuid7';

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('uuid7 — format and version/variant bits', () => {
  it('produces a canonical lowercase 8-4-4-4-12 UUID', () => {
    const id = uuid7();
    expect(id).toMatch(UUID_SHAPE);
    expect(id).toBe(id.toLowerCase());
  });

  it('sets the version nibble to 7 (first char of 3rd group)', () => {
    for (let i = 0; i < 50; i++) {
      const id = uuid7();
      expect(id[14]).toBe('7');
    }
  });

  it('sets the RFC 4122 variant (first char of 4th group ∈ {8,9,a,b})', () => {
    for (let i = 0; i < 50; i++) {
      const id = uuid7();
      expect('89ab').toContain(id[19]);
    }
  });

  it('exposes uuid7 as an alias of uuidv7', () => {
    expect(uuid7).toBe(uuidv7);
  });

  it('encodes the 48-bit millisecond timestamp prefix big-endian', () => {
    const now = 0x0123_4567_89ab; // arbitrary 48-bit value
    const id = uuidv7(now);
    const hexPrefix = id.replace(/-/g, '').slice(0, 12);
    expect(hexPrefix).toBe('0123456789ab');
  });

  it('clamps negative timestamps to 0 and never throws', () => {
    expect(() => uuidv7(-1)).not.toThrow();
    const id = uuidv7(-12345);
    expect(id.replace(/-/g, '').slice(0, 12)).toBe('000000000000');
    expect(isUuid7(id)).toBe(true);
  });
});

describe('isUuid7 — validation guard', () => {
  it('accepts a freshly generated uuid7', () => {
    expect(isUuid7(uuid7())).toBe(true);
  });

  it('rejects a UUIDv4 (version nibble 4)', () => {
    expect(isUuid7('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(false);
  });

  it('rejects malformed / non-uuid strings', () => {
    for (const bad of ['', 'not-a-uuid', '123', '7'.repeat(32)]) {
      expect(isUuid7(bad)).toBe(false);
    }
  });

  it('rejects a uuid with a bad variant nibble (e.g. c)', () => {
    // version 7 but variant nibble 'c' is not in {8,9,a,b}
    expect(isUuid7('017f22e2-79b0-7cc3-c98c-9f3b1e2d4a5b')).toBe(false);
  });

  it('is not fooled by non-string inputs', () => {
    // @ts-expect-error — exercising defensive runtime guard
    expect(isUuid7(undefined)).toBe(false);
    // @ts-expect-error — exercising defensive runtime guard
    expect(isUuid7(null)).toBe(false);
    // @ts-expect-error — exercising defensive runtime guard
    expect(isUuid7(12345)).toBe(false);
  });
});

describe('uuid7 — properties', () => {
  it('every generated id validates via isUuid7 (round-trip)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 48 - 1 }), (ms) => {
        return isUuid7(uuidv7(ms));
      }),
      { numRuns: 500 },
    );
  });

  it('ids from a later millisecond sort lexicographically after earlier ones', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 44 }),
        fc.integer({ min: 1, max: 2 ** 32 }),
        (base, delta) => {
          const earlier = uuidv7(base);
          const later = uuidv7(base + delta);
          // Strictly greater ms → strictly greater string (timestamp prefix dominates).
          return earlier < later;
        },
      ),
      { numRuns: 500 },
    );
  });

  it('generates distinct ids within the same millisecond', () => {
    const fixedMs = 1_700_000_000_000;
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(uuidv7(fixedMs));
    // Random 74-bit suffix makes collisions astronomically unlikely.
    expect(ids.size).toBe(1000);
  });
});
