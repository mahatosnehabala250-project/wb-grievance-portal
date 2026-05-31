/**
 * Unit tests for src/lib/whatsapp/send.ts (task 27.6).
 *
 * Tests cover:
 *   - Happy path: breaker closed → Cloud API called → { ok: true } returned
 *   - Breaker open path: BreakerOpenError → outbox INSERT → { ok: true, queued: true }
 *   - API failure path: Cloud API throws → outbox INSERT → { ok: true, queued: true }
 *   - buildPayload normalisation
 *   - traceId propagation to outbox row
 *   - Missing credentials guard (falls back to outbox)
 *   - Double failure: API error + outbox INSERT fails → { ok: false }
 *
 * All tests use injectable seams (breakerStore, db, fetchImpl) so no live DB
 * or network calls are made.
 *
 * Requirements: 29.5, 29.6 — Design §v1.1.10
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendWA,
  buildPayload,
  setDefaultSendDb,
  type SendDbClient,
} from '../../src/lib/whatsapp/send';
import {
  clearBreakerCache,
  type BreakerStore,
  type CircuitStateRow,
  type BreakerName,
} from '../../src/lib/breaker/breaker';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-01-15T10:00:00.000Z');

/** Build a minimal closed-state CircuitStateRow. */
function closedRow(name: BreakerName = 'whatsapp'): CircuitStateRow {
  return {
    name,
    state: 'closed',
    consecutive_failures: 0,
    window_start: FIXED_NOW.toISOString(),
    opened_at: null,
    last_probe_at: null,
    updated_at: FIXED_NOW.toISOString(),
  };
}

/** Build a minimal open-state CircuitStateRow (cooldown not yet elapsed). */
function openRow(name: BreakerName = 'whatsapp'): CircuitStateRow {
  // opened_at is set far in the future so the cooldown (30s) has NOT elapsed
  // regardless of when the test runs. This ensures the breaker stays 'open'.
  const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now
  return {
    name,
    state: 'open',
    consecutive_failures: 5,
    window_start: FIXED_NOW.toISOString(),
    opened_at: farFuture,
    last_probe_at: null,
    updated_at: FIXED_NOW.toISOString(),
  };
}

/** Build a BreakerStore backed by a single in-memory row. */
function makeStore(row: CircuitStateRow): BreakerStore {
  let current = { ...row };
  return {
    async read() {
      return { ...current };
    },
    async write(_name, patch) {
      current = { ...current, ...patch };
    },
  };
}

/** Build a SendDbClient mock that records INSERT calls. */
function makeDb(opts: { failWith?: string } = {}): {
  client: SendDbClient;
  queries: { sql: string; params: unknown[] }[];
} {
  const queries: { sql: string; params: unknown[] }[] = [];
  const client: SendDbClient = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params: params ?? [] });
      if (opts.failWith) {
        throw new Error(opts.failWith);
      }
      return { rows: [] };
    },
  };
  return { client, queries };
}

/** Build a fetch mock that returns a successful Cloud API response. */
function makeSuccessFetch(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ messages: [{ id: 'wamid.abc' }] }),
    text: () => Promise.resolve('{"messages":[{"id":"wamid.abc"}]}'),
  }) as unknown as typeof fetch;
}

/** Build a fetch mock that returns an HTTP error. */
function makeErrorFetch(status = 500, body = 'Internal Server Error'): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

/** Build a fetch mock that throws a network error. */
function makeThrowingFetch(message = 'Network error'): typeof fetch {
  return vi.fn().mockRejectedValue(new Error(message)) as unknown as typeof fetch;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildPayload', () => {
  it('passes through a canonical text message unchanged', () => {
    const payload = buildPayload('+919876543210', { type: 'text', text: { body: 'Hello' } });
    expect(payload).toMatchObject({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+919876543210',
      type: 'text',
      text: { body: 'Hello' },
    });
  });

  it('normalises shorthand { type:"text", text:"Hello" } to canonical form', () => {
    const payload = buildPayload('+919876543210', { type: 'text', text: 'Hello' });
    expect(payload.text).toEqual({ body: 'Hello' });
  });

  it('normalises bare text string without type', () => {
    const payload = buildPayload('+919876543210', { text: 'Hello' });
    expect(payload.type).toBe('text');
    expect(payload.text).toEqual({ body: 'Hello' });
  });

  it('passes through interactive message body unchanged', () => {
    const body = {
      type: 'interactive',
      interactive: { type: 'button', body: { text: 'Choose' }, action: { buttons: [] } },
    };
    const payload = buildPayload('+919876543210', body);
    expect(payload.type).toBe('interactive');
    expect(payload.interactive).toEqual(body.interactive);
  });

  it('wraps a primitive body as a plain text message', () => {
    const payload = buildPayload('+919876543210', 'Hello world');
    expect(payload.type).toBe('text');
    expect((payload.text as Record<string, unknown>).body).toBe('Hello world');
  });
});

