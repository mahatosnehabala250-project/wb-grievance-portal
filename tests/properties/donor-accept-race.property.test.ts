// Feature: sahayak-multi-agent-router, Property 6: Race-safe donor acceptance
//
// Property 6 (Design §Property 6, §Donor Acceptance / Race Condition — v1 vs v1.1):
// For any set of K concurrent donor responses (HAAN) targeting the same blood_request
// with units_needed = N, after all responses settle:
//   - donors_confirmed_count <= units_needed   (no over-acceptance; the chk_confirmed_le_needed
//                                                CHECK constraint is the last line of defence)
//   - exactly min(K, N) donors have response_status = 'accepted'
//   - the remaining K - min(K, N) donors have response_status = 'standby'
//
// Validates: Requirements 6.1, 6.2, 6.3
//
// HOW THIS TEST EXERCISES THE IMPLEMENTATION
//   The production endpoint POST /api/blood-requests/donor-respond performs the HAAN
//   acceptance inside a single transaction that:
//     BEGIN
//     SET LOCAL lock_timeout = '5s'
//     SELECT pg_advisory_xact_lock(hashtext($blood_request_id::text))
//     SELECT donors_confirmed_count, units_needed FROM blood_requests WHERE id = $1 FOR UPDATE
//     -- under cap  -> 'accepted' + donors_confirmed_count += 1
//     -- at/over cap -> 'standby' + donors_standby_count   += 1
//     UPDATE blood_donor_responses SET response_status = ..., responded_at = NOW() ...
//     UPDATE blood_donors          SET total_offers_accepted += 1 ...
//     COMMIT
//   (see src/app/api/blood-requests/donor-respond/route.ts).
//
//   Per the task guidance, we exercise that exact DB-level concurrency logic the same way
//   the route does — replicating the route's transaction verbatim against the real test DB
//   via a pg Pool — and fire K of them with Promise.allSettled. This avoids standing up the
//   Next.js server runtime while still proving the advisory-lock + conditional-count path and
//   the chk_confirmed_le_needed invariant hold under genuine concurrency.
//
// DB AVAILABILITY
//   This property needs a direct Postgres connection. Following the pattern in
//   tests/migrations/run-smoke.js, we resolve a connection string from
//   SMOKE_DATABASE_URL -> DIRECT_URL -> DATABASE_URL and SKIP the whole suite cleanly
//   (exit 0, no failure) when only the 'supabase://use-rest-api' sentinel (or nothing)
//   is present. Seeded rows are removed in afterEach / afterAll.

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
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
    '[donor-accept-race] SKIP: no direct Postgres connection string found.\n' +
      '        Set SMOKE_DATABASE_URL, DIRECT_URL, or DATABASE_URL to a real\n' +
      '        Postgres/Supabase pooler URL to run the race-safety property test.',
  );
}

// A marker district used for safety-net cleanup in afterAll.
const SEED_DISTRICT = '__pbt_race__';

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
      max: 12,
    });
  }
  return pool;
}

// ─── Generic, schema-tolerant row seeding ────────────────────────────────────
// The base blood_requests / blood_donor_responses tables are created by the JS-15 v1
// schema (not by the spec migrations), so their full column set is unknown here. We
// introspect information_schema at runtime and auto-fill any NOT NULL column without a
// default (and that is not identity/generated), on top of the meaningful explicit values
// we provide. This keeps the seed robust across schema variations.

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
    if (meta.is_nullable === 'NO' && meta.column_default === null &&
        meta.is_identity === 'NO' && meta.is_generated === 'NEVER') {
      const { value, cast } = autoFill(meta);
      add(name, value, cast);
    }
  }

  const sql = `INSERT INTO "${table}" (${names.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`;
  const res = await client.query(sql, values);
  return res.rows[0].id as string;
}

// ─── Faithful replica of the route's HAAN advisory-lock transaction ──────────
// Mirrors src/app/api/blood-requests/donor-respond/route.ts (HAAN path) exactly.

type RespondOutcome = 'accepted' | 'standby' | 'not_found' | 'lock_timeout';

