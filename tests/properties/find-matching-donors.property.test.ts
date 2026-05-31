// Feature: sahayak-multi-agent-router, Property 9: find_matching_donors eligibility and compatibility
//
// Property 9 (Design §Property 9, Requirements 8.5):
// For any blood_request(blood_group=G, district=D, units=U, block=B) and any blood_donors
// pool, every donor `d` returned by find_matching_donors(G, D, U, B) satisfies ALL of:
//   - d.blood_group ∈ compatible-donor-set(G)   (ABO/Rh matrix from MEDICAL_RULES.md)
//   - d.next_eligible_date IS NULL OR d.next_eligible_date <= CURRENT_DATE
//   - d.permanently_deferred = false
//   - d.deferral_until IS NULL OR d.deferral_until <= CURRENT_DATE
//   - age(d.date_of_birth) BETWEEN 18 AND 65
//   - d.weight_kg >= 45
//   - d.is_paused = false AND d.is_available = true
//   - d.district = D
//
// Validates: Requirements 8.5
//
// TWO COMPLEMENTARY HALVES
//   1. A DB-INDEPENDENT pure-model half that checks the ABO/Rh compatibility matrix
//      documented in wb-grievance-portal-context/.ai-context/MEDICAL_RULES.md against
//      first-principles antigen-subset reasoning. This runs everywhere (no DB needed)
//      so the file always carries value.
//   2. A DB-BACKED half that seeds a mix of fully-eligible+compatible donors and donors
//      that each violate EXACTLY ONE eligibility/compatibility criterion, then asserts
//      find_matching_donors returns ONLY the fully-eligible+compatible donors.
//
// DB AVAILABILITY
//   The DB half needs a direct Postgres connection. Following the pattern in
//   tests/migrations/run-smoke.js and tests/properties/donor-accept-race.property.test.ts,
//   we resolve a connection string from SMOKE_DATABASE_URL -> DIRECT_URL -> DATABASE_URL
//   and SKIP that suite cleanly (no failure) when only the 'supabase://use-rest-api'
//   sentinel (or nothing) is present. Seeded rows are removed in afterEach / afterAll.

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

// ─── ABO/Rh compatibility matrix (recipient ← compatible donor groups) ───────
// Mirrors get_compatible_blood_groups() in
// supabase/migrations/20260101_007_find_matching_donors.sql and the matrix in
// MEDICAL_RULES.md (§Compatibility Matrix).

const ALL_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'] as const;
type BloodGroup = (typeof ALL_GROUPS)[number];

const COMPATIBILITY_MATRIX: Record<BloodGroup, BloodGroup[]> = {
  'O-': ['O-'],
  'O+': ['O-', 'O+'],
  'A-': ['O-', 'A-'],
  'A+': ['O-', 'O+', 'A-', 'A+'],
  'B-': ['O-', 'B-'],
  'B+': ['O-', 'O+', 'B-', 'B+'],
  'AB-': ['O-', 'A-', 'B-', 'AB-'],
  'AB+': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
};

/** Antigen set carried by a donor of `group`: A, B, and/or Rh (Rh+ only). */
function antigens(group: BloodGroup): Set<string> {
  const rhPositive = group.endsWith('+');
  const abo = group.slice(0, -1); // 'O' | 'A' | 'B' | 'AB'
  const set = new Set<string>();
  if (abo.includes('A')) set.add('A');
  if (abo.includes('B')) set.add('B');
  if (rhPositive) set.add('Rh');
  return set;
}

/**
 * First-principles whole-blood/red-cell compatibility:
 * a donor can give to a recipient iff every antigen the donor carries is also
 * present in the recipient (antigens(donor) ⊆ antigens(recipient)).
 */
function isCompatibleByFirstPrinciples(donor: BloodGroup, recipient: BloodGroup): boolean {
  const r = antigens(recipient);
  for (const a of antigens(donor)) {
    if (!r.has(a)) return false;
  }
  return true;
}

function compatibleDonors(recipient: BloodGroup): BloodGroup[] {
  return COMPATIBILITY_MATRIX[recipient];
}

function incompatibleDonors(recipient: BloodGroup): BloodGroup[] {
  const ok = new Set(COMPATIBILITY_MATRIX[recipient]);
  return ALL_GROUPS.filter((g) => !ok.has(g));
}

