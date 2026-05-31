import { NextRequest, NextResponse } from 'next/server';
import { Pool, type PoolClient } from 'pg';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

/**
 * POST /api/cascade/override-policy  (admin)
 *
 * Admin-only endpoint that records a MANUAL cascade-policy override. The
 * Adaptive Donor Cascade Policy Resolver (`resolve_cascade_policy`, task 21.1)
 * honours a non-expired `source='manual'` row first (Phase A — a human admin
 * decision wins even during cold-start), so this endpoint lets an operator pin
 * tier sizes / wait windows for a `(urgency, district?, blood_group?,
 * hour_bucket?)` scope until an explicit `expires_at`. After expiry the resolver
 * filters the row out (`expires_at IS NULL OR expires_at > now()`) and the
 * bucket automatically reverts to the bandit-learned or default schedule
 * (Req 23.9).
 *
 * Auth: admin JWT (Bearer token) — same pattern as `/api/cache/invalidate`,
 * `/api/agents/test-route`, and `/api/blood-requests/escalate`.
 *
 * Request body:
 * {
 *   urgency:      "routine" | "urgent" | "critical",  // required
 *   district?:    string | null,                      // optional scope dimension
 *   blood_group?: string | null,                      // optional scope dimension
 *   hour_bucket?: number,                             // optional 0-23; omitted = all buckets
 *   tier_sizes:   [number, number, number],           // required → tier_1/2/3_count
 *   wait_minutes: [number, number, number],           // required → wait_1/2/3_minutes
 *   expires_at:   string                              // required ISO timestamp, must be future
 * }
 *
 * Response: { ok: true, data: { policy_id, audit_id, policies: [...], scope, expires_at } }
 *   - `policies` holds one entry per affected hour bucket (1 when hour_bucket is
 *     given, 6 when it is omitted). `policy_id`/`audit_id` mirror the first entry
 *     for the documented §v1.1.15 contract shape.
 *
 * ─── Design-vs-migration schema notes (IMPORTANT) ────────────────────────────
 * 1. Tier config: Design §v1.1.15 / Req 23.8 describe `tier_sizes` and
 *    `wait_minutes` arrays. The ACTUALLY shipped table
 *    (`supabase/migrations/20260201_002_adaptive_cascade.sql`) uses scalar
 *    columns `tier_1_count..tier_3_count` and `wait_1_minutes..wait_3_minutes`.
 *    This route maps the request arrays onto those columns.
 * 2. Audit columns: Req 34.7 describes `cascade_policy_audit (prev_value,
 *    new_value, source, ...)`. The shipped table uses `action IN ('created',
 *    'updated','manual_override')`, `old_values`/`new_values` jsonb, and
 *    `actor`. This route writes against the REAL schema:
 *    `action='manual_override'`, `old_values=<resolved pre-override policy>`,
 *    `new_values=<the manual override>`, `actor=<admin username>`.
 * 3. hour_bucket is `NOT NULL` in the table, so an "all buckets" override
 *    (Req 23.8 scopes by district/blood_group/urgency only) is materialised as
 *    one manual row per 4-hour bucket {0,4,8,12,16,20} — the buckets the
 *    resolver normalises request hours into (`(hour/4)*4`).
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.4, §v1.1.15
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 23.8, 23.9
 * @see supabase/migrations/20260201_002_adaptive_cascade.sql — cascade_policies / cascade_policy_audit DDL
 * @see supabase/migrations/20260201_009_resolve_cascade_policy.sql — expires_at + resolver precedence
 */

export const runtime = 'nodejs';

/**
 * Raw pg pool — the override write + its audit row are committed in a single
 * transaction, and we read the pre-override policy via the `resolve_cascade_policy`
 * SQL function, so we use a node-postgres client rather than the Supabase
 * builder. Same `DATABASE_URL`/`DIRECT_URL` convention as `/api/cache/invalidate`.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

/** Urgency values seeded in cascade_policies and used by the cascade engine. */
const VALID_URGENCIES = ['routine', 'urgent', 'critical'] as const;
type Urgency = (typeof VALID_URGENCIES)[number];

/** The 4-hour bucket start hours the resolver normalises request hours into. */
const HOUR_BUCKETS = [0, 4, 8, 12, 16, 20] as const;

interface OverrideBody {
  urgency?: unknown;
  district?: unknown;
  blood_group?: unknown;
  hour_bucket?: unknown;
  tier_sizes?: unknown;
  wait_minutes?: unknown;
  expires_at?: unknown;
}

/** Treat empty / whitespace-only strings as "not provided". */
function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Validate an array of exactly 3 non-negative integers (tier sizes / wait minutes). */
function parseIntTriple(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const out: number[] = [];
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null;
    out.push(v);
  }
  return out;
}

