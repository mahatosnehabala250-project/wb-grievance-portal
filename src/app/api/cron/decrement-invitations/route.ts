import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/cron/decrement-invitations   (Vercel Cron)
 *
 * Nightly donor-fairness recompute for the Adaptive Donor Cascade (task 21.4,
 * Req 23.5, Design §v1.1.4). The `trg_donor_invitation_counter` trigger
 * (migration 20260201_022) only ever INCREMENTS `blood_donors.invitations_last_30d`
 * on each new `cascade_notifications` row, so invitations age out of the 30-day
 * anti-burnout window silently. This cron invokes the SQL function
 * `decrement_30d_invitations()`, which recomputes every donor's
 * `invitations_last_30d` as `count(*) from cascade_notifications where
 * donor_id = ... and notified_at > now() - interval '30 days'`, decrementing the
 * counter for invitations that have aged past the window. This keeps the
 * `recency_penalty` term of the v1.1.4 fairness ranker (migration
 * 20260201_009_donor_fairness_ranking.sql) accurate.
 *
 * ─── Schedule ────────────────────────────────────────────────────────────────
 * Registered in `vercel.json` `crons` as a nightly run at 03:45 UTC:
 *   { "path": "/api/cron/decrement-invitations", "schedule": "45 3 * * *" }
 * Minute 45 keeps it clear of the other nightly jobs (idempotency-cleanup 03:00,
 * classifier-calibration 02:30, bandit-trainer 03:30). Running AFTER the
 * bandit-trainer is harmless — the trainer reads `cascade_outcomes`, not the
 * live `invitations_last_30d` counter. Vercel Cron invokes the route with GET.
 *
 * ─── Auth ────────────────────────────────────────────────────────────────────
 * Vercel automatically attaches `Authorization: Bearer ${CRON_SECRET}` to cron
 * invocations when the `CRON_SECRET` env var is set. This handler rejects any
 * request whose bearer token does not match `process.env.CRON_SECRET`, so the
 * endpoint cannot be triggered by the public internet. If `CRON_SECRET` is not
 * configured the route refuses to run (fail-closed) rather than mutating donor
 * rows for an unauthenticated caller. Mirrors
 * `src/app/api/cron/idempotency-cleanup/route.ts`.
 *
 * Response: { ok: true, data: { recomputed: true } }
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.4 (adaptive cascade / donor fairness)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 23.5
 * @see supabase/migrations/20260201_022_donor_invitation_counter.sql — trigger + decrement_30d_invitations()
 * @see src/app/api/cron/idempotency-cleanup/route.ts — sibling Vercel Cron pattern (auth, envelope)
 */

export const runtime = 'nodejs';
// Never serve a cached response for a cron mutation.
export const dynamic = 'force-dynamic';

/**
 * Service-role Supabase client — matches the convention used by the sibling
 * cron routes (`idempotency-cleanup`, `bandit-trainer`). The recompute is a
 * single set-based UPDATE encapsulated in the `decrement_30d_invitations()` SQL
 * function, invoked here via PostgREST RPC.
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  // ─── Auth: Vercel Cron bearer secret (fail-closed) ───
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error('[cron/decrement-invitations] CRON_SECRET is not configured — refusing to run');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not configured' },
      { status: 401 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // ─── Recompute the 30-day invitation window for every donor ───
  // The work is done server-side by the SQL function so the sliding-window
  // boundary uses Postgres `now()` (no app/db clock skew) and the whole sweep
  // is one atomic statement.
  try {
    const { error } = await supabase.rpc('decrement_30d_invitations');

    if (error) {
      console.error('[cron/decrement-invitations] RPC failed:', error);
      return NextResponse.json(
        { ok: false, error: 'Failed to recompute invitations_last_30d', details: error.message },
        { status: 500 }
      );
    }

    console.log('[cron/decrement-invitations] Recomputed invitations_last_30d for all donors');

    return NextResponse.json({ ok: true, data: { recomputed: true } });
  } catch (err) {
    console.error('[cron/decrement-invitations] Error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
