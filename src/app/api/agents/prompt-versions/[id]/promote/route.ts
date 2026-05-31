import { NextRequest, NextResponse } from 'next/server';
import { Pool, type PoolClient } from 'pg';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

/**
 * POST /api/agents/prompt-versions/:id/promote  (v1.1, admin-only)
 *
 * Promote a STAGED prompt version row to active traffic. This is the second
 * half of the staging → review → promote lifecycle (Design §v1.1.14, Req 15.5);
 * the first half is the staging insert at `POST /api/agents/prompt-versions`
 * (task 31.9).
 *
 * The promotion runs as a SINGLE transaction so the "at most one active row per
 * (agent, version)" invariant (Property 35) always holds:
 *   (a) Conditional promote of the staged row:
 *         UPDATE agent_prompt_versions
 *            SET active = true, weight = $weight, status = 'active'
 *          WHERE id = $id AND active = false
 *       RETURNING agent, version, weight
 *       If this affects ZERO rows the row is already active or does not exist →
 *       HTTP 409 PROMOTION_INVALID (the staged row was already promoted by a
 *       concurrent admin, or the id is wrong). The conditional `WHERE active =
 *       false` is also the concurrency guard: only one of two racing promote
 *       calls can win it.
 *   (b) Demote the previously-active row(s) of the SAME (agent, version):
 *         UPDATE agent_prompt_versions
 *            SET active = false, weight = 0, status = 'archived'
 *          WHERE agent = $agent AND version = $version
 *            AND id != $id AND active = true
 *
 * Both statements commit together; if either throws the transaction rolls back
 * and nothing changes.
 *
 * Auth: admin JWT (Bearer token). Promotion is admin-only and audit-logged
 * (`activity_logs action='prompt_version_promoted'`).
 *
 * The handler uses a raw pg client (service-role `DATABASE_URL` connection) so
 * it BYPASSES the row-level-security policies that forbid a UI client from
 * UPDATEing an already-active row (migration
 * `20260201_023_prompt_versions_staging_rls.sql`, task 31.11). That RLS block
 * is exactly what forces all promotions to flow through this endpoint.
 *
 * Request body: { weight: number }   // > 0 and <= 1 (e.g. 0.1 for a 10% canary)
 *
 * Response (Design §v1.1.14):
 * { ok: true, data: { id, agent, version, active: true, weight, status: 'active', promoted_at } }
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.14, Property 35 (§v1.1.16)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 15.5
 * @see src/app/api/agents/prompt-versions/route.ts — the staging-insert half
 * @see supabase/migrations/20260201_004_idempotency_outbox_promptversions.sql — agent_prompt_versions DDL
 */

export const runtime = 'nodejs';

/**
 * Raw pg pool — the promote-new + demote-old pair must commit in ONE
 * transaction, and the connection runs with the service-role `DATABASE_URL`
 * so it bypasses the UI-facing RLS that forbids UPDATEing an active row. Same
 * `DATABASE_URL`/`DIRECT_URL` convention as `/api/cascade/override-policy`.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

/**
 * (a) Conditional promote of the staged row. `WHERE active = false` is both the
 * "must be staged" guard and the concurrency guard (only one racing caller can
 * flip it). RETURNING gives us the (agent, version) needed to scope the demote.
 */
const PROMOTE_SQL = `
UPDATE agent_prompt_versions
   SET active = true, weight = $2, status = 'active', updated_at = NOW()
 WHERE id = $1 AND active = false
RETURNING id, agent, version, weight, active, status, updated_at
`.trim();

/**
 * (b) Demote the previously-active row(s) of the same (agent, version). Scoped
 * to `id != $1` so we never demote the row we just promoted, and `active = true`
 * so only the incumbent is touched. Enforces Property 35.
 */
const DEMOTE_OLD_SQL = `
UPDATE agent_prompt_versions
   SET active = false, weight = 0, status = 'archived', updated_at = NOW()
 WHERE agent = $1 AND version = $2 AND id != $3 AND active = true
RETURNING id
`.trim();

interface PromoteBody {
  weight?: unknown;
}

/** Validation error envelope, matching the project convention. */
function validationError(message: string) {
  return NextResponse.json({ ok: false, error: 'VALIDATION_FAILED', message }, { status: 400 });
}

/** Basic uuid v4-ish shape check so a malformed :id fails fast (not as a 500). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // ─── Resolve + validate the :id path param ───
    const { id } = await params;
    if (!id || !UUID_RE.test(id)) {
      return validationError('a valid prompt version id (uuid) is required in the path');
    }

    // ─── Parse body ───
    let body: PromoteBody;
    try {
      body = (await request.json()) as PromoteBody;
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    // weight: required, finite, > 0 and <= 1 (Design §v1.1.14 — a canary share).
    if (
      typeof body.weight !== 'number' ||
      !Number.isFinite(body.weight) ||
      body.weight <= 0 ||
      body.weight > 1
    ) {
      return validationError('weight is required and must be a number > 0 and <= 1');
    }
    const weight = body.weight;

    // ─── Atomic demote-old + promote-new in one transaction ───
    client = await pool.connect();
    await client.query('BEGIN');

    // (a) Conditional promote of the staged row. Zero rows ⇒ already-active or
    //     non-existent ⇒ PROMOTION_INVALID.
    const promoteRes = await client.query<{
      id: string;
      agent: string;
      version: string;
      weight: number | string;
      active: boolean;
      status: string;
      updated_at: string;
    }>(PROMOTE_SQL, [id, weight]);

    if ((promoteRes.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          ok: false,
          error: 'PROMOTION_INVALID',
          message:
            'prompt version cannot be promoted: it does not exist or is already active',
        },
        { status: 409 }
      );
    }

    const promoted = promoteRes.rows[0];

    // (b) Demote the previously-active row(s) of the same (agent, version).
    const demoteRes = await client.query<{ id: string }>(DEMOTE_OLD_SQL, [
      promoted.agent,
      promoted.version,
      id,
    ]);

    await client.query('COMMIT');

    const demotedIds = demoteRes.rows.map((r) => r.id);

    // ─── Audit log (best-effort; never fails the promotion) ───
    try {
      await pool.query(
        `INSERT INTO activity_logs (action, entity_type, entity_id, details, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [
          'prompt_version_promoted',
          'agent_prompt_version',
          promoted.id,
          JSON.stringify({
            agent: promoted.agent,
            version: promoted.version,
            weight,
            demoted_ids: demotedIds,
            promoted_by: payload.userId ?? payload.username ?? 'admin',
          }),
        ],
      );
    } catch (auditErr) {
      // Audit failure is non-fatal — the promotion already committed.
      console.warn('[prompt-versions/promote] audit log failed (non-blocking):', auditErr);
    }

    return NextResponse.json({
      ok: true,
      data: {
        id: promoted.id,
        agent: promoted.agent,
        version: promoted.version,
        active: true,
        weight: typeof promoted.weight === 'string' ? Number(promoted.weight) : promoted.weight,
        status: 'active',
        promoted_at: promoted.updated_at,
        demoted_ids: demotedIds,
      },
    });
  } catch (error) {
    // Roll back the transaction if it is still open.
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback errors — the connection is being released anyway
      }
    }
    console.error('[prompt-versions/promote] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  } finally {
    if (client) client.release();
  }
}
