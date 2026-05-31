// Feature: sahayak-multi-agent-router, Property 10: Donation trigger atomicity
//
// Property 10 (Design §Property 10):
// For any row inserted into
//   donation_history(donor_id = X, donated_date = Y, donation_type = T, ...)
// after the AFTER-INSERT trigger trg_update_donor_after_donation fires, the
// corresponding blood_donors row for X satisfies ALL of:
//   - last_donated_date  = Y
//   - last_donation_type = T
//   - next_eligible_date = calculate_next_eligible_date(X, T, Y)
//   - total_donations     increased by exactly 1
//   - donations_this_year increased by exactly 1 IFF
//         extract(year from Y) = extract(year from CURRENT_DATE)
//       (otherwise donations_this_year is unchanged)
//
// Validates: Requirements 8.4
//
// HOW THIS TEST EXERCISES THE IMPLEMENTATION
//   The trigger and the cooldown function are pure database objects created by
//   migration 20260101_006_eligibility_function_and_trigger.sql. We exercise
//   them exactly the way the production /api/blood-donors/record-donation path
//   does: seed a blood_donors row, INSERT a single donation_history row, and let
//   the AFTER INSERT trigger update the donor. We then re-read the donor row and
//   assert every field mutation the property requires. The canonical comparison
//   for next_eligible_date is against a direct call to calculate_next_eligible_date
//   (the exact thing the property names), with an independent JS recomputation of
//   the gender/type cooldown as a cross-check.
//
// DB AVAILABILITY
//   This property needs a direct Postgres connection. Following the pattern in
//   the sibling property tests (and tests/migrations/run-smoke.js) we resolve a
//   connection string from SMOKE_DATABASE_URL -> DIRECT_URL -> DATABASE_URL and
//   SKIP the whole suite cleanly when only the 'supabase://use-rest-api' sentinel
//   (or nothing) is present. Seeded rows are removed in afterEach / afterAll.
//
//   NOTE: donation_history is an immutable medical audit log — UPDATE/DELETE are
//   REVOKEd from PUBLIC/anon/authenticated/service_role (ADR-006). Cleanup DELETEs
//   therefore only succeed when the configured connection is the table owner or a
//   superuser (the usual DIRECT_URL/DATABASE_URL migration role). We attempt the
//   deletes but tolerate failures so a restricted role never turns cleanup into a
//   test failure.

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

// ─── Connection-string resolution (mirrors the sibling property tests) ───────

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
const SKIP = CONNECTION_STRING === null;

if (SKIP) {
  // Clear, non-failing SKIP message so pipelines that run entirely over the REST
  // API (no direct Postgres) do not break. The suite below is skipped via skipIf.
  // eslint-disable-next-line no-console
  console.log(
    '[donation-trigger] SKIP: no direct Postgres connection string found.\n' +
      '        Set SMOKE_DATABASE_URL, DIRECT_URL, or DATABASE_URL to a real\n' +
      '        Postgres/Supabase pooler URL to run the donation-trigger property test.',
  );
}

// A marker district used for safety-net cleanup in afterAll.
const SEED_DISTRICT = '__pbt_donation_trigger__';

// ─── Lazily-created pool (only when a DB is configured) ──────────────────────

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const useSsl =
      /supabase\.(co|com|in)/i.test(CONNECTION_STRING ?? '') ||
      process.env.PGSSLMODE === 'require';
    pool = new Pool({
      connectionString: CONNECTION_STRING ?? undefined,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: 8,
    });
  }
  return pool;
}

// ─── Generic, schema-tolerant row seeding ────────────────────────────────────
// blood_donors / donation_history may carry columns beyond what this spec's
// migrations define (depending on the deployed schema). We introspect
// information_schema at runtime and auto-fill any NOT NULL column without a
// default (and that is not identity/generated), on top of the meaningful
// explicit values we provide. This keeps the seed robust across schema variants.

interface ColumnMeta {
  data_type: string;
  is_nullable: string; // 'YES' | 'NO'
  column_default: string | null;
  is_identity: string; // 'YES' | 'NO'
  is_generated: string; // 'ALWAYS' | 'NEVER'
}

