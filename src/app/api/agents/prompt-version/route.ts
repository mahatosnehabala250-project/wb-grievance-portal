import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

/**
 * POST /api/agents/prompt-version  (admin)
 *
 * Admin-only endpoint that registers (inserts or re-activates) a single prompt
 * version row in `agent_prompt_versions` — the table the v1.1.14 Prompt_Selector
 * reads from (`src/lib/abtest/promptLoader.ts`) and that the deploy-time
 * registrar (`scripts/register-prompt-versions.js`) seeds with the `full` /
 * `compact` variants.
 *
 * This is the SIMPLE single-row registration endpoint (note the SINGULAR path).
 * It is distinct from the v1.1 staging → promote pair at the PLURAL path
 * `/api/agents/prompt-versions` (+ `/:id/promote`, tasks 31.9 / 31.10), which
 * enforces the `weight=0, active=false` staging contract and the atomic
 * demote-old + promote-new transition. This endpoint just upserts whatever
 * `(agent, version)` the admin hands it, keyed on the table's
 * `UNIQUE (agent, version)` constraint.
 *
 * Auth: admin JWT (Bearer token) — same pattern as `/api/agents/test-route`
 * and `/api/cache/invalidate`.
 *
 * Request body:
 * {
 *   agent:     "complaint" | "blood" | "donor" | "info",  // required
 *   version:   string,                                     // required, non-empty
 *   prompt_md: string,                                     // required, non-empty
 *   weight?:   number,                                     // optional, >= 0, default 1.0
 *   active?:   boolean                                     // optional, default false
 * }
 *
 * Behaviour: idempotent UPSERT on `(agent, version)`. Re-registering the same
 * pair overwrites `prompt_md`, `weight`, `active`, derives `status`
 * (active=true → 'active', else 'staging') and bumps `updated_at`. The `status`
 * is derived (never taken from the body) so an active row can never be left with
 * a stale `status='staging'` — keeping it consistent with the deploy-time
 * registrar (`promptRegistry.ts`).
 *
 * Response: { ok: true, data: { id } } — the row's uuid (Design §v1.1.15).
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.14, §v1.1.15
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 33.1
 * @see supabase/migrations/20260201_004_idempotency_outbox_promptversions.sql — agent_prompt_versions DDL
 * @see src/lib/abtest/promptLoader.ts — the reader this endpoint feeds
 * @see src/lib/abtest/promptRegistry.ts — the deploy-time registrar (same UPSERT shape)
 */

export const runtime = 'nodejs';

/**
 * Raw pg pool — follows the same `DATABASE_URL`/`DIRECT_URL` convention used by
 * `/api/cache/invalidate` and the donor-respond / cancel-acceptance routes, and
 * matches the connection-string resolution in `scripts/register-prompt-versions.js`.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

/** Agent values accepted by the `chk_agent_prompt_versions_agent` CHECK constraint. */
const VALID_AGENTS = ['complaint', 'blood', 'donor', 'info'] as const;
type Agent = (typeof VALID_AGENTS)[number];

/**
 * Idempotent upsert keyed on `UNIQUE (agent, version)` (migration 004).
 * Parameter order: [agent, version, prompt_md, weight, active, status].
 * Mirrors `UPSERT_PROMPT_VERSION_SQL` in `src/lib/abtest/promptRegistry.ts`,
 * plus a `RETURNING id` so the handler can echo the row id (Design §v1.1.15).
 */
const UPSERT_PROMPT_VERSION_SQL = `
INSERT INTO agent_prompt_versions (agent, version, prompt_md, weight, active, status)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (agent, version)
DO UPDATE SET
  prompt_md  = EXCLUDED.prompt_md,
  weight     = EXCLUDED.weight,
  active     = EXCLUDED.active,
  status     = EXCLUDED.status,
  updated_at = NOW()
RETURNING id
`.trim();

interface PromptVersionBody {
  agent?: unknown;
  version?: unknown;
  prompt_md?: unknown;
  weight?: unknown;
  active?: unknown;
}

/** Treat empty / whitespace-only strings as "not provided". */
function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export async function POST(request: NextRequest) {
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
    let body: PromptVersionBody;
    try {
      body = (await request.json()) as PromptVersionBody;
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    // ─── Validation ───
    const agent = asNonEmptyString(body.agent);
    if (!agent) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'agent is required' },
        { status: 400 }
      );
    }
    if (!VALID_AGENTS.includes(agent as Agent)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'VALIDATION_FAILED',
          message: `agent must be one of: ${VALID_AGENTS.join(', ')}`,
        },
        { status: 400 }
      );
    }

    const version = asNonEmptyString(body.version);
    if (!version) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'version is required' },
        { status: 400 }
      );
    }

    // prompt_md must be a non-empty string (the DB column is NOT NULL). Use a
    // direct type check rather than asNonEmptyString so the stored markdown is
    // preserved verbatim (leading/trailing whitespace not trimmed away).
    if (typeof body.prompt_md !== 'string' || body.prompt_md.trim() === '') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'prompt_md is required and must be a non-empty string' },
        { status: 400 }
      );
    }
    const promptMd = body.prompt_md;

    // weight: optional, finite, >= 0. Default 1.0 (matches the column default).
    let weight = 1.0;
    if (body.weight !== undefined) {
      if (typeof body.weight !== 'number' || !Number.isFinite(body.weight) || body.weight < 0) {
        return NextResponse.json(
          { ok: false, error: 'VALIDATION_FAILED', message: 'weight must be a finite number >= 0' },
          { status: 400 }
        );
      }
      weight = body.weight;
    }

    // active: optional boolean. Default false (matches the column default and
    // the staging-first convention — promotion to traffic is an explicit act).
    let active = false;
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') {
        return NextResponse.json(
          { ok: false, error: 'VALIDATION_FAILED', message: 'active must be a boolean' },
          { status: 400 }
        );
      }
      active = body.active;
    }

    // Derive status from active so the lifecycle column stays consistent with
    // the active flag (CHECK status IN ('staging','active','archived')).
    const status = active ? 'active' : 'staging';

    // ─── Upsert ───
    const result = await pool.query<{ id: string }>(UPSERT_PROMPT_VERSION_SQL, [
      agent,
      version,
      promptMd,
      weight,
      active,
      status,
    ]);

    const id = result.rows[0]?.id;

    return NextResponse.json({
      ok: true,
      data: { id, agent, version, weight, active, status },
    });
  } catch (error) {
    console.error('[agents/prompt-version] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
