// Feature: sahayak-multi-agent-router, Task 9.5
// Unit tests for the donor OTP auth + profile API routes (section 9).
//
// Covers:
//   - POST  /api/donor/auth/send-otp     (public — this IS the auth flow)
//   - POST  /api/donor/auth/verify-otp   (public — issues a donor JWT)
//   - GET   /api/blood-donors/me         (auth: donor JWT)
//   - PATCH /api/blood-donors/me         (auth: donor JWT, editable profile fields)
//   - POST  /api/blood-donors/self-defer (auth: donor JWT)
//
// For each route we assert: request validation, authentication (donor JWT —
// issued/verified with the real jose-based @/lib/jwt helper, exactly like the
// verify-otp handler signs it), the happy path, and the error envelopes that
// the design's §Error Handling matrix labels VALIDATION_FAILED (400 + ok:false)
// and UNAUTHORIZED (401 + ok:false).
//
// NOTE on envelope shape: design.md §Error Handling specifies the canonical
// failure envelope `{ ok:false, error:{ code, message } }`. The *implemented*
// handlers return either `{ ok:false, error:'<string>' }` (the OTP routes) or
// `{ ok:false, error:'VALIDATION_FAILED', details:[...] }` (the profile routes),
// always with the correct HTTP status (401 UNAUTHORIZED / 403 FORBIDDEN /
// 400 VALIDATION_FAILED). These tests assert the routes' ACTUAL behaviour —
// per task instructions the handlers must not be modified.
//
// The Supabase client is mocked the same way as tests/api/sessions-routing.test.ts
// (no live DB). The mock additionally exposes `auth.signInWithOtp` /
// `auth.verifyOtp` for the OTP flow and a FIFO result queue consumed by the
// terminal `.single()` / `.maybeSingle()` / awaited-builder operations.
//
// _Requirements: 17.1, 17.2, 17.4, 17.5 — Design §API Endpoint Contracts, §Error Handling_

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignJWT } from 'jose';

