import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

/**
 * POST /api/cache/invalidate  (admin)
 *
 * Admin-only endpoint that drops entries from the Semantic Cache (`query_cache`)
 * so freshly written/updated data (e.g. a newly registered complaint) does not
 * keep returning a stale cached "no such ticket" / scheme / help response.
 *
 * This is the manual counterpart to the automatic LISTEN/NOTIFY
 * `cache_invalidate` listener (task 24.4): an operator can force a drop by
 * category, by ticket number, or by session from `/dashboard/agents`.
 *
 * Auth: admin JWT (Bearer token) — same pattern as `/api/agents/test-route`
 * and `/api/blood-requests/escalate`.
 *
 * Request body (all optional, but at least one is required):
 * {
 *   category?:      "status" | "scheme" | "help",   // drop a whole category
 *   ticket_number?: string,                          // drop rows mentioning a ticket
 *   session_id?:    string                           // drop rows mentioning a session/phone
 * }
 *
 * When multiple filters are supplied they are AND-combined (more specific →
 * fewer rows dropped), mirroring the design's invalidation listener which scopes
 * a ticket drop to `category='ticket_status'`. Supplying no filter is rejected
 * with VALIDATION_FAILED to prevent an accidental full-table wipe.
 *
 * Response: { ok: true, data: { deleted_count: number } }
 *
 * ─── Design-vs-migration schema note (IMPORTANT) ─────────────────────────────
 * Design §v1.1.7 / Req 26.x and the §v1.1.15 contract describe categories as
 * `ticket_status | scheme_info | help_list` and a `ttl` column. The ACTUALLY
 * shipped schema (`supabase/migrations/20260201_003_handoff_guardrail_cache.sql`)
 * uses `category IN ('status','scheme','help')`, a `response text` column, and
 * `expires_at` (not `ttl`). This route is written against the REAL schema — the
 * same decision `src/lib/semanticCache/lookup.ts` documents — so that a delete
 * actually matches the rows that were stored. `query_cache` has no `session_id`
 * column, so a session filter is a best-effort `ILIKE` over `query_text`.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.7, §v1.1.15
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 26
 * @see supabase/migrations/20260201_003_handoff_guardrail_cache.sql — query_cache DDL
 */

export const runtime = 'nodejs';

/**
 * Raw pg pool — the Semantic Cache helpers use a node-postgres client (the
 * pgvector `<=>` ANN search isn't expressible through the Supabase builder), so
 * this admin route follows the same `DATABASE_URL`/`DIRECT_URL` convention used
 * by `donor-respond` and `cancel-acceptance`.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

/** Category values accepted by the `chk_cache_category` CHECK constraint. */
const VALID_CATEGORIES = ['status', 'scheme', 'help'] as const;
type CacheCategory = (typeof VALID_CATEGORIES)[number];

interface InvalidateBody {
  category?: unknown;
  session_id?: unknown;
  ticket_number?: unknown;
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
    let body: InvalidateBody;
    try {
      body = (await request.json()) as InvalidateBody;
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const category = asNonEmptyString(body.category);
    const ticketNumber = asNonEmptyString(body.ticket_number);
    const sessionId = asNonEmptyString(body.session_id);

    // ─── Validation ───
    // Reject types that were supplied but are not usable strings.
    if (body.category !== undefined && category === undefined) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'category must be a non-empty string' },
        { status: 400 }
      );
    }
    if (body.ticket_number !== undefined && ticketNumber === undefined) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'ticket_number must be a non-empty string' },
        { status: 400 }
      );
    }
    if (body.session_id !== undefined && sessionId === undefined) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'session_id must be a non-empty string' },
        { status: 400 }
      );
    }

    if (category !== undefined && !VALID_CATEGORIES.includes(category as CacheCategory)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'VALIDATION_FAILED',
          message: `category must be one of: ${VALID_CATEGORIES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // At least one filter is required — never allow an unscoped full-table wipe.
    if (!category && !ticketNumber && !sessionId) {
      return NextResponse.json(
        {
          ok: false,
          error: 'VALIDATION_FAILED',
          message: 'At least one of category, ticket_number, or session_id is required',
        },
        { status: 400 }
      );
    }

    // ─── Build the parameterized DELETE (filters AND-combined) ───
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    if (ticketNumber) {
      // A ticket can appear either in the cached answer or the original query.
      params.push(ticketNumber);
      const p = params.length;
      conditions.push(`(response ILIKE '%' || $${p} || '%' OR query_text ILIKE '%' || $${p} || '%')`);
    }

    if (sessionId) {
      // No session column on query_cache — best-effort match on the query text.
      params.push(sessionId);
      conditions.push(`query_text ILIKE '%' || $${params.length} || '%'`);
    }

    const sql = `DELETE FROM query_cache WHERE ${conditions.join(' AND ')}`;
    const result = await pool.query(sql, params);
    const deletedCount = result.rowCount ?? 0;

    return NextResponse.json({
      ok: true,
      data: { deleted_count: deletedCount },
    });
  } catch (error) {
    console.error('[cache/invalidate] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
