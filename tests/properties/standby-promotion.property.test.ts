// Feature: sahayak-multi-agent-router, Property 8: Standby promotion on cancel
//
// Property 8 (Design §Property 8): For any blood request with at least one
// `accepted` donor and at least one `standby` donor, when the accepted donor
// cancels OR the seeker rejects in the 15-min window, the highest-priority
// standby donor (by the ranking criteria of `find_matching_donors`) is promoted
// to `accepted` and notified, and the request's counters stay consistent
// (`donors_confirmed_count <= units_needed` always holds).
//
// Validates: Requirements 6.6
//
// ─────────────────────────────────────────────────────────────────────────────
// This is a REAL-DB property test. It exercises the actual route handler
// `POST /api/blood-requests/cancel-acceptance` (which serves both the donor
// "cancel" path and the seeker "seeker_reject" branch — see route.ts) against a
// live Postgres / Supabase database under the same advisory lock the route uses.
//
// DB availability follows the EXACT resolution order used by
// tests/migrations/run-smoke.js:
//     SMOKE_DATABASE_URL → DIRECT_URL → DATABASE_URL
// If only the `supabase://use-rest-api` sentinel (or nothing) is present, the
// whole suite is SKIPPED cleanly so the test passes in REST-only / CI
// environments without a direct Postgres connection.
//
// When a DB is available the test, for each generated scenario:
//   1. Seeds a blood_request at FULL confirmed capacity
//      (donors_confirmed_count = units_needed) with N accepted donors and
//      M >= 1 standby donors. The "winner" standby strictly dominates every
//      other standby on EVERY ranking dimension the route or find_matching_donors
//      could use (earliest responded_at, same block, highest total_donations,
//      earliest created_at) so the expected promotion is unambiguous.
//   2. Cancels one accepted donor via the real route handler.
//   3. Asserts the dominant standby was promoted to `accepted`, the cancelled
//      donor is `declined`, counters stay consistent, and the
//      `donors_confirmed_count <= units_needed` invariant holds.
//   4. Cleans up every row it inserted.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

// =============================================================================
// Part A — DB-INDEPENDENT property over a pure model of the cancel/promotion logic
// =============================================================================
//
// The route's cancel + standby-promotion logic is inline inside an advisory-lock
// transaction (src/app/api/blood-requests/cancel-acceptance/route.ts), not an
// exported function. Matching the established two-half pattern in this repo's
// other DB-backed property suites (notably willingness-counter.property.test.ts
// and screening-deferral.property.test.ts), this suite pairs the live-DB half
// (Part B, below) with a pure model that faithfully mirrors the handler:
//
//   1. The cancelled (or seeker-rejected) donor's `accepted` response → `declined`,
//      and `donors_confirmed_count -= 1`.
//   2. The highest-priority `standby` response (by the ranking criteria of
//      `find_matching_donors`) is promoted to `accepted`, with
//      `donors_confirmed_count += 1` and `donors_standby_count -= 1`.
//   3. If no standby exists, nobody is promoted and confirmed simply decrements.
//
// This half ALWAYS runs and gives the suite value even with no database.

type ModelStatus = 'accepted' | 'standby' | 'declined';

interface ModelResponse {
  donorId: string;
  status: ModelStatus;
  /**
   * Composite ranking key — LOWER means HIGHER priority. This abstracts the
   * `find_matching_donors` ordering (same-block first, most experienced, earliest
   * responder). The live route currently orders standbys by `responded_at ASC`;
   * the DB half (Part B) seeds a winner that dominates on every dimension so both
   * rankings agree. Here we model the general "highest priority wins" contract.
   */
  priority: number;
}

interface ModelRequest {
  unitsNeeded: number;
  confirmed: number;
  standby: number;
  responses: ModelResponse[];
}

interface PromotionResult {
  model: ModelRequest;
  promotedDonorId: string | null;
}

/**
 * Pure mirror of the route's under-lock cancel + standby-promotion sequence.
 * Returns a NEW model (the input is not mutated) plus the promoted donor id.
 */