async function getColumns(
  client: pg.PoolClient,
  table: string,
): Promise<Map<string, ColumnMeta>> {
  const res = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default, is_identity, is_generated
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  const map = new Map<string, ColumnMeta>();
  for (const r of res.rows) {
    map.set(r.column_name, {
      data_type: r.data_type,
      is_nullable: r.is_nullable,
      column_default: r.column_default,
      is_identity: r.is_identity,
      is_generated: r.is_generated,
    });
  }
  return map;
}

/** Type-appropriate placeholder for a required column we were not given a value for. */
function autoFill(meta: ColumnMeta): { value: unknown; cast?: string } {
  switch (meta.data_type) {
    case 'uuid':
      return { value: randomUUID() };
    case 'integer':
    case 'smallint':
    case 'bigint':
    case 'numeric':
    case 'double precision':
    case 'real':
      return { value: 1 };
    case 'boolean':
      return { value: false };
    case 'date':
      return { value: '2026-01-01' };
    case 'timestamp without time zone':
    case 'timestamp with time zone':
      return { value: new Date().toISOString() };
    case 'json':
      return { value: '{}', cast: 'json' };
    case 'jsonb':
      return { value: '{}', cast: 'jsonb' };
    case 'ARRAY':
      return { value: [] };
    default:
      // text, character varying, character, citext, and anything else stringy.
      return { value: 'pbt_seed' };
  }
}

/**
 * INSERT a row into `table`, filling required columns automatically.
 * `explicit` values are only applied for columns that actually exist on the table.
 * Returns the generated `id`.
 */
async function insertRow(
  client: pg.PoolClient,
  table: string,
  explicit: Record<string, unknown>,
): Promise<string> {
  const cols = await getColumns(client, table);

  const names: string[] = [];
  const placeholders: string[] = [];
  const values: unknown[] = [];

  const add = (name: string, value: unknown, cast?: string) => {
    names.push(`"${name}"`);
    values.push(value);
    placeholders.push(cast ? `$${values.length}::${cast}` : `$${values.length}`);
  };

  // 1. Explicit values (only for columns that exist).
  for (const [k, v] of Object.entries(explicit)) {
    if (cols.has(k)) add(k, v);
  }

  // 2. Auto-fill remaining NOT NULL columns that have no default and are not
  //    identity/generated, and that we have not already provided.
  const provided = new Set(Object.keys(explicit).filter((k) => cols.has(k)));
  for (const [name, meta] of cols) {
    if (provided.has(name)) continue;
    if (
      meta.is_nullable === 'NO' &&
      meta.column_default === null &&
      meta.is_identity === 'NO' &&
      meta.is_generated === 'NEVER'
    ) {
      const { value, cast } = autoFill(meta);
      add(name, value, cast);
    }
  }

  const sql = `INSERT INTO "${table}" (${names.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`;
  const res = await client.query(sql, values);
  return res.rows[0].id as string;
}

// ─── Date helpers (UTC, string-based to dodge node-postgres date parsing) ────

type DonationType = 'whole_blood' | 'platelets' | 'plasma' | 'double_red';
type Gender = 'male' | 'female' | 'other';

/** Subtract `days` from an ISO date string (YYYY-MM-DD), returning a new ISO string. */
function isoDateMinusDays(baseIso: string, days: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return formatIso(dt);
}

/** Add `days` to an ISO date string (YYYY-MM-DD), returning a new ISO string. */
function isoDatePlusDays(baseIso: string, days: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatIso(dt);
}

