/**
 * Router Classifier Cache (task 18.2).
 *
 * Normalize + lookup-or-classify write-through helpers for the
 * `router_classifier_cache` table. The cache lets the Hybrid CEO Router avoid
 * redundant Gemini Flash classifier calls for repeated or near-identical
 * messages within a 7-day TTL window (Design §v1.1.1).
 *
 * Authoritative table shape (Design §v1.1.1, Req 34.1):
 *   router_classifier_cache (
 *     query_hash text PRIMARY KEY,         -- sha256(normalized message) hex
 *     decision   jsonb NOT NULL,           -- { agent, secondary_agent, rationale }
 *     confidence numeric NOT NULL,         -- classifier confidence in [0, 1]
 *     ttl        timestamptz NOT NULL,     -- now() + 7 days at write time
 *     hit_count  int NOT NULL DEFAULT 0,   -- atomically incremented on each hit
 *     created_at timestamptz NOT NULL DEFAULT now()
 *   )
 *
 * Key design points faithful to the §v1.1.1 pseudocode:
 *   - The cache KEY is `sha256(normalized)` hex (a fixed-width, index-friendly
 *     key) rather than the raw normalized text.
 *   - The cache LOOKUP is a single atomic `UPDATE ... WHERE ttl > now()
 *     RETURNING ...` that increments `hit_count` in the same statement, so a
 *     hit both reads the decision and records the hit without a race.
 *   - On a miss we call {@link classify} (the Gemini Flash wrapper in
 *     `./classifier`) and WRITE THROUGH with `INSERT ... ON CONFLICT DO UPDATE`
 *     and a 7-day TTL.
 *
 * The DB client is INJECTED (pg-style `query(sql, params) => { rows }`) so the
 * function is unit-testable against an in-memory mock without a live DB,
 * following the injectable-client convention in
 * `src/lib/sessions/prepareContext.ts`. A pg-style client is required (rather
 * than the Supabase query builder) because the atomic `UPDATE ... RETURNING`
 * with `hit_count = hit_count + 1` and the jsonb `ON CONFLICT` upsert are not
 * expressible cleanly through the Supabase builder.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.1 (normalization + lookup)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 20.3, 20.4
 */

import { createHash } from 'crypto';

import { classify } from './classifier';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Language hint accepted by the classifier (Design §v1.1.1 `Lang`). */
export type Lang = 'en' | 'hi' | 'bn';

/**
 * The cached decision payload stored in `router_classifier_cache.decision`
 * (jsonb). This is the `ClassifierOutput` minus the per-call telemetry
 * (`latency_ms`, `total_tokens`), per Design §v1.1.1.
 */
export interface CachedDecision {
  agent: string;
  secondary_agent: string | null;
  rationale: string;
}

/**
 * Result of {@link lookupOrClassify}: the decision fields plus the resolved
 * `confidence` and a `fromCache` flag telling the caller whether the value was
 * served from the cache (true) or freshly classified (false).
 */
export interface LookupOrClassifyResult extends CachedDecision {
  confidence: number;
  fromCache: boolean;
}

/** A single row returned by a DB query. */
export interface DbQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
}

/**
 * Minimal injectable DB client surface.
 *
 * Matches the node-postgres `Pool`/`Client` shape (`query(text, params)`
 * resolving to `{ rows }`). Callers inject the real pg client in production and
 * a lightweight mock in tests. Declared structurally so any object exposing a
 * compatible `query` method satisfies it.
 */
export interface DbClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<DbQueryResult<Row>>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Cache TTL in days (Design §v1.1.1 — 7-day write-through). */
export const TTL_DAYS = 7;

const TABLE = 'router_classifier_cache';

/**
 * Atomic cache lookup. The `UPDATE ... RETURNING` increments `hit_count` and
 * returns the decision in a single statement, so a hit is recorded without a
 * separate read+write race. Expired rows (`ttl <= now()`) match nothing.
 */
const LOOKUP_SQL = `UPDATE ${TABLE}
        SET hit_count = hit_count + 1
      WHERE query_hash = $1 AND ttl > now()
    RETURNING decision, confidence`;

/**
 * Write-through upsert with a 7-day TTL. `ON CONFLICT` refreshes the decision,
 * confidence, and TTL for an existing (possibly expired) key.
 */
