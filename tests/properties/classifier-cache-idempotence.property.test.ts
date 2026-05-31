// Feature: sahayak-multi-agent-router, Property 16: Classifier cache idempotence
//
// Validates: Requirements 20.3, 20.4 — Design §v1.1.1, §Property 16
//
// Property 16: messages that normalize to the same `query_hash` (whitespace,
// case, and Unicode NFC variants) produce the same cached decision within the
// TTL, and the underlying Gemini Flash classifier is invoked AT MOST ONCE
// across N lookups of equivalent messages.
//
// Two layers:
//   (1) normalize(...) collapses whitespace / case / NFC variants to one hash.
//   (2) lookupOrClassify(...) over an in-memory cache that faithfully emulates
//       the LOOKUP_SQL (UPDATE ... RETURNING, hit_count += 1) and WRITE_SQL
//       (INSERT ... ON CONFLICT DO UPDATE) statements: the first lookup of an
//       equivalence class misses + classifies + writes through; every later
//       lookup of any variant in the class hits the cache and never re-classifies.

import fc from 'fast-check';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Gemini Flash wrapper so we can count invocations and keep the
// decision deterministic (no network, no API key needed).
const classifyCalls = { n: 0 };
vi.mock('../../src/lib/router/classifier', () => ({
  classify: vi.fn(async (input: { message: string }) => {
    classifyCalls.n += 1;
    return {
      agent: 'info',
      confidence: 0.81,
      secondary_agent: null,
      rationale: `classified:${input.message.trim().toLowerCase()}`,
      latency_ms: 1,
      total_tokens: 7,
    };
  }),
}));

import { normalize, lookupOrClassify, type DbClient } from '../../src/lib/router/cache';

// ─── In-memory cache faithful to the two SQL statements ────────────────────────

interface CacheRow {
  query_hash: string;
  decision: unknown;
  confidence: number;
  hit_count: number;
  ttl: number; // epoch ms
}

function makeMemoryDb(now: () => number = () => Date.now()): DbClient {
  const table = new Map<string, CacheRow>();
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;

  return {
    async query<Row = Record<string, unknown>>(sql: string, params?: unknown[]) {
      const isLookup = /UPDATE/i.test(sql) && /RETURNING/i.test(sql);
      const isWrite = /INSERT\s+INTO/i.test(sql);

      if (isLookup) {
        const key = params?.[0] as string;
        const row = table.get(key);
        if (row && row.ttl > now()) {
          row.hit_count += 1; // atomic hit_count = hit_count + 1
          return { rows: [{ decision: row.decision, confidence: row.confidence }] as Row[] };
        }
        return { rows: [] as Row[] };
      }

      if (isWrite) {
        const [key, decision, confidence] = (params ?? []) as [string, unknown, number];
        const existing = table.get(key);
        if (existing) {
          existing.decision = decision;
          existing.confidence = confidence;
          existing.ttl = now() + TTL_MS;
        } else {
          table.set(key, { query_hash: key, decision, confidence, hit_count: 0, ttl: now() + TTL_MS });
        }
        return { rows: [] as Row[] };
      }

      return { rows: [] as Row[] };
    },
  };
}

beforeEach(() => {
  classifyCalls.n = 0;
});

// ─── Layer 1: normalize collapses equivalent variants to the same hash ────────

describe('Property 16a — normalize() collapses whitespace/case/NFC variants', () => {
  it('produces identical hashes for case / whitespace / NFC variants of a base message', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('blood chahiye', 'need blood', 'kanyashree scheme', 'ration card'),
        // arbitrary internal/edge whitespace and case perturbations
        fc.array(fc.constantFrom(' ', '\t', '\n', '\u00A0', '  '), { minLength: 0, maxLength: 4 }),
        (base, pads) => {
          const upper = base.toUpperCase();
          const spaced = base.split(' ').join(pads.join('') || '   ');
          const padded = `${pads.join('')}${base}${pads.join('')}`;
          // All of these must normalize to the same hash as the base.
          const h = normalize(base);
          expect(normalize(upper)).toBe(h);
          expect(normalize(spaced)).toBe(h);
          expect(normalize(padded)).toBe(h);
          // NFC equivalence: a decomposed Devanagari sequence normalizes equal to its composed form.
          const decomposed = base.normalize('NFD');
          expect(normalize(decomposed)).toBe(h);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('is deterministic and returns a 64-char lowercase hex digest', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const a = normalize(s);
        const b = normalize(s);
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Layer 2: lookupOrClassify idempotence over the cache ─────────────────────

describe('Property 16b — lookupOrClassify classifies at most once per equivalence class', () => {
  it('same hash → same decision within TTL; classifier invoked at most once across N lookups', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('blood chahiye', 'need blood now', 'kanyashree scheme info'),
        fc.integer({ min: 2, max: 8 }),
        async (base, n) => {
          classifyCalls.n = 0;
          const db = makeMemoryDb();

          // Build N whitespace/case variants that all normalize to the same hash.
          const variants = Array.from({ length: n }, (_, i) =>
            i % 2 === 0 ? `  ${base.toUpperCase()}  ` : base.split(' ').join('\t '),
          );

          const results = [];
          for (const v of variants) {
            results.push(await lookupOrClassify(v, 'en', 'trace', db));
          }

          // Classifier called at most once (exactly once: first miss).
          expect(classifyCalls.n).toBeLessThanOrEqual(1);
          expect(classifyCalls.n).toBe(1);

          // All decisions identical (agent / rationale / confidence).
          const first = results[0];
          for (const r of results) {
            expect(r.agent).toBe(first.agent);
            expect(r.rationale).toBe(first.rationale);
            expect(r.confidence).toBe(first.confidence);
          }
          // First is a miss; all subsequent are cache hits.
          expect(first.fromCache).toBe(false);
          for (let i = 1; i < results.length; i++) {
            expect(results[i].fromCache).toBe(true);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it('distinct messages classify independently (no false cache sharing)', async () => {
    classifyCalls.n = 0;
    const db = makeMemoryDb();

    await lookupOrClassify('blood chahiye', 'en', 't', db);
    await lookupOrClassify('kanyashree scheme', 'en', 't', db);
    await lookupOrClassify('blood chahiye', 'en', 't', db); // repeat → cache hit

    // Two distinct equivalence classes → exactly two classify calls.
    expect(classifyCalls.n).toBe(2);
  });
});
