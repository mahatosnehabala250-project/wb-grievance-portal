import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

/**
 * GET /api/cron/cascade-override-expiry   (Vercel Cron)
 *
 * Housekeeping sweep for the Adaptive Donor Cascade (task 21.8, Req 23.9,
 * Design §v1.1.4 "Manual override flow + audit trail"). Admins can pin a manual
 * cascade policy via `POST /api/cascade/override-policy` (task 21.7); each such
 * `cascade_policies` row carries `source='manual'` and an explicit `expires_at`
 * so the override auto-reverts. The Policy Resolver (`resolve_cascade_policy`,
 * task 21.1 / migration 20260201_009) already filters
 * `expires_at IS NULL OR expires_at > now()`, so an expired manual row is
 * ALREADY invisible at read time and the next cascade automatically falls back
 * to the bandit-learned or default policy for that bucket (Req 23.9).
 *
 * This cron is therefore the *bookkeeping* half of that flow: it detects manual
 * overrides whose `expires_at` has just passed and writes the expiry transition
 * to `cascade_policy_audit` (Design §v1.1.4 diagram:
 * `G[Cron: expire-policies] --> H[INSERT cascade_policy_audit
 * prev_value=manual, new_value=null, source=expiry]`). It does NOT need to —
 * and cannot safely — physically resolve the override at the data layer; see
 * the schema notes below.
 *
 * Response: { ok: true, data: { expired: number } }
 *
 * ─── Schedule ────────────────────────────────────────────────────────────────
 * Registered in `vercel.json` `crons` as an hourly run at minute 15:
 *   { "path": "/api/cron/cascade-override-expiry", "schedule": "15 * * * *" }
 * (Minute 15 keeps it clear of the on-the-hour herd.) Vercel Cron invokes the
 * route with a GET request. Hourly cadence matches the task's "hourly job" and
 * is fine-grained enough that an expired override is audited within an hour of
 * lapsing, while the resolver has already stopped serving it the instant
 * `expires_at` passed.
 *
 * ─── Auth ────────────────────────────────────────────────────────────────────
 * Vercel automatically attaches `Authorization: Bearer ${CRON_SECRET}` to cron
 * invocations when `CRON_SECRET` is set. This handler rejects any request whose
 * bearer token does not match `process.env.CRON_SECRET` (fail-closed): if
 * `CRON_SECRET` is not configured the route refuses to run rather than letting
 * the public internet drive the audit trail. Mirrors
 * `src/app/api/cron/idempotency-cleanup/route.ts`.
 *
 * ─── Design-vs-migration schema note (IMPORTANT) ─────────────────────────────
 * Design §v1.1.4 sketches the expiry audit as `(prev_value=manual,
 * new_value=null, source='expiry')`. The ACTUALLY shipped `cascade_policy_audit`
 * schema (`supabase/migrations/20260201_002_adaptive_cascade.sql`) is
 * `(id, policy_id, action text CHECK (action IN
 * ('created','updated','manual_override')), old_values jsonb, new_values jsonb,
 * actor text, created_at)`. There is no `source` column and `'expiry'` is not a
 * permitted `action`, so this route maps the design intent onto the real
 * columns — the same design-vs-schema decision documented by
 * `src/app/api/cache/invalidate/route.ts` and `.../cron/idempotency-cleanup`:
 *   - `prev_value=manual`  → `old_values` jsonb snapshot of the expiring policy
 *                            (includes `source` and `expires_at`).
 *   - `new_value=null`     → `new_values = 'null'::jsonb` (JSON null = "reverted
 *                            to none; resolver now serves bandit/default").
 *   - `source='expiry'`    → `actor = 'cron:cascade-override-expiry'` so the
 *                            expiry sweep is attributable in the audit trail.
 *   - the expiry event itself is recorded under `action='manual_override'`
 *                            (the only enum value that scopes to the manual
 *                            override lifecycle; the actor + JSON-null new_values
 *                            disambiguate it from the override *creation* row
 *                            that task 21.7 writes).
 *
 * ─── Why no physical DELETE / mutation of cascade_policies ───────────────────
 * Both `cascade_policy_audit.policy_id` and `cascade_outcomes.policy_id`
 * reference `cascade_policies(id)` with NO `ON DELETE` clause (RESTRICT). A
 * manual override always already has at least one audit row (the
 * `manual_override` creation row from task 21.7) and may have `cascade_outcomes`
 * logged against it (kept as bandit training data), so a hard DELETE would be
 * RESTRICT-blocked. The resolver's `expires_at > now()` filter already removes
 * the row from selection, so leaving the (now-expired) row in place is correct;
 * the audit row is the durable record of the revert.
 *
 * ─── Idempotency ─────────────────────────────────────────────────────────────
 * Expired manual rows keep `expires_at` in the past indefinitely, so a naive
 * hourly insert would write a duplicate audit row on every run. The
 * `INSERT ... SELECT` below guards with `NOT EXISTS (... actor =
 * 'cron:cascade-override-expiry')`, so each expired override is audited exactly
 * once. `data.expired` is the number of newly-audited overrides this run (0 on
 * subsequent runs once all expirations are recorded).
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.4 (Manual override flow + audit trail)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 23.8, 23.9
 * @see supabase/migrations/20260201_002_adaptive_cascade.sql — cascade_policies / cascade_policy_audit DDL
 * @see supabase/migrations/20260201_009_resolve_cascade_policy.sql — cascade_policies.expires_at + resolver filter
 * @see src/app/api/cron/idempotency-cleanup/route.ts — sibling Vercel Cron pattern (auth, envelope)
 */