async function donorRespondHaan(
  bloodRequestId: string,
  donorId: string,
): Promise<RespondOutcome> {
  // Retry on lock_timeout (55P03) — should not occur for small K with a 5s timeout,
  // but keeps the property exact if the test DB is briefly contended.
  for (let attempt = 0; attempt < 4; attempt++) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");

      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [bloodRequestId]);

      const reqResult = await client.query(
        'SELECT donors_confirmed_count, units_needed FROM blood_requests WHERE id = $1 FOR UPDATE',
        [bloodRequestId],
      );

      if (reqResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return 'not_found';
      }

      const { donors_confirmed_count, units_needed } = reqResult.rows[0];
      let responseStatus: 'accepted' | 'standby';

      if (donors_confirmed_count < units_needed) {
        responseStatus = 'accepted';
        await client.query(
          'UPDATE blood_requests SET donors_confirmed_count = donors_confirmed_count + 1 WHERE id = $1',
          [bloodRequestId],
        );
      } else {
        responseStatus = 'standby';
        await client.query(
          'UPDATE blood_requests SET donors_standby_count = donors_standby_count + 1 WHERE id = $1',
          [bloodRequestId],
        );
      }

      await client.query(
        `UPDATE blood_donor_responses
            SET response_status = $1, responded_at = NOW()
          WHERE blood_request_id = $2 AND donor_id = $3`,
        [responseStatus, bloodRequestId, donorId],
      );

      await client.query(
        'UPDATE blood_donors SET total_offers_accepted = total_offers_accepted + 1 WHERE id = $1',
        [donorId],
      );

      await client.query('COMMIT');
      return responseStatus;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      const code = (err as { code?: string }).code;
      if (code === '55P03') {
        // lock_timeout — back off briefly and retry.
        await new Promise((r) => setTimeout(r, 50 + attempt * 50));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
  return 'lock_timeout';
}

// ─── Seed / cleanup helpers ──────────────────────────────────────────────────

interface SeededScenario {
  requestId: string;
  donorIds: string[];
}

async function seedScenario(unitsNeeded: number, donorCount: number): Promise<SeededScenario> {
  const client = await getPool().connect();
  try {
    const requestId = await insertRow(client, 'blood_requests', {
      blood_group: 'O+',
      district: SEED_DISTRICT,
      block: SEED_DISTRICT,
      units_needed: unitsNeeded,
      donors_confirmed_count: 0,
      donors_standby_count: 0,
      cascade_tier: 1,
      urgency: 'urgent',
      status: 'searching',
    });

    const donorIds: string[] = [];
    for (let i = 0; i < donorCount; i++) {
      const donorId = await insertRow(client, 'blood_donors', {
        phone: `+9190000${Date.now() % 1000000}${i}`.slice(0, 15),
        name: `PBT Donor ${i}`,
        blood_group: 'O+',
        gender: 'male',
        district: SEED_DISTRICT,
        block: SEED_DISTRICT,
        is_available: true,
        is_paused: false,
        permanently_deferred: false,
        total_offers_accepted: 0,
      });
      donorIds.push(donorId);

      await insertRow(client, 'blood_donor_responses', {
        blood_request_id: requestId,
        donor_id: donorId,
        response_status: 'pending',
      });
    }

    return { requestId, donorIds };
  } finally {
    client.release();
  }
}

async function cleanupScenario(s: SeededScenario): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('DELETE FROM blood_donor_responses WHERE blood_request_id = $1', [s.requestId]);
    if (s.donorIds.length > 0) {
      await client.query('DELETE FROM blood_donors WHERE id = ANY($1::uuid[])', [s.donorIds]);
    }
    await client.query('DELETE FROM blood_requests WHERE id = $1', [s.requestId]);
  } finally {
    client.release();
  }
}

// Track every scenario seeded so a crashing run still gets swept in afterAll.
const seeded: SeededScenario[] = [];

// ─── The property suite (skipped cleanly when no DB is configured) ───────────

