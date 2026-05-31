/**
 * Semantic Cache — write-through with category-specific TTL (task 24.2).
 *
 * The companion to {@link ./lookup}. On a cache MISS the caller runs its v1
 * primary lookup (Status Code Path / Info Code Node) and then calls
 * {@link writeThrough} here to persist the freshly-computed response so that
 * future semantically-close queries are served from the cache
 * (Design §v1.1.7, Req 26.4–26.5).
 *
 * Pipeline (Design §v1.1.7 architecture diagram, MISS → WRITE branch):
 *   normalize (NFC + lowercase + whitespace collapse — reused from lookup.ts)
 *     → sha256 the normalized text into a stable `query_hash`
 *     → embed the normalized text (injected endpoint → 768-d vector)
 *     → INSERT … ON CONFLICT (query_hash) DO UPDATE into `query_cache`,
 *       setting `expires_at = now() + <category-specific interval>` and
 *       attributing the write with the current message's `trace_id`.
 *
 * ─── Category-specific TTL (Req 26.4) ────────────────────────────────────────
 * The design names the categories `ticket_status | scheme_info | help_list`
 * with TTLs 5 minutes / 7 days / 1 hour respectively. The ACTUAL shipped schema
 * (migration `20260201_003_handoff_guardrail_cache.sql`) constrains `category`
 * to `status | scheme | help`, so this module — like {@link ./lookup} — uses
 * the migration's values and applies the same TTL windows:
 *
 *   | Category | Design name     | TTL       |
 *   |----------|-----------------|-----------|
 *   | status   | ticket_status   | 5 minutes |
 *   | scheme   | scheme_info     | 7 days    |
 *   | help     | help_list       | 1 hour    |
 *
 * ─── Schema alignment (IMPORTANT) ────────────────────────────────────────────
 * The design's write SQL inserts `(id, query_hash, query_embedding, category,
 * response, ttl)`. The REAL `query_cache` table additionally requires
 * `query_text` (NOT NULL) and uses `expires_at` (NOT `ttl`); `id`, `hit_count`,
 * and `created_at` carry DEFAULTs. This module therefore writes
 * `query_hash, query_text, query_embedding, category, response, trace_id,
 * expires_at` and lets the table defaults populate the rest. `hit_count` is
 * intentionally NOT touched on a conflicting update, so an existing row's hit
 * tally survives a response refresh (matching the design's ON CONFLICT clause,
 * which only refreshes response / embedding / ttl).
 *
 * The `expires_at` is computed SERVER-SIDE (`now() + interval`) rather than in
 * JS so it shares the exact clock the {@link ./lookup} filter uses
 * (`expires_at > now()`), avoiding app/DB clock skew at the TTL boundary.
 *
 * The DB client and the embedding endpoint are INJECTED (same `DbClient` /
 * `EmbedFn` surface as {@link ./lookup}) so the function is unit-testable
 * against an in-memory mock without a live DB or embedding API.
 *
 * Wiring this write-through into the v1 Status Code Path and Info Code Node is
 * task 24.3 and is NOT part of this module.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.7 Semantic Cache
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 26.4, 26.5
 * @see supabase/migrations/20260201_003_handoff_guardrail_cache.sql — query_cache DDL
 */

import { createHash } from 'crypto';

import {
  normalizeQuery,
  toVectorLiteral,
  type Category,
  type DbClient,
  type EmbedFn,
} from './lookup';

// Re-export the shared cache types so consumers of the write path can import
// everything from one place without reaching into lookup.ts (additive only).
export { normalizeQuery, toVectorLiteral, type Category, type DbClient, type EmbedFn };

// ─── Constants ───────────────────────────────────────────────────────────────

const TABLE = 'query_cache';

/**
 * Category → Postgres interval literal for the write-through TTL (Req 26.4).
 *
 * Keys are the REAL migration categories (`status | scheme | help`); the values
 * are the TTL windows the design assigns to the design-named equivalents
 * (`ticket_status` 5 min / `scheme_info` 7 days / `help_list` 1 hour). Exposed
 * for unit tests and so the intervals live in exactly one place. The mapping is
 * applied server-side via the {@link WRITE_SQL} CASE expression.
 */
export const CATEGORY_TTL: Record<Category, string> = {
  status: '5 minutes',
  scheme: '7 days',
  help: '1 hour',
};

/**
 * Write-through upsert with a category-specific TTL.
 *
 * Columns written explicitly: `query_hash` ($1), `query_text` ($2),
 * `query_embedding` ($3, cast `::vector`), `category` ($4), `response` ($5),
 * `trace_id` ($6). `expires_at` is derived server-side as
 * `now() + (CASE category … END)` so it uses the same clock as the lookup's
 * `expires_at > now()` filter. `id`, `hit_count`, and `created_at` are left to
 * their table DEFAULTs.
 *
 * `ON CONFLICT (query_hash)` refreshes the response, query text, embedding,
 * category, trace attribution, and `expires_at` for an existing (possibly
 * expired) key. `hit_count` is deliberately NOT reset, preserving the running
 * hit tally across a response refresh (Design §v1.1.7 ON CONFLICT semantics).
 *
 * The CASE keys use the migration's category values. A category outside the
 * CHECK set would make the CASE yield NULL and violate `expires_at NOT NULL`,
 * surfacing the bad input as a DB error rather than silently caching forever.
 */
