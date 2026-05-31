// Feature: sahayak-multi-agent-router, Task 10.3
// Integration test — certificate generation end-to-end.
//
// Requirements: 10.1, 10.2, 10.3, 10.5 — Design §Testing Strategy → Integration tests
// ("Certificate generation end-to-end: insert donation, assert PDF appears in
//  Supabase Storage and verify URL is reachable.")
//
// What this test exercises
// ------------------------
// The donation-certificate pipeline spans two route handlers:
//   1. POST /api/blood/generate-certificate  — loads donation_history + donor,
//      renders the certificate, uploads it to Supabase Storage, and returns a
//      signed URL (7-day expiry) + public verify URL.
//   2. GET  /api/blood/verify/[id]           — public, unauthenticated lookup
//      that returns the minimal public payload a QR scanner lands on.
//
// Because the heavy/external dependency here is Supabase (Auth + Storage + DB),
// we mock `@supabase/supabase-js` entirely: the chainable query builder serves
// the donor / donation / verify lookups, and `supabase.storage.from(...)`
// serves `.upload(...)` + `.createSignedUrl(...)`. No live DB or live Storage
// is required. We then assert the ORCHESTRATION end-to-end:
//   - the generator passes the right inputs through to Storage,
//   - a non-empty certificate artifact is uploaded at the documented path with
//     a QR pointing at /verify/<certificate_id>,
//   - a 7-day signed URL is requested and returned,
//   - donation_history is stamped with the certificate_id,
//   - the public verify endpoint returns the expected public payload (and no PII).
//
// IMPLEMENTATION NOTE (intentional, do NOT "fix" the test to the design):
// design.md §Low-Level Design sketches PDF generation via `@react-pdf/renderer`
// / `jsPDF` + the `qrcode` npm package. The COMMITTED route handler instead
// renders an **HTML** certificate (uploaded as `…/<donation_id>.html`,
// contentType `text/html`) and embeds the QR as an external image URL
// (api.qrserver.com). Per the task instructions we assert what the
// implementation actually does, not the design sketch. Neither
// `@react-pdf/renderer` nor `qrcode` is a project dependency, so there is no
// hard external dep to skip around.
//
// This test only CREATES tests/integration/certificate.test.ts — it never
// modifies vitest.config.ts, the route handlers, or any other test file.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Supabase mock — hoisted so the vi.mock factory can close over it.
//
// The single shared `client` is returned by every `createClient(...)` call.
// (The verify route creates its client at module-load time; the generate route
// creates one per request — both resolve to this same stub.)
//
// `from(table)` returns a fresh chainable builder per call. Results are routed
// by (table, operation) so the three distinct donation_history queries don't
// collide:
//   - blood_donors        .select().eq().single()            → donor
//   - donation_history     .select(<no join>).eq().eq().single() → donation (generate)
//   - donation_history     .select(<blood_donors!inner>).eq().single() → verifyDonation
//   - donation_history     .update().eq()  (awaited directly) → updateResult
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown };

  const state = {
    donor: { data: null as unknown, error: null as unknown } as Result,
    donation: { data: null as unknown, error: null as unknown } as Result,
    verifyDonation: { data: null as unknown, error: null as unknown } as Result,
    upload: { data: { path: '' } as unknown, error: null as unknown } as Result,
    signedUrl: { data: { signedUrl: '' } as unknown, error: null as unknown } as Result,
    updateResult: { data: null as unknown, error: null as unknown } as Result,
    calls: {
      from: [] as string[],
      storageBuckets: [] as string[],
      uploads: [] as { path: string; opts: unknown; buffer: Buffer }[],
      signedUrls: [] as { path: string; expiresIn: number }[],
      updates: [] as Record<string, unknown>[],
      updateFilters: [] as [string, unknown][],
    },
  };

  const makeBuilder = (table: string) => {
    let selectStr = '';
    let isUpdate = false;

    const b: Record<string, unknown> = {};

    b.select = (sel: string) => {
      selectStr = typeof sel === 'string' ? sel : '';
      return b;
    };
    b.update = (data: Record<string, unknown>) => {
      isUpdate = true;
      state.calls.updates.push(data);
      return b;
    };
    b.eq = (col: string, val: unknown) => {
      if (isUpdate) state.calls.updateFilters.push([col, val]);
      return b;
    };
    b.single = () => {
      if (table === 'blood_donors') return Promise.resolve(state.donor);
      if (table === 'donation_history') {
        // The verify route's select joins blood_donors; the generate route's
        // donation lookup does not. Use that to disambiguate.
        if (selectStr.includes('blood_donors')) return Promise.resolve(state.verifyDonation);
        return Promise.resolve(state.donation);
      }
      return Promise.resolve({ data: null, error: null });
    };
    // Thenable: the generate route awaits the update().eq() chain directly.
    b.then = (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(state.updateResult).then(resolve, reject);

    return b;
  };

  const storage = {
    from: (bucket: string) => {
      state.calls.storageBuckets.push(bucket);
      return {
        upload: (path: string, buffer: Buffer, opts: unknown) => {
          state.calls.uploads.push({ path, opts, buffer });
          return Promise.resolve(state.upload);
        },
        createSignedUrl: (path: string, expiresIn: number) => {
          state.calls.signedUrls.push({ path, expiresIn });
          return Promise.resolve(state.signedUrl);
        },
      };
    },
  };

  const client = {
    from: (table: string) => {
      state.calls.from.push(table);
      return makeBuilder(table);
    },
    storage,
  };

  return { state, client };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => h.client),
}));

