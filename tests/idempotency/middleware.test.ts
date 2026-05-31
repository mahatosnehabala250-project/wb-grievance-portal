// Unit tests for the idempotency middleware (task 26.1).
//
// These are pure / mock-DB tests — no live database. They exercise the
// TypeScript wrapper's contract against the REAL `idempotency_keys` schema
// (migration 20260201_004): `(key, endpoint, response_status, response_body
// jsonb, created_at, expires_at)`. The replay-safety end-to-end property
// (Property 28, task 26.6) runs against a live test DB separately.
//
// Covered:
//   - no Idempotency-Key header → handler runs, nothing persisted (Req 28.1)
//   - first call → handler runs once, persists status + body envelope (Req 28.2)
//   - replay (same key + same body) → stored response, handler NOT re-run (Req 28.3)
//   - conflict (same key + different body) → 409 IDEMPOTENCY_KEY_CONFLICT (Req 28.4)
//   - replayed response is byte-identical to the first response
//   - the wrapped handler can still read the original request body (clone)
//   - transient 5xx responses are not cached (stay retryable)

import { describe, it, expect, vi } from 'vitest';

import {
  withIdempotency,
  idempotencyConflictResponse,
  IDEMPOTENCY_HEADER,
  CONFLICT_ERROR_CODE,
  REPLAY_HEADER,
  type DbClient,
  type IdempotencyRequest,
} from '../../src/lib/idempotency/middleware';

// ─── Test helpers ──────────────────────────────────────────────────────────

/**
 * A tiny in-memory stand-in for the `idempotency_keys` table that understands
 * the three SQL statements the middleware issues (SELECT valid row, and the
 * INSERT ... ON CONFLICT claim). Rows never expire in the mock (no cleanup),
 * which is fine for these tests — the `expires_at > now()` filter always passes.
 */
function mockDb(): {
  db: DbClient;
  rows: Map<string, { response_status: number; response_body: string }>;
  calls: { sql: string; params?: unknown[] }[];
} {
  const rows = new Map<string, { response_status: number; response_body: string }>();
  const calls: { sql: string; params?: unknown[] }[] = [];

  const db: DbClient = {
    async query<Row>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });

      // SELECT response_status, response_body ... WHERE key=$1 AND endpoint=$2
      if (sql.includes('SELECT response_status')) {
        const [key, endpoint] = params as [string, string];
        const row = rows.get(`${key}\u0000${endpoint}`);
        return { rows: row ? [row as unknown as Row] : [] };
      }

      // INSERT ... ON CONFLICT (key, endpoint) DO UPDATE ... WHERE expires_at <= now() RETURNING key
      if (sql.includes('INSERT INTO idempotency_keys')) {
        const [key, endpoint, status, body] = params as [string, string, number, string];
        const mapKey = `${key}\u0000${endpoint}`;
        if (rows.has(mapKey)) {
          // Existing non-expired row → conflict WHERE is false → no row claimed.
          return { rows: [] };
        }
        rows.set(mapKey, { response_status: status, response_body: body });
        return { rows: [{ key } as unknown as Row] };
      }

      return { rows: [] };
    },
  };

  return { db, rows, calls };
}

/** Build a minimal IdempotencyRequest with an optional Idempotency-Key. */
function makeReq(opts: {
  method?: string;
  body?: string;
  key?: string | null;
}): IdempotencyRequest {
  const { method = 'POST', body = '', key = null } = opts;
  return {
    method,
    headers: {
      get(name: string) {
        if (name === IDEMPOTENCY_HEADER) return key;
        return null;
      },
    },
    async text() {
      return body;
    },
    clone() {
      return makeReq(opts);
    },
  };
}

/** A JSON Response, like the ones route handlers return. */
function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ENDPOINT = '/api/blood-requests/donor-respond';

// ─── No header → passthrough (Req 28.1: header is optional) ──────────────────

describe('withIdempotency — no Idempotency-Key header', () => {
  it('runs the handler and persists nothing', async () => {
    const { db, rows, calls } = mockDb();
    const handler = vi.fn(async () => jsonResponse({ ok: true }));

    const req = makeReq({ body: '{"donor":"x"}', key: null });
    const res = await withIdempotency(req, ENDPOINT, handler, db);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ ok: true });
    expect(rows.size).toBe(0);
    expect(calls).toHaveLength(0); // no DB round-trips at all
  });
});

// ─── First call → run + persist (Req 28.2) ───────────────────────────────────

