import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createTraceLogger } from '@/lib/trace/logger';

/**
 * POST /api/guardrail/log  (n8n internal)
 *
 * Called by the Guardrail Code Node in JS-01v2 after a specialist agent reply
 * is checked and the umbrella `checkReply` returns a non-OK action (Req 25.8,
 * 25.10, Design §v1.1.6). Persists one `guardrail_violations` row per check and,
 * when an `agent_invocation_id` is supplied, flips
 * `agent_invocations.guardrail_blocked = true`.
 *
 * Auth: `X-N8N-SECRET` header must match `N8N_WEBHOOK_SECRET`.
 *
 * Body:
 * {
 *   session_id?: string,
 *   agent_invocation_id?: string (uuid),
 *   trace_id?: string (uuid),
 *   rule_name: string,            // joined violation rule ids, e.g. "pii_leak,length_cap"
 *   original_reply?: string,      // truncated to 1000 chars (PII minimization)
 *   repaired_reply?: string,      // truncated to 1000 chars; NULL when blocked
 *   action: 'repaired' | 'blocked' | 'flagged',
 *   severity?: 'low' | 'medium' | 'high'
 * }
 *
 * Fire-and-forget on the workflow side: a failure here MUST NOT block the
 * citizen-facing reply (Design §Observability). Returns { ok, data: { id } }.
 *
 * Requirements: 25.8, 25.10 — Design §v1.1.6
 * @see supabase/migrations/20260201_003_handoff_guardrail_cache.sql — guardrail_violations DDL
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const VALID_ACTIONS = ['repaired', 'blocked', 'flagged'] as const;
const VALID_SEVERITIES = ['low', 'medium', 'high'] as const;

/** Truncate a value to at most `max` chars; null/undefined pass through as null. */
function truncate(value: unknown, max = 1000): string | null {
  if (typeof value !== 'string') return null;
  return value.slice(0, max);
}

export async function POST(request: NextRequest) {
  try {
    // ─── Auth: verify n8n webhook secret ───
    const secret = request.headers.get('x-n8n-secret');
    const expectedSecret = process.env.N8N_WEBHOOK_SECRET;
    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // ─── Parse body ───
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'request body must be a JSON object' },
        { status: 400 }
      );
    }

    const {
      session_id,
      agent_invocation_id,
      trace_id,
      rule_name,
      original_reply,
      repaired_reply,
      action,
      severity,
    } = body as Record<string, unknown>;

    // ─── Validation ───
    if (typeof rule_name !== 'string' || rule_name.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'rule_name is required' },
        { status: 400 }
      );
    }
    if (typeof action !== 'string' || !VALID_ACTIONS.includes(action as (typeof VALID_ACTIONS)[number])) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: `action must be one of: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 }
      );
    }
    const resolvedSeverity =
      typeof severity === 'string' && VALID_SEVERITIES.includes(severity as (typeof VALID_SEVERITIES)[number])
        ? severity
        : 'medium';

    const log = createTraceLogger(request, {
      route: '/api/guardrail/log',
      traceId: typeof trace_id === 'string' ? trace_id : undefined,
    });

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data, error } = await supabase
      .from('guardrail_violations')
      .insert({
        session_id: typeof session_id === 'string' ? session_id : null,
        agent_invocation_id: typeof agent_invocation_id === 'string' ? agent_invocation_id : null,
        trace_id: log.traceId,
        rule_name: rule_name.slice(0, 200),
        original_reply: truncate(original_reply),
        repaired_reply: action === 'blocked' ? null : truncate(repaired_reply),
        action,
        severity: resolvedSeverity,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      log.error('guardrail_violation_insert_failed', { session_id, err: error.message });
      return NextResponse.json(
        { ok: false, error: 'Failed to log guardrail violation', details: error.message },
        { status: 500 }
      );
    }

    // Best-effort: mark the agent invocation as guardrail-blocked (Req 25.10).
    if (typeof agent_invocation_id === 'string' && agent_invocation_id.length > 0) {
      const { error: updErr } = await supabase
        .from('agent_invocations')
        .update({ guardrail_blocked: true })
        .eq('id', agent_invocation_id);
      if (updErr) {
        // Non-fatal: the violation row is the source of truth.
        log.warn('agent_invocation_guardrail_flag_failed', { agent_invocation_id, err: updErr.message });
      }
    }

    log.info('guardrail_violation_logged', { id: data.id, action, rule_name });
    return NextResponse.json({ ok: true, data: { id: data.id } });
  } catch (error) {
    console.error('[guardrail/log] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