const WRITE_SQL = `INSERT INTO ${TABLE}
    (query_hash, query_text, query_embedding, category, response, trace_id, expires_at)
  VALUES (
    $1, $2, $3::vector, $4, $5, $6,
    now() + (CASE $4
               WHEN 'status' THEN interval '5 minutes'
               WHEN 'scheme' THEN interval '7 days'
               WHEN 'help'   THEN interval '1 hour'
             END)
  )
  ON CONFLICT (query_hash) DO UPDATE
     SET query_text      = EXCLUDED.query_text,
         query_embedding = EXCLUDED.query_embedding,
         category        = EXCLUDED.category,
         response        = EXCLUDED.response,
         trace_id        = EXCLUDED.trace_id,
         expires_at      = EXCLUDED.expires_at
  RETURNING id, query_hash, hit_count, expires_at`;

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Outcome of {@link writeThrough}: the persisted row's identity plus the
 * resolved TTL boundary. `hit_count` reflects the post-upsert value (0 for a
 * brand-new row, or the preserved tally for a refreshed one).
 */
export interface WriteThroughResult {
  id: string;
  query_hash: string;
  hit_count: number;
  expires_at: string;
}

/** Injected dependencies for {@link writeThrough}. */
export interface WriteThroughDeps {
  /** Embedding endpoint (same surface as the lookup path). */
  embed: EmbedFn;
  /** pg-style DB client (same surface as the lookup path). */
  db: DbClient;
  /**
   * Current message's trace id (v1.1.8) for last-write attribution. Optional —
   * stored as NULL when omitted, matching `query_cache.trace_id` being
   * nullable.
   */
  traceId?: string | null;
}

// ─── Query hashing ─────────────────────────────────────────────────────────

/**
 * Hash a raw message into the stable `query_cache.query_hash` cache key.
 *
 * Reuses {@link normalizeQuery} (NFC + lowercase + whitespace collapse + trim)
 * from the lookup module so the WRITE side keys rows identically to how the
 * READ side normalizes, then takes `sha256(normalized)` as lowercase hex — a
 * fixed-width, UNIQUE-index-friendly key, matching the
 * `router_classifier_cache` hashing convention in `src/lib/router/cache.ts`.
 *
 * Pure function: case / whitespace / NFC variants of one query collapse to a
 * single `query_hash`, so they upsert the same row instead of accumulating
 * near-duplicate cache entries.
 *
 * @example hashQuery("  My Ticket  WB-2026-00042 ") // sha256 hex of "my ticket wb-2026-00042"
 */
export function hashQuery(message: string): string {
  const normalized = normalizeQuery(message);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// ─── Write-through ─────────────────────────────────────────────────────────

/**
 * Store a freshly-computed primary-lookup `response` in the semantic cache with
 * a category-specific TTL (Design §v1.1.7, Req 26.4–26.5).
 *
 * Intended to be called on a cache MISS, AFTER the caller has run its v1
 * primary lookup:
 *   1. {@link normalizeQuery} the message and {@link hashQuery} it into the
 *      `query_hash` upsert key.
 *   2. {@link EmbedFn embed} the normalized text into a dense vector (same
 *      embedding the lookup will later compare against) and serialize it with
 *      {@link toVectorLiteral}.
 *   3. Upsert via {@link WRITE_SQL}: `expires_at = now() + <category TTL>`
 *      (5 min `status` / 7 days `scheme` / 1 hour `help`), attributing the
 *      write with `traceId`. An existing key is refreshed in place with its
 *      `hit_count` preserved.
 *
 * @param message  Raw inbound query text (same value passed to the lookup).
 * @param category Cache category to store under (`status | scheme | help`).
 * @param response Primary-lookup response text to cache.
 * @param deps     Injected `embed`, pg-style `db`, and optional `traceId`.
 * @returns        The persisted row's id, hash, hit_count, and expiry.
 */
export async function writeThrough(
  message: string,
  category: Category,
  response: string,
  deps: WriteThroughDeps,
): Promise<WriteThroughResult> {
  const { embed, db, traceId = null } = deps;

  // 1) Normalize → hash (upsert key) + keep the normalized text for query_text.
  const normalized = normalizeQuery(message);
  const queryHash = hashQuery(message);

  // 2) Embed the normalized text → pgvector literal ($3 ::vector).
  const embedding = await embed(normalized);
  const vectorLiteral = toVectorLiteral(embedding);

  // 3) Upsert with category-specific, server-computed TTL + trace attribution.
  const result = await db.query<{
    id: string;
    query_hash: string;
    hit_count: number | string;
    expires_at: string;
  }>(WRITE_SQL, [queryHash, normalized, vectorLiteral, category, response, traceId]);

  const row = result.rows[0];

  return {
    id: row?.id ?? '',
    query_hash: row?.query_hash ?? queryHash,
    hit_count: toCount(row?.hit_count),
    expires_at: row?.expires_at ?? '',
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Coerce a `hit_count` value to a finite integer. Postgres `integer` arrives as
 * a JS number via node-postgres, but a non-parsing client may surface it as a
 * string — normalize both to a number. Mirrors the helper in {@link ./lookup}.
 */
function toCount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
