// Feature: sahayak-multi-agent-router, task 24.4 — Semantic Cache invalidation listener
//
// Unit tests for src/lib/semanticCache/invalidationListener.ts.
//
// The listener subscribes to the Postgres `LISTEN cache_invalidate` channel
// (emitted by trg_complaint_cache_invalidate in migration 20260201_007) and
// drops the matching query_cache rows. The DELETE scope, the category filter,
// and the design-name → column-value mapping all live in the module. To exercise
// the parse/map/delete logic without a live Postgres LISTEN/NOTIFY channel, we
// provide an in-memory client mock that:
//   - records every (sql, params) DELETE,
//   - emulates query_cache filtering (category + ticket-in-response/query_text),
//   - exposes the node-postgres `.on('notification' | 'error')` event surface
//     and the connect/query/end lifecycle,
// mirroring the in-memory DbClient mock convention in lookup.test.ts.

import { describe, it, expect, vi } from 'vitest';

import {
  CHANNEL,
  CATEGORY_ALIASES,
  normalizeCategory,
  parseInvalidatePayload,
  invalidateCacheEntries,
  handleNotification,
  startCacheInvalidationListener,
  type Category,
  type InvalidateDbClient,
  type ListenClient,
  type CacheInvalidateNotification,
  type DbDeleteResult,
} from '../../src/lib/semanticCache/invalidationListener';

// ─── In-memory query_cache row + mock client ──────────────────────────────────

interface CacheRow {
  category: Category;
  response: string;
  query_text: string;
}

/**
 * Build an InvalidateDbClient mock backed by `rows`. It emulates the two
 * DELETE statements the module issues: a category-wide delete (1 param) and a
 * scoped match delete (2 params, term matched case-insensitively against both
 * `response` and `query_text`). Returns `{ rowCount }` like node-postgres and
 * captures every call for assertion.
 */
function makeDb(rows: CacheRow[]) {
  const calls: { sql: string; params?: unknown[] }[] = [];

  const db: InvalidateDbClient = {
    async query(sql: string, params?: unknown[]): Promise<DbDeleteResult> {
      calls.push({ sql, params });

      const category = String(params?.[0] ?? '');
      const term = params?.[1] !== undefined ? String(params[1]).toLowerCase() : undefined;

      const survivors: CacheRow[] = [];
      let deleted = 0;
      for (const r of rows) {
        const categoryMatch = r.category === category;
        const termMatch =
          term === undefined
            ? true
            : r.response.toLowerCase().includes(term) ||
              r.query_text.toLowerCase().includes(term);
        if (categoryMatch && termMatch) {
          deleted += 1;
        } else {
          survivors.push(r);
        }
      }
      rows.splice(0, rows.length, ...survivors);
      return { rowCount: deleted };
    },
  };

  return { db, calls, rows };
}

// ─── normalizeCategory + CATEGORY_ALIASES ─────────────────────────────────────

describe('normalizeCategory — design name ↔ migration column value', () => {
  it('maps design names to the shipped query_cache.category values', () => {
    expect(normalizeCategory('ticket_status')).toBe('status');
    expect(normalizeCategory('scheme_info')).toBe('scheme');
    expect(normalizeCategory('help_list')).toBe('help');
  });

  it('accepts the migration values themselves (identity)', () => {
    expect(normalizeCategory('status')).toBe('status');
    expect(normalizeCategory('scheme')).toBe('scheme');
    expect(normalizeCategory('help')).toBe('help');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeCategory('  Ticket_Status ')).toBe('status');
  });

  it('returns null for unknown or non-string categories', () => {
    expect(normalizeCategory('unknown_category')).toBeNull();
    expect(normalizeCategory(undefined)).toBeNull();
    expect(normalizeCategory(123)).toBeNull();
  });

  it('CATEGORY_ALIASES covers every emitted + stored value', () => {
    expect(CATEGORY_ALIASES.ticket_status).toBe('status');
    expect(CATEGORY_ALIASES.scheme_info).toBe('scheme');
    expect(CATEGORY_ALIASES.help_list).toBe('help');
  });
});