// ---------------------------------------------------------------------------
// Supabase mock — shared, hoisted so the vi.mock factory can reference it.
//
// The chainable query builder supports the shapes used by the donor routes:
//   .select(..).eq(..).maybeSingle()           (send-otp / verify-otp lookup)
//   .update(..).eq(..)            (awaited directly — verify-otp auth link)
//   .select(..).eq(..).single()                (GET /me, PATCH /me fetch)
//   .update(..).eq(..).select(..).single()     (PATCH /me, self-defer)
//
// Terminal operations (single / maybeSingle / awaiting the builder) consume the
// next result from `state.queue` (FIFO). Auth results are configured separately.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown };
  const state = {
    queue: [] as Result[],
    auth: {
      signInWithOtp: { data: {}, error: null } as Result,
      verifyOtp: { data: { user: { id: 'auth-user-1' } }, error: null } as Result,
    },
    calls: {
      from: [] as string[],
      select: [] as unknown[],
      update: [] as Record<string, unknown>[],
      filters: [] as [string, string, unknown][],
      auth: [] as { method: string; args: unknown }[],
    },
  };

  const next = (): Result =>
    state.queue.length ? (state.queue.shift() as Result) : { data: null, error: null };

  const makeBuilder = () => {
    const b: Record<string, unknown> = {};
    b.select = (sel: unknown) => {
      state.calls.select.push(sel);
      return b;
    };
    b.update = (data: Record<string, unknown>) => {
      state.calls.update.push(data);
      return b;
    };
    b.eq = (c: string, v: unknown) => {
      state.calls.filters.push(['eq', c, v]);
      return b;
    };
    b.single = () => Promise.resolve(next());
    b.maybeSingle = () => Promise.resolve(next());
    // thenable: awaiting the builder chain directly (e.g. update().eq()) resolves a result
    b.then = (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(next()).then(resolve, reject);
    return b;
  };

  const client = {
    from: (table: string) => {
      state.calls.from.push(table);
      return makeBuilder();
    },
    auth: {
      signInWithOtp: (args: unknown) => {
        state.calls.auth.push({ method: 'signInWithOtp', args });
        return Promise.resolve(state.auth.signInWithOtp);
      },
      verifyOtp: (args: unknown) => {
        state.calls.auth.push({ method: 'verifyOtp', args });
        return Promise.resolve(state.auth.verifyOtp);
      },
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
import { POST as sendOtp } from '../../src/app/api/donor/auth/send-otp/route';
import { POST as verifyOtpRoute } from '../../src/app/api/donor/auth/verify-otp/route';
import { GET as getMe, PATCH as patchMe } from '../../src/app/api/blood-donors/me/route';
import { POST as selfDefer } from '../../src/app/api/blood-donors/self-defer/route';
import { signToken, verifyToken } from '../../src/lib/jwt';

// Same secret/algorithm the verify-otp handler uses to sign donor tokens.
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'wb-gov-support-system-secret-key-2024'
);

/** Build a minimal Request the route handlers can consume (cast to NextRequest). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(url: string, init: RequestInit = {}): any {
  return new Request(url, init);
}

/** Mint a donor JWT exactly as the verify-otp handler does: { donorId, phone, role:'DONOR' }. */
async function donorToken(donorId = 'donor-1', phone = '+919876543210'): Promise<string> {
  return new SignJWT({ donorId, phone, role: 'DONOR' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET);
}

/** Mint a role:'DONOR' token that deliberately omits the donorId claim. */
async function donorTokenNoId(phone = '+919876543210'): Promise<string> {
  return new SignJWT({ phone, role: 'DONOR' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET);
}

/** A valid, correctly-signed token that is NOT a donor (role !== 'DONOR'). */
async function nonDonorToken(): Promise<string> {
  return signToken({
    userId: 'u-admin',
    username: 'admin',
    role: 'ADMIN',
    name: 'Admin User',
    block: 'HQ',
    district: null,
  });
}

beforeEach(() => {
  h.state.queue = [];
  h.state.auth = {
    signInWithOtp: { data: {}, error: null },
    verifyOtp: { data: { user: { id: 'auth-user-1' } }, error: null },
  };
  h.state.calls = { from: [], select: [], update: [], filters: [], auth: [] };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

// ===========================================================================
// POST /api/donor/auth/send-otp  (Req 17.1) — public OTP request
// ===========================================================================
describe('POST /api/donor/auth/send-otp', () => {
  const URL = 'http://localhost:3000/api/donor/auth/send-otp';

  function req(body: unknown) {
    return makeReq(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('returns 400 VALIDATION_FAILED when phone is missing', async () => {
    const res = await sendOtp(req({}));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/phone/i);
  });

  it('returns 400 VALIDATION_FAILED when phone is not E.164 format', async () => {
    const res = await sendOtp(req({ phone: '9876543210' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/format/i);
  });

  it('returns 404 when the phone is not registered as a donor', async () => {
    h.state.queue = [{ data: null, error: null }]; // donor lookup → no row
    const res = await sendOtp(req({ phone: '+919876543210' }));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not registered/i);
  });

  it('happy path: looks up the donor and dispatches an OTP', async () => {
    h.state.queue = [{ data: { id: 'donor-1', phone: '+919876543210' }, error: null }];
    const res = await sendOtp(req({ phone: '+919876543210' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.phone).toBe('+919876543210');
    expect(json.data.message).toMatch(/otp sent/i);
    expect(h.state.calls.from).toContain('blood_donors');
    expect(h.state.calls.auth).toContainEqual({
      method: 'signInWithOtp',
      args: { phone: '+919876543210' },
    });
  });

  it('returns 500 when the OTP provider fails', async () => {
    h.state.queue = [{ data: { id: 'donor-1', phone: '+919876543210' }, error: null }];
    h.state.auth.signInWithOtp = { data: null, error: { message: 'sms gateway down' } };
    const res = await sendOtp(req({ phone: '+919876543210' }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
  });
});

// ===========================================================================
// POST /api/donor/auth/verify-otp  (Req 17.1) — issues donor JWT
// ===========================================================================
describe('POST /api/donor/auth/verify-otp', () => {
  const URL = 'http://localhost:3000/api/donor/auth/verify-otp';

  function req(body: unknown) {
    return makeReq(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('returns 400 VALIDATION_FAILED when phone is missing', async () => {
    const res = await verifyOtpRoute(req({ otp: '123456' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/phone/i);
  });

  it('returns 400 VALIDATION_FAILED when otp is missing', async () => {
    const res = await verifyOtpRoute(req({ phone: '+919876543210' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/otp/i);
  });

  it('returns 400 VALIDATION_FAILED when otp is not 6 digits', async () => {
    const res = await verifyOtpRoute(req({ phone: '+919876543210', otp: '123' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/6-digit/i);
  });

  it('returns 401 UNAUTHORIZED when the OTP is invalid or expired', async () => {
    h.state.auth.verifyOtp = { data: null, error: { message: 'token expired' } };
    const res = await verifyOtpRoute(req({ phone: '+919876543210', otp: '123456' }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/invalid or expired otp/i);
  });

  it('returns 404 when no donor profile matches the phone', async () => {
    h.state.queue = [{ data: null, error: null }]; // donor lookup → no row
    const res = await verifyOtpRoute(req({ phone: '+919876543210', otp: '123456' }));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not found/i);
  });

  it('happy path: verifies OTP and returns a valid donor JWT', async () => {
    h.state.queue = [
      {
        data: {
          id: 'donor-1',
          name: 'Asha Devi',
          blood_group: 'O+',
          auth_user_id: 'auth-user-1', // already linked → no link update
        },
        error: null,
      },
    ];
    const res = await verifyOtpRoute(req({ phone: '+919876543210', otp: '123456' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.donor).toEqual({ id: 'donor-1', name: 'Asha Devi', blood_group: 'O+' });
    expect(typeof json.data.token).toBe('string');

    // The issued token must verify with the real jwt helper and carry the donor claims.
    const claims = await verifyToken(json.data.token);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = claims as any;
    expect(c).not.toBeNull();
    expect(c.role).toBe('DONOR');
    expect(c.donorId).toBe('donor-1');
    expect(c.phone).toBe('+919876543210');
  });

  it('links auth_user_id when the donor row is not yet linked', async () => {
    h.state.queue = [
      { data: { id: 'donor-1', name: 'Asha Devi', blood_group: 'O+', auth_user_id: null }, error: null },
      { data: null, error: null }, // result of the link UPDATE (awaited builder)
    ];
    const res = await verifyOtpRoute(req({ phone: '+919876543210', otp: '123456' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(h.state.calls.update).toContainEqual({ auth_user_id: 'auth-user-1' });
  });
});

// ===========================================================================
// GET /api/blood-donors/me  (Req 17.2) — donor JWT
// ===========================================================================
describe('GET /api/blood-donors/me', () => {
  const URL = 'http://localhost:3000/api/blood-donors/me';

  function req(token?: string) {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    return makeReq(URL, { method: 'GET', headers });
  }

  it('returns 401 UNAUTHORIZED when no token is provided', async () => {
    const res = await getMe(req());
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/no token/i);
  });

  it('returns 401 UNAUTHORIZED when the token is invalid', async () => {
    const res = await getMe(req('not-a-real-jwt'));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/invalid or expired/i);
  });

  it('returns 403 FORBIDDEN when a valid non-donor token is used', async () => {
    const res = await getMe(req(await nonDonorToken()));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/donor access/i);
  });

  it('returns 403 FORBIDDEN when the donor token is missing donorId', async () => {
    const res = await getMe(req(await donorTokenNoId()));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/donorid/i);
  });

  it('happy path: returns the authenticated donor profile', async () => {
    const profile = {
      id: 'donor-1',
      phone: '+919876543210',
      name: 'Asha Devi',
      blood_group: 'O+',
      gender: 'female',
      district: 'Howrah',
      block: 'Bagnan-I',
      next_eligible_date: '2026-05-01',
      is_available: true,
      total_donations: 3,
    };
    h.state.queue = [{ data: profile, error: null }];
    const res = await getMe(req(await donorToken('donor-1')));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data).toEqual(profile);
    expect(h.state.calls.from).toContain('blood_donors');
    expect(h.state.calls.filters).toContainEqual(['eq', 'id', 'donor-1']);
  });

  it('returns 404 when the donor row no longer exists', async () => {
    h.state.queue = [{ data: null, error: { code: 'PGRST116' } }];
    const res = await getMe(req(await donorToken('donor-1')));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.ok).toBe(false);
  });
});

// ===========================================================================
// PATCH /api/blood-donors/me  (Req 17.2, 17.4) — editable profile fields
// ===========================================================================
describe('PATCH /api/blood-donors/me', () => {
  const URL = 'http://localhost:3000/api/blood-donors/me';

  function req(body: unknown, token?: string) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    return makeReq(URL, { method: 'PATCH', headers, body: JSON.stringify(body) });
  }

  it('returns 401 UNAUTHORIZED when no token is provided', async () => {
    const res = await patchMe(req({ name: 'New Name' }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
  });

  it('returns 403 FORBIDDEN when a valid non-donor token is used', async () => {
    const res = await patchMe(req({ name: 'New Name' }, await nonDonorToken()));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/donor access/i);
  });

  it('returns 400 VALIDATION_FAILED when weight_kg is below 45', async () => {
    const res = await patchMe(req({ weight_kg: 40 }, await donorToken('donor-1')));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('VALIDATION_FAILED');
    expect(json.details.join(' ')).toMatch(/weight_kg/i);
  });

  it('returns 400 VALIDATION_FAILED when last_donation_type is not a valid enum value', async () => {
    const res = await patchMe(
      req({ last_donation_type: 'super_blood' }, await donorToken('donor-1'))
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('VALIDATION_FAILED');
    expect(json.details.join(' ')).toMatch(/last_donation_type/i);
  });

  it('returns 400 VALIDATION_FAILED when no editable fields are provided', async () => {
    const res = await patchMe(req({}, await donorToken('donor-1')));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('VALIDATION_FAILED');
    expect(json.details.join(' ')).toMatch(/no fields/i);
  });

  it('happy path: updates simple profile fields', async () => {
    const updated = {
      id: 'donor-1',
      name: 'Asha Rani',
      district: 'Howrah',
      block: 'Bagnan-II',
      is_available: false,
    };
    h.state.queue = [{ data: updated, error: null }];
    const res = await patchMe(
      req({ name: 'Asha Rani', block: 'Bagnan-II', is_available: false }, await donorToken('donor-1'))
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data).toEqual(updated);
    expect(h.state.calls.update[0]).toMatchObject({
      name: 'Asha Rani',
      block: 'Bagnan-II',
      is_available: false,
    });
    expect(h.state.calls.filters).toContainEqual(['eq', 'id', 'donor-1']);
  });

  it('recalculates next_eligible_date when last_donated_date is self-reported', async () => {
    // First queue entry: the existing-donor fetch (gender used for cooldown math).
    // Second queue entry: the returned updated row.
    h.state.queue = [
      { data: { gender: 'female', last_donation_type: null }, error: null },
      {
        data: {
          id: 'donor-1',
          last_donated_date: '2026-01-01',
          last_donation_type: 'whole_blood',
          next_eligible_date: '2026-05-01',
        },
        error: null,
      },
    ];
    const res = await patchMe(
      req(
        { last_donated_date: '2026-01-01', last_donation_type: 'whole_blood' },
        await donorToken('donor-1')
      )
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    // The update payload must include a recomputed next_eligible_date (female whole_blood = +120d).
    const updatePayload = h.state.calls.update[0];
    expect(updatePayload.last_donated_date).toBe('2026-01-01');
    expect(updatePayload.next_eligible_date).toBe('2026-05-01');
  });
});

// ===========================================================================
// POST /api/blood-donors/self-defer  (Req 17.5) — donor JWT
// ===========================================================================
describe('POST /api/blood-donors/self-defer', () => {
  const URL = 'http://localhost:3000/api/blood-donors/self-defer';

  function req(body: unknown, token?: string) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    return makeReq(URL, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  it('returns 401 UNAUTHORIZED when no token is provided', async () => {
    const res = await selfDefer(req({ reason: 'illness' }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
  });

  it('returns 403 FORBIDDEN when a valid non-donor token is used', async () => {
    const res = await selfDefer(req({ reason: 'illness' }, await nonDonorToken()));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/donor access/i);
  });

  it('returns 400 VALIDATION_FAILED when reason is missing or invalid', async () => {
    const res = await selfDefer(req({ reason: 'feeling_lazy' }, await donorToken('donor-1')));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('VALIDATION_FAILED');
    expect(json.message).toMatch(/reason/i);
  });

  it('returns 400 VALIDATION_FAILED when duration_days is not a positive integer', async () => {
    const res = await selfDefer(
      req({ reason: 'illness', duration_days: -5 }, await donorToken('donor-1'))
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('VALIDATION_FAILED');
    expect(json.message).toMatch(/duration_days/i);
  });

  it('happy path: applies a self-deferral and returns the deferral window', async () => {
    h.state.queue = [
      {
        data: { id: 'donor-1', deferral_until: '2026-02-15', deferral_reason: 'illness' },
        error: null,
      },
    ];
    const res = await selfDefer(req({ reason: 'illness' }, await donorToken('donor-1')));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.donor_id).toBe('donor-1');
    expect(json.data.deferral_reason).toBe('illness');
    expect(typeof json.data.deferral_until).toBe('string');
    expect(h.state.calls.from).toContain('blood_donors');
    // The update must carry both deferral columns.
    const updatePayload = h.state.calls.update[0];
    expect(updatePayload.deferral_reason).toBe('illness');
    expect(typeof updatePayload.deferral_until).toBe('string');
    expect(h.state.calls.filters).toContainEqual(['eq', 'id', 'donor-1']);
  });

  it('happy path: includes free-text notes in the stored deferral reason', async () => {
    h.state.queue = [
      {
        data: { id: 'donor-1', deferral_until: '2026-03-01', deferral_reason: 'travel: abroad trip' },
        error: null,
      },
    ];
    const res = await selfDefer(
      req({ reason: 'travel', notes: 'abroad trip' }, await donorToken('donor-1'))
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(h.state.calls.update[0].deferral_reason).toBe('travel: abroad trip');
  });
});
