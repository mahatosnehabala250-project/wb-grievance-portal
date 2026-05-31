// Feature: sahayak-multi-agent-router, Property 11: Yearly donation cap enforcement
//
// Property 11 (Design §Property 11):
// For any donor and donation sequence within a calendar year, after each
// RecordDonation call `donations_this_year` does not exceed the gender-and-type
// cap (whole-blood male=4, whole-blood female=3, platelets=24). Once the cap is
// reached, subsequent matching attempts via `find_matching_donors` exclude that
// donor until the year-end reset.
//
// Validates: Requirements 8.6
//
// IMPLEMENTATION UNDER TEST
//   The yearly-cap exclusion lives in the `find_matching_donors` RPC
//   (supabase/migrations/20260101_007_find_matching_donors.sql). Its cap filter is:
//
//     AND NOT (
//       (last_donation_type = 'whole_blood' AND gender = 'male'   AND donations_this_year >= 4)
//       OR (last_donation_type = 'whole_blood' AND gender = 'female' AND donations_this_year >= 3)
//       OR (last_donation_type = 'whole_blood' AND (gender IS NULL OR gender = 'other') AND donations_this_year >= 3)
//       OR (last_donation_type = 'platelets' AND donations_this_year >= 24)
//     )
//
//   The annual reset is `reset_yearly_donations()` in migration 006, which zeroes
//   `donations_this_year` for all donors (re-enabling capped donors next year).
//
//   Matching the established pattern in this repo's other property suites
//   (e.g. screening-deferral.property.test.ts), this file has two halves:
//
//   (A) DB-INDEPENDENT property over a pure model that faithfully mirrors the
//       RPC's cap thresholds. Always runs; gives the test value with no DB.
//
//   (B) DB-INTEGRATION property that seeds otherwise-eligible donors at / over /
//       under the cap for each (gender, donation_type) and asserts the real
//       `find_matching_donors` RPC excludes capped donors and includes under-cap
//       ones. It SKIPS GRACEFULLY when no direct Postgres connection string is
//       configured (mirroring tests/migrations/run-smoke.js and the sibling
//       donor-accept-race.property.test.ts), so it never hard-fails a pipeline
//       running entirely over the Supabase REST API.

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

// =============================================================================
// Shared pure model of the RPC's yearly-cap thresholds.
// Kept as a literal mirror of migration 20260101_007's cap filter so the test
// fails loudly if the implementation's numbers ever drift from Req 8.6.
// =============================================================================

type Gender = 'male' | 'female' | 'other' | null;
type DonationType = 'whole_blood' | 'platelets' | 'plasma' | 'double_red' | null;

/**
 * The yearly cap that applies to a (gender, donationType) pair, or `null` when no
 * yearly cap applies (plasma, double_red, or a donor with no recorded
 * last_donation_type this year — those branches are absent from the RPC filter).
 */
function capFor(gender: Gender, donationType: DonationType): number | null {
  if (donationType === 'whole_blood') {
    if (gender === 'male') return 4;
    if (gender === 'female') return 3;
    // 'other' or NULL gender -> conservative 3 (matches the RPC's third branch).
    return 3;
  }
  if (donationType === 'platelets') return 24;
  // plasma, double_red, or NULL donation type -> not capped by the yearly rule.
  return null;
}

/**
 * Mirrors the RPC's `AND NOT (...)` cap filter: a donor is "capped" (excluded
 * from matching) exactly when a cap applies and `donations_this_year` has
 * reached or exceeded it.
 */
function isYearlyCapReached(
  gender: Gender,
  donationType: DonationType,
  donationsThisYear: number,
): boolean {
  const cap = capFor(gender, donationType);
  if (cap === null) return false;
  return donationsThisYear >= cap;
}