// ─── parseInvalidatePayload ───────────────────────────────────────────────────

describe('parseInvalidatePayload — tolerant JSON payload parsing', () => {
  it('parses the trigger payload { category: ticket_status, ticket_number }', () => {
    const raw = JSON.stringify({ category: 'ticket_status', ticket_number: 'WB-2026-00042' });
    expect(parseInvalidatePayload(raw)).toEqual({ category: 'status', match: 'WB-2026-00042' });
  });

  it('drops a null ticket_number → category-wide payload (no match)', () => {
    const raw = JSON.stringify({ category: 'ticket_status', ticket_number: null });
    expect(parseInvalidatePayload(raw)).toEqual({ category: 'status' });
  });

  it('accepts the generic match / session_id aliases as the match term', () => {
    expect(parseInvalidatePayload(JSON.stringify({ category: 'scheme', match: 'kanyashree' }))).toEqual({
      category: 'scheme',
      match: 'kanyashree',
    });
    expect(parseInvalidatePayload(JSON.stringify({ category: 'help', session_id: '919876543210' }))).toEqual({
      category: 'help',
      match: '919876543210',
    });
  });

  it('returns null for malformed / non-JSON / category-less payloads', () => {
    expect(parseInvalidatePayload('not json')).toBeNull();
    expect(parseInvalidatePayload('')).toBeNull();
    expect(parseInvalidatePayload(JSON.stringify({ ticket_number: 'WB-2026-00042' }))).toBeNull();
    expect(parseInvalidatePayload(JSON.stringify({ category: 'bogus', ticket_number: 'x' }))).toBeNull();
    expect(parseInvalidatePayload(undefined)).toBeNull();
    expect(parseInvalidatePayload(JSON.stringify('a string'))).toBeNull();
  });
});

// ─── invalidateCacheEntries ───────────────────────────────────────────────────

