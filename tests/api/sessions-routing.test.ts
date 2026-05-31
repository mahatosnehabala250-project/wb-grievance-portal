// Feature: sahayak-multi-agent-router, Task 3.5
// Unit tests for the section-3 session and routing API routes.
//
// Covers:
//   - POST /api/sessions/save        (auth: X-N8N-SECRET)
//   - POST /api/routing/log          (auth: X-N8N-SECRET)
//   - POST /api/agents/test-route    (auth: admin JWT)
//   - GET  /api/routing/decisions    (auth: JWT, admin vs non-admin masking)
//
// For each route we assert: request validation, authentication
// (n8n secret + admin JWT), the happy path, and the error envelopes that the
// design's §Error Handling matrix labels VALIDATION_FAILED (400 + ok:false)
// and UNAUTHORIZED (401 + ok:false).
//
// NOTE on envelope shape: design.md §Error Handling specifies the canonical
// failure envelope `{ ok:false, error:{ code, message } }`. The *implemented*
// route handlers currently return `{ ok:false, error:'<string>' }` with the
// correct HTTP status code (401 for UNAUTHORIZED, 400 for VALIDATION_FAILED).
// These tests intentionally assert the routes' ACTUAL behaviour (status +
// ok:false) — per task instructions the handlers must not be modified.
//
// _Requirements: 1.1–1.5, 13.2, 15.3, 18.1 — Design §Error Handling_

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Supabase mock — shared, hoisted so the vi.mock factory can reference it.
// The mock provides a chainable query builder that is also "thenable" so the
// GET /api/routing/decisions handler (which awaits the chain directly) works,
// while .single() returns a plain promise for the upsert/insert handlers.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown; count?: number };
  const state = {
    single: { data: null as unknown, error: null as unknown } as Result,
    list: { data: [] as unknown[], error: null as unknown, count: 0 } as Result,
    calls: {
      from: [] as string[],
      upsert: null as null | { data: Record<string, unknown>; opts: unknown },
      insert: null as null | Record<string, unknown>,
      select: [] as { sel: unknown; opts: unknown }[],
      filters: [] as [string, string, unknown][],
      limit: null as number | null,
    },
  };

  const makeBuilder = () => {
    const b: Record<string, unknown> = {};
    b.upsert = (data: Record<string, unknown>, opts: unknown) => {
      state.calls.upsert = { data, opts };
      return b;
    };
    b.insert = (data: Record<string, unknown>) => {
      state.calls.insert = data;
      return b;
    };
    b.select = (sel: unknown, opts: unknown) => {
      state.calls.select.push({ sel, opts });
      return b;
    };
    b.order = () => b;
    b.limit = (n: number) => {
      state.calls.limit = n;
      return b;
    };
    b.eq = (c: string, v: unknown) => {
      state.calls.filters.push(['eq', c, v]);
      return b;
    };
    b.gte = (c: string, v: unknown) => {
      state.calls.filters.push(['gte', c, v]);
      return b;
    };
    b.lte = (c: string, v: unknown) => {
      state.calls.filters.push(['lte', c, v]);
      return b;
    };
    b.single = () => Promise.resolve(state.single);
    // thenable: awaiting the builder chain resolves the list result
    b.then = (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(state.list).then(resolve, reject);
    return b;
  };

  const client = {
    from: (table: string) => {
      state.calls.from.push(table);
      return makeBuilder();
    },
  };

  return { state, client };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => h.client),
}));

// ---------------------------------------------------------------------------
// Route handlers under test + real JWT helper for genuine auth coverage.
// ---------------------------------------------------------------------------
import { POST as sessionsSave } from '../../src/app/api/sessions/save/route';
import { POST as routingLog } from '../../src/app/api/routing/log/route';
import { POST as testRoute } from '../../src/app/api/agents/test-route/route';
import { GET as routingDecisions } from '../../src/app/api/routing/decisions/route';
import { signToken } from '../../src/lib/jwt';

const N8N_SECRET = 'test-n8n-secret';