// =============================================================================
// Part A — DB-independent property over the pure cap model
// =============================================================================
describe('Property 11A: yearly donation cap thresholds (pure model, no DB)', () => {
  const arbGender: fc.Arbitrary<Gender> = fc.constantFrom('male', 'female', 'other', null);
  const arbType: fc.Arbitrary<DonationType> = fc.constantFrom(
    'whole_blood',
    'platelets',
    'plasma',
    'double_red',
    null,
  );
  const arbCount = fc.integer({ min: 0, max: 60 });

  it('cap exclusion matches the documented gender-and-type thresholds (Req 8.6)', () => {
    fc.assert(
      fc.property(arbGender, arbType, arbCount, (gender, type, count) => {
        const reached = isYearlyCapReached(gender, type, count);

        if (type === 'whole_blood' && gender === 'male') {
          expect(reached).toBe(count >= 4);
        } else if (type === 'whole_blood' && gender === 'female') {
          expect(reached).toBe(count >= 3);
        } else if (type === 'whole_blood') {
          // 'other' or NULL gender
          expect(reached).toBe(count >= 3);
        } else if (type === 'platelets') {
          expect(reached).toBe(count >= 24);
        } else {
          // plasma, double_red, or NULL type: no yearly cap ever.
          expect(reached).toBe(false);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('cap-gated donation sequence never lets donations_this_year exceed the cap (Req 8.6)', () => {
    // Model the real-world enforcement loop: a donor can only be matched (and
    // therefore donate again) while NOT capped. Each successful match increments
    // donations_this_year by 1 (same calendar year). Once the cap is reached the
    // donor drops out of find_matching_donors, so no further increments happen.
    fc.assert(
      fc.property(
        arbGender,
        fc.constantFrom<DonationType>('whole_blood', 'platelets'),
        fc.integer({ min: 0, max: 30 }), // starting donations_this_year
        fc.integer({ min: 0, max: 40 }), // number of additional match attempts
        (gender, type, start, attempts) => {
          const cap = capFor(gender, type)!; // whole_blood / platelets always have a cap
          let dty = start;
          for (let i = 0; i < attempts; i++) {
            if (isYearlyCapReached(gender, type, dty)) break; // excluded -> cannot donate
            dty += 1; // matched -> donated -> increment
          }
          // The counter never exceeds the cap as a result of cap-gated matching...
          expect(dty).toBeLessThanOrEqual(Math.max(cap, start));
          if (start <= cap) {
            expect(dty).toBeLessThanOrEqual(cap);
            // ...and it climbs to exactly the cap once enough attempts are made.
            if (start + attempts >= cap) expect(dty).toBe(cap);
            else expect(dty).toBe(start + attempts);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('a donor strictly below the cap is matchable; at/above the cap is excluded', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Gender>('male', 'female', 'other', null),
        fc.constantFrom<DonationType>('whole_blood', 'platelets'),
        (gender, type) => {
          const cap = capFor(gender, type)!;
          // strictly below -> not reached (matchable)
          expect(isYearlyCapReached(gender, type, cap - 1)).toBe(false);
          // exactly at -> reached (excluded)
          expect(isYearlyCapReached(gender, type, cap)).toBe(true);
          // above -> reached (excluded)
          expect(isYearlyCapReached(gender, type, cap + 1)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('anchored thresholds: male WB=4, female WB=3, other WB=3, platelets=24', () => {
    expect(capFor('male', 'whole_blood')).toBe(4);
    expect(capFor('female', 'whole_blood')).toBe(3);
    expect(capFor('other', 'whole_blood')).toBe(3);
    expect(capFor(null, 'whole_blood')).toBe(3);
    expect(capFor('male', 'platelets')).toBe(24);
    expect(capFor('female', 'platelets')).toBe(24);
    // No yearly cap for plasma / double_red.
    expect(capFor('male', 'plasma')).toBeNull();
    expect(capFor('male', 'double_red')).toBeNull();
  });

  it('the annual reset (donations_this_year -> 0) re-enables a capped donor', () => {
    // Once-reached donor is excluded; after reset_yearly_donations() zeroes the
    // counter, the same donor is matchable again.
    const gender: Gender = 'female';
    const type: DonationType = 'whole_blood';
    expect(isYearlyCapReached(gender, type, 3)).toBe(true); // capped
    const afterReset = 0; // reset_yearly_donations() effect
    expect(isYearlyCapReached(gender, type, afterReset)).toBe(false); // matchable again
  });
});

// =============================================================================
// Part B — DB-integration property against the real find_matching_donors RPC
// =============================================================================
//
// Connection-string resolution mirrors tests/migrations/run-smoke.js and the
// sibling donor-accept-race.property.test.ts exactly:
//   1. SMOKE_DATABASE_URL  2. DIRECT_URL  3. DATABASE_URL
// The `supabase://use-rest-api` sentinel (or an empty env) results in a clean,
// non-failing SKIP via describe.skipIf.

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
  // eslint-disable-next-line no-console
  console.log(
    '[yearly-cap] SKIP DB integration: no direct Postgres connection string found.\n' +
      '        Set SMOKE_DATABASE_URL, DIRECT_URL, or DATABASE_URL to a real\n' +
      '        Postgres/Supabase pooler URL to exercise find_matching_donors.',
  );
}

// Marker district prefix so the afterAll safety-net can sweep leftovers even if
// a run crashes mid-iteration. Each seeded donor uses a unique district under
// this prefix to fully isolate one donor per find_matching_donors call (the RPC
// LIMITs its result set, so isolation avoids false "exclusions").
const SEED_PREFIX = '__pbt_cap__';

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

// ─── Schema-tolerant row seeding (mirrors donor-accept-race.property.test.ts) ─

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
      return { value: 'pbt_seed' };
  }
}

/**
 * INSERT a row into `table`, filling required columns automatically. `explicit`
 * values are applied only for columns that exist. NULL explicit values are
 * inserted as-is (so callers can deliberately set a column to NULL). Returns id.
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

  // 1. Explicit values (only for columns that exist on the table).
  for (const [k, v] of Object.entries(explicit)) {
    if (cols.has(k)) add(k, v);
  }

  // 2. Auto-fill remaining NOT NULL columns with no default that we did not set.
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

// A counter to keep seeded phone numbers unique within a run.
let seedSeq = 0;

interface DonorSpec {
  gender: Gender;
  lastDonationType: DonationType;
  donationsThisYear: number;
}

/**
 * Seed one otherwise-fully-eligible donor in its own unique district so the cap
 * is the ONLY thing that could exclude it. Returns the donor id and district.
 */
async function seedDonor(spec: DonorSpec): Promise<{ donorId: string; district: string }> {
  const client = await getPool().connect();
  try {
    const district = `${SEED_PREFIX}${randomUUID().slice(0, 8)}`;
    const n = seedSeq++;
    const phone = `+9199${String(Date.now()).slice(-7)}${String(n).padStart(3, '0')}`.slice(0, 15);

    const donorId = await insertRow(client, 'blood_donors', {
      phone,
      name: `PBT Cap Donor ${n}`,
      blood_group: 'O+', // compatible donor for an 'O+' request
      gender: spec.gender, // may be null on purpose
      date_of_birth: '1990-01-01', // age ~36 -> inside 18..65
      weight_kg: 70, // >= 45
      district,
      block: district,
      is_available: true,
      is_paused: false,
      permanently_deferred: false,
      next_eligible_date: null, // passes the cooldown filter
      deferral_until: null, // passes the temporary-deferral filter
      last_donation_type: spec.lastDonationType, // may be null on purpose
      donations_this_year: spec.donationsThisYear,
      total_donations: spec.donationsThisYear,
    });

    return { donorId, district };
  } finally {
    client.release();
  }
}

/**
 * Returns true iff the given donor id is returned by find_matching_donors for an
 * 'O+' request in its (isolated) district. p_units is large so the RPC's
 * LIMIT (GREATEST(p_units*3, 10)) never truncates a single-donor district.
 */
async function donorIsMatched(donorId: string, district: string): Promise<boolean> {
  const client = await getPool().connect();
  try {
    const res = await client.query(
      'SELECT id FROM find_matching_donors($1, $2, $3, $4)',
      ['O+', district, 50, district],
    );
    return res.rows.some((r: { id: string }) => r.id === donorId);
  } finally {
    client.release();
  }
}

async function deleteDonor(donorId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('DELETE FROM blood_donors WHERE id = $1', [donorId]);
  } finally {
    client.release();
  }
}

// Track seeded donor ids so a crashing iteration still gets swept in afterAll.
const seededDonorIds: string[] = [];

describe.skipIf(SKIP)('Property 11B: yearly cap exclusion in find_matching_donors (real DB)', () => {
  beforeAll(async () => {
    const client = await getPool().connect();
    try {
      await client.query('SELECT 1');
      // Confirm the RPC exists; if not, this environment has not run the spec
      // migrations and the property cannot be meaningfully evaluated.
      const fn = await client.query(
        "SELECT 1 FROM pg_proc WHERE proname = 'find_matching_donors' LIMIT 1",
      );
      if (fn.rows.length === 0) {
        throw new Error(
          'find_matching_donors RPC not found — run the sahayak migrations against this DB first.',
        );
      }
    } finally {
      client.release();
    }
  });

  afterEach(async () => {
    while (seededDonorIds.length > 0) {
      const id = seededDonorIds.pop()!;
      await deleteDonor(id).catch(() => {});
    }
  });

  afterAll(async () => {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('DELETE FROM blood_donors WHERE district LIKE $1', [`${SEED_PREFIX}%`]);
      } catch {
        /* ignore cleanup errors */
      } finally {
        client.release();
      }
      await pool.end();
      pool = null;
    }
  });

  /** Seed one donor matching `spec`, assert its match membership, then clean up. */
  async function checkDonor(spec: DonorSpec): Promise<void> {
    const { donorId, district } = await seedDonor(spec);
    seededDonorIds.push(donorId);
    try {
      const matched = await donorIsMatched(donorId, district);
      const capped = isYearlyCapReached(spec.gender, spec.lastDonationType, spec.donationsThisYear);
      // A capped donor MUST be excluded; an under-cap (otherwise-eligible) donor
      // MUST be included.
      expect(matched).toBe(!capped);
    } finally {
      const idx = seededDonorIds.indexOf(donorId);
      if (idx >= 0) seededDonorIds.splice(idx, 1);
      await deleteDonor(donorId).catch(() => {});
    }
  }

  // ─── Anchored boundary cases (at / over / under cap per gender+type) ────────

  it('male whole_blood: 3 included, 4 excluded, 5 excluded (cap=4)', async () => {
    await checkDonor({ gender: 'male', lastDonationType: 'whole_blood', donationsThisYear: 3 });
    await checkDonor({ gender: 'male', lastDonationType: 'whole_blood', donationsThisYear: 4 });
    await checkDonor({ gender: 'male', lastDonationType: 'whole_blood', donationsThisYear: 5 });
  });

  it('female whole_blood: 2 included, 3 excluded, 4 excluded (cap=3)', async () => {
    await checkDonor({ gender: 'female', lastDonationType: 'whole_blood', donationsThisYear: 2 });
    await checkDonor({ gender: 'female', lastDonationType: 'whole_blood', donationsThisYear: 3 });
    await checkDonor({ gender: 'female', lastDonationType: 'whole_blood', donationsThisYear: 4 });
  });

  it('other/NULL-gender whole_blood: 2 included, 3 excluded (cap=3)', async () => {
    await checkDonor({ gender: 'other', lastDonationType: 'whole_blood', donationsThisYear: 2 });
    await checkDonor({ gender: 'other', lastDonationType: 'whole_blood', donationsThisYear: 3 });
    await checkDonor({ gender: null, lastDonationType: 'whole_blood', donationsThisYear: 2 });
    await checkDonor({ gender: null, lastDonationType: 'whole_blood', donationsThisYear: 3 });
  });

  it('platelets: 23 included, 24 excluded, 30 excluded (cap=24, any gender)', async () => {
    await checkDonor({ gender: 'male', lastDonationType: 'platelets', donationsThisYear: 23 });
    await checkDonor({ gender: 'male', lastDonationType: 'platelets', donationsThisYear: 24 });
    await checkDonor({ gender: 'female', lastDonationType: 'platelets', donationsThisYear: 30 });
  });

  it('plasma / double_red / NULL type are never yearly-capped (high counts still included)', async () => {
    await checkDonor({ gender: 'male', lastDonationType: 'plasma', donationsThisYear: 100 });
    await checkDonor({ gender: 'female', lastDonationType: 'double_red', donationsThisYear: 100 });
    await checkDonor({ gender: 'male', lastDonationType: null, donationsThisYear: 100 });
  });

  // ─── Property: membership == NOT capped, for any (gender, type, count) ──────

  it('a donor is matched iff it has not reached its yearly cap (Req 8.6)', async () => {
    const arbGender: fc.Arbitrary<Gender> = fc.constantFrom('male', 'female', 'other', null);
    const arbType: fc.Arbitrary<DonationType> = fc.constantFrom(
      'whole_blood',
      'platelets',
      'plasma',
      'double_red',
      null,
    );
    // Range straddles every cap boundary (3, 4, 24) on both sides.
    const arbCount = fc.integer({ min: 0, max: 26 });

    await fc.assert(
      fc.asyncProperty(arbGender, arbType, arbCount, async (gender, type, count) => {
        await checkDonor({ gender, lastDonationType: type, donationsThisYear: count });
      }),
      { numRuns: 24, timeout: 20_000 },
    );
  }, 120_000);
});
