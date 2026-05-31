import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { withIdempotency } from '@/lib/idempotency/middleware';

/**
 * POST /api/agents/prompt-versions  (v1.1, admin)
 *
 * Admin-only endpoint that STAGES a new candidate prompt version in
 * `agent_prompt_versions`. This is the PLURAL staging endpoint of the
 * staging → review → promote lifecycle (Design §v1.1.14, Req 15.5). It is
 * distinct from the SINGULAR `/api/agents/prompt-version` (task 31.4), which is
 * a generic upsert keyed on `UNIQUE (agent, version)`.
 *
 * A staged row always takes NO traffic:
 *   - `weight  = 0`     (excluded from the weighted pool by the Prompt_Selector)
 *   - `active  = false` (not eligible for selection at all)
 *   - `status  = 'staging'`
 *
 * Promotion to active traffic is an explicit, separate admin action handled by
 * `POST /api/agents/prompt-versions/:id/promote` (task 31.10), which atomically
 * demotes the previously-active row and promotes the staged row in one
 * transaction. Direct UPDATE of an already-active row from the UI is forbidden
 * at the RLS layer (migration `20260201_023_prompt_versions_staging_rls.sql`,
 * task 31.11).
 *
 * Auth: admin JWT (Bearer token) — same pattern as the singular route,
 * `/api/cascade/override-policy`, and `/api/cache/invalidate`.
 *
 * Request body:
 * {
 *   agent:              "complaint" | "blood" | "donor" | "info",  // required
 *   version:            string,                                    // required, non-empty
 *   prompt_md:          string,                                    // required, non-empty
 *   parent_version_id?: string                                     // optional, audit-only
 * }
 *
 * Response (Design §v1.1.14):
 * {
 *   ok: true,
 *   data: { id, agent, version, weight: 0, active: false, status: 'staging', created_at }
 * }
 *
 * Idempotency: wrapped with the v1.1 idempotency middleware (task 26.1). A
 * retried request carrying the same `Idempotency-Key` header replays the stored
 * response instead of inserting a second staging row (Design §v1.1.9).
 *
 * ─── Design-vs-migration schema notes (IMPORTANT) ────────────────────────────
 * Task 31.9 describes `created_by = auth.uid()` and an optional
 * `parent_version_id` column. The ACTUALLY shipped table
 * (`supabase/migrations/20260201_004_idempotency_outbox_promptversions.sql`)
 * has NO `created_by` / `parent_version_id` columns — only
 * `(id, agent, version, prompt_md, weight, active, status, created_at,
 * updated_at)`. This system also authenticates with an app JWT (`payload.userId`
 * / `payload.username`) rather than a Supabase `auth.uid()`. So the staging
 * actor and the optional `parent_version_id` are recorded in the best-effort
 * `activity_logs` audit row (`action='prompt_version_staged'`) instead of on
 * the table itself, matching the precedent in `/api/cascade/override-policy`.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.14, §v1.1.15
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 15.5
 * @see supabase/migrations/20260201_004_idempotency_outbox_promptversions.sql — agent_prompt_versions DDL
 * @see src/app/api/agents/prompt-versions/[id]/promote/route.ts — the promote half of the lifecycle
 * @see src/lib/abtest/promptLoader.ts — the reader staged rows are eventually selected by
 */

export const runtime = 'nodejs';

/** Stable endpoint id used by the idempotency middleware for the dedupe key. */
const ENDPOINT = '/api/agents/prompt-versions';

/**
 * Raw pg pool — same `DATABASE_URL`/`DIRECT_URL` convention as the singular
 * route and `/api/cascade/override-policy`. Reused both for the staging INSERT
 * and as the idempotency middleware's DB client.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

/** Agent values accepted by the `chk_agent_prompt_versions_agent` CHECK constraint. */
const VALID_AGENTS = ['complaint', 'blood', 'donor', 'info'] as const;
type Agent = (typeof VALID_AGENTS)[number];

/**
 * Staging INSERT. Always `weight = 0`, `active = false`, `status = 'staging'`
 * (the parameters are fixed literals here, never taken from the body, so a
 * staged row can never accidentally be created already-active). `RETURNING`
 * echoes the row id + created_at for the §v1.1.14 response contract.
 */