export const runtime = 'nodejs';
// Never serve a cached response for a cron mutation.
export const dynamic = 'force-dynamic';

/**
 * Raw pg pool — the expiry sweep is a single set-based `INSERT ... SELECT` with
 * a `NOT EXISTS` idempotency guard, which is cleaner expressed as SQL than
 * through the Supabase REST builder. Follows the `DATABASE_URL`/`DIRECT_URL`
 * convention used by the sibling cascade-adjacent routes (`donor-respond`,
 * `cancel-acceptance`, `cache/invalidate`).
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

/** Audit `actor` sentinel marking a row written by this expiry sweep. */
const EXPIRY_ACTOR = 'cron:cascade-override-expiry';

export async function GET(request: NextRequest) {
  // ─── Auth: Vercel Cron bearer secret (fail-closed) ───
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error('[cron/cascade-override-expiry] CRON_SECRET is not configured — refusing to run');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not configured' },
      { status: 401 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // ─── Audit each newly-expired manual override exactly once ───
  // Uses SQL `now()` (not an app clock) so the expiry boundary matches the
  // resolver's `expires_at > now()` filter without clock-skew between tiers.
  try {
    const sql = `
      INSERT INTO cascade_policy_audit (policy_id, action, old_values, new_values, actor)
      SELECT
        cp.id,
        'manual_override',
        jsonb_build_object(
          'source',         cp.source,
          'urgency',        cp.urgency,
          'hour_bucket',    cp.hour_bucket,
          'district',       cp.district,
          'blood_group',    cp.blood_group,
          'tier_1_count',   cp.tier_1_count,
          'tier_2_count',   cp.tier_2_count,
          'tier_3_count',   cp.tier_3_count,
          'wait_1_minutes', cp.wait_1_minutes,
          'wait_2_minutes', cp.wait_2_minutes,
          'wait_3_minutes', cp.wait_3_minutes,
          'expires_at',     cp.expires_at
        ),
        'null'::jsonb,
        $1
      FROM cascade_policies cp
      WHERE cp.source = 'manual'
        AND cp.expires_at IS NOT NULL
        AND cp.expires_at < now()
        AND NOT EXISTS (
          SELECT 1
          FROM cascade_policy_audit a
          WHERE a.policy_id = cp.id
            AND a.actor = $1
        )
      RETURNING policy_id
    `;

    const result = await pool.query(sql, [EXPIRY_ACTOR]);
    const expired = result.rowCount ?? 0;

    console.log(`[cron/cascade-override-expiry] Audited ${expired} newly-expired manual override(s)`);

    return NextResponse.json({ ok: true, data: { expired } });
  } catch (err) {
    console.error('[cron/cascade-override-expiry] Error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
