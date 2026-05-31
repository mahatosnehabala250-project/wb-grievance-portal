/**
 * Semantic Cache — embedding-then-search lookup (task 24.1).
 *
 * A pgvector-backed cache that short-circuits the v1 Status Code Path and the
 * Info Code Node when an inbound query is semantically close (cosine ≥ 0.92)
 * to a recent, non-expired query (Design §v1.1.7, Req 26.1–26.3).
 *
 * Pipeline (Design §v1.1.7 architecture diagram):
 *   normalize (NFC + lowercase + whitespace collapse)
 *     → embed (injected embedding endpoint → 768-d vector)
 *     → pgvector cosine ANN search against `query_cache`
 *       filtered by `category` and non-expired rows
 *     → on a match with sim ≥ 0.92: return the cached response and
 *       atomically increment `hit_count` (Req 26.3)
 *     → otherwise: report a miss so the caller runs the v1 primary lookup.
 *
 * The write-through on a miss is task 24.2 (`writeThrough.ts`) and is NOT part
 * of this module.
 *
 * Circuit breaker (task 27.2, Req 29.1 / 29.4):
 *   The `embed(...)` call is wrapped with the `embeddings` circuit breaker from
 *   `src/lib/breaker/breaker.ts`. When the breaker is open, `lookup` returns
 *   `{ hit: false }` immediately (cache miss) so the caller falls through to
 *   the v1 primary lookup — the semantic cache is bypassed entirely (Design
 *   §v1.1.10, Req 29.4). The breaker store is injectable via
 *   `deps.breakerStore` for testing.
 *
 * ─── Design-vs-migration schema mismatch (IMPORTANT) ─────────────────────────
 * The design (§v1.1.7) and Req 26.2/26.4 describe the table with a `ttl`
 * column and category values `ticket_status | scheme_info | help_list`, and a
 * `response jsonb` column. The ACTUAL shipped schema in migration
 * `20260201_003_handoff_guardrail_cache.sql` differs:
 *
 *   query_cache (
 *     id              uuid PK,
 *     query_hash      text UNIQUE NOT NULL,
 *     query_text      text NOT NULL,
 *     query_embedding vector(768),
 *     category        text NOT NULL CHECK (category IN ('status','scheme','help')),
 *     response        text NOT NULL,          -- text, not jsonb
 *     hit_count       int  NOT NULL DEFAULT 0,
 *     trace_id        uuid,
 *     created_at      timestamptz NOT NULL DEFAULT now(),
 *     expires_at      timestamptz NOT NULL    -- NOT `ttl`
 *   )
 *
 * This module is written against the REAL migration schema: it filters on
 * `expires_at > now()` (not `ttl`) and its {@link Category} type matches the
 * CHECK constraint (`status | scheme | help`). The cached response is returned
 * as a `string` (the column is `text`). Aligning the lookup to the values that
 * are actually stored is required for the search to match any rows.
 *
 * The DB client is INJECTED (pg-style `query(sql, params) => { rows }`) and the
 * embedding endpoint is INJECTED (`embed(text) => Promise<number[]>`) so the
 * function is unit-testable against an in-memory mock without a live DB or a
 * live embedding API — following the injectable-client convention in
 * `src/lib/router/cache.ts` and `src/lib/sessions/prepareContext.ts`. The 0.92
 * cosine threshold and the `category` / expiry filter live in the SQL.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.7 Semantic Cache
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.10 Circuit Breakers
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 26.1, 26.2, 26.3, 29.1, 29.4
 * @see supabase/migrations/20260201_003_handoff_guardrail_cache.sql — query_cache DDL
 */

import { withBreaker, isBreakerOpenError, type BreakerStore } from '../breaker/breaker';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Cache category, matching the `chk_cache_category` CHECK constraint in
 * migration `20260201_003`. NOTE: the design/requirements name these
 * `ticket_status | scheme_info | help_list`, but the shipped column only
 * accepts `status | scheme | help`. We use the migration's values because the
 * lookup must match what is actually stored.
 */
