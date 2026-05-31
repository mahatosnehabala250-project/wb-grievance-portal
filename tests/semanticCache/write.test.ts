// Feature: sahayak-multi-agent-router, task 24.2 — Semantic Cache write-through with category-specific TTL
//
// Unit tests for src/lib/semanticCache/write.ts.
//
// The category-specific TTL (now() + interval) and the ON CONFLICT upsert live
// inside the SQL in production. To exercise the write-through logic without a
// live Postgres + pgvector, we provide an in-memory DbClient mock that emulates
// the query_cache upsert semantics of WRITE_SQL: it keys rows by query_hash,
// inserts a new row (hit_count defaulting to 0) or refreshes an existing one
// in place (preserving hit_count), computes expires_at = now + the category's
// TTL window, and returns id/query_hash/hit_count/expires_at exactly as the
// RETURNING clause would.

import { describe, it, expect, vi } from 'vitest';

import {
  writeThrough,
  hashQuery,
  CATEGORY_TTL,
  type Category,
  type DbClient,
  type EmbedFn,
} from '../../src/lib/semanticCache/write';

// ─── In-memory query_cache row + upsert mock ──────────────────────────────────

interface CacheRow {
  id: string;
  query_hash: string;
  query_text: string;
  query_embedding: number[] | null;
  category: Category;
  response: string;
  hit_count: number;
  trace_id: string | null;
  expires_at: number; // epoch ms
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

/** TTL window (ms) per migration category, mirroring CATEGORY_TTL. */
const TTL_MS: Record<Category, number> = {
  status: 5 * 60_000,
  scheme: 7 * 24 * 60 * 60_000,
  help: 60 * 60_000,
};

/**
 * Build an upsert-capable DbClient mock over a `store` keyed by query_hash.
 * `now` is the simulated clock used to compute expires_at = now + TTL.
 */
function makeDb(
  store: Map<string, CacheRow>,
  now: number = Date.now(),
): DbClient & { calls: { sql: string; params?: unknown[] }[] } {
  const calls: { sql: string; params?: unknown[] }[] = [];
  let seq = 0;
  return {
    calls,
    async query<Row = Record<string, unknown>>(sql: string, params?: unknown[]) {
      calls.push({ sql, params });

      const queryHash = String(params?.[0] ?? '');
      const queryText = String(params?.[1] ?? '');
      const embedding = parseVectorLiteral(String(params?.[2] ?? '[]'));
      const category = String(params?.[3] ?? '') as Category;
      const response = String(params?.[4] ?? '');
      const traceId = (params?.[5] ?? null) as string | null;

      const expiresAt = now + (TTL_MS[category] ?? NaN);
      // NOT NULL expires_at: an unknown category → CASE yields NULL → DB error.
      if (!Number.isFinite(expiresAt)) {
        throw new Error(
          'null value in column "expires_at" violates not-null constraint',
        );
      }

      const existing = store.get(queryHash);
      let row: CacheRow;
      if (existing) {
        // ON CONFLICT DO UPDATE — refresh fields, PRESERVE hit_count.
        existing.query_text = queryText;
        existing.query_embedding = embedding;
        existing.category = category;
        existing.response = response;
        existing.trace_id = traceId;
        existing.expires_at = expiresAt;
        row = existing;
      } else {
        // Fresh INSERT — hit_count defaults to 0.
        row = {
          id: `row-${++seq}`,
          query_hash: queryHash,
          query_text: queryText,
          query_embedding: embedding,
          category,
          response,
          hit_count: 0,
          trace_id: traceId,
          expires_at: expiresAt,
        };
        store.set(queryHash, row);
      }

      return {
        rows: [
          {
            id: row.id,
            query_hash: row.query_hash,
            hit_count: row.hit_count,
            expires_at: new Date(row.expires_at).toISOString(),
          } as unknown as Row,
        ],
      };
    },
  };
}

const makeEmbed = (vec: number[] = [0.1, 0.2, 0.3]): EmbedFn =>
  vi.fn(async (_text: string) => vec);

// ─── hashQuery (stable, normalization-aware key) ──────────────────────────────

describe('hashQuery — stable sha256 of normalized text', () => {
  it('collapses case / whitespace / NFC variants to the same hash', () => {
    const a = hashQuery('  My Ticket   WB-2026-00042 ');
    const b = hashQuery('my ticket wb-2026-00042');
    expect(a).toBe(b);
  });

  it('produces a 64-char lowercase hex digest', () => {
    expect(hashQuery('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('yields different hashes for genuinely different queries', () => {
    expect(hashQuery('ticket status')).not.toBe(hashQuery('scheme info'));
  });
});

// ─── CATEGORY_TTL mapping (Req 26.4) ──────────────────────────────────────────

describe('CATEGORY_TTL — design windows mapped to migration categories', () => {
  it('maps status → 5 minutes, scheme → 7 days, help → 1 hour', () => {
    expect(CATEGORY_TTL).toEqual({
      status: '5 minutes',
      scheme: '7 days',
      help: '1 hour',
    });
  });
});

// ─── writeThrough: insert behavior (Req 26.5) ─────────────────────────────────

describe('writeThrough — fresh insert on a cache miss', () => {
  it('embeds normalized text, inserts the response, and returns the new row', async () => {
    const store = new Map<string, CacheRow>();
    const now = Date.now();
    const db = makeDb(store, now);
    const embed = makeEmbed([1, 0, 0]);

    const res = await writeThrough(
      'Where is my ticket WB-2026-00042',
      'status',
      'Your ticket WB-2026-00042 is IN PROGRESS.',
      { embed, db, traceId: 'trace-1' },
    );

    // embed was called with the NORMALIZED text
    expect(embed).toHaveBeenCalledWith('where is my ticket wb-2026-00042');

    // a row was persisted under the normalized hash
    const stored = store.get(hashQuery('Where is my ticket WB-2026-00042'));
    expect(stored).toBeDefined();
    expect(stored?.response).toBe('Your ticket WB-2026-00042 is IN PROGRESS.');
    expect(stored?.query_text).toBe('where is my ticket wb-2026-00042');
    expect(stored?.category).toBe('status');
    expect(stored?.trace_id).toBe('trace-1');
    expect(stored?.query_embedding).toEqual([1, 0, 0]);
    expect(stored?.hit_count).toBe(0);

    // returned result mirrors RETURNING
    expect(res.query_hash).toBe(hashQuery('Where is my ticket WB-2026-00042'));
    expect(res.hit_count).toBe(0);
    expect(res.id).toBe(stored?.id);
    expect(new Date(res.expires_at).getTime()).toBe(now + TTL_MS.status);
  });

  it('defaults trace_id to null when omitted', async () => {
    const store = new Map<string, CacheRow>();
    const db = makeDb(store);
    await writeThrough('help please', 'help', 'Here are the services...', {
      embed: makeEmbed(),
      db,
    });
    const stored = store.get(hashQuery('help please'));
    expect(stored?.trace_id).toBeNull();
  });
});

// ─── writeThrough: category-specific TTL (Req 26.4) ───────────────────────────

describe('writeThrough — category-specific expires_at = now() + interval', () => {
  it.each<[Category, number]>([
    ['status', 5 * 60_000],
    ['scheme', 7 * 24 * 60 * 60_000],
    ['help', 60 * 60_000],
  ])('sets the %s TTL window', async (category, expectedMs) => {
    const store = new Map<string, CacheRow>();
    const now = Date.now();
    const db = makeDb(store, now);

    const res = await writeThrough(`q-${category}`, category, 'resp', {
      embed: makeEmbed(),
      db,
    });

    expect(new Date(res.expires_at).getTime()).toBe(now + expectedMs);
  });

  it('passes the category as $4 so the SQL CASE picks the interval', async () => {
    const store = new Map<string, CacheRow>();
    const db = makeDb(store);
    await writeThrough('scheme question', 'scheme', 'resp', {
      embed: makeEmbed(),
      db,
    });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].params?.[3]).toBe('scheme');
    // TTL windows are encoded in the SQL CASE, not passed as params
    expect(db.calls[0].sql).toContain("interval '5 minutes'");
    expect(db.calls[0].sql).toContain("interval '7 days'");
    expect(db.calls[0].sql).toContain("interval '1 hour'");
    expect(db.calls[0].sql).toContain('ON CONFLICT (query_hash)');
  });
});

// ─── writeThrough: ON CONFLICT upsert (Design §v1.1.7) ────────────────────────

describe('writeThrough — ON CONFLICT refreshes in place and preserves hit_count', () => {
  it('updates response/embedding/expiry for an existing key without resetting hit_count', async () => {
    const store = new Map<string, CacheRow>();
    const hash = hashQuery('ticket wb-2026-00042 status');
    // Seed an existing row that already accumulated hits.
    store.set(hash, {
      id: 'row-seed',
      query_hash: hash,
      query_text: 'ticket wb-2026-00042 status',
      query_embedding: [1, 0, 0],
      category: 'status',
      response: 'OLD: RECEIVED',
      hit_count: 7,
      trace_id: 'old-trace',
      expires_at: Date.now() - 1, // already expired
    });
    const now = Date.now();
    const db = makeDb(store, now);

    const res = await writeThrough(
      'Ticket WB-2026-00042 status',
      'status',
      'NEW: IN PROGRESS',
      { embed: makeEmbed([0, 1, 0]), db, traceId: 'new-trace' },
    );

    const stored = store.get(hash);
    expect(store.size).toBe(1); // upsert, not a second row
    expect(stored?.response).toBe('NEW: IN PROGRESS');
    expect(stored?.query_embedding).toEqual([0, 1, 0]);
    expect(stored?.trace_id).toBe('new-trace');
    expect(stored?.hit_count).toBe(7); // PRESERVED across refresh
    expect(new Date(res.expires_at).getTime()).toBe(now + TTL_MS.status);
    expect(res.hit_count).toBe(7);
    expect(res.id).toBe('row-seed');
  });
});