/** Build a minimal Request the route handlers can consume (cast to NextRequest). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(url: string, init: RequestInit = {}): any {
  return new Request(url, init);
}

async function adminToken(): Promise<string> {
  return signToken({
    userId: 'u-admin',
    username: 'admin',
    role: 'ADMIN',
    name: 'Admin User',
    block: 'HQ',
    district: null,
  });
}

async function officerToken(): Promise<string> {
  return signToken({
    userId: 'u-officer',
    username: 'officer',
    role: 'BLOCK_OFFICER',
    name: 'Block Officer',
    block: 'Bagnan-I',
    district: 'Howrah',
  });
}

beforeEach(() => {
  h.state.single = { data: null, error: null };
  h.state.list = { data: [], error: null, count: 0 };
  h.state.calls = { from: [], upsert: null, insert: null, select: [], filters: [], limit: null };
  process.env.N8N_WEBHOOK_SECRET = N8N_SECRET;
});

// ===========================================================================
// POST /api/sessions/save  (Req 1.1–1.5)
// ===========================================================================
describe('POST /api/sessions/save', () => {
  const URL = 'http://localhost:3000/api/sessions/save';

  function req(body: unknown, headers: Record<string, string> = {}) {
    return makeReq(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  it('returns 401 UNAUTHORIZED when X-N8N-SECRET header is missing', async () => {
    const res = await sessionsSave(req({ session_id: '+919876543210' }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/unauthorized/i);
  });

  it('returns 401 UNAUTHORIZED when X-N8N-SECRET is wrong', async () => {
    const res = await sessionsSave(
      req({ session_id: '+919876543210' }, { 'x-n8n-secret': 'nope' })
    );
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
  });

  it('returns 400 VALIDATION_FAILED when session_id is missing', async () => {
    const res = await sessionsSave(req({ last_intent: 'idle' }, { 'x-n8n-secret': N8N_SECRET }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/session_id/i);
  });

  it('returns 400 VALIDATION_FAILED when last_intent is not a valid enum value', async () => {
    const res = await sessionsSave(
      req({ session_id: '+919876543210', last_intent: 'bogus_intent' }, { 'x-n8n-secret': N8N_SECRET })
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/last_intent/i);
  });

  it('returns 400 VALIDATION_FAILED when active_agent is not a valid enum value', async () => {
    const res = await sessionsSave(
      req({ session_id: '+919876543210', active_agent: 'wizard' }, { 'x-n8n-secret': N8N_SECRET })
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/active_agent/i);
  });

  it('happy path: persists session state and returns the saved row', async () => {
    h.state.single = {
      data: { session_id: '+919876543210', last_intent: 'complaint_collecting', active_agent: 'complaint' },
      error: null,
    };
    const res = await sessionsSave(
      req(
        {
          session_id: '+919876543210',
          last_intent: 'complaint_collecting',
          active_agent: 'complaint',
          collected_data: { category: 'water' },
          language: 'hi',
        },
        { 'x-n8n-secret': N8N_SECRET }
      )
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data).toEqual({
      session_id: '+919876543210',
      last_intent: 'complaint_collecting',
      active_agent: 'complaint',
    });
    expect(h.state.calls.from).toContain('conversation_sessions');
    // collected_data was persisted on a normal (non-complete) save
    expect(h.state.calls.upsert?.data.collected_data).toEqual({ category: 'water' });
  });

  it('flow_complete: resets last_intent to idle and clears collected_data (Req 1.5)', async () => {
    h.state.single = {
      data: { session_id: '+919876543210', last_intent: 'idle', active_agent: 'ceo' },
      error: null,
    };
    const res = await sessionsSave(
      req(
        {
          session_id: '+919876543210',
          last_intent: 'complaint_confirming',
          collected_data: { category: 'water' },
          flow_complete: true,
        },
        { 'x-n8n-secret': N8N_SECRET }
      )
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(h.state.calls.upsert?.data.last_intent).toBe('idle');
    expect(h.state.calls.upsert?.data.collected_data).toEqual({});
  });
});

// ===========================================================================
// POST /api/routing/log  (Req 2.13, 18.1)
// ===========================================================================
describe('POST /api/routing/log', () => {
  const URL = 'http://localhost:3000/api/routing/log';

  function req(body: unknown, headers: Record<string, string> = {}) {
    return makeReq(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  it('returns 401 UNAUTHORIZED when X-N8N-SECRET header is missing', async () => {
    const res = await routingLog(req({ session_id: '+919876543210', reason: 'idle_keyword:blood' }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
  });

  it('returns 400 VALIDATION_FAILED when session_id is missing', async () => {
    const res = await routingLog(req({ reason: 'idle_keyword:blood' }, { 'x-n8n-secret': N8N_SECRET }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/session_id/i);
  });

  it('returns 400 VALIDATION_FAILED when reason is missing', async () => {
    const res = await routingLog(req({ session_id: '+919876543210' }, { 'x-n8n-secret': N8N_SECRET }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/reason/i);
  });

  it('returns 400 VALIDATION_FAILED when agent_dispatched is an invalid enum value', async () => {
    const res = await routingLog(
      req(
        { session_id: '+919876543210', reason: 'x', agent_dispatched: 'pharmacist' },
        { 'x-n8n-secret': N8N_SECRET }
      )
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/agent_dispatched/i);
  });

  it('happy path: inserts a routing decision and truncates message_text to 200 chars', async () => {
    h.state.single = { data: { id: 'rd-1' }, error: null };
    const longMessage = 'x'.repeat(250);
    const res = await routingLog(
      req(
        {
          session_id: '+919876543210',
          message_text: longMessage,
          last_intent_before: 'idle',
          agent_dispatched: 'blood',
          reason: 'idle_keyword:blood',
          trace_id: '11111111-1111-1111-1111-111111111111',
        },
        { 'x-n8n-secret': N8N_SECRET }
      )
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data).toEqual({ id: 'rd-1' });
    expect(h.state.calls.from).toContain('routing_decisions');
    expect((h.state.calls.insert?.message_text as string).length).toBe(200);
    expect(h.state.calls.insert?.agent_dispatched).toBe('blood');
  });

  it('happy path: allows null agent_dispatched for stale-reset rows', async () => {
    h.state.single = { data: { id: 'rd-2' }, error: null };
    const res = await routingLog(
      req(
        { session_id: '+919876543210', reason: 'session_stale_reset', agent_dispatched: null },
        { 'x-n8n-secret': N8N_SECRET }
      )
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(h.state.calls.insert?.agent_dispatched).toBeNull();
  });
});

// ===========================================================================
// POST /api/agents/test-route  (Req 15.3) — admin JWT
// ===========================================================================
describe('POST /api/agents/test-route', () => {
  const URL = 'http://localhost:3000/api/agents/test-route';

  function req(body: unknown, token?: string) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    return makeReq(URL, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  it('returns 401 UNAUTHORIZED when no token is provided', async () => {
    const res = await testRoute(req({ message: 'blood chahiye' }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
  });

  it('returns 401 when the token is invalid', async () => {
    const res = await testRoute(req({ message: 'blood chahiye' }, 'not-a-real-jwt'));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/invalid token/i);
  });

  it('returns 403 when a valid non-admin token is used', async () => {
    const res = await testRoute(req({ message: 'blood chahiye' }, await officerToken()));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/admin/i);
  });

  it('returns 400 VALIDATION_FAILED when message is missing', async () => {
    const res = await testRoute(req({ last_intent: 'idle' }, await adminToken()));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/message/i);
  });

  it('returns 400 VALIDATION_FAILED when language is invalid', async () => {
    const res = await testRoute(req({ message: 'blood chahiye', language: 'fr' }, await adminToken()));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/language/i);
  });

  it('happy path: admin gets the CEO Router decision for a blood keyword', async () => {
    const res = await testRoute(req({ message: 'blood chahiye', last_intent: 'idle' }, await adminToken()));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.agent).toBe('blood');
    expect(typeof json.data.reason).toBe('string');
    expect(Array.isArray(json.data.rules_evaluated)).toBe(true);
  });

  it('happy path: a greeting on idle routes to the welcome agent', async () => {
    const res = await testRoute(req({ message: 'hi', last_intent: 'idle' }, await adminToken()));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.agent).toBe('welcome');
  });
});

// ===========================================================================
// GET /api/routing/decisions  (Req 13.2, 13.3) — JWT + phone masking
// ===========================================================================
describe('GET /api/routing/decisions', () => {
  const BASE = 'http://localhost:3000/api/routing/decisions';

  function req(query = '', token?: string) {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    return makeReq(`${BASE}${query}`, { method: 'GET', headers });
  }

  const sampleRow = {
    id: 'r1',
    session_id: '+919876543210',
    message_text: 'hi',
    last_intent_before: 'idle',
    agent_dispatched: 'welcome',
    reason: 'greeting_on_idle',
    trace_id: null,
    created_at: '2026-02-01T00:00:00.000Z',
  };

  it('returns 401 UNAUTHORIZED when no token is provided', async () => {
    const res = await routingDecisions(req(''));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
  });

  it('returns 401 when the token is invalid', async () => {
    const res = await routingDecisions(req('', 'garbage-token'));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/invalid token/i);
  });

  it('happy path: admin sees unmasked phone numbers and the total count', async () => {
    h.state.list = { data: [sampleRow], error: null, count: 1 };
    const res = await routingDecisions(req('', await adminToken()));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.total).toBe(1);
    expect(json.data[0].session_id).toBe('+919876543210');
  });

  it('non-admin: phone numbers are masked', async () => {
    h.state.list = { data: [sampleRow], error: null, count: 1 };
    const res = await routingDecisions(req('', await officerToken()));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data[0].session_id).toBe('+91******3210');
  });

  it('applies the agent filter and caps limit at 200', async () => {
    h.state.list = { data: [], error: null, count: 0 };
    const res = await routingDecisions(req('?agent=blood&limit=500', await adminToken()));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(h.state.calls.limit).toBe(200);
    expect(h.state.calls.filters).toContainEqual(['eq', 'agent_dispatched', 'blood']);
  });
});
