#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// Runner for tests/migrations/smoke.sql (sahayak-multi-agent-router task 1.9)
// =============================================================================
// Executes the portable SQL smoke test against a Postgres / Supabase database
// using the `pg` client already present in this project — no `psql` binary or
// pgTAP extension required.
//
// Usage:
//   node tests/migrations/run-smoke.js                  # runs smoke.sql (v1)
//   node tests/migrations/run-smoke.js v1_1_smoke.sql   # runs the v1.1 batch
//   DATABASE_URL=postgres://... node tests/migrations/run-smoke.js
//
// The optional first CLI argument selects which .sql file (relative to this
// directory) to execute. It defaults to smoke.sql so existing callers are
// unaffected. The argument is resolved against __dirname and must stay inside
// it (no path traversal).
//
// Connection string resolution order:
//   1. process.env.SMOKE_DATABASE_URL
//   2. process.env.DIRECT_URL
//   3. process.env.DATABASE_URL
//
// The `supabase://use-rest-api` sentinel used by this repo's `.env` is NOT a
// real connection string — the smoke test needs a direct Postgres connection
// (the Supabase session/transaction pooler URL works). If only the sentinel is
// present, the runner exits with a clear, non-failing SKIP message so it does
// not break pipelines that run entirely over the REST API.
//
// Exit codes:
//   0  all assertions passed (or skipped because no direct DB URL is available)
//   1  one or more assertions failed, or the SQL could not be executed
// =============================================================================

const fs = require('fs');
const path = require('path');

const SENTINEL = 'supabase://use-rest-api';

function resolveConnectionString() {
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

function resolveSqlFile() {
  const arg = process.argv[2];
  const fileName = arg && arg.trim() ? arg.trim() : 'smoke.sql';
  // Resolve against this directory and refuse anything that escapes it.
  const resolved = path.resolve(__dirname, fileName);
  if (path.dirname(resolved) !== path.resolve(__dirname)) {
    console.error(
      `[smoke] FAIL: refusing to run "${fileName}" — the SQL file must live in ${__dirname}.`
    );
    process.exit(1);
  }
  return resolved;
}

async function main() {
  const connectionString = resolveConnectionString();
  const sqlPath = resolveSqlFile();
  const sqlLabel = path.basename(sqlPath);
  if (!connectionString) {
    console.log(
      `[smoke] SKIP (${sqlLabel}): no direct Postgres connection string found.\n` +
        '        Set SMOKE_DATABASE_URL, DIRECT_URL, or DATABASE_URL to a real\n' +
        '        Postgres/Supabase pooler URL to run migration smoke tests.'
    );
    process.exit(0);
  }

  let Client;
  try {
    ({ Client } = require('pg'));
  } catch (err) {
    console.error('[smoke] FAIL: the "pg" package is not installed.', err.message);
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Supabase requires TLS; allow self-signed for the pooler endpoint.
  const useSsl = /supabase\.(co|com|in)/i.test(connectionString) || process.env.PGSSLMODE === 'require';
  const client = new Client({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  console.log(`[smoke] connecting... (${sqlLabel})`);
  try {
    await client.connect();
  } catch (err) {
    console.error('[smoke] FAIL: could not connect to the database:', err.message);
    process.exit(1);
  }

  try {
    // node-postgres returns an array of results for a multi-statement query.
    const results = await client.query(sql);
    const resultArray = Array.isArray(results) ? results : [results];

    // Print the TAP rows emitted by the SELECT in section 4.
    for (const r of resultArray) {
      if (r && r.rows && r.rows.length && Object.prototype.hasOwnProperty.call(r.rows[0], 'tap')) {
        for (const row of r.rows) console.log(row.tap);
      }
    }
    console.log(`\n[smoke] PASS: all migration smoke assertions passed (${sqlLabel}).`);
    await client.end();
    process.exit(0);
  } catch (err) {
    // The final DO block RAISEs EXCEPTION with the list of failed assertions.
    console.error('\n[smoke] FAIL:');
    console.error(err.message);
    try {
      await client.end();
    } catch (_) {
      /* ignore */
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[smoke] unexpected error:', err);
  process.exit(1);
});