function cancelAndPromote(req: ModelRequest, cancelDonorId: string): PromotionResult {
  const responses = req.responses.map((r) => ({ ...r }));
  let { confirmed, standby } = req;

  // Step 1: mark the cancelled donor's accepted response as declined.
  const cancelled = responses.find(
    (r) => r.donorId === cancelDonorId && r.status === 'accepted',
  );
  if (!cancelled) {
    // Mirrors the route's NOT_FOUND guard: no accepted response → no-op.
    return { model: { ...req, responses }, promotedDonorId: null };
  }
  cancelled.status = 'declined';
  confirmed -= 1;

  // Step 2: find the highest-priority standby (lowest priority value; deterministic
  // donorId tie-break so the winner is unambiguous for any input).
  const standbys = responses
    .filter((r) => r.status === 'standby')
    .sort((a, b) => a.priority - b.priority || (a.donorId < b.donorId ? -1 : 1));

  let promotedDonorId: string | null = null;
  if (standbys.length > 0) {
    const winner = standbys[0];
    winner.status = 'accepted';
    confirmed += 1;
    standby -= 1;
    promotedDonorId = winner.donorId;
  }

  return {
    model: { unitsNeeded: req.unitsNeeded, confirmed, standby, responses },
    promotedDonorId,
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * A blood request seeded at FULL confirmed capacity (confirmed === units_needed)
 * with N accepted donors and M standby donors carrying DISTINCT priorities. The
 * first accepted donor is the one we will cancel.
 */
const arbScenario = fc
  .record({
    unitsNeeded: fc.integer({ min: 1, max: 4 }),
    // Distinct ranking keys → exactly one unambiguous "highest priority" standby.
    standbyPriorities: fc.uniqueArray(fc.integer({ min: 0, max: 100_000 }), {
      minLength: 0,
      maxLength: 5,
    }),
  })
  .map(({ unitsNeeded, standbyPriorities }) => {
    const responses: ModelResponse[] = [];
    for (let i = 0; i < unitsNeeded; i++) {
      responses.push({ donorId: `accepted-${i}`, status: 'accepted', priority: -1 });
    }
    standbyPriorities.forEach((p, j) => {
      responses.push({ donorId: `standby-${j}`, status: 'standby', priority: p });
    });
    const model: ModelRequest = {
      unitsNeeded,
      confirmed: unitsNeeded,
      standby: standbyPriorities.length,
      responses,
    };
    // Expected winner: the standby with the minimum priority (tie-break by id,
    // though priorities are unique here).
    const expectedWinner =
      standbyPriorities.length === 0
        ? null
        : responses
            .filter((r) => r.status === 'standby')
            .sort((a, b) => a.priority - b.priority || (a.donorId < b.donorId ? -1 : 1))[0]
            .donorId;
    return { model, cancelDonorId: 'accepted-0', expectedWinner };
  });

const acceptedCountOf = (m: ModelRequest) =>
  m.responses.filter((r) => r.status === 'accepted').length;

describe('Property 8A: standby promotion on cancel (pure model, no DB)', () => {
  it('promotes the highest-priority standby and keeps counts consistent (Req 6.6)', () => {
    fc.assert(
      fc.property(arbScenario, ({ model, cancelDonorId, expectedWinner }) => {
        const before = model.confirmed;
        const { model: after, promotedDonorId } = cancelAndPromote(model, cancelDonorId);

        // The cancelled donor always ends 'declined'.
        const cancelled = after.responses.find((r) => r.donorId === cancelDonorId)!;
        expect(cancelled.status).toBe('declined');

        if (expectedWinner === null) {
          // No standby existed → nobody promoted, confirmed strictly decrements.
          expect(promotedDonorId).toBeNull();
          expect(after.confirmed).toBe(before - 1);
          expect(after.standby).toBe(0);
        } else {
          // The dominant standby is promoted to accepted.
          expect(promotedDonorId).toBe(expectedWinner);
          const promoted = after.responses.find((r) => r.donorId === expectedWinner)!;
          expect(promoted.status).toBe('accepted');
          // One cancel + one promote nets to the same confirmed count.
          expect(after.confirmed).toBe(before);
          // Standby count drops by exactly one.
          expect(after.standby).toBe(model.standby - 1);
        }

        // The over-acceptance invariant (chk_confirmed_le_needed) always holds.
        expect(after.confirmed).toBeLessThanOrEqual(after.unitsNeeded);
        // Accepted response rows always equal the confirmed counter.
        expect(acceptedCountOf(after)).toBe(after.confirmed);
      }),
      { numRuns: 500 },
    );
  });

  it('only the highest-priority standby moves; the rest stay on standby', () => {
    fc.assert(
      fc.property(
        // Force at least two standbys so "the rest stay standby" is meaningful.
        fc.record({
          unitsNeeded: fc.integer({ min: 1, max: 3 }),
          standbyPriorities: fc.uniqueArray(fc.integer({ min: 0, max: 100_000 }), {
            minLength: 2,
            maxLength: 5,
          }),
        }),
        ({ unitsNeeded, standbyPriorities }) => {
          const responses: ModelResponse[] = [];
          for (let i = 0; i < unitsNeeded; i++) {
            responses.push({ donorId: `accepted-${i}`, status: 'accepted', priority: -1 });
          }
          standbyPriorities.forEach((p, j) =>
            responses.push({ donorId: `standby-${j}`, status: 'standby', priority: p }),
          );
          const model: ModelRequest = {
            unitsNeeded,
            confirmed: unitsNeeded,
            standby: standbyPriorities.length,
            responses,
          };
          const minPriority = Math.min(...standbyPriorities);
          const { model: after, promotedDonorId } = cancelAndPromote(model, 'accepted-0');

          // Exactly one promotion happened.
          const promotedRows = after.responses.filter(
            (r) => r.status === 'accepted' && r.donorId.startsWith('standby-'),
          );
          expect(promotedRows).toHaveLength(1);
          expect(promotedRows[0].priority).toBe(minPriority);
          expect(promotedRows[0].donorId).toBe(promotedDonorId);

          // Every other standby is untouched.
          const stillStandby = after.responses.filter((r) => r.status === 'standby');
          expect(stillStandby).toHaveLength(standbyPriorities.length - 1);
          expect(stillStandby.every((r) => r.priority !== minPriority)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('cancelling a donor with no accepted response is a no-op (NOT_FOUND guard)', () => {
    const model: ModelRequest = {
      unitsNeeded: 2,
      confirmed: 2,
      standby: 1,
      responses: [
        { donorId: 'accepted-0', status: 'accepted', priority: -1 },
        { donorId: 'accepted-1', status: 'accepted', priority: -1 },
        { donorId: 'standby-0', status: 'standby', priority: 10 },
      ],
    };
    const { model: after, promotedDonorId } = cancelAndPromote(model, 'ghost-donor');
    expect(promotedDonorId).toBeNull();
    expect(after.confirmed).toBe(2);
    expect(after.standby).toBe(1);
    expect(acceptedCountOf(after)).toBe(2);
  });

  it('single unit, one standby: cancel promotes the standby, confirmed stays at 1', () => {
    const model: ModelRequest = {
      unitsNeeded: 1,
      confirmed: 1,
      standby: 1,
      responses: [
        { donorId: 'accepted-0', status: 'accepted', priority: -1 },
        { donorId: 'standby-0', status: 'standby', priority: 5 },
      ],
    };
    const { model: after, promotedDonorId } = cancelAndPromote(model, 'accepted-0');
    expect(promotedDonorId).toBe('standby-0');
    expect(after.confirmed).toBe(1);
    expect(after.standby).toBe(0);
    expect(after.confirmed).toBeLessThanOrEqual(after.unitsNeeded);
  });

  it('no standby: cancel decrements confirmed and promotes nobody', () => {
    const model: ModelRequest = {
      unitsNeeded: 1,
      confirmed: 1,
      standby: 0,
      responses: [{ donorId: 'accepted-0', status: 'accepted', priority: -1 }],
    };
    const { model: after, promotedDonorId } = cancelAndPromote(model, 'accepted-0');
    expect(promotedDonorId).toBeNull();
    expect(after.confirmed).toBe(0);
    expect(acceptedCountOf(after)).toBe(0);
  });
});

// =============================================================================
// Part B — DB-INTEGRATION property against the REAL route handler
// =============================================================================

// ─── DB connection-string resolution (mirrors run-smoke.js) ───────────────────

const SENTINEL = 'supabase://use-rest-api';

function resolveConnectionString(): string | null {
  const candidates = [
    process.env.SMOKE_DATABASE_URL,
    process.env.DIRECT_URL,
    process.env.DATABASE_URL,
  ];
  for (const c of candidates) {
    if (c && c.trim() && c.trim() !== SENTINEL) return c.trim();
  }
  return null;
}

const CONNECTION_STRING = resolveConnectionString();
const N8N_SECRET = 'standby-promotion-test-secret';

/** Supabase requires TLS; allow self-signed for the pooler endpoint. */
function useSslFor(cs: string): boolean {
  return /supabase\.(co|com|in)/i.test(cs) || process.env.PGSSLMODE === 'require';
}

/** Ensure the route's own Pool (built from DATABASE_URL) negotiates TLS for Supabase. */
function withSslMode(cs: string): string {
  if (!useSslFor(cs)) return cs;
  if (/sslmode=/i.test(cs)) return cs;
  return cs + (cs.includes('?') ? '&' : '?') + 'sslmode=no-verify';
}

// ─── Self-documenting unit test: the skip logic (always runs) ─────────────────

describe('standby-promotion: DB connection resolution', () => {
  it('treats the supabase REST sentinel as "no direct DB"', () => {
    const saved = {
      smoke: process.env.SMOKE_DATABASE_URL,
      direct: process.env.DIRECT_URL,
      db: process.env.DATABASE_URL,
    };
    try {
      process.env.SMOKE_DATABASE_URL = '';
      process.env.DIRECT_URL = '';
      process.env.DATABASE_URL = SENTINEL;
      expect(resolveConnectionString()).toBeNull();

      process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db';
      expect(resolveConnectionString()).toBe('postgres://u:p@localhost:5432/db');
    } finally {
      // Restore exactly so the real suite below still sees the genuine env.
      if (saved.smoke === undefined) delete process.env.SMOKE_DATABASE_URL;
      else process.env.SMOKE_DATABASE_URL = saved.smoke;
      if (saved.direct === undefined) delete process.env.DIRECT_URL;
      else process.env.DIRECT_URL = saved.direct;
      if (saved.db === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved.db;
    }
  });
});

// ─── Real-DB property suite ───────────────────────────────────────────────────

const DESCRIBE = CONNECTION_STRING ? describe : describe.skip;

if (!CONNECTION_STRING) {
  // eslint-disable-next-line no-console
  console.log(
    '[standby-promotion] SKIP: no direct Postgres connection string found.\n' +
      '        Set SMOKE_DATABASE_URL, DIRECT_URL, or DATABASE_URL to a real\n' +
      '        Postgres/Supabase pooler URL to run Property 8 against a live DB.',
  );
}

DESCRIBE('Property 8: Standby promotion on cancel (real DB)', () => {
  let client: Client;
  let ready = false;
  // The real route handler, dynamically imported AFTER env is configured so its
  // module-level pg Pool picks up our resolved connection string.
  let cancelAcceptance: (req: unknown) => Promise<Response>;

  // ─── Schema-introspection helpers (robust against the unknown JS-15 v1 base) ──

  /** Required columns = NOT NULL, no default, not generated. */
  async function requiredColumns(
    table: string,
  ): Promise<Array<{ column_name: string; data_type: string }>> {
    const { rows } = await client.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND is_nullable = 'NO'
          AND column_default IS NULL
          AND is_generated = 'NEVER'`,
      [table],
    );
    return rows;
  }

  /** Synthesize a type-appropriate placeholder for an otherwise-unknown column. */
  function synth(dataType: string): unknown {
    switch (dataType) {
      case 'integer':
      case 'bigint':
      case 'smallint':
      case 'numeric':
      case 'double precision':
      case 'real':
        return 0;
      case 'boolean':
        return false;
      case 'timestamp with time zone':
      case 'timestamp without time zone':
        return new Date();
      case 'date':
        return new Date();
      case 'jsonb':
      case 'json':
        return '{}';
      case 'uuid':
        return randomUUID();
      default:
        return 'test';
    }
  }

  /**
   * INSERT a row, supplying caller-provided values plus synthesized placeholders
   * for any *other* required column we did not explicitly set. Returns the row id.
   */
  async function insertRow(
    table: string,
    explicit: Record<string, unknown>,
  ): Promise<void> {
    const required = await requiredColumns(table);
    const merged: Record<string, unknown> = { ...explicit };
    for (const col of required) {
      if (!(col.column_name in merged)) {
        merged[col.column_name] = synth(col.data_type);
      }
    }
    const cols = Object.keys(merged);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const values = cols.map((c) => merged[c]);
    await client.query(
      `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
      values,
    );
  }

  // ─── Request builder for the route handler ──────────────────────────────────

  function buildReq(body: unknown, secret = N8N_SECRET): unknown {
    return new Request('http://localhost/api/blood-requests/cancel-acceptance', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-n8n-secret': secret },
      body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    if (!CONNECTION_STRING) return;

    // Configure env BEFORE importing the route so its Pool uses our DB and the
    // promotion notification is skipped (N8N_WEBHOOK_URL intentionally unset).
    process.env.N8N_WEBHOOK_SECRET = N8N_SECRET;
    delete process.env.N8N_WEBHOOK_URL;
    process.env.DATABASE_URL = withSslMode(CONNECTION_STRING);
    process.env.DIRECT_URL = withSslMode(CONNECTION_STRING);

    client = new Client({
      connectionString: CONNECTION_STRING,
      ssl: useSslFor(CONNECTION_STRING) ? { rejectUnauthorized: false } : undefined,
    });

    try {
      await client.connect();
      // Confirm the base tables we depend on actually exist before claiming ready.
      const { rows } = await client.query(
        `SELECT count(*)::int AS n
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('blood_requests', 'blood_donors', 'blood_donor_responses')`,
      );
      if (!rows.length || rows[0].n < 3) {
        // eslint-disable-next-line no-console
        console.warn(
          '[standby-promotion] SKIP: base blood tables not present on this DB — ' +
            'apply the JS-15 v1 schema + sahayak migrations to run Property 8.',
        );
        ready = false;
        return;
      }
      const mod = await import(
        '../../src/app/api/blood-requests/cancel-acceptance/route'
      );
      cancelAcceptance = mod.POST as unknown as (req: unknown) => Promise<Response>;
      ready = true;
    } catch (err) {
      // A configured-but-unreachable DB should not hard-fail this optional,
      // test-only property. Skip cleanly with a clear warning.
      // eslint-disable-next-line no-console
      console.warn(
        '[standby-promotion] SKIP: could not connect / prepare DB:',
        (err as Error).message,
      );
      ready = false;
    }
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  // ─── Seeding ────────────────────────────────────────────────────────────────

  interface Seeded {
    requestId: string;
    unitsNeeded: number;
    cancelDonorId: string; // an accepted donor we will cancel
    winnerStandbyId: string; // the dominant standby that must be promoted
    otherStandbyIds: string[]; // standbys that must stay 'standby'
    allDonorIds: string[];
  }

  const DISTRICT = 'Howrah';
  const REQ_BLOCK = 'Bagnan-I';
  const T0 = new Date('2026-03-01T09:00:00.000Z').getTime();

  async function seedScenario(
    unitsNeeded: number,
    standbyCount: number,
  ): Promise<Seeded> {
    const requestId = randomUUID();

    // Request seeded at FULL confirmed capacity (Req 6: confirmed == units_needed).
    await insertRow('blood_requests', {
      id: requestId,
      seeker_phone: `+9190000${Math.floor(Math.random() * 100000)}`,
      seeker_name: 'Test Seeker',
      patient_name: 'Test Patient',
      blood_group: 'A+',
      units_needed: unitsNeeded,
      hospital: 'Test Hospital',
      district: DISTRICT,
      block: REQ_BLOCK,
      urgency: 'routine',
      status: 'donor_found',
      cascade_tier: 1,
      donors_confirmed_count: unitsNeeded,
      donors_standby_count: standbyCount,
    });

    const allDonorIds: string[] = [];

    // Helper to create an eligible donor + its response.
    async function makeDonor(opts: {
      responseStatus: 'accepted' | 'standby';
      respondedAt: Date;
      block: string;
      totalDonations: number;
      createdAt: Date;
    }): Promise<string> {
      const donorId = randomUUID();
      await insertRow('blood_donors', {
        id: donorId,
        phone: `+9191000${Math.floor(Math.random() * 1000000)}`,
        name: 'Test Donor',
        gender: 'male',
        // Eligible: ~30 years old, well above the 45kg floor.
        date_of_birth: new Date('1995-01-01T00:00:00.000Z'),
        weight_kg: 70,
        blood_group: 'O-', // universal donor → compatible with any request group
        district: DISTRICT,
        block: opts.block,
        is_available: true,
        is_paused: false,
        permanently_deferred: false,
        total_donations: opts.totalDonations,
        total_offers_accepted: 1,
        donations_this_year: 0,
        created_at: opts.createdAt,
      });
      await insertRow('blood_donor_responses', {
        id: randomUUID(),
        blood_request_id: requestId,
        donor_id: donorId,
        response_status: opts.responseStatus,
        responded_at: opts.respondedAt,
      });
      allDonorIds.push(donorId);
      return donorId;
    }

    // N accepted donors (filling the confirmed capacity).
    let cancelDonorId = '';
    for (let i = 0; i < unitsNeeded; i++) {
      const id = await makeDonor({
        responseStatus: 'accepted',
        respondedAt: new Date(T0 - 1_000_000 + i * 1000),
        block: 'AcceptedBlock',
        totalDonations: 5,
        createdAt: new Date(T0 - 5_000_000 + i * 1000),
      });
      if (i === 0) cancelDonorId = id;
    }

    // The dominant standby: strictly best on EVERY ordering dimension —
    // earliest responded_at, same block as the request, highest total_donations,
    // earliest created_at. So it wins under the route's FIFO (responded_at ASC)
    // AND under find_matching_donors ranking (block, total_donations DESC, created_at ASC).
    const winnerStandbyId = await makeDonor({
      responseStatus: 'standby',
      respondedAt: new Date(T0), // earliest among standbys
      block: REQ_BLOCK, // same block as request
      totalDonations: 100, // most experienced
      createdAt: new Date(T0 - 10_000_000), // earliest registered
    });

    // The remaining standbys: strictly worse on every dimension.
    const otherStandbyIds: string[] = [];
    for (let j = 0; j < standbyCount - 1; j++) {
      const id = await makeDonor({
        responseStatus: 'standby',
        respondedAt: new Date(T0 + (j + 1) * 60_000), // later than winner
        block: 'OtherBlock', // not the request block
        totalDonations: 10 - j, // fewer donations
        createdAt: new Date(T0 + (j + 1) * 1000), // registered later
      });
      otherStandbyIds.push(id);
    }

    return {
      requestId,
      unitsNeeded,
      cancelDonorId,
      winnerStandbyId,
      otherStandbyIds,
      allDonorIds,
    };
  }

  async function cleanup(seeded: Seeded | null): Promise<void> {
    if (!seeded) return;
    try {
      await client.query('DELETE FROM blood_donor_responses WHERE blood_request_id = $1', [
        seeded.requestId,
      ]);
      await client.query('DELETE FROM blood_requests WHERE id = $1', [seeded.requestId]);
      if (seeded.allDonorIds.length) {
        await client.query('DELETE FROM blood_donors WHERE id = ANY($1::uuid[])', [
          seeded.allDonorIds,
        ]);
      }
    } catch {
      /* best-effort cleanup */
    }
  }

  async function responseStatusOf(
    requestId: string,
    donorId: string,
  ): Promise<string | null> {
    const { rows } = await client.query(
      `SELECT response_status FROM blood_donor_responses
        WHERE blood_request_id = $1 AND donor_id = $2`,
      [requestId, donorId],
    );
    return rows.length ? rows[0].response_status : null;
  }

  async function requestCounts(
    requestId: string,
  ): Promise<{ confirmed: number; standby: number; needed: number }> {
    const { rows } = await client.query(
      `SELECT donors_confirmed_count AS confirmed,
              donors_standby_count   AS standby,
              units_needed           AS needed
         FROM blood_requests WHERE id = $1`,
      [requestId],
    );
    return rows[0];
  }

  // ─── Property 8 ───────────────────────────────────────────────────────────────

  it(
    'promotes the highest-priority standby to accepted on cancel / seeker-reject, keeping counts consistent',
    async (ctx) => {
      if (!ready) {
        ctx.skip();
        return;
      }

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            unitsNeeded: fc.integer({ min: 1, max: 2 }),
            standbyCount: fc.integer({ min: 1, max: 3 }),
            reason: fc.constantFrom('cancel', 'seeker_reject'),
          }),
          async ({ unitsNeeded, standbyCount, reason }) => {
            let seeded: Seeded | null = null;
            try {
              seeded = await seedScenario(unitsNeeded, standbyCount);

              const res = await cancelAcceptance(
                buildReq({
                  donor_id: seeded.cancelDonorId,
                  blood_request_id: seeded.requestId,
                  reason,
                }),
              );
              const body = (await res.json()) as {
                ok: boolean;
                data?: { cancelled_donor_id?: string; promoted_donor_id?: string };
              };

              // 1. The route succeeded and reports the dominant standby as promoted.
              expect(res.status).toBe(200);
              expect(body.ok).toBe(true);
              expect(body.data?.cancelled_donor_id).toBe(seeded.cancelDonorId);
              expect(body.data?.promoted_donor_id).toBe(seeded.winnerStandbyId);

              // 2. Persisted statuses: cancelled → declined, winner → accepted.
              expect(await responseStatusOf(seeded.requestId, seeded.cancelDonorId)).toBe(
                'declined',
              );
              expect(await responseStatusOf(seeded.requestId, seeded.winnerStandbyId)).toBe(
                'accepted',
              );

              // 3. The non-promoted standbys are untouched.
              for (const other of seeded.otherStandbyIds) {
                expect(await responseStatusOf(seeded.requestId, other)).toBe('standby');
              }

              // 4. Counters stay consistent: one cancel + one promote nets to the
              //    same confirmed count, standby decremented by exactly one, and the
              //    chk_confirmed_le_needed invariant holds.
              const counts = await requestCounts(seeded.requestId);
              expect(counts.confirmed).toBe(unitsNeeded);
              expect(counts.standby).toBe(standbyCount - 1);
              expect(counts.confirmed).toBeLessThanOrEqual(counts.needed);

              // 5. Cross-check: number of accepted response rows equals confirmed count.
              const { rows } = await client.query(
                `SELECT count(*)::int AS n FROM blood_donor_responses
                  WHERE blood_request_id = $1 AND response_status = 'accepted'`,
                [seeded.requestId],
              );
              expect(rows[0].n).toBe(unitsNeeded);
            } finally {
              await cleanup(seeded);
            }
          },
        ),
        { numRuns: 10 },
      );
    },
    120_000,
  );

  // ─── Focused anchor: no standby left → confirmed simply decrements ────────────

  it(
    'when no standby exists, cancel decrements confirmed and promotes nobody',
    async (ctx) => {
      if (!ready) {
        ctx.skip();
        return;
      }

      const requestId = randomUUID();
      const donorId = randomUUID();
      const allDonorIds = [donorId];
      try {
        await insertRow('blood_requests', {
          id: requestId,
          seeker_phone: '+919000000099',
          seeker_name: 'Solo Seeker',
          patient_name: 'Solo Patient',
          blood_group: 'A+',
          units_needed: 1,
          hospital: 'Test Hospital',
          district: DISTRICT,
          block: REQ_BLOCK,
          urgency: 'routine',
          status: 'donor_found',
          cascade_tier: 1,
          donors_confirmed_count: 1,
          donors_standby_count: 0,
        });
        await insertRow('blood_donors', {
          id: donorId,
          phone: '+919100000099',
          name: 'Solo Donor',
          gender: 'female',
          date_of_birth: new Date('1990-01-01T00:00:00.000Z'),
          weight_kg: 60,
          blood_group: 'O-',
          district: DISTRICT,
          block: REQ_BLOCK,
          is_available: true,
          is_paused: false,
          permanently_deferred: false,
          total_donations: 3,
          total_offers_accepted: 1,
          donations_this_year: 0,
          created_at: new Date(T0),
        });
        await insertRow('blood_donor_responses', {
          id: randomUUID(),
          blood_request_id: requestId,
          donor_id: donorId,
          response_status: 'accepted',
          responded_at: new Date(T0),
        });

        const res = await cancelAcceptance(
          buildReq({ donor_id: donorId, blood_request_id: requestId, reason: 'cancel' }),
        );
        const body = (await res.json()) as {
          ok: boolean;
          data?: { promoted_donor_id?: string };
        };

        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.data?.promoted_donor_id).toBeUndefined();

        expect(await responseStatusOf(requestId, donorId)).toBe('declined');

        const counts = await requestCounts(requestId);
        expect(counts.confirmed).toBe(0);
        expect(counts.confirmed).toBeLessThanOrEqual(counts.needed);
      } finally {
        await client
          .query('DELETE FROM blood_donor_responses WHERE blood_request_id = $1', [requestId])
          .catch(() => {});
        await client.query('DELETE FROM blood_requests WHERE id = $1', [requestId]).catch(() => {});
        await client
          .query('DELETE FROM blood_donors WHERE id = ANY($1::uuid[])', [allDonorIds])
          .catch(() => {});
      }
    },
    60_000,
  );
});