// Route handlers under test (imported AFTER the mock is registered).
import { POST as generateCertificate } from '../../src/app/api/blood/generate-certificate/route';
import { GET as verifyCertificate } from '../../src/app/api/blood/verify/[id]/route';

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------
const N8N_SECRET = 'test-n8n-secret';
const APP_URL = 'https://wb-grievance-portal.vercel.app';

const DONOR_ID = '11111111-1111-1111-1111-111111111111';
const DONATION_ID = '22222222-2222-2222-2222-222222222222';

const DONOR_ROW = {
  id: DONOR_ID,
  name: 'Rahul Sharma',
  blood_group: 'O+',
  phone: '+919876543210',
};

const DONATION_ROW = {
  id: DONATION_ID,
  donated_date: '2026-02-01',
  donation_type: 'whole_blood',
  units: 1,
  hospital: 'SSKM Hospital, Kolkata',
};

/** Build a NextRequest-ish Request for the generate-certificate POST. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function genReq(body: unknown, headers: Record<string, string> = {}): any {
  return new Request('http://localhost:3000/api/blood/generate-certificate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Build a NextRequest-ish Request + the route's `{ params }` for verify GET. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function verifyCall(id: string): [any, { params: Promise<{ id: string }> }] {
  const req = new Request(`http://localhost:3000/api/blood/verify/${id}`, { method: 'GET' });
  return [req, { params: Promise.resolve({ id }) }];
}

beforeEach(() => {
  // Reset mock state between tests.
  h.state.donor = { data: null, error: null };
  h.state.donation = { data: null, error: null };
  h.state.verifyDonation = { data: null, error: null };
  h.state.upload = { data: { path: '' }, error: null };
  h.state.signedUrl = { data: { signedUrl: '' }, error: null };
  h.state.updateResult = { data: null, error: null };
  h.state.calls = {
    from: [],
    storageBuckets: [],
    uploads: [],
    signedUrls: [],
    updates: [],
    updateFilters: [],
  };

  process.env.N8N_WEBHOOK_SECRET = N8N_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
});

// ===========================================================================
// End-to-end pipeline (the core of Task 10.3)
// Req 10.1 (job produces a certificate), 10.2 (artifact + QR → verify URL),
// 10.3 (uploaded to Supabase Storage at certificates/<donor>/<donation>),
// 10.5 (public verify URL returns the donation's public payload).
// ===========================================================================
describe('certificate generation end-to-end (generate → Storage → verify)', () => {
  it('generates the certificate, uploads to Storage, signs a 7-day URL, then the public verify URL resolves', async () => {
    // ── seed the DB lookups the generator performs ──
    h.state.donor = { data: DONOR_ROW, error: null };
    h.state.donation = { data: DONATION_ROW, error: null };
    const signedUrl =
      'https://supabase.example.co/storage/v1/object/sign/certificates/' +
      `${DONOR_ID}/${DONATION_ID}.html?token=abc.def.ghi`;
    h.state.signedUrl = { data: { signedUrl }, error: null };

    // ── 1. generate ──
    const genRes = await generateCertificate(
      genReq({ donor_id: DONOR_ID, donation_id: DONATION_ID }, { 'x-n8n-secret': N8N_SECRET })
    );
    const genJson = await genRes.json();

    expect(genRes.status).toBe(200);
    expect(genJson.ok).toBe(true);

    const { certificate_id, certificate_url, verify_url } = genJson.data;
    expect(typeof certificate_id).toBe('string');
    expect(certificate_id.length).toBeGreaterThan(0);

    // signed URL is returned verbatim from Storage (7-day expiry handled below)
    expect(certificate_url).toBe(signedUrl);

    // public verify URL points at /verify/<certificate_id> on the app origin
    expect(verify_url).toBe(`${APP_URL}/verify/${certificate_id}`);

    // ── 2. the artifact actually landed in Supabase Storage ──
    expect(h.state.calls.storageBuckets).toContain('certificates');
    expect(h.state.calls.uploads).toHaveLength(1);

    const upload = h.state.calls.uploads[0];
    // Documented Storage path: certificates/<donor_id>/<donation_id>.<ext>
    // (the committed handler uploads HTML, so the ext is .html — Req 10.3).
    expect(upload.path).toBe(`certificates/${DONOR_ID}/${DONATION_ID}.html`);
    expect((upload.opts as { upsert?: boolean }).upsert).toBe(true);
    expect((upload.opts as { contentType?: string }).contentType).toBe('text/html');

    // a non-empty artifact was produced containing the donor + donation facts
    expect(upload.buffer.length).toBeGreaterThan(0);
    const artifact = upload.buffer.toString('utf-8');
    expect(artifact).toContain(DONOR_ROW.name);
    expect(artifact).toContain(DONOR_ROW.blood_group);
    expect(artifact).toContain(DONATION_ROW.hospital);
    expect(artifact).toContain(certificate_id);

    // Req 10.2: the certificate carries a QR that links to the public verify URL.
    expect(artifact).toContain(encodeURIComponent(verify_url));

    // ── 3. a 7-day (604800s) signed URL was requested for the uploaded object ──
    expect(h.state.calls.signedUrls).toHaveLength(1);
    expect(h.state.calls.signedUrls[0].path).toBe(`certificates/${DONOR_ID}/${DONATION_ID}.html`);
    expect(h.state.calls.signedUrls[0].expiresIn).toBe(604800);

    // ── 4. donation_history is stamped with the new certificate_id ──
    expect(h.state.calls.updates).toContainEqual({ certificate_id });
    expect(h.state.calls.updateFilters).toContainEqual(['id', DONATION_ID]);

    // ── 5. public verification (Req 10.5) ──
    // The QR/verify page hits GET /api/blood/verify/[id]. The committed verify
    // handler looks the donation up by its donation_history.id, so that is what
    // the QR scan resolves against; assert it returns the minimal public payload.
    h.state.verifyDonation = {
      data: {
        ...DONATION_ROW,
        created_at: '2026-02-01T10:00:00.000Z',
        blood_donors: { name: DONOR_ROW.name, blood_group: DONOR_ROW.blood_group },
      },
      error: null,
    };

    const verRes = await verifyCertificate(...verifyCall(DONATION_ID));
    const verJson = await verRes.json();

    expect(verRes.status).toBe(200);
    expect(verJson.ok).toBe(true);
    expect(verJson.verified).toBe(true);
    expect(verJson.data).toMatchObject({
      certificate_id: DONATION_ID,
      donor_name: DONOR_ROW.name,
      blood_group: DONOR_ROW.blood_group,
      donated_date: DONATION_ROW.donated_date,
      hospital: DONATION_ROW.hospital,
    });

    // No PII leaks through the public endpoint.
    const publicBlob = JSON.stringify(verJson);
    expect(publicBlob).not.toContain(DONOR_ROW.phone);
  });
});

// ===========================================================================
// generate-certificate — auth, validation, and failure envelopes
// ===========================================================================
describe('POST /api/blood/generate-certificate', () => {
  const body = { donor_id: DONOR_ID, donation_id: DONATION_ID };

  it('returns 401 when the X-N8N-SECRET header is missing', async () => {
    const res = await generateCertificate(genReq(body));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
  });

  it('returns 401 when the X-N8N-SECRET header is wrong', async () => {
    const res = await generateCertificate(genReq(body, { 'x-n8n-secret': 'nope' }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
  });

  it('returns 400 when donor_id is missing', async () => {
    const res = await generateCertificate(
      genReq({ donation_id: DONATION_ID }, { 'x-n8n-secret': N8N_SECRET })
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/donor_id/i);
  });

  it('returns 400 when donation_id is missing', async () => {
    const res = await generateCertificate(
      genReq({ donor_id: DONOR_ID }, { 'x-n8n-secret': N8N_SECRET })
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/donation_id/i);
  });

  it('returns 404 CERT_GEN_FAILED when the donor is not found', async () => {
    h.state.donor = { data: null, error: { message: 'no rows' } };
    const res = await generateCertificate(genReq(body, { 'x-n8n-secret': N8N_SECRET }));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('CERT_GEN_FAILED');
  });

  it('returns 404 CERT_GEN_FAILED when the donation record is not found', async () => {
    h.state.donor = { data: DONOR_ROW, error: null };
    h.state.donation = { data: null, error: { message: 'no rows' } };
    const res = await generateCertificate(genReq(body, { 'x-n8n-secret': N8N_SECRET }));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('CERT_GEN_FAILED');
  });

  it('returns 500 CERT_GEN_FAILED when the Storage upload fails', async () => {
    h.state.donor = { data: DONOR_ROW, error: null };
    h.state.donation = { data: DONATION_ROW, error: null };
    h.state.upload = { data: null, error: { message: 'storage down' } };
    const res = await generateCertificate(genReq(body, { 'x-n8n-secret': N8N_SECRET }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('CERT_GEN_FAILED');
  });

  it('returns 500 CERT_GEN_FAILED when the signed URL cannot be created', async () => {
    h.state.donor = { data: DONOR_ROW, error: null };
    h.state.donation = { data: DONATION_ROW, error: null };
    h.state.upload = { data: { path: 'ok' }, error: null };
    h.state.signedUrl = { data: null, error: { message: 'sign failed' } };
    const res = await generateCertificate(genReq(body, { 'x-n8n-secret': N8N_SECRET }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('CERT_GEN_FAILED');
  });
});

// ===========================================================================
// verify/[id] — public endpoint, validation + not-found (Req 10.5)
// ===========================================================================
describe('GET /api/blood/verify/[id]', () => {
  it('returns 400 when the id param is empty', async () => {
    const res = await verifyCertificate(...verifyCall('   '));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.verified).toBe(false);
  });

  it('returns 404 when the certificate does not exist', async () => {
    h.state.verifyDonation = { data: null, error: { message: 'no rows' } };
    const res = await verifyCertificate(...verifyCall(DONATION_ID));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.ok).toBe(false);
    expect(json.verified).toBe(false);
  });

  it('returns the minimal public payload for a valid certificate', async () => {
    h.state.verifyDonation = {
      data: {
        ...DONATION_ROW,
        created_at: '2026-02-01T10:00:00.000Z',
        blood_donors: { name: DONOR_ROW.name, blood_group: DONOR_ROW.blood_group },
      },
      error: null,
    };
    const res = await verifyCertificate(...verifyCall(DONATION_ID));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.verified).toBe(true);
    expect(json.data.donor_name).toBe(DONOR_ROW.name);
    expect(json.data.blood_group).toBe(DONOR_ROW.blood_group);
    expect(json.data.donated_date).toBe(DONATION_ROW.donated_date);
    expect(json.data.hospital).toBe(DONATION_ROW.hospital);
    expect(typeof json.data.verified_at).toBe('string');
  });
});
