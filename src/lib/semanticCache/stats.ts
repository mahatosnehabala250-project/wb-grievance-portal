/**
 * Semantic Cache — hit-rate aggregation (task 24.6).
 *
 * Pure, DB-free aggregation of `query_cache` rows into per-category cache
 * hit-rate statistics over one or more time windows. This powers the
 * `/dashboard/agents` cache-hit-rate widget (Req 26.6) and the
 * `GET /api/cache/stats` admin endpoint.
 *
 * ─── Metric definition (Req 26.6 — Design §v1.1.7) ───────────────────────────
 * `query_cache` is a write-on-miss cache: the write-through (task 24.2) INSERTs
 * a row the first time a query is seen (a *miss*) and increments `hit_count`
 * every subsequent time a semantically-close query is served from cache (a
 * *hit*, Req 26.3). So for a set of rows in a window:
 *
 *   hits   = Σ hit_count        — number of requests served from cache
 *   misses = row count          — number of cached entries (each created on a miss)
 *   total  = hits + misses      — total requests routed through the cache
 *   hit_rate = hits / total     — 0 when total === 0
 *
 * `misses = row count` is the best available proxy for cold lookups given the
 * shipped schema (no separate miss counter). Because the write-through upserts
 * `ON CONFLICT (query_hash)`, a query that misses, expires, and misses again
 * refreshes its existing row rather than inserting a new one, so this can
 * slightly UNDER-count misses — an acknowledged approximation. The task brief
 * explicitly sanctions "sum of hit_count, row counts, by category".
 *
 * Windowing uses each row's write timestamp (`created_at`): a row counts toward
 * a window when `created_at >= now - window`. This matches the design's
 * "sourced from `query_cache.hit_count` and write timestamps".
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.7 Semantic Cache
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 26.6
 * @see supabase/migrations/20260201_003_handoff_guardrail_cache.sql — query_cache DDL
 */

// ─── Categories (mirror the chk_cache_category CHECK constraint) ──────────────

/**
 * Cache categories accepted by the `chk_cache_category` CHECK constraint in
 * migration `20260201_003`. The design/requirements name these
 * `ticket_status | scheme_info | help_list`, but the shipped column only stores
 * `status | scheme | help` — we report the values that are actually stored
 * (same decision as `lookup.ts` / `write.ts`).
 */
export const CACHE_CATEGORIES = ['status', 'scheme', 'help'] as const;
export type CacheCategory = (typeof CACHE_CATEGORIES)[number];

// ─── Types ────────────────────────────────────────────────────────────────────

/** A minimal `query_cache` row needed for hit-rate aggregation. */
export interface CacheStatsRow {
  category: string;
  hit_count: number | string | null;
  created_at: string;
}

/** Hit-rate stats for a single category (or the "all" rollup). */
export interface CategoryStat {
  /** `status | scheme | help`, or `all` for the cross-category rollup. */
  category: string;
  /** Σ hit_count — requests served from cache. */
  hits: number;
  /** Row count — cached entries (each created on a miss). */
  misses: number;
  /** hits + misses — total requests routed through the cache. */
  total: number;
  /** hits / total in [0, 1]; 0 when total === 0. Rounded to 4 decimals. */
  hit_rate: number;
}

/** Aggregated stats for one time window. */
export interface WindowStats {
  /** Window label, e.g. `24h` or `7d`. */
  window: string;
  /** Inclusive lower bound of the window as an ISO string. */
  since: string;
  /** One entry per category in {@link CACHE_CATEGORIES} (zero-filled). */
  categories: CategoryStat[];
  /** Cross-category rollup (category === `all`). */
  overall: CategoryStat;
}

/** A window definition: a label and its duration in milliseconds. */
export interface WindowDef {
  label: string;
  ms: number;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Default windows surfaced by the widget: last 24 hours and last 7 days. */
export const DEFAULT_WINDOWS: WindowDef[] = [
  { label: '24h', ms: 24 * HOUR_MS },
  { label: '7d', ms: 7 * DAY_MS },
];

/** Largest default window (used to bound the DB fetch). */
export const MAX_DEFAULT_WINDOW_MS = Math.max(...DEFAULT_WINDOWS.map((w) => w.ms));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Coerce a possibly-stringified pg integer to a finite, non-negative number. */
function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** hits / total in [0, 1], rounded to 4 decimals; 0 when total === 0. */
function rate(hits: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((hits / total) * 10_000) / 10_000;
}

/** Finalize accumulated hits/misses into a {@link CategoryStat}. */
function finalize(category: string, hits: number, misses: number): CategoryStat {
  const total = hits + misses;
  return { category, hits, misses, total, hit_rate: rate(hits, total) };
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Aggregate cache rows into per-category hit-rate stats for a single window.
 *
 * Only rows whose `created_at` is at or after `now - window.ms` are counted.
 * Every category in {@link CACHE_CATEGORIES} appears in `categories` (zero-filled
 * when no rows match), so the widget always renders a stable, ordered set.
 * Rows with an unknown category are folded into the `overall` rollup but not
 * into any per-category bucket.
 *
 * Pure: depends only on its arguments.
 */
export function aggregateWindow(
  rows: CacheStatsRow[],
  window: WindowDef,
  now: number,
): WindowStats {
  const sinceMs = now - window.ms;

  // Per-category accumulators, seeded with every known category.
  const hitsBy = new Map<string, number>();
  const missesBy = new Map<string, number>();
  for (const c of CACHE_CATEGORIES) {
    hitsBy.set(c, 0);
    missesBy.set(c, 0);
  }

  let overallHits = 0;
  let overallMisses = 0;

  for (const row of rows) {
    const createdMs = new Date(row.created_at).getTime();
    if (!Number.isFinite(createdMs) || createdMs < sinceMs) continue;

    const hits = toCount(row.hit_count);
    overallHits += hits;
    overallMisses += 1; // each row is one cached entry == one initial miss

    const category = row.category;
    if (hitsBy.has(category)) {
      hitsBy.set(category, hitsBy.get(category)! + hits);
      missesBy.set(category, missesBy.get(category)! + 1);
    }
  }

  const categories = CACHE_CATEGORIES.map((c) =>
    finalize(c, hitsBy.get(c)!, missesBy.get(c)!),
  );

  return {
    window: window.label,
    since: new Date(sinceMs).toISOString(),
    categories,
    overall: finalize('all', overallHits, overallMisses),
  };
}

/**
 * Aggregate cache rows into hit-rate stats for several windows at once.
 *
 * @param rows    `query_cache` rows (category, hit_count, created_at).
 * @param now     Reference "now" in epoch ms (defaults to `Date.now()`).
 * @param windows Window definitions (defaults to {@link DEFAULT_WINDOWS}).
 */
export function aggregateCacheStats(
  rows: CacheStatsRow[],
  now: number = Date.now(),
  windows: WindowDef[] = DEFAULT_WINDOWS,
): WindowStats[] {
  return windows.map((w) => aggregateWindow(rows, w, now));
}