describe('withIdempotency — first call', () => {
  it('runs the handler once and persists status + envelope', async () => {
    const { db, rows } = mockDb();
    const handler = vi.fn(async () => jsonResponse({ ok: true, accepted: true }, 201));

    const req = makeReq({ body: '{"donor":"a"}', key: 'k-1' });
    const res = await withIdempotency(req, ENDPOINT, handler, db);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, accepted: true });

    // Persisted exactly one row with status + an envelope carrying the body.
    expect(rows.size).toBe(1);
    const stored = [...rows.values()][0];
    expect(stored.response_status).toBe(201);
    const env = JSON.parse(stored.response_body);
    expect(typeof env.request_hash).toBe('string');
    expect(env.request_hash).toHaveLength(64); // sha256 hex
    expect(JSON.parse(env.body_text)).toEqual({ ok: true, accepted: true });
  });

  it('lets the wrapped handler read the original request body', async () => {
    const { db } = mockDb();
    let seenBody = '';
    const req = makeReq({ body: '{"donor":"a"}', key: 'k-body' });
    const handler = vi.fn(async () => {
      seenBody = await req.text();
      return jsonResponse({ ok: true });
    });

    await withIdempotency(req, ENDPOINT, handler, db);
    expect(seenBody).toBe('{"donor":"a"}');
  });
});

// ─── Replay → stored response, no re-run (Req 28.3) ──────────────────────────

describe('withIdempotency — replay (same key, same body)', () => {
  it('returns the stored response without re-running the handler', async () => {
    const { db } = mockDb();
    const handler = vi.fn(async () =>
      jsonResponse({ ok: true, id: Math.random() }), // would differ if re-run
    );

    const first = makeReq({ body: '{"donor":"a"}', key: 'k-replay' });
    const res1 = await withIdempotency(first, ENDPOINT, handler, db);
    const text1 = await res1.text();

    const second = makeReq({ body: '{"donor":"a"}', key: 'k-replay' });
    const res2 = await withIdempotency(second, ENDPOINT, handler, db);
    const text2 = await res2.text();

    expect(handler).toHaveBeenCalledTimes(1); // NOT re-run on replay
    expect(text2).toBe(text1); // byte-identical replay
    expect(res2.status).toBe(res1.status);
    expect(res2.headers.get(REPLAY_HEADER)).toBe('true');
  });
});

// ─── Conflict → 409 (Req 28.4) ────────────────────────────────────────────────

describe('withIdempotency — conflict (same key, different body)', () => {
  it('returns 409 IDEMPOTENCY_KEY_CONFLICT and does not re-run the handler', async () => {
    const { db } = mockDb();
    const handler = vi.fn(async () => jsonResponse({ ok: true }));

    const first = makeReq({ body: '{"donor":"a"}', key: 'k-conflict' });
    await withIdempotency(first, ENDPOINT, handler, db);

    const second = makeReq({ body: '{"donor":"DIFFERENT"}', key: 'k-conflict' });
    const res = await withIdempotency(second, ENDPOINT, handler, db);

    expect(handler).toHaveBeenCalledTimes(1); // second call short-circuits
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe(CONFLICT_ERROR_CODE);
  });

  it('treats a different endpoint as a separate key (no false conflict)', async () => {
    const { db } = mockDb();
    const handler = vi.fn(async () => jsonResponse({ ok: true }));

    const a = makeReq({ body: '{"x":1}', key: 'k-shared' });
    await withIdempotency(a, '/api/endpoint-a', handler, db);

    const b = makeReq({ body: '{"x":1}', key: 'k-shared' });
    const res = await withIdempotency(b, '/api/endpoint-b', handler, db);

    expect(handler).toHaveBeenCalledTimes(2); // both ran, different endpoints
    expect(res.status).toBe(200);
  });
});

// ─── Transient 5xx is not cached (stays retryable) ───────────────────────────

describe('withIdempotency — does not cache 5xx', () => {
  it('returns the 5xx and persists nothing, so a retry can run the handler', async () => {
    const { db, rows } = mockDb();
    const handler = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

    const first = makeReq({ body: '{"donor":"a"}', key: 'k-5xx' });
    const res1 = await withIdempotency(first, ENDPOINT, handler, db);
    expect(res1.status).toBe(503);
    expect(rows.size).toBe(0); // not persisted

    const retry = makeReq({ body: '{"donor":"a"}', key: 'k-5xx' });
    const res2 = await withIdempotency(retry, ENDPOINT, handler, db);
    expect(res2.status).toBe(200); // retry succeeded
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

// ─── idempotencyConflictResponse helper ──────────────────────────────────────

describe('idempotencyConflictResponse', () => {
  it('returns a 409 with the conflict envelope', async () => {
    const res = idempotencyConflictResponse();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe(CONFLICT_ERROR_CODE);
    expect(body.ok).toBe(false);
  });
});