describe('sendWA — happy path (breaker closed)', () => {
  beforeEach(() => {
    clearBreakerCache();
    setDefaultSendDb(null);
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
  });

  it('calls the Cloud API and returns { ok: true } when breaker is closed', async () => {
    const breakerStore = makeStore(closedRow());
    const { client: db } = makeDb();
    const fetchMock = makeSuccessFetch();

    const result = await sendWA(
      '+919876543210',
      { type: 'text', text: { body: 'Test message' } },
      undefined,
      { breakerStore, db, fetchImpl: fetchMock },
    );

    expect(result.ok).toBe(true);
    expect((result as { queued?: boolean }).queued).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('sends to the correct Graph API endpoint', async () => {
    const breakerStore = makeStore(closedRow());
    const { client: db } = makeDb();
    const fetchMock = makeSuccessFetch();

    await sendWA(
      '+919876543210',
      { type: 'text', text: { body: 'Hi' } },
      undefined,
      { breakerStore, db, fetchImpl: fetchMock },
    );

    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('graph.facebook.com');
    expect(url).toContain('test-phone-id');
    expect(url).toContain('/messages');
  });

  it('does NOT insert into whatsapp_outbox on success', async () => {
    const breakerStore = makeStore(closedRow());
    const { client: db, queries } = makeDb();
    const fetchMock = makeSuccessFetch();

    await sendWA(
      '+919876543210',
      { type: 'text', text: { body: 'Hi' } },
      undefined,
      { breakerStore, db, fetchImpl: fetchMock },
    );

    expect(queries).toHaveLength(0);
  });
});

describe('sendWA — breaker open path (Req 29.5)', () => {
  beforeEach(() => {
    clearBreakerCache();
    setDefaultSendDb(null);
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
  });

  it('returns { ok: true, queued: true } when breaker is open', async () => {
    const breakerStore = makeStore(openRow());
    const { client: db } = makeDb();
    const fetchMock = makeSuccessFetch();

    const result = await sendWA(
      '+919876543210',
      { type: 'text', text: { body: 'Hello' } },
      undefined,
      { breakerStore, db, fetchImpl: fetchMock },
    );

    expect(result.ok).toBe(true);
    expect((result as { queued?: boolean }).queued).toBe(true);
    // Cloud API must NOT be called when breaker is open.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('inserts a pending row into whatsapp_outbox when breaker is open', async () => {
    const breakerStore = makeStore(openRow());
    const { client: db, queries } = makeDb();

    await sendWA(
      '+919876543210',
      { type: 'text', text: { body: 'Hello' } },
      undefined,
      { breakerStore, db, fetchImpl: makeSuccessFetch() },
    );

    expect(queries).toHaveLength(1);
    const { sql, params } = queries[0];
    expect(sql).toContain('INSERT INTO whatsapp_outbox');
    expect(sql).toContain("'pending'");
    expect(params).toContain('+919876543210');
  });

  it('propagates traceId to the outbox INSERT', async () => {
    const breakerStore = makeStore(openRow());
    const { client: db, queries } = makeDb();

    await sendWA(
      '+919876543210',
      { type: 'text', text: { body: 'Hello' } },
      'trace-uuid-1234',
      { breakerStore, db, fetchImpl: makeSuccessFetch() },
    );

    const { sql, params } = queries[0];
    expect(sql).toContain('trace_id');
    expect(params).toContain('trace-uuid-1234');
  });

  it('omits trace_id from outbox INSERT when not provided', async () => {
    const breakerStore = makeStore(openRow());
    const { client: db, queries } = makeDb();

    await sendWA(
      '+919876543210',
      { type: 'text', text: { body: 'Hello' } },
      undefined,
      { breakerStore, db, fetchImpl: makeSuccessFetch() },
    );

    const { sql } = queries[0];
    expect(sql).not.toContain('trace_id');
  });
});

describe('sendWA — API failure fallback (Req 29.5)', () => {
  beforeEach(() => {
    clearBreakerCache();
    setDefaultSendDb(null);
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
  });

  it('falls back to outbox when Cloud API returns HTTP error', async () => {
    const breakerStore = makeStore(closedRow());
    const { client: db, queries } = makeDb();
    const fetchMock = makeErrorFetch(500, 'Internal Server Error');

    const result = await sendWA(
      '+919876543210',
      { type: 'text', text: { body: 'Hello' } },
      undefined,
      { breakerStore, db, fetchImpl: fetchMock },
    );

    expect(result.ok).toBe(true);
    expect((result as { queued?: boolean }).queued).toBe(true);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('INSERT INTO whatsapp_outbox');
  });

  it('falls back to outbox when fetch throws a network error', async () => {
    const breakerStore = makeStore(closedRow());
    const { client: db, queries } = makeDb();
    const fetchMock = makeThrowingFetch('ECONNREFUSED');

    const result = await sendWA(
      '+919876543210',
      { type: 'text', text: { body: 'Hello' } },
      undefined,
      { breakerStore, db, fetchImpl: fetchMock },
    );

    expect(result.ok).toBe(true);
    expect((result as { queued?: boolean }).queued).toBe(true);
    expect(queries).toHaveLength(1);
  });

  it('increments the breaker failure counter on API error', async () => {
    const row = closedRow();
    const breakerStore = makeStore(row);
    const { client: db } = makeDb();
    const fetchMock = makeErrorFetch(503);

    await sendWA(
      '+919876543210',
      { type: 'text', text: { body: 'Hello' } },
      undefined,
      { breakerStore, db, fetchImpl: fetchMock },
    );

    // After one failure the breaker should have incremented consecutive_failures.
    const updatedRow = await breakerStore.read('whatsapp');
    expect(updatedRow?.consecutive_failures).toBeGreaterThan(0);
  });

  it('returns { ok: false } when API fails AND outbox INSERT also fails', async () => {
    const breakerStore = makeStore(closedRow());
    const { client: db } = makeDb({ failWith: 'DB connection refused' });
    const fetchMock = makeErrorFetch(500);

    const result = await sendWA(
      '+919876543210',
      { type: 'text', text: { body: 'Hello' } },
      undefined,
      { breakerStore, db, fetchImpl: fetchMock },
    );

    expect(result.ok).toBe(false);
    expect((result as { error?: string }).error).toContain('outbox_failed');
  });
});

describe('sendWA — missing credentials guard', () => {
  beforeEach(() => {
    clearBreakerCache();
    setDefaultSendDb(null);
  });

  it('falls back to outbox when WHATSAPP_PHONE_NUMBER_ID is missing', async () => {
    const savedId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';

    const breakerStore = makeStore(closedRow());
    const { client: db, queries } = makeDb();

    const result = await sendWA(
      '+919876543210',
      { type: 'text', text: { body: 'Hello' } },
      undefined,
      { breakerStore, db, fetchImpl: makeSuccessFetch() },
    );

    expect(result.ok).toBe(true);
    expect((result as { queued?: boolean }).queued).toBe(true);
    expect(queries).toHaveLength(1);

    process.env.WHATSAPP_PHONE_NUMBER_ID = savedId;
  });

  it('falls back to outbox when WHATSAPP_ACCESS_TOKEN is missing', async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
    const savedToken = process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_ACCESS_TOKEN;

    const breakerStore = makeStore(closedRow());
    const { client: db, queries } = makeDb();

    const result = await sendWA(
      '+919876543210',
      { type: 'text', text: { body: 'Hello' } },
      undefined,
      { breakerStore, db, fetchImpl: makeSuccessFetch() },
    );

    expect(result.ok).toBe(true);
    expect((result as { queued?: boolean }).queued).toBe(true);
    expect(queries).toHaveLength(1);

    process.env.WHATSAPP_ACCESS_TOKEN = savedToken;
  });
});
