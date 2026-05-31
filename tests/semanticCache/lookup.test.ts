// Feature: sahayak-multi-agent-router, task 24.1 — Semantic Cache embedding-then-search lookup
//
// Unit tests for src/lib/semanticCache/lookup.ts.
//
// The cosine-similarity threshold, the category filter, and the expiry filter
// all live inside the SQL in production. To exercise the lookup logic without a
// live Postgres + pgvector, we provide an in-memory DbClient mock that faithfully
// emulates the query_cache semantics of LOOKUP_SQL: it parses the bound vector
// literal + category, computes cosine similarity in JS against stored rows,
// applies the category and `expires_at > now()` filters, takes the single
// nearest row, applies the 0.92 threshold, and (on a hit) atomically increments
// hit_count — returning the post-increment value, exactly as the RETURNING clause
// would.

import { describe, it, expect, vi } from 'vitest';

import {
  lookup,
  normalizeQuery,
  toVectorLiteral,
  SIMILARITY_THRESHOLD,
  type Category,
  type DbClient,
  type EmbedFn,
} from '../../src/lib/semanticCache/lookup';

// ─── In-memory query_cache row + mock ─────────────────────────────────────────

interface CacheRow {
  id: string;
  query_embedding: number[] | null;
  category: Category;
  response: string;
  hit_count: number;
  expires_at: number; // epoch ms
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Parse the `[a,b,c]` pgvector literal produced by toVectorLiteral. */
function parseVectorLiteral(literal: string): number[] {
  return literal
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .filter((s) => s.length > 0)
    .map(Number);
}

/**
 * Build a DbClient mock backed by the given rows. `now` is the simulated clock
 * used for the `expires_at > now()` filter.
 */
function makeDb(rows: CacheRow[], now: number = Date.now()): DbClient {
  return {
    async query<Row = Record<string, unknown>>(_sql: string, params?: unknown[]) {
      const queryVec = parseVectorLiteral(String(params?.[0] ?? '[]'));
      const category = String(params?.[1] ?? '');

      // category + non-expired + non-null embedding filter
      const candidates = rows.filter(
        (r) =>
          r.category === category &&
          r.expires_at > now &&
          Array.isArray(r.query_embedding),
      );

      // nearest single row by cosine similarity (ORDER BY <=> LIMIT 1)
      let best: CacheRow | null = null;
      let bestSim = -Infinity;
      for (const r of candidates) {
        const sim = cosine(queryVec, r.query_embedding as number[]);
        if (sim > bestSim) {
          bestSim = sim;
          best = r;
        }
      }

      // threshold gate (the outer UPDATE ... WHERE ranked.sim >= 0.92)
      if (!best || bestSim < SIMILARITY_THRESHOLD) {
        return { rows: [] as Row[] };
      }

      // atomic increment + RETURNING post-increment values
      best.hit_count += 1;
      return {
        rows: [{ response: best.response, hit_count: best.hit_count } as unknown as Row],
      };
    },
  };
}

// Identity-ish embed: maps text to a fixed-length numeric vector. Same text →
// same vector (deterministic), so normalization collapses variants.
const FIXED_VECTOR: Record<string, number[]> = {
  'ticket wb-2026-00042 status': [1, 0, 0],
  'where is my ticket wb-2026-00042': [0.98, 0.2, 0], // close to the above
  'what is kanyashree scheme': [0, 1, 0], // orthogonal → far
};

const makeEmbed = (table: Record<string, number[]> = FIXED_VECTOR): EmbedFn =>
  vi.fn(async (text: string) => table[text] ?? [0, 0, 1]);

const future = (ms: number) => Date.now() + ms;
const past = (ms: number) => Date.now() - ms;

// ─── normalizeQuery ───────────────────────────────────────────────────────────

describe('normalizeQuery — NFC + lowercase + whitespace collapse', () => {
  it('lowercases, collapses whitespace, and trims', () => {
    expect(normalizeQuery('  My Ticket   WB-2026-00042 ?')).toBe(
      'my ticket wb-2026-00042 ?',
    );
  });

  it('collapses non-breaking and wide spaces to a single space', () => {
    expect(normalizeQuery('a\u00A0\u3000b')).toBe('a b');
  });

  it('applies Unicode NFC composition (decomposed === composed)', () => {
    const composed = normalizeQuery('é'); // U+00E9
    const decomposed = normalizeQuery('e\u0301'); // e + combining acute
    expect(composed).toBe(decomposed);
  });

  it('handles null/undefined input without throwing', () => {
    expect(normalizeQuery(undefined as unknown as string)).toBe('');
    expect(normalizeQuery(null as unknown as string)).toBe('');
  });
});

// ─── toVectorLiteral ──────────────────────────────────────────────────────────

describe('toVectorLiteral — pgvector literal serialization', () => {
  it('serializes a numeric array to [a,b,c]', () => {
    expect(toVectorLiteral([1, 2, 3])).toBe('[1,2,3]');
  });

  it('coerces non-finite values to 0', () => {
    expect(toVectorLiteral([NaN, Infinity, -Infinity, 0.5])).toBe('[0,0,0,0.5]');
  });

  it('produces an empty-vector literal for an empty array', () => {
    expect(toVectorLiteral([])).toBe('[]');
  });
});

// ─── lookup: hit / miss behavior (Req 26.1, 26.3) ─────────────────────────────

describe('lookup — semantic hit on a close, non-expired, same-category row', () => {
  it('returns { hit: true, response, hit_count } and increments hit_count', async () => {
    const rows: CacheRow[] = [
      {
        id: 'r1',
        query_embedding: FIXED_VECTOR['ticket wb-2026-00042 status'],
        category: 'status',
        response: 'Your ticket WB-2026-00042 is IN PROGRESS.',
        hit_count: 3,
        expires_at: future(5 * 60_000),
      },
    ];
    const db = makeDb(rows);
    const embed = makeEmbed();

    // A semantically-close but textually-different query.
    const res = await lookup('Where is my ticket WB-2026-00042', 'status', {
      embed,
      db,
    });

    expect(res).toEqual({
      hit: true,
      response: 'Your ticket WB-2026-00042 is IN PROGRESS.',
      hit_count: 4, // post-increment (Req 26.3)
    });
    // embed was called with the normalized text
    expect(embed).toHaveBeenCalledWith('where is my ticket wb-2026-00042');
  });
});

describe('lookup — miss cases (caller runs v1 primary lookup)', () => {
  it('misses when the nearest row is below the 0.92 threshold', async () => {
    const rows: CacheRow[] = [
      {
        id: 'r1',
        query_embedding: FIXED_VECTOR['what is kanyashree scheme'], // orthogonal
        category: 'status',
        response: 'unrelated',
        hit_count: 0,
        expires_at: future(5 * 60_000),
      },
    ];
    const res = await lookup('ticket WB-2026-00042 status', 'status', {
      embed: makeEmbed(),
      db: makeDb(rows),
    });
    expect(res).toEqual({ hit: false });
  });

  it('misses when the only close row has expired (expires_at <= now)', async () => {
    const rows: CacheRow[] = [
      {
        id: 'r1',
        query_embedding: FIXED_VECTOR['ticket wb-2026-00042 status'],
        category: 'status',
        response: 'stale',
        hit_count: 9,
        expires_at: past(60_000), // expired
      },
    ];
    const res = await lookup('ticket WB-2026-00042 status', 'status', {
      embed: makeEmbed(),
      db: makeDb(rows),
    });
    expect(res).toEqual({ hit: false });
    // hit_count must NOT have been incremented on a miss
    expect(rows[0].hit_count).toBe(9);
  });

  it('misses when a close row exists only under a different category', async () => {
    const rows: CacheRow[] = [
      {
        id: 'r1',
        query_embedding: FIXED_VECTOR['ticket wb-2026-00042 status'],
        category: 'scheme', // different category
        response: 'wrong category',
        hit_count: 0,
        expires_at: future(7 * 24 * 60 * 60_000),
      },
    ];
    const res = await lookup('ticket WB-2026-00042 status', 'status', {
      embed: makeEmbed(),
      db: makeDb(rows),
    });
    expect(res).toEqual({ hit: false });
  });

  it('misses against an empty cache', async () => {
    const res = await lookup('anything at all', 'help', {
      embed: makeEmbed(),
      db: makeDb([]),
    });
    expect(res).toEqual({ hit: false });
  });
});

describe('lookup — query plumbing', () => {
  it('binds the pgvector literal as $1 and the category as $2', async () => {
    const captured: { sql: string; params?: unknown[] }[] = [];
    const db: DbClient = {
      async query(sql, params) {
        captured.push({ sql, params });
        return { rows: [] };
      },
    };
    const embed: EmbedFn = async () => [0.1, 0.2, 0.3];

    await lookup('hello', 'scheme', { embed, db });

    expect(captured).toHaveLength(1);
    expect(captured[0].params?.[0]).toBe('[0.1,0.2,0.3]');
    expect(captured[0].params?.[1]).toBe('scheme');
    // threshold is embedded in the SQL, not passed as a param
    expect(captured[0].sql).toContain(String(SIMILARITY_THRESHOLD));
    expect(captured[0].sql).toContain("expires_at > now()");
    expect(captured[0].sql).toContain('category = $2');
  });
});
