// Feature: sahayak-multi-agent-router, Property 2: Cooldown calculation correctness
//
// Property 2 (Design §Property 2, §SQL DDL → calculate_next_eligible_date):
// For any (gender, donation_type, donated_date) input, calculate_next_eligible_date
// returns:
//   - donated_date + 90 days   when donation_type='whole_blood' AND gender='male'
//   - donated_date + 120 days  when donation_type='whole_blood' AND gender='female'
//   - donated_date + 14 days   when donation_type='platelets' or 'plasma'
//   - donated_date + 168 days  when donation_type='double_red'
//
// Validates: Requirements 8.3
//
// HOW THIS TEST EXERCISES THE IMPLEMENTATION
//   The cooldown math lives entirely in the real Postgres function
//   calculate_next_eligible_date(p_donor_id uuid, p_donation_type text, p_donated_date date)
//   created by migration 20260101_006_eligibility_function_and_trigger.sql. The function
//   resolves gender by SELECTing it from the blood_donors row identified by p_donor_id, so
//   to prove the gender-dependent cells (male=90 vs female=120 for whole_blood) we seed one
//   male and one female donor and call the function with each (donor, donation_type) pair.
//   We then assert the returned date equals donated_date + expected_days, computed
//   independently in JS using pure UTC calendar-day arithmetic (Postgres `date + integer`
//   adds calendar days with no time-of-day / DST component, so the comparison is exact).
//
//   The function result is cast to ::text in SQL so it comes back as a 'YYYY-MM-DD' string,
//   sidestepping any node-postgres Date<->timezone coercion.
//
// DB AVAILABILITY
//   This property needs a direct Postgres connection. Following the pattern in
//   tests/properties/donor-accept-race.property.test.ts and tests/migrations/run-smoke.js,
//   we resolve a connection string from SMOKE_DATABASE_URL -> DIRECT_URL -> DATABASE_URL and
//   SKIP the whole suite cleanly (no failure) when only the 'supabase://use-rest-api'
//   sentinel (or nothing) is present. Seeded donors are removed in afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

// ─── Connection-string resolution (mirrors tests/migrations/run-smoke.js) ────

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
    '[cooldown] SKIP: no direct Postgres connection string found.\n' +
      '        Set SMOKE_DATABASE_URL, DIRECT_URL, or DATABASE_URL to a real\n' +
      '        Postgres/Supabase pooler URL to run the cooldown property test.',
  );
}

// Marker district used so the afterAll safety-net cleanup never touches real rows.
const SEED_DISTRICT = '__pbt_cooldown__';

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
      max: 4,
    });
  }
  return pool;
}

// ─── Pure JS replica of Postgres `date + integer` (calendar-day add) ─────────
// Operates entirely in UTC so there is no DST / local-midnight drift. This mirrors
// exactly what `donated_date + N` does inside the SQL function.

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function addCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

// ─── Schema-tolerant donor seeding (mirrors sibling property test) ───────────
// The base blood_donors table is created by the JS-15 v1 schema, so its full
// NOT NULL column set is unknown here. We introspect information_schema and
// auto-fill any required column we did not provide explicitly.

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
      // 50 is a safe value for any numeric CHECK on blood_donors
      // (e.g. weight_kg CHECK 30..200) should the column be NOT NULL without a default.
      return { value: 50 };
    case 'boolean':
      return { value: false };
    case 'date':
      return { value: '2000-01-01' };
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
      return { value: 'pbt_seed' };
  }
}

/** INSERT a donor row, auto-filling required columns. Returns the generated id. */
async function insertDonor(
  client: pg.PoolClient,
  explicit: Record<string, unknown>,
): Promise<string> {
  const cols = await getColumns(client, 'blood_donors');

  const names: string[] = [];
  const placeholders: string[] = [];
  const values: unknown[] = [];

  const add = (name: string, value: unknown, cast?: string) => {
    names.push(`"${name}"`);
    values.push(value);
    placeholders.push(cast ? `$${values.length}::${cast}` : `$${values.length}`);
  };

  for (const [k, v] of Object.entries(explicit)) {
    if (cols.has(k)) add(k, v);
  }

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

  const sql = `INSERT INTO blood_donors (${names.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`;
  const res = await client.query(sql, values);
  return res.rows[0].id as string;
}

async function callCooldown(
  donorId: string | null,
  donationType: string,
  donatedDate: string,
): Promise<string> {
  const res = await getPool().query(
    'SELECT calculate_next_eligible_date($1::uuid, $2::text, $3::date)::text AS d',
    [donorId, donationType, donatedDate],
  );
  return res.rows[0].d as string;
}

// Donor ids seeded once and reused across all iterations (gender is the only
// donor-dependent input the function reads).
let maleDonorId = '';
let femaleDonorId = '';

// ─── Generators ──────────────────────────────────────────────────────────────