function formatIso(dt: Date): string {
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Mirror of calculate_next_eligible_date's cooldown table (Req 8.3). */
function cooldownDays(type: DonationType, gender: Gender): number {
  switch (type) {
    case 'whole_blood':
      return gender === 'female' ? 120 : 90; // male and 'other' -> 90 (conservative)
    case 'platelets':
      return 14;
    case 'plasma':
      return 14;
    case 'double_red':
      return 168;
  }
}

// ─── DB reference clock (resolved once so JS and SQL agree on "this year") ───

let dbToday = ''; // CURRENT_DATE as YYYY-MM-DD
let dbYear = 0; // EXTRACT(YEAR FROM CURRENT_DATE)

// ─── Seed / cleanup helpers ──────────────────────────────────────────────────

interface SeededDonor {
  donorId: string;
}

interface SeedSpec {
  gender: Gender;
  initialTotal: number;
  initialThisYear: number;
}

async function seedDonor(spec: SeedSpec): Promise<SeededDonor> {
  const client = await getPool().connect();
  try {
    const donorId = await insertRow(client, 'blood_donors', {
      phone: `+9190001${(Date.now() % 1_000_000).toString().padStart(6, '0')}`.slice(0, 15),
      name: 'PBT Trigger Donor',
      blood_group: 'O+',
      gender: spec.gender,
      district: SEED_DISTRICT,
      block: SEED_DISTRICT,
      is_available: true,
      is_paused: false,
      permanently_deferred: false,
      total_donations: spec.initialTotal,
      donations_this_year: spec.initialThisYear,
      // Pre-seed eligibility fields with sentinel values so we can prove the
      // trigger overwrites them rather than leaving them untouched.
      last_donated_date: null,
      last_donation_type: null,
      next_eligible_date: null,
    });
    return { donorId };
  } finally {
    client.release();
  }
}

async function cleanupDonor(s: SeededDonor): Promise<void> {
  const client = await getPool().connect();
  try {
    // donation_history first (donor_id FK is ON DELETE RESTRICT). DELETE may be
    // REVOKEd for restricted roles — tolerate that without failing the test.
    await client
      .query('DELETE FROM donation_history WHERE donor_id = $1', [s.donorId])
      .catch(() => {});
    await client.query('DELETE FROM blood_donors WHERE id = $1', [s.donorId]).catch(() => {});
  } finally {
    client.release();
  }
}

// Track every donor seeded so a crashing run still gets swept in afterAll.
const seeded: SeededDonor[] = [];

// ─── The property suite (skipped cleanly when no DB is configured) ───────────

describe.skipIf(SKIP)('Property 10: Donation trigger atomicity (real DB)', () => {
  beforeAll(async () => {
    // Fail fast with a clear message if the configured DB is unreachable, and
    // resolve the DB's notion of "today"/"this year" so JS and SQL agree even
    // across timezone boundaries near midnight / Jan 1.
    const client = await getPool().connect();
    try {
      const res = await client.query(
        "SELECT CURRENT_DATE::text AS today, EXTRACT(YEAR FROM CURRENT_DATE)::int AS year",
      );
      dbToday = res.rows[0].today as string;
      dbYear = res.rows[0].year as number;
    } finally {
      client.release();
    }
  });

  afterEach(async () => {
    while (seeded.length > 0) {
      const s = seeded.pop()!;
      await cleanupDonor(s).catch(() => {});
    }
  });

  afterAll(async () => {
    // Safety net: remove any leftover rows tagged with the seed district.
    if (pool) {
      const client = await pool.connect();
      try {
        await client
          .query(
            `DELETE FROM donation_history
              WHERE donor_id IN (SELECT id FROM blood_donors WHERE district = $1)`,
            [SEED_DISTRICT],
          )
          .catch(() => {});
        await client.query('DELETE FROM blood_donors WHERE district = $1', [SEED_DISTRICT]).catch(() => {});
      } catch {
        /* ignore cleanup errors */
      } finally {
        client.release();
      }
      await pool.end();
      pool = null;
    }
  });

  /**
   * Seed a donor, INSERT one donation_history row, then re-read the donor and
   * assert every Property-10 mutation. `daysAgo` is relative to the DB's
   * CURRENT_DATE so the same-calendar-year branch is unambiguous.
   */
  async function runScenario(params: {
    gender: Gender;
    donationType: DonationType;
    daysAgo: number;
    initialTotal: number;
    initialThisYear: number;
  }): Promise<void> {
    const { gender, donationType, daysAgo, initialTotal, initialThisYear } = params;

    const donatedDate = isoDateMinusDays(dbToday, daysAgo);
    const donatedYear = Number(donatedDate.slice(0, 4));
    const sameYear = donatedYear === dbYear;

    const donor = await seedDonor({ gender, initialTotal, initialThisYear });
    seeded.push(donor);
    try {
      const client = await getPool().connect();
      try {
        // INSERT the donation — the AFTER INSERT trigger does the work.
        await insertRow(client, 'donation_history', {
          donor_id: donor.donorId,
          blood_request_id: null,
          donated_date: donatedDate,
          donation_type: donationType,
          units: 1,
          hospital: 'PBT Hospital',
        });

        // Canonical expected next_eligible_date: a direct call to the very
        // function the property names.
        const fnRes = await client.query(
          'SELECT calculate_next_eligible_date($1, $2, $3::date)::text AS next_eligible',
          [donor.donorId, donationType, donatedDate],
        );
        const expectedNextFromFn = fnRes.rows[0].next_eligible as string;

        // Independent JS cross-check of the cooldown arithmetic.
        const expectedNextFromJs = isoDatePlusDays(donatedDate, cooldownDays(donationType, gender));

        // Re-read the donor. Cast date columns to text to avoid node-postgres
        // local-timezone Date parsing (which can shift the day).
        const donorRes = await client.query(
          `SELECT last_donated_date::text  AS last_donated_date,
                  last_donation_type        AS last_donation_type,
                  next_eligible_date::text  AS next_eligible_date,
                  total_donations           AS total_donations,
                  donations_this_year       AS donations_this_year
             FROM blood_donors
            WHERE id = $1`,
          [donor.donorId],
        );
        expect(donorRes.rows.length).toBe(1);
        const row = donorRes.rows[0];

        // last_donated_date = Y
        expect(row.last_donated_date).toBe(donatedDate);
        // last_donation_type = T
        expect(row.last_donation_type).toBe(donationType);
        // next_eligible_date = calculate_next_eligible_date(X, T, Y)
        expect(row.next_eligible_date).toBe(expectedNextFromFn);
        // ...and that function result matches the documented cooldown table.
        expect(row.next_eligible_date).toBe(expectedNextFromJs);
        // total_donations increased by exactly 1
        expect(row.total_donations).toBe(initialTotal + 1);
        // donations_this_year increased by 1 IFF same calendar year, else unchanged
        expect(row.donations_this_year).toBe(sameYear ? initialThisYear + 1 : initialThisYear);
      } finally {
        client.release();
      }
    } finally {
      const idx = seeded.indexOf(donor);
      if (idx >= 0) seeded.splice(idx, 1);
      await cleanupDonor(donor).catch(() => {});
    }
  }

  it('after a donation INSERT, the donor row reflects all trigger-driven mutations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          gender: fc.constantFrom<Gender>('male', 'female', 'other'),
          donationType: fc.constantFrom<DonationType>(
            'whole_blood',
            'platelets',
            'plasma',
            'double_red',
          ),
          // 0..~5.5 years back: spans both the same-year and prior-year branches.
          daysAgo: fc.integer({ min: 0, max: 2000 }),
          initialTotal: fc.integer({ min: 0, max: 12 }),
          initialThisYear: fc.integer({ min: 0, max: 12 }),
        }),
        async (params) => {
          await runScenario(params);
        },
      ),
      { numRuns: 25, timeout: 20_000 },
    );
  }, 180_000);

  // ─── Anchored example cases: deterministically cover both year branches ─────
  //     and every (donation_type, gender) cooldown cell.

  it('same-year whole_blood (male) donation today -> +90d cooldown, this_year +1', async () => {
    await runScenario({
      gender: 'male',
      donationType: 'whole_blood',
      daysAgo: 0,
      initialTotal: 0,
      initialThisYear: 0,
    });
  });

  it('same-year whole_blood (female) donation today -> +120d cooldown, this_year +1', async () => {
    await runScenario({
      gender: 'female',
      donationType: 'whole_blood',
      daysAgo: 0,
      initialTotal: 2,
      initialThisYear: 1,
    });
  });

  it('same-year platelets donation today -> +14d cooldown, this_year +1', async () => {
    await runScenario({
      gender: 'male',
      donationType: 'platelets',
      daysAgo: 0,
      initialTotal: 5,
      initialThisYear: 3,
    });
  });

  it('same-year double_red donation today -> +168d cooldown, this_year +1', async () => {
    await runScenario({
      gender: 'female',
      donationType: 'double_red',
      daysAgo: 0,
      initialTotal: 0,
      initialThisYear: 0,
    });
  });

  it('prior-year donation (~2 years ago) -> total +1 but this_year UNCHANGED', async () => {
    await runScenario({
      gender: 'male',
      donationType: 'whole_blood',
      daysAgo: 730,
      initialTotal: 4,
      initialThisYear: 2,
    });
  });

  it('prior-year plasma donation (~2 years ago) -> +14d cooldown, this_year UNCHANGED', async () => {
    await runScenario({
      gender: 'other',
      donationType: 'plasma',
      daysAgo: 800,
      initialTotal: 1,
      initialThisYear: 0,
    });
  });
});