const WRITE_SQL = `INSERT INTO ${TABLE} (query_hash, decision, confidence, ttl)
     VALUES ($1, $2, $3, now() + interval '7 days')
     ON CONFLICT (query_hash)
     DO UPDATE SET decision = EXCLUDED.decision,
                   confidence = EXCLUDED.confidence,
                   ttl = EXCLUDED.ttl`;

// ─── Normalization ─────────────────────────────────────────────────────────

/**
 * Normalize a raw message into a stable cache key.
 *
 * Steps (order matters — Design §v1.1.1 normalization rules):
 *   1. Unicode NFC normalization (canonical composition).
 *   2. Lowercase (locale-insensitive `toLowerCase()`).
 *   3. Collapse runs of whitespace (incl. non-breaking spaces — JS `\s`
 *      matches `\u00A0`, `\u2028`, `\u3000`, etc.) to a single space.
 *   4. Trim leading / trailing whitespace.
 *   5. Compute `sha256(normalized)` → lowercase hex.
 *
 * Pure function — the same input always yields the same hex digest, so
 * whitespace and case variants of the same message collapse to one cache key
 * (Property 16: classifier cache idempotence).
 *
 * @example normalize("  Blood   CHAHIYE ") // => sha256 hex of "blood chahiye"
 */
export function normalize(input: string): string {
  const normalized = (input ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// ─── Cache lookup-or-classify ────────────────────────────────────────────────

/**
 * Look up a classifier decision in the cache, or classify on a miss and write
 * through with a 7-day TTL (Design §v1.1.1 pseudocode).
 *
 * Flow:
 *   1. Hash the message into a `query_hash` via {@link normalize}.
 *   2. Atomically `UPDATE ... RETURNING` to fetch a non-expired decision and
 *      bump `hit_count` (Req 20.4). On a hit, return it with `fromCache: true`.
 *   3. On a miss, call {@link classify} (Gemini Flash wrapper) — Req 20.2.
 *   4. Write the decision through with `INSERT ... ON CONFLICT DO UPDATE` and a
 *      7-day TTL (Req 20.3), then return it with `fromCache: false`.
 *
 * @param message  Raw inbound message text.
 * @param language Language hint forwarded to the classifier on a miss.
 * @param traceId  Request trace id (v1.1.8) forwarded to the classifier.
 * @param db       Injected pg-style DB client.
 */
export async function lookupOrClassify(
  message: string,
  language: Lang,
  traceId: string,
  db: DbClient,
): Promise<LookupOrClassifyResult> {
  const key = normalize(message);

  // 1) Cache lookup with atomic hit_count increment (Req 20.4).
  const hit = await db.query<{ decision: unknown; confidence: unknown }>(LOOKUP_SQL, [key]);
  const row = hit.rows[0];
  if (row) {
    const decision = coerceDecision(row.decision);
    return {
      ...decision,
      confidence: toNumber(row.confidence),
      fromCache: true,
    };
  }

  // 2) Miss → classify (Req 20.2).
  const out = await classify({ message, language, traceId });
  const decision: CachedDecision = {
    agent: out.agent,
    secondary_agent: out.secondary_agent ?? null,
    rationale: out.rationale,
  };

  // 3) Write through with a 7-day TTL (Req 20.3).
  await db.query(WRITE_SQL, [key, decision, out.confidence]);

  return {
    ...decision,
    confidence: out.confidence,
    fromCache: false,
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Coerce a jsonb `decision` value (already parsed by the pg driver, or a JSON
 * string from a non-parsing client) into a well-formed {@link CachedDecision}.
 */
function coerceDecision(value: unknown): CachedDecision {
  let obj: Record<string, unknown> = {};
  if (typeof value === 'string') {
    try {
      obj = JSON.parse(value) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  } else if (value && typeof value === 'object') {
    obj = value as Record<string, unknown>;
  }

  return {
    agent: typeof obj.agent === 'string' ? obj.agent : 'welcome',
    secondary_agent: typeof obj.secondary_agent === 'string' ? obj.secondary_agent : null,
    rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
  };
}

/**
 * Coerce a value to a finite number. Postgres returns `numeric` columns as
 * strings via node-postgres, so the cached `confidence` arrives as a string.
 */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