export type Category = 'status' | 'scheme' | 'help';

/** A single row returned by a DB query (node-postgres `{ rows }` shape). */
export interface DbQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
}

/**
 * Minimal injectable DB client surface.
 *
 * Matches the node-postgres `Pool`/`Client` shape (`query(text, params)`
 * resolving to `{ rows }`). Callers inject the real pg client in production and
 * a lightweight mock in tests. Declared structurally so any object exposing a
 * compatible `query` method satisfies it. A pg-style client (rather than the
 * Supabase query builder) is required because the pgvector `<=>` ANN search and
 * the atomic `UPDATE ... RETURNING` hit-count increment are not expressible
 * cleanly through the Supabase builder.
 */
export interface DbClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<DbQueryResult<Row>>;
}

/**
 * Injectable embedding function. Takes the normalized query text and returns a
 * dense embedding vector. In production this wraps the cached embedding
 * endpoint (e.g. a Gemini / text-embedding model producing a 768-d vector to
 * match `query_embedding vector(768)`); in tests it is a deterministic stub.
 */
export type EmbedFn = (text: string) => Promise<number[]>;

/** Result of {@link lookup}: a discriminated union over the hit flag. */
export type LookupResult =
  | { hit: true; response: string; hit_count: number }
  | { hit: false };

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum cosine similarity for a cache hit (Design §v1.1.7, Req 26.3). */
export const SIMILARITY_THRESHOLD = 0.92;

const TABLE = 'query_cache';

/**
 * Single-statement cosine ANN lookup with an atomic hit-count increment.
 *
 * The `ranked` CTE performs the pgvector approximate-nearest-neighbour search
 * (`ORDER BY query_embedding <=> $1::vector LIMIT 1`) over non-expired rows of
 * the requested category, computing cosine similarity as
 * `1 - (query_embedding <=> $1::vector)`. The outer `UPDATE` only fires when
 * that single nearest row clears the 0.92 threshold; it increments `hit_count`
 * and returns the cached `response` together with the post-increment count
 * (Req 26.3). When no row clears the threshold (or all are expired) the
 * statement returns zero rows → a cache miss.
 *
 * Doing the search + threshold filter + increment in one statement keeps the
 * hit recording race-free: there is no read-then-write gap during which a
 * concurrent caller could double-count or miss the increment.
 *
 * Params: $1 = query embedding (pgvector literal), $2 = category.
 *
 * Schema note: filters on `expires_at` (the real migration column), NOT the
 * `ttl` name used in the design pseudocode.
 */
const LOOKUP_SQL = `WITH ranked AS (
  SELECT id,
         response,
         hit_count,
         1 - (query_embedding <=> $1::vector) AS sim
    FROM ${TABLE}
   WHERE category = $2
     AND expires_at > now()
     AND query_embedding IS NOT NULL
   ORDER BY query_embedding <=> $1::vector
   LIMIT 1
)
UPDATE ${TABLE} AS q
   SET hit_count = q.hit_count + 1
  FROM ranked
 WHERE q.id = ranked.id
   AND ranked.sim >= ${SIMILARITY_THRESHOLD}
RETURNING q.response AS response, q.hit_count AS hit_count`;

// ─── Normalization ─────────────────────────────────────────────────────────

/**
 * Normalize a raw message into stable query text for embedding.
 *
 * Steps (Design §v1.1.7 "Normalize message NFC + lowercase"):
 *   1. Unicode NFC normalization (canonical composition).
 *   2. Lowercase.
 *   3. Collapse runs of whitespace (incl. non-breaking / wide spaces — JS `\s`
 *      matches `\u00A0`, `\u2028`, `\u3000`, etc.) to a single space.
 *   4. Trim leading / trailing whitespace.
 *
 * Pure function: the same input always yields the same normalized text, so
 * whitespace and case variants of one query embed identically. Unlike
 * `src/lib/router/cache.ts#normalize` (which returns a sha256 hash for use as a
 * cache key), this returns the normalized TEXT because the embedding step
 * consumes text.
 *
 * @example normalizeQuery("  My Ticket  WB-2026-00042 ?") // "my ticket wb-2026-00042 ?"
 */
