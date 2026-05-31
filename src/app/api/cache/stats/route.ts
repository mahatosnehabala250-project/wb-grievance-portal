import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';
import {
  aggregateCacheStats,
  DEFAULT_WINDOWS,
  MAX_DEFAULT_WINDOW_MS,
  type CacheStatsRow,
  type WindowStats,
} from '@/lib/semanticCache/stats';

/**
 * GET /api/cache/stats  (admin only)
 *
 * Powers the `/dashboard/agents` cache-hit-rate widget (task 24.6, Req 26.6).
 * Aggregates the Semantic Cache (`query_cache`) into per-category hit-rate
 * statistics over two windows — the last 24 hours and the last 7 days:
 *
 *   { ok: true, data: {
 *       windows: WindowStats[],   // one entry per window (24h, 7d)
 *       generated_at: string,     // ISO timestamp
 *   } }
 *
 * Each {@link WindowStats} carries one {@link CategoryStat} per cache category
 * (`status | scheme | help`) plus an `overall` rollup, where:
 *   hits   = Σ hit_count   (requests served from cache, Req 26.3)
 *   misses = row count     (cached entries, each created on a miss, Req 26.5)
 *   hit_rate = hits / (hits + misses)
 *
 * Read path mirrors `GET /api/system-health`: a single read-only SELECT against
 * the service-role client, scoped to the largest window so the aggregation is
 * done in pure JS (`src/lib/semanticCache/stats.ts`). If `query_cache` is absent
 * or the query fails, the route degrades gracefully to zeroed windows rather
 * than 500-ing — an empty cache is a valid (cold) state, not an error.
 *
 * Auth: admin JWT (Bearer token) — same convention as `/api/system-health` and
 * `/api/cache/invalidate`.
 *
 * ─── Design-vs-migration schema note ────────────────────────────────────────
 * Design §v1.1.7 / Req 26 describe categories `ticket_status | scheme_info |
 * help_list`. The shipped schema (migration `20260201_003`) stores
 * `status | scheme | help` with `hit_count int` and `created_at timestamptz`.
 * This route reads the REAL columns so the aggregate reflects what is stored.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.7, §v1.1.15
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 26.6
 * @see supabase/migrations/20260201_003_handoff_guardrail_cache.sql — query_cache DDL
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Hard cap on rows pulled for the in-memory aggregation. */
const AGG_ROW_CAP = 20000;

/** Full response payload shape. */
export interface CacheStatsData {
  windows: WindowStats[];
  generated_at: string;
}

/**
 * Load `query_cache` rows written within the largest reported window.
 * Degrades to [] if the table is absent or the query fails — the aggregation
 * then yields zeroed windows.
 */
async function loadCacheRows(now: Date): Promise<CacheStatsRow[]> {
  try {
    const since = new Date(now.getTime() - MAX_DEFAULT_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from('query_cache')
      .select('category, hit_count, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(AGG_ROW_CAP);

    if (error || !data) return [];
    return data as CacheStatsRow[];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  // ─── Auth: admin JWT only ───
  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 401 });
  }

  if (payload.role !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Admin access required' }, { status: 403 });
  }

  // ─── Aggregate ───
  const now = new Date();
  const rows = await loadCacheRows(now);
  const windows = aggregateCacheStats(rows, now.getTime(), DEFAULT_WINDOWS);

  const data: CacheStatsData = {
    windows,
    generated_at: now.toISOString(),
  };

  return NextResponse.json({ ok: true, data });
}