/** Validation error envelope, matching the `/api/cache/invalidate` convention. */
function validationError(message: string) {
  return NextResponse.json({ ok: false, error: 'VALIDATION_FAILED', message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  let client: PoolClient | undefined;
  try {
    // ─── Auth: admin JWT ───
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

    // ─── Parse body ───
    let body: OverrideBody;
    try {
      body = (await request.json()) as OverrideBody;
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    // ─── Validation ───
    const urgency = asNonEmptyString(body.urgency);
    if (!urgency || !VALID_URGENCIES.includes(urgency as Urgency)) {
      return validationError(`urgency is required and must be one of: ${VALID_URGENCIES.join(', ')}`);
    }

    // Optional scope dimensions. `null` is an explicit "applies to all" wildcard;
    // a supplied non-string (or empty string) is rejected.
    let district: string | null = null;
    if (body.district !== undefined && body.district !== null) {
      const d = asNonEmptyString(body.district);
      if (d === undefined) return validationError('district must be a non-empty string or null');
      district = d;
    }

    let bloodGroup: string | null = null;
    if (body.blood_group !== undefined && body.blood_group !== null) {
      const g = asNonEmptyString(body.blood_group);
      if (g === undefined) return validationError('blood_group must be a non-empty string or null');
      bloodGroup = g;
    }

    // hour_bucket: optional. When omitted → materialise across all 6 buckets.
    // When supplied, normalise to the 4-hour bucket start the resolver uses.
    let targetBuckets: number[];
    if (body.hour_bucket === undefined || body.hour_bucket === null) {
      targetBuckets = [...HOUR_BUCKETS];
    } else {
      const hb = body.hour_bucket;
      if (typeof hb !== 'number' || !Number.isInteger(hb) || hb < 0 || hb > 23) {
        return validationError('hour_bucket must be an integer between 0 and 23');
      }
      targetBuckets = [Math.floor(hb / 4) * 4];
    }

    const tierSizes = parseIntTriple(body.tier_sizes);
    if (!tierSizes) {
      return validationError('tier_sizes is required and must be an array of 3 non-negative integers');
    }

    const waitMinutes = parseIntTriple(body.wait_minutes);
    if (!waitMinutes) {
      return validationError('wait_minutes is required and must be an array of 3 non-negative integers');
    }

    const expiresRaw = asNonEmptyString(body.expires_at);
    if (!expiresRaw) {
      return validationError('expires_at is required (ISO timestamp)');
    }
    const expiresAt = new Date(expiresRaw);
    if (Number.isNaN(expiresAt.getTime())) {
      return validationError('expires_at must be a valid ISO timestamp');
    }
    if (expiresAt.getTime() <= Date.now()) {
      // A non-future expiry would make the override immediately invisible to the
      // resolver (which filters `expires_at > now()`), so reject it up front.
      return validationError('expires_at must be in the future');
    }

    // ─── Persist override(s) + audit rows in one transaction ───
    client = await pool.connect();
    await client.query('BEGIN');

    const policies: Array<{ policy_id: string; audit_id: string; hour_bucket: number }> = [];

    for (const bucket of targetBuckets) {
      // 1. Capture the pre-override resolved policy for the audit `old_values`
      //    (Design: prev_value = resolved v1/bandit policy for the bucket).
      const prevRes = await client.query<{ prev: unknown }>(
        'SELECT row_to_json(resolve_cascade_policy($1, $2, $3, $4)) AS prev',
        [urgency, district, bloodGroup, bucket]
      );
      const oldValues = prevRes.rows[0]?.prev ?? null;

      // 2. Idempotency: refresh an existing manual row at this exact scope first
      //    (NULL-safe match) so repeated overrides update rather than pile up.
      const updateRes = await client.query<{ id: string }>(
        `UPDATE cascade_policies
            SET tier_1_count   = $5,
                tier_2_count   = $6,
                tier_3_count   = $7,
                wait_1_minutes = $8,
                wait_2_minutes = $9,
                wait_3_minutes = $10,
                expires_at     = $11,
                updated_at     = NOW()
          WHERE source = 'manual'
            AND urgency = $1
            AND hour_bucket = $2
            AND district IS NOT DISTINCT FROM $3
            AND blood_group IS NOT DISTINCT FROM $4
          RETURNING id`,
        [
          urgency,
          bucket,
          district,
          bloodGroup,
          tierSizes[0],
          tierSizes[1],
          tierSizes[2],
          waitMinutes[0],
          waitMinutes[1],
          waitMinutes[2],
          expiresAt.toISOString(),
        ]
      );

      let policyId: string;
      if ((updateRes.rowCount ?? 0) > 0) {
        policyId = updateRes.rows[0].id;
      } else {
        // 3. No manual row yet. INSERT one. For a fully-specified (non-NULL)
        //    scope the unique key (urgency, hour_bucket, district, blood_group)
        //    may already be held by a default/bandit row — ON CONFLICT flips
        //    that row to a manual override (alpha/beta intentionally preserved
        //    so a later bandit run can recover). For wildcard scopes the NULLs
        //    are distinct in the unique index, so a fresh manual row is inserted
        //    alongside the default row.
        const insertRes = await client.query<{ id: string }>(
          `INSERT INTO cascade_policies
              (urgency, hour_bucket, district, blood_group,
               tier_1_count, tier_2_count, tier_3_count,
               wait_1_minutes, wait_2_minutes, wait_3_minutes,
               source, expires_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual', $11, NOW())
           ON CONFLICT ON CONSTRAINT uq_cascade_policies_scope
           DO UPDATE SET
               tier_1_count   = EXCLUDED.tier_1_count,
               tier_2_count   = EXCLUDED.tier_2_count,
               tier_3_count   = EXCLUDED.tier_3_count,
               wait_1_minutes = EXCLUDED.wait_1_minutes,
               wait_2_minutes = EXCLUDED.wait_2_minutes,
               wait_3_minutes = EXCLUDED.wait_3_minutes,
               source         = 'manual',
               expires_at     = EXCLUDED.expires_at,
               updated_at     = NOW()
           RETURNING id`,
          [
            urgency,
            bucket,
            district,
            bloodGroup,
            tierSizes[0],
            tierSizes[1],
            tierSizes[2],
            waitMinutes[0],
            waitMinutes[1],
            waitMinutes[2],
            expiresAt.toISOString(),
          ]
        );
        policyId = insertRes.rows[0].id;
      }

      // 4. Audit trail row (Req 23.8). new_values captures the manual override;
      //    old_values captures the policy that was resolving before it.
      const newValues = {
        urgency,
        hour_bucket: bucket,
        district,
        blood_group: bloodGroup,
        tier_sizes: tierSizes,
        wait_minutes: waitMinutes,
        expires_at: expiresAt.toISOString(),
        source: 'manual',
      };

      const auditRes = await client.query<{ id: string }>(
        `INSERT INTO cascade_policy_audit (policy_id, action, old_values, new_values, actor)
         VALUES ($1, 'manual_override', $2::jsonb, $3::jsonb, $4)
         RETURNING id`,
        [
          policyId,
          oldValues === null ? null : JSON.stringify(oldValues),
          JSON.stringify(newValues),
          payload.username ?? payload.userId ?? 'admin',
        ]
      );

      policies.push({ policy_id: policyId, audit_id: auditRes.rows[0].id, hour_bucket: bucket });
    }

    await client.query('COMMIT');

    // ─── Best-effort operational audit to activity_logs (non-blocking) ───
    // Matches the v1.1 admin-route convention (`/api/sessions/escalate`,
    // `/api/blood-requests/escalate`): a failure here must not fail the request,
    // and the mandated policy audit already committed above.
    try {
      const scopeLabel = [
        urgency,
        district ?? 'any-district',
        bloodGroup ?? 'any-group',
        body.hour_bucket === undefined || body.hour_bucket === null
          ? 'all-hour-buckets'
          : `hour_bucket=${targetBuckets[0]}`,
      ].join(' / ');

      await pool.query(
        `INSERT INTO activity_logs ("complaintId", action, description, "actorId", "actorName", metadata)
         VALUES (NULL, $1, $2, $3, $4, $5)`,
        [
          'CASCADE_POLICY_OVERRIDE',
          `Admin set manual cascade override (${scopeLabel}) until ${expiresAt.toISOString()}`,
          payload.userId,
          payload.username,
          JSON.stringify({
            scope: { urgency, district, blood_group: bloodGroup },
            hour_buckets: targetBuckets,
            tier_sizes: tierSizes,
            wait_minutes: waitMinutes,
            expires_at: expiresAt.toISOString(),
            policy_ids: policies.map((p) => p.policy_id),
          }),
        ]
      );
    } catch (logError) {
      console.error('[cascade/override-policy] Audit log error:', logError);
    }

    return NextResponse.json({
      ok: true,
      data: {
        // §v1.1.15 contract shape — representative ids (first affected bucket).
        policy_id: policies[0]?.policy_id ?? null,
        audit_id: policies[0]?.audit_id ?? null,
        // Full per-bucket result (6 entries when hour_bucket is omitted).
        policies,
        scope: { urgency, district, blood_group: bloodGroup },
        expires_at: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[cascade/override-policy] Rollback error:', rollbackError);
      }
    }
    console.error('[cascade/override-policy] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  } finally {
    if (client) client.release();
  }
}