// ════════════════════════════════════════════════════════════════════════════
// HALF 1 — DB-INDEPENDENT compatibility-matrix property (always runs)
// ════════════════════════════════════════════════════════════════════════════

describe('Property 9 (pure model): ABO/Rh compatibility matrix is self-consistent', () => {
  it('the documented matrix equals first-principles antigen-subset compatibility for every (donor, recipient) pair', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_GROUPS),
        fc.constantFrom(...ALL_GROUPS),
        (donor, recipient) => {
          const documented = COMPATIBILITY_MATRIX[recipient].includes(donor);
          const firstPrinciples = isCompatibleByFirstPrinciples(donor, recipient);
          expect(documented).toBe(firstPrinciples);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('O- is the universal donor (compatible with every recipient)', () => {
    for (const recipient of ALL_GROUPS) {
      expect(COMPATIBILITY_MATRIX[recipient]).toContain('O-');
    }
  });

  it('AB+ is the universal recipient (every donor group is compatible)', () => {
    expect(new Set(COMPATIBILITY_MATRIX['AB+'])).toEqual(new Set(ALL_GROUPS));
  });

  it('O- recipient can only receive from O- (strictest case)', () => {
    expect(COMPATIBILITY_MATRIX['O-']).toEqual(['O-']);
  });

  it('Rh- donors never appear restricted out, Rh+ donors only serve Rh+ recipients', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_GROUPS), fc.constantFrom(...ALL_GROUPS), (donor, recipient) => {
        if (donor.endsWith('+') && recipient.endsWith('-')) {
          // An Rh-positive donor can never give to an Rh-negative recipient.
          expect(COMPATIBILITY_MATRIX[recipient].includes(donor)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HALF 2 — DB-backed property against the real find_matching_donors RPC
// ════════════════════════════════════════════════════════════════════════════

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
  // eslint-disable-next-line no-console
  console.log(
    '[find-matching-donors] SKIP: no direct Postgres connection string found.\n' +
      '        Set SMOKE_DATABASE_URL, DIRECT_URL, or DATABASE_URL to a real\n' +
      '        Postgres/Supabase pooler URL to run the eligibility/compatibility property test.',
  );
}

// Marker districts for safety-net cleanup. The "wrong district" ineligible donor
// is seeded into SEED_DISTRICT_ALT so it is filtered out by the district predicate.
const SEED_DISTRICT = '__pbt_fmd__';
const SEED_DISTRICT_ALT = '__pbt_fmd_wrong__';

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

// ─── Date helpers (UTC, interior values away from the 18/65 boundary) ─────────

function isoDateOffsetDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoDateYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// ─── Generic, schema-tolerant row seeding (mirrors the sibling race test) ────

interface ColumnMeta {
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
  is_generated: string;
}

async function getColumns(client: pg.PoolClient, table: string): Promise<Map<string, ColumnMeta>> {
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

  const sql = `INSERT INTO "${table}" (${names.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`;
  const res = await client.query(sql, values);
  return res.rows[0].id as string;
}

// ─── Donor builders ──────────────────────────────────────────────────────────

let phoneSeq = 0;
function uniquePhone(): string {
  phoneSeq += 1;
  // Stay short and unique across the run.
  return `+9199${String(Date.now() % 1_000_000)}${phoneSeq}`.slice(0, 15);
}

/** A fully eligible + compatible donor row for the given recipient group. */
function eligibleDonor(group: BloodGroup): Record<string, unknown> {
  return {
    phone: uniquePhone(),
    name: 'PBT Eligible',
    blood_group: group,
    gender: 'male',
    date_of_birth: isoDateYearsAgo(30), // clearly within 18–65
    weight_kg: 60,
    district: SEED_DISTRICT,
    block: SEED_DISTRICT,
    is_available: true,
    is_paused: false,
    permanently_deferred: false,
    next_eligible_date: isoDateOffsetDays(-30), // past
    deferral_until: null,
    last_donation_type: null,
    donations_this_year: 0,
    total_donations: 0,
    total_offers_accepted: 0,
  };
}

interface SeededScenario {
  requestGroup: BloodGroup;
  district: string;
  units: number;
  eligibleIds: string[];
  ineligibleIds: string[];
  allDonorIds: string[];
}

async function seedScenario(
  requestGroup: BloodGroup,
  units: number,
  eligibleCount: number,
): Promise<SeededScenario> {
  const client = await getPool().connect();
  const eligibleIds: string[] = [];
  const ineligibleIds: string[] = [];

  try {
    const compatible = compatibleDonors(requestGroup);
    const incompatible = incompatibleDonors(requestGroup);

    // 1. Fully eligible + compatible donors (each picks a compatible group).
    for (let i = 0; i < eligibleCount; i++) {
      const g = compatible[i % compatible.length];
      const id = await insertRow(client, 'blood_donors', eligibleDonor(g));
      eligibleIds.push(id);
    }

    // 2. Ineligible donors — each violates EXACTLY ONE criterion, otherwise eligible.
    const compatibleGroup = compatible[0]; // O- is always compatible with everyone
    const violations: Array<Record<string, unknown>> = [
      // future next_eligible_date (cooldown not elapsed)
      { ...eligibleDonor(compatibleGroup), name: 'V_future_eligible', next_eligible_date: isoDateOffsetDays(30) },
      // permanently deferred
      { ...eligibleDonor(compatibleGroup), name: 'V_perm_deferred', permanently_deferred: true },
      // future temporary deferral
      {
        ...eligibleDonor(compatibleGroup),
        name: 'V_future_deferral',
        deferral_until: isoDateOffsetDays(30),
        deferral_reason: 'pbt',
      },
      // age under 18
      { ...eligibleDonor(compatibleGroup), name: 'V_age_under_18', date_of_birth: isoDateYearsAgo(17) },
      // age over 65
      { ...eligibleDonor(compatibleGroup), name: 'V_age_over_65', date_of_birth: isoDateYearsAgo(70) },
      // weight under 45 kg
      { ...eligibleDonor(compatibleGroup), name: 'V_weight_under_45', weight_kg: 40 },
      // paused
      { ...eligibleDonor(compatibleGroup), name: 'V_paused', is_paused: true },
      // unavailable
      { ...eligibleDonor(compatibleGroup), name: 'V_unavailable', is_available: false },
      // wrong district
      { ...eligibleDonor(compatibleGroup), name: 'V_wrong_district', district: SEED_DISTRICT_ALT, block: SEED_DISTRICT_ALT },
    ];

    // incompatible blood group — only when an incompatible group exists
    // (AB+ recipient is universal, so there is none to add).
    if (incompatible.length > 0) {
      violations.push({
        ...eligibleDonor(compatibleGroup),
        name: 'V_incompatible_group',
        blood_group: incompatible[0],
      });
    }

    for (const v of violations) {
      const id = await insertRow(client, 'blood_donors', v);
      ineligibleIds.push(id);
    }

    return {
      requestGroup,
      district: SEED_DISTRICT,
      units,
      eligibleIds,
      ineligibleIds,
      allDonorIds: [...eligibleIds, ...ineligibleIds],
    };
  } finally {
    client.release();
  }
}

async function cleanupScenario(s: SeededScenario): Promise<void> {
  const client = await getPool().connect();
  try {
    if (s.allDonorIds.length > 0) {
      await client.query('DELETE FROM blood_donors WHERE id = ANY($1::uuid[])', [s.allDonorIds]);
    }
  } finally {
    client.release();
  }
}

const seeded: SeededScenario[] = [];

describe.skipIf(SKIP)('Property 9: find_matching_donors eligibility and compatibility (real DB)', () => {
  beforeAll(async () => {
    const client = await getPool().connect();
    try {
      await client.query('SELECT 1');
      // Confirm the RPC exists; fail fast with a clear message if migrations are absent.
      const fn = await client.query(
        `SELECT 1 FROM pg_proc WHERE proname = 'find_matching_donors' LIMIT 1`,
      );
      if (fn.rows.length === 0) {
        throw new Error(
          'find_matching_donors() not found — apply migration 20260101_007_find_matching_donors.sql to the test DB.',
        );
      }
    } finally {
      client.release();
    }
  });

  afterEach(async () => {
    while (seeded.length > 0) {
      const s = seeded.pop()!;
      await cleanupScenario(s).catch(() => {});
    }
  });

  afterAll(async () => {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('DELETE FROM blood_donors WHERE district = ANY($1::text[])', [
          [SEED_DISTRICT, SEED_DISTRICT_ALT],
        ]);
      } catch {
        /* ignore cleanup errors */
      } finally {
        client.release();
      }
      await pool.end();
      pool = null;
    }
  });

  /** Seed a scenario, run the RPC, assert Property 9, clean up. */
  async function runScenario(
    requestGroup: BloodGroup,
    units: number,
    eligibleCount: number,
  ): Promise<void> {
    const scenario = await seedScenario(requestGroup, units, eligibleCount);
    seeded.push(scenario);
    try {
      const client = await getPool().connect();
      try {
        const res = await client.query(
          `SELECT id, blood_group, district, weight_kg, date_of_birth, next_eligible_date
             FROM find_matching_donors($1, $2, $3, $4)`,
          [requestGroup, SEED_DISTRICT, units, null],
        );

        const returnedIds = new Set<string>(res.rows.map((r) => r.id as string));
        const eligibleSet = new Set(scenario.eligibleIds);
        const ineligibleSet = new Set(scenario.ineligibleIds);
        const compatible = new Set(compatibleDonors(requestGroup));

        // (a) Every fully-eligible+compatible seeded donor is returned.
        //     (eligibleCount stays small so the RPC's LIMIT never truncates them.)
        for (const id of scenario.eligibleIds) {
          expect(returnedIds.has(id)).toBe(true);
        }

        // (b) No ineligible seeded donor is ever returned.
        for (const id of scenario.ineligibleIds) {
          expect(returnedIds.has(id)).toBe(false);
        }

        // (c) Property 9 directly: every returned row that we seeded satisfies the
        //     compatibility + eligibility predicates exposed by the RPC's columns.
        const today = isoDateOffsetDays(0);
        for (const row of res.rows) {
          const id = row.id as string;
          if (!eligibleSet.has(id) && !ineligibleSet.has(id)) continue; // ignore foreign rows
          // Compatibility
          expect(compatible.has(row.blood_group as BloodGroup)).toBe(true);
          // District
          expect(row.district).toBe(SEED_DISTRICT);
          // Weight
          expect(Number(row.weight_kg)).toBeGreaterThanOrEqual(45);
          // Cooldown
          if (row.next_eligible_date !== null) {
            const ned = String(row.next_eligible_date).slice(0, 10);
            expect(ned <= today).toBe(true);
          }
          // Age 18–65 (computed from date_of_birth)
          const dob = new Date(String(row.date_of_birth));
          const ageMs = Date.now() - dob.getTime();
          const ageYears = ageMs / (365.25 * 24 * 3600 * 1000);
          expect(ageYears).toBeGreaterThanOrEqual(18);
          expect(ageYears).toBeLessThanOrEqual(65);
        }
      } finally {
        client.release();
      }
    } finally {
      const idx = seeded.indexOf(scenario);
      if (idx >= 0) seeded.splice(idx, 1);
      await cleanupScenario(scenario).catch(() => {});
    }
  }

  it('returns only fully-eligible + ABO/Rh-compatible donors for arbitrary requests', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          requestGroup: fc.constantFrom(...ALL_GROUPS),
          units: fc.integer({ min: 1, max: 3 }),
          eligibleCount: fc.integer({ min: 1, max: 4 }),
        }),
        async ({ requestGroup, units, eligibleCount }) => {
          await runScenario(requestGroup, units, eligibleCount);
        },
      ),
      { numRuns: 16, timeout: 20_000 },
    );
  }, 180_000);

  // ─── Anchored example cases ─────────────────────────────────────────────────

  it('O- request (strictest): only O- eligible donors are matched', async () => {
    await runScenario('O-', 2, 3);
  });

  it('AB+ request (universal recipient, no incompatible group exists)', async () => {
    await runScenario('AB+', 2, 4);
  });

  it('A+ request: O-, O+, A-, A+ eligible donors are matched, others excluded', async () => {
    await runScenario('A+', 1, 4);
  });

  it('B- request: only O- and B- eligible donors are matched', async () => {
    await runScenario('B-', 3, 2);
  });
});