describe.skipIf(SKIP)('Property 6: Race-safe donor acceptance (real DB)', () => {
  beforeAll(async () => {
    // Fail fast with a clear message if the configured DB is unreachable, rather
    // than letting every property iteration surface a confusing connection error.
    const client = await getPool().connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  });

  afterEach(async () => {
    // Clean up everything seeded during the iteration that just ran.
    while (seeded.length > 0) {
      const s = seeded.pop()!;
      await cleanupScenario(s).catch(() => {});
    }
  });

  afterAll(async () => {
    // Safety net: remove any leftover rows tagged with the seed district.
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query(
          `DELETE FROM blood_donor_responses
            WHERE blood_request_id IN (SELECT id FROM blood_requests WHERE district = $1)`,
          [SEED_DISTRICT],
        );
        await client.query('DELETE FROM blood_donors WHERE district = $1', [SEED_DISTRICT]);
        await client.query('DELETE FROM blood_requests WHERE district = $1', [SEED_DISTRICT]);
      } catch {
        /* ignore cleanup errors */
      } finally {
        client.release();
      }
      await pool.end();
      pool = null;
    }
  });

  /** Run one full scenario: seed, fire K concurrent HAANs, assert, clean up. */
  async function runScenario(unitsNeeded: number, donorCount: number): Promise<void> {
    const scenario = await seedScenario(unitsNeeded, donorCount);
    seeded.push(scenario);
    try {
      const expectedAccepted = Math.min(donorCount, unitsNeeded);
      const expectedStandby = donorCount - expectedAccepted;

      // K parallel accept calls — the heart of the race.
      const results = await Promise.allSettled(
        scenario.donorIds.map((donorId) => donorRespondHaan(scenario.requestId, donorId)),
      );

      // No call should have thrown (lock timeouts are retried internally).
      for (const r of results) {
        expect(r.status).toBe('fulfilled');
        if (r.status === 'fulfilled') {
          expect(['accepted', 'standby']).toContain(r.value);
        }
      }

      // Read the authoritative final DB state.
      const client = await getPool().connect();
      try {
        const reqRow = await client.query(
          'SELECT donors_confirmed_count, donors_standby_count, units_needed FROM blood_requests WHERE id = $1',
          [scenario.requestId],
        );
        const { donors_confirmed_count, donors_standby_count, units_needed } = reqRow.rows[0];

        const statusRows = await client.query(
          `SELECT response_status, COUNT(*)::int AS n
             FROM blood_donor_responses
            WHERE blood_request_id = $1
            GROUP BY response_status`,
          [scenario.requestId],
        );
        const counts: Record<string, number> = {};
        for (const row of statusRows.rows) counts[row.response_status] = row.n;
        const acceptedCount = counts['accepted'] ?? 0;
        const standbyCount = counts['standby'] ?? 0;

        // Invariant (Req 6.1 / 6.3): never over-accept.
        expect(donors_confirmed_count).toBeLessThanOrEqual(units_needed);

        // Exactly min(K, N) accepted (Req 6.2); the rest standby (Req 6.3).
        expect(acceptedCount).toBe(expectedAccepted);
        expect(standbyCount).toBe(expectedStandby);

        // The request counters agree with the response rows.
        expect(donors_confirmed_count).toBe(expectedAccepted);
        expect(donors_standby_count).toBe(expectedStandby);
      } finally {
        client.release();
      }
    } finally {
      // Per-iteration cleanup (afterEach is the safety net).
      const idx = seeded.indexOf(scenario);
      if (idx >= 0) seeded.splice(idx, 1);
      await cleanupScenario(scenario).catch(() => {});
    }
  }

  it('for K concurrent HAANs against units_needed=N, exactly min(K,N) accept and the rest standby', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          unitsNeeded: fc.integer({ min: 1, max: 4 }),
          donorCount: fc.integer({ min: 1, max: 6 }),
        }),
        async ({ unitsNeeded, donorCount }) => {
          await runScenario(unitsNeeded, donorCount);
        },
      ),
      { numRuns: 20, timeout: 20_000 },
    );
  }, 120_000);

  // ─── Anchored example cases (specific N/K combinations) ─────────────────────

  it('K=3 donors, N=1 unit -> 1 accepted, 2 standby', async () => {
    await runScenario(1, 3);
  });

  it('K=2 donors, N=2 units -> 2 accepted, 0 standby', async () => {
    await runScenario(2, 2);
  });

  it('K=5 donors, N=2 units -> 2 accepted, 3 standby', async () => {
    await runScenario(2, 5);
  });

  it('K=1 donor, N=3 units -> 1 accepted, 0 standby', async () => {
    await runScenario(3, 1);
  });
});
