import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/cron/idempotency-cleanup   (Vercel Cron)
 *
 * Daily cleanup job (task 26.3, Req 28.2 / 34.12, Design §v1.1.9) that removes
 * expired rows from the `idempotency_keys` table so the dedupe table does not
 * grow without bound. Idempotency keys are retained for 24 hours (Req 28.2);
 * the idempotency middleware (task 26.1) stamps each row with an `expires_at`
 * of `created_at + 24h`, so "expired" == "older than the 24-hour retention
 * window".
 *
 * ─── Schedule ────────────────────────────────────────────────────────────────
 * Registered in `vercel.json` `crons` as a daily run at 03:00 UTC:
 *   { "path": "/api/cron/idempotency-cleanup", "schedule": "0 3 * * *" }
 * Vercel Cron invokes the route with a GET request.
 *
 * ─── Auth ──────────────────────────────────────────────────────────────────
 * Vercel automatically attaches `Authorization: Bearer ${CRON_SECRET}` to cron
 * invocations when the `CRON_SECRET` env var is set. This handler rejects any
 * request whose bearer token does not match `process.env.CRON_SECRET`, so the
 * endpoint cannot be triggered by the public internet. If `CRON_SECRET` is not
 * configured the route refuses to run (fail-closed) rather than deleting rows
 * for an unauthenticated caller.
 *
 * ─── Design-vs-migration schema note (IMPORTANT) ─────────────────────────────
 * Design §v1.1.9 sketches the cleanup as
 *   `DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`
 * against an idealized `(key, endpoint, response_hash, created_at)` table. The
 * ACTUALLY shipped schema
 * (`supabase/migrations/20260201_004_idempotency_outbox_promptversions.sql`) is
 * `(id, key, endpoint, response_status, response_body, created_at, expires_at)`
 * and ships a dedicated index `idx_idempotency_keys_expires_at` whose own
 * comment documents the intended cleanup as `DELETE ... WHERE expires_at < NOW()`.
 * This route is written against the REAL schema — the same decision
 * `src/app/api/cache/invalidate/route.ts` documents — so the delete is
 * index-backed and matches exactly the rows the middleware marked as expired.
 * Because `expires_at = created_at + 24h`, `expires_at < now()` is equivalent to
 * the design's `created_at < now() - interval '24 hours'`.
 *
 * Response: { ok: true, data: { deleted: number } }
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.9 Idempotency, Rate Limiting, Backpressure
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 28.2, 34.12
 * @see supabase/migrations/20260201_004_idempotency_outbox_promptversions.sql — idempotency_keys DDL
 */

export const runtime = 'nodejs';
// Never serve a cached response for a cron mutation.
export const dynamic = 'force-dynamic';

/**
 * Service-role Supabase client — matches the convention used by sibling v1.1
 * routes (`/api/trace/[id]`, `/api/n8n/cascade-trigger`) and works with the
 * repo's default REST-API database mode. A plain `expires_at < now()` filtered
 * delete is fully expressible through the builder, so no raw `pg` pool is needed.
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  // ─── Auth: Vercel Cron bearer secret (fail-closed) ───
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error('[cron/idempotency-cleanup] CRON_SECRET is not configured — refusing to run');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not configured' },
      { status: 401 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // ─── Delete expired rows (index-backed on idx_idempotency_keys_expires_at) ───
  try {
    const nowIso = new Date().toISOString();

    const { error, count } = await supabase
      .from('idempotency_keys')
      .delete({ count: 'exact' })
      .lt('expires_at', nowIso);

    if (error) {
      console.error('[cron/idempotency-cleanup] Delete failed:', error);
      return NextResponse.json(
        { ok: false, error: 'Failed to clean up idempotency_keys', details: error.message },
        { status: 500 }
      );
    }

    const deleted = count ?? 0;
    console.log(`[cron/idempotency-cleanup] Deleted ${deleted} expired idempotency_keys row(s)`);

    return NextResponse.json({ ok: true, data: { deleted } });
  } catch (err) {
    console.error('[cron/idempotency-cleanup] Error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