describe('invalidateCacheEntries — scoped DELETE', () => {
  it('drops only same-category rows mentioning the ticket (response OR query_text)', async () => {
    const { db, rows } = makeDb([
      { category: 'status', response: 'Ticket WB-2026-00042 is IN PROGRESS.', query_text: 'where is my ticket' },
      { category: 'status', response: 'no such ticket', query_text: 'status WB-2026-00042' },
      { category: 'status', response: 'Ticket WB-2026-99999 is RESOLVED.', query_text: 'status of 99999' },
      { category: 'scheme', response: 'WB-2026-00042 mentioned but wrong category', query_text: 'scheme q' },
    ]);

    const deleted = await invalidateCacheEntries({ category: 'status', match: 'WB-2026-00042' }, db);

    expect(deleted).toBe(2);
    // The unrelated status ticket and the cross-category row survive.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.category).sort()).toEqual(['scheme', 'status']);
  });

  it('drops the entire category when no match term is supplied', async () => {
    const { db, rows } = makeDb([
      { category: 'scheme', response: 'a', query_text: 'q1' },
      { category: 'scheme', response: 'b', query_text: 'q2' },
      { category: 'status', response: 'c', query_text: 'q3' },
    ]);

    const deleted = await invalidateCacheEntries({ category: 'scheme' }, db);

    expect(deleted).toBe(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('status');
  });

  it('parameterizes the match term (never string-concatenated into SQL)', async () => {
    const { db, calls } = makeDb([]);
    await invalidateCacheEntries({ category: 'status', match: "WB'; DROP TABLE x;--" }, db);

    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(['status', "WB'; DROP TABLE x;--"]);
    // The raw term must NOT appear inline in the SQL string.
    expect(calls[0].sql).not.toContain('DROP TABLE x');
    expect(calls[0].sql).toContain('category = $1');
  });
});

// ─── handleNotification (parse → map → delete) ────────────────────────────────

describe('handleNotification — end-to-end from raw payload', () => {
  it('invalidates stale ticket_status rows from a real trigger payload', async () => {
    const { db, rows } = makeDb([
      { category: 'status', response: 'no such ticket WB-2026-00042', query_text: 'status WB-2026-00042' },
      { category: 'status', response: 'WB-2026-00001 IN PROGRESS', query_text: 'q' },
    ]);

    const raw = JSON.stringify({ category: 'ticket_status', ticket_number: 'WB-2026-00042' });
    const deleted = await handleNotification(raw, db);

    expect(deleted).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].response).toBe('WB-2026-00001 IN PROGRESS');
  });

  it('returns 0 and issues no DELETE for an unparseable / unknown-category payload', async () => {
    const { db, calls } = makeDb([{ category: 'status', response: 'x', query_text: 'q' }]);

    expect(await handleNotification('not json', db)).toBe(0);
    expect(await handleNotification(JSON.stringify({ category: 'bogus' }), db)).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

// ─── startCacheInvalidationListener — lifecycle + event wiring ────────────────

/** A scriptable ListenClient mock that lets a test fire 'notification' events. */
function makeListenClient(rows: CacheRow[]): ListenClient & {
  emit: (msg: CacheInvalidateNotification) => void;
  sql: string[];
  rows: CacheRow[];
} {
  const { db } = makeDb(rows);
  const notificationHandlers: ((msg: CacheInvalidateNotification) => void)[] = [];
  const sql: string[] = [];

  const client = {
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    on(event: string, listener: (...args: unknown[]) => void) {
      if (event === 'notification') {
        notificationHandlers.push(listener as (msg: CacheInvalidateNotification) => void);
      }
      return client;
    },
    async query(text: string, params?: unknown[]): Promise<DbDeleteResult> {
      sql.push(text);
      // LISTEN / UNLISTEN are control statements with no rows; delegate real
      // DELETEs to the in-memory db emulation.
      if (/^\s*(LISTEN|UNLISTEN)\b/i.test(text)) return { rowCount: 0 };
      return db.query(text, params);
    },
    emit(msg: CacheInvalidateNotification) {
      for (const h of notificationHandlers) h(msg);
    },
    sql,
    rows,
  };

  return client as unknown as ListenClient & {
    emit: (msg: CacheInvalidateNotification) => void;
    sql: string[];
    rows: CacheRow[];
  };
}

describe('startCacheInvalidationListener — subscribe, react, teardown', () => {
  it('connects and issues LISTEN cache_invalidate on start', async () => {
    const client = makeListenClient([]);
    const handle = await startCacheInvalidationListener({ client, onInvalidated: () => {} });

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.sql.some((s) => s === `LISTEN ${CHANNEL}`)).toBe(true);

    await handle.stop();
  });

  it('runs the scoped DELETE when a matching notification arrives', async () => {
    const client = makeListenClient([
      { category: 'status', response: 'no such ticket WB-2026-00042', query_text: 'status WB-2026-00042' },
      { category: 'status', response: 'WB-2026-00001 IN PROGRESS', query_text: 'q' },
    ]);

    const seen: number[] = [];
    const handle = await startCacheInvalidationListener({
      client,
      onInvalidated: ({ deleted }) => seen.push(deleted),
    });

    client.emit({
      channel: CHANNEL,
      payload: JSON.stringify({ category: 'ticket_status', ticket_number: 'WB-2026-00042' }),
    });
    // allow the fire-and-forget handler promise to resolve
    await new Promise((r) => setTimeout(r, 0));

    expect(seen).toEqual([1]);
    expect(client.rows).toHaveLength(1);
    expect(client.rows[0].response).toBe('WB-2026-00001 IN PROGRESS');

    await handle.stop();
    expect(client.sql.some((s) => s === `UNLISTEN ${CHANNEL}`)).toBe(true);
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('ignores notifications on a different channel', async () => {
    const client = makeListenClient([{ category: 'status', response: 'WB-2026-00042', query_text: 'q' }]);
    const seen: number[] = [];
    const handle = await startCacheInvalidationListener({
      client,
      onInvalidated: ({ deleted }) => seen.push(deleted),
    });

    client.emit({
      channel: 'some_other_channel',
      payload: JSON.stringify({ category: 'ticket_status', ticket_number: 'WB-2026-00042' }),
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(seen).toEqual([]);
    expect(client.rows).toHaveLength(1); // untouched

    await handle.stop();
  });
});