export function normalizeQuery(input: string): string {
  return (input ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Serialize a numeric embedding into a pgvector text literal (`[a,b,c]`) so it
 * can be bound as a parameter and cast with `::vector` in SQL. node-postgres
 * does not natively serialize a JS number array to pgvector's wire format, so
 * we format it explicitly. Non-finite values (NaN/Infinity) are coerced to `0`
 * to keep the literal parseable by pgvector.
 */
export function toVectorLiteral(embedding: number[]): string {
  const parts = embedding.map((n) => (Number.isFinite(n) ? n : 0));
  return `[${parts.join(',')}]`;
}

// ─── Lookup ──────────────────────────────────────────────────────────────────

/**
 * Look up a semantically-close cached response for `message` within `category`.
 *
 * Flow (Design §v1.1.7, Req 26.1–26.3):
 *   1. {@link normalizeQuery} the message (NFC + lowercase + whitespace).
 *   2. {@link embed} the normalized text into a dense vector — wrapped with the
 *      `embeddings` circuit breaker (task 27.2, Req 29.1 / 29.4). When the
 *      breaker is open, `lookup` returns `{ hit: false }` immediately so the
 *      caller falls through to the v1 primary lookup (semantic cache bypassed).
 *   3. Run the cosine ANN search ({@link LOOKUP_SQL}) over non-expired rows of
 *      `category`. The 0.92 threshold and the category/expiry filter are in the
 *      SQL.
 *   4. On a match: the same statement increments `hit_count` atomically and
 *      returns `{ hit: true, response, hit_count }` where `hit_count` is the
 *      post-increment value reflecting this hit.
 *   5. On no match (sim < 0.92, all expired, or empty table): return
 *      `{ hit: false }` so the caller runs the v1 primary lookup (write-through
 *      is task 24.2).
 *
 * @param message  Raw inbound query text.
 * @param category Cache category to search (`status | scheme | help`).
 * @param deps     Injected `embed` function, pg-style `db` client, and optional
 *                 `breakerStore` for the `embeddings` circuit breaker.
 * @returns        A hit (with response + post-increment hit_count) or a miss.
 */
export async function lookup(
  message: string,
  category: Category,
  deps: { embed: EmbedFn; db: DbClient; breakerStore?: BreakerStore },
): Promise<LookupResult> {
  const { embed, db } = deps;

  // 1) Normalize the message.
  const normalized = normalizeQuery(message);

  // 2) Embed — wrapped with the `embeddings` circuit breaker (Req 29.1 / 29.4).
  //    When the breaker is open, `withBreaker` throws `BreakerOpenError` and we
  //    return a cache miss immediately (semantic cache bypassed per Req 29.4).
  let embedding: number[];
  try {
    embedding = await withBreaker(
      'embeddings',
      () => embed(normalized),
      { store: deps.breakerStore },
    );
  } catch (err) {
    if (isBreakerOpenError(err)) {
      // Embeddings breaker open — bypass the semantic cache (Req 29.4).
      return { hit: false };
    }
    // Re-throw unexpected errors so the caller can handle them.
    throw err;
  }

  const vectorLiteral = toVectorLiteral(embedding);

  // 3-4) Cosine ANN search + atomic hit-count increment (threshold in SQL).
  const result = await db.query<{ response: string; hit_count: number | string }>(
    LOOKUP_SQL,
    [vectorLiteral, category],
  );

  const row = result.rows[0];
  if (!row) {
    // 5) Miss — caller runs the v1 primary lookup.
    return { hit: false };
  }

  return {
    hit: true,
    response: row.response,
    hit_count: toCount(row.hit_count),
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Coerce a `hit_count` value to a finite integer. Postgres `integer` arrives as
 * a JS number via node-postgres, but a non-parsing client may surface it as a
 * string — normalize both to a number.
 */
function toCount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