// A valid 'YYYY-MM-DD' string. Day capped at 28 so every generated date is valid
// regardless of month; the cooldown add (90/120/14/168 days) crosses month and
// year boundaries from these anchors, exercising calendar rollover.
const donatedDateArb = fc
  .record({
    y: fc.integer({ min: 2000, max: 2035 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ y, m, d }) => `${y}-${pad2(m)}-${pad2(d)}`);

interface Cell {
  gender: 'male' | 'female';
  donationType: 'whole_blood' | 'platelets' | 'plasma' | 'double_red';
  expectedDays: number;
}

// Each documented (gender, donation_type) cell from Property 2. For the
// gender-independent types (platelets/plasma/double_red) we sample either gender
// to demonstrate the result does not depend on it.
const cellArb: fc.Arbitrary<Cell> = fc.oneof(
  fc.constant<Cell>({ gender: 'male', donationType: 'whole_blood', expectedDays: 90 }),
  fc.constant<Cell>({ gender: 'female', donationType: 'whole_blood', expectedDays: 120 }),
  fc
    .constantFrom<Cell['gender']>('male', 'female')
    .map((gender) => ({ gender, donationType: 'platelets', expectedDays: 14 }) as Cell),
  fc
    .constantFrom<Cell['gender']>('male', 'female')
    .map((gender) => ({ gender, donationType: 'plasma', expectedDays: 14 }) as Cell),
  fc
    .constantFrom<Cell['gender']>('male', 'female')
    .map((gender) => ({ gender, donationType: 'double_red', expectedDays: 168 }) as Cell),
);

function donorIdFor(gender: 'male' | 'female'): string {
  return gender === 'male' ? maleDonorId : femaleDonorId;
}

// ─── The property suite (skipped cleanly when no DB is configured) ───────────

describe.skipIf(SKIP)('Property 2: Cooldown calculation correctness (real DB)', () => {
  beforeAll(async () => {
    const client = await getPool().connect();
    try {
      // Fail fast with a clear message if the configured DB is unreachable.
      await client.query('SELECT 1');

      maleDonorId = await insertDonor(client, {
        phone: `+9190001${(Date.now() % 100000).toString().padStart(5, '0')}`,
        name: 'PBT Cooldown Male',
        blood_group: 'O+',
        gender: 'male',
        district: SEED_DISTRICT,
        block: SEED_DISTRICT,
        weight_kg: 70,
        is_available: true,
      });

      femaleDonorId = await insertDonor(client, {
        phone: `+9190002${(Date.now() % 100000).toString().padStart(5, '0')}`,
        name: 'PBT Cooldown Female',
        blood_group: 'O+',
        gender: 'female',
        district: SEED_DISTRICT,
        block: SEED_DISTRICT,
        weight_kg: 60,
        is_available: true,
      });
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('DELETE FROM blood_donors WHERE district = $1', [SEED_DISTRICT]);
      } catch {
        /* ignore cleanup errors */
      } finally {
        client.release();
      }
      await pool.end();
      pool = null;
    }
  });

  // ─── The universal property ────────────────────────────────────────────────

  it('returns donated_date + {90,120,14,14,168} for the matching (gender, donation_type) cell', async () => {
    await fc.assert(
      fc.asyncProperty(donatedDateArb, cellArb, async (donatedDate, cell) => {
        const actual = await callCooldown(
          donorIdFor(cell.gender),
          cell.donationType,
          donatedDate,
        );
        const expected = addCalendarDays(donatedDate, cell.expectedDays);
        expect(actual).toBe(expected);
      }),
      { numRuns: 120, timeout: 20_000 },
    );
  }, 120_000);

  // ─── Anchored example cases (one per documented cell, fixed date) ───────────

  it('whole_blood + male -> +90 days', async () => {
    expect(await callCooldown(maleDonorId, 'whole_blood', '2026-01-01')).toBe('2026-04-01');
  });

  it('whole_blood + female -> +120 days', async () => {
    expect(await callCooldown(femaleDonorId, 'whole_blood', '2026-01-01')).toBe('2026-05-01');
  });

  it('platelets -> +14 days (gender-independent)', async () => {
    expect(await callCooldown(maleDonorId, 'platelets', '2026-01-01')).toBe('2026-01-15');
    expect(await callCooldown(femaleDonorId, 'platelets', '2026-01-01')).toBe('2026-01-15');
  });

  it('plasma -> +14 days (gender-independent)', async () => {
    expect(await callCooldown(maleDonorId, 'plasma', '2026-01-01')).toBe('2026-01-15');
    expect(await callCooldown(femaleDonorId, 'plasma', '2026-01-01')).toBe('2026-01-15');
  });

  it('double_red -> +168 days (gender-independent)', async () => {
    expect(await callCooldown(maleDonorId, 'double_red', '2026-01-01')).toBe('2026-06-18');
    expect(await callCooldown(femaleDonorId, 'double_red', '2026-01-01')).toBe('2026-06-18');
  });

  // ─── Edge: NULL-gender (non-existent donor) exercises the type-default branches ─
  // Per the function definition, an unresolved donor -> gender NULL, so whole_blood
  // falls through to the conservative 90-day default while the gender-independent
  // types keep their fixed cooldowns.
  it('NULL-gender donor falls back to type defaults (whole_blood=90, platelets/plasma=14, double_red=168)', async () => {
    const ghost = randomUUID();
    expect(await callCooldown(ghost, 'whole_blood', '2026-01-01')).toBe('2026-04-01');
    expect(await callCooldown(ghost, 'platelets', '2026-01-01')).toBe('2026-01-15');
    expect(await callCooldown(ghost, 'plasma', '2026-01-01')).toBe('2026-01-15');
    expect(await callCooldown(ghost, 'double_red', '2026-01-01')).toBe('2026-06-18');
  });
});
