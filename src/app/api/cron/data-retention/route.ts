import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/cron/data-retention   (Vercel Cron) — DPDP Act 2023 data minimisation.
 *
 * Daily job that anonymises stale conversation_sessions: it scrubs collected
 * PII (collected_data) and conversation memory (history_summary) from sessions
 * inactive longer than the retention window, via the `run_data_retention`
 * Postgres RPC. Complaints are intentionally NOT auto-erased — they are a legal
 * grievance record and are only removed on explicit citizen erasure request
 * (/api/privacy/erase).
 *
 * Retention window: RETENTION_DAYS env (default 365 days).
 *
 * Schedule (add to vercel.json crons — daily, Hobby-plan compatible):
 *   { "path": "/api/cron/data-retention", "schedule": "0 4 * * *" }
 *
 * Auth: Vercel attaches `Authorization: Bearer ${CRON_SECRET}`. Fail-closed if
 * CRON_SECRET is unset.
 *
 * Response: { ok: true, data: { sessions_scrubbed, retention_days } }
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error('[cron/data-retention] CRON_SECRET not configured — refusing to run');
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 401 });
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const days = parseInt(process.env.RETENTION_DAYS || '365', 10) || 365;

  try {
    const { data, error } = await supabase.rpc('run_data_retention', { p_days: days });
    if (error) {
      console.error('[cron/data-retention] RPC failed:', error);
      return NextResponse.json(
        { ok: false, error: 'Failed to run data retention', details: error.message },
        { status: 500 }
      );
    }

    // Phase 2: bound the rate-limit event log. Rows older than the largest
    // bucket window (blood_request_create = 24h) are always expired and can
    // never be counted again, so they are safe to purge. Best-effort: a
    // failure here must not fail the DPDP retention run.
    let rateLimitPurged: number | null = null;
    try {
      const { count } = await supabase
        .from('rate_limit_events')
        .delete({ count: 'exact' })
        .lt('created_at', new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
      rateLimitPurged = count ?? null;
    } catch (purgeErr) {
      console.error('[cron/data-retention] rate_limit_events purge failed (non-fatal):', purgeErr);
    }

    console.log('[cron/data-retention] done:', JSON.stringify({ ...(data as object ?? {}), rateLimitPurged }));
    return NextResponse.json({ ok: true, data: { ...(data as object ?? {}), rate_limit_events_purged: rateLimitPurged } });
  } catch (err) {
    console.error('[cron/data-retention] Error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