const INSERT_STAGING_SQL = `
INSERT INTO agent_prompt_versions (agent, version, prompt_md, weight, active, status)
VALUES ($1, $2, $3, 0, false, 'staging')
RETURNING id, agent, version, weight, active, status, created_at
`.trim();

interface StagingBody {
  agent?: unknown;
  version?: unknown;
  prompt_md?: unknown;
  parent_version_id?: unknown;
}

/** Treat empty / whitespace-only strings as "not provided". */
function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Validation error envelope, matching the project convention. */
function validationError(message: string) {
  return NextResponse.json({ ok: false, error: 'VALIDATION_FAILED', message }, { status: 400 });
}

/** Narrow an unknown caught value to a pg error with a SQLSTATE `code`. */
function pgErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

async function handleStagingInsert(request: NextRequest): Promise<NextResponse> {
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
    let body: StagingBody;
    try {
      body = (await request.json()) as StagingBody;
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    // ─── Validation ───
    const agent = asNonEmptyString(body.agent);
    if (!agent) {
      return validationError('agent is required');
    }
    if (!VALID_AGENTS.includes(agent as Agent)) {
      return validationError(`agent must be one of: ${VALID_AGENTS.join(', ')}`);
    }

    const version = asNonEmptyString(body.version);
    if (!version) {
      return validationError('version is required');
    }

    // prompt_md must be a non-empty string (the DB column is NOT NULL). Direct
    // type check rather than asNonEmptyString so the stored markdown keeps its
    // verbatim leading/trailing whitespace.
    if (typeof body.prompt_md !== 'string' || body.prompt_md.trim() === '') {
      return validationError('prompt_md is required and must be a non-empty string');
    }
    const promptMd = body.prompt_md;

    // parent_version_id: optional, audit-only. If supplied it must be a
    // non-empty string (recorded in the activity_logs metadata, not the table).
    let parentVersionId: string | null = null;
    if (body.parent_version_id !== undefined && body.parent_version_id !== null) {
      const p = asNonEmptyString(body.parent_version_id);
      if (p === undefined) {
        return validationError('parent_version_id must be a non-empty string when provided');
      }
      parentVersionId = p;
    }

    // ─── Insert staging row ───
    let row: {
      id: string;
      agent: string;
      version: string;
      weight: number | string;
      active: boolean;
      status: string;
      created_at: string;
    };
    try {
      const result = await pool.query<typeof row>(INSERT_STAGING_SQL, [agent, version, promptMd]);
      row = result.rows[0];
    } catch (error) {
      const code = pgErrorCode(error);
      // UNIQUE (agent, version) violation → this (agent, version) already exists.
      if (code === '23505') {
        return NextResponse.json(
          {
            ok: false,
            error: 'CONFLICT',
            message: `a prompt version already exists for agent='${agent}', version='${version}'`,
          },
          { status: 409 }
        );
      }
      throw error;
    }

    // ─── Best-effort audit to activity_logs (non-blocking) ───
    // Matches the v1.1 admin-route convention (`/api/cascade/override-policy`):
    // a failure here must not fail the request.
    try {
      await pool.query(
        `INSERT INTO activity_logs ("complaintId", action, description, "actorId", "actorName", metadata)
         VALUES (NULL, $1, $2, $3, $4, $5)`,
        [
          'prompt_version_staged',
          `Admin staged prompt version '${version}' for agent '${agent}'`,
          payload.userId,
          payload.username,
          JSON.stringify({
            prompt_version_id: row.id,
            agent,
            version,
            parent_version_id: parentVersionId,
            weight: 0,
            active: false,
            status: 'staging',
          }),
        ]
      );
    } catch (logError) {
      console.error('[agents/prompt-versions] Audit log error:', logError);
    }

    return NextResponse.json({
      ok: true,
      data: {
        id: row.id,
        agent: row.agent,
        version: row.version,
        weight: Number(row.weight),
        active: row.active,
        status: row.status,
        created_at: row.created_at,
      },
    });
  } catch (error) {
    console.error('[agents/prompt-versions] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  // Wrap with idempotency dedupe (task 26.1 / 31.9): a retried request carrying
  // the same `Idempotency-Key` header replays the stored response rather than
  // inserting a duplicate staging row. No header → runs normally (no dedupe).
  return withIdempotency(request, ENDPOINT, () => handleStagingInsert(request), pool);
}
