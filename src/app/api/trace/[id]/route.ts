import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/trace/[id]
 *
 * Admin trace-inspector endpoint (task 25.5, Req 27.5 / 32.4 / 32.5).
 *
 * Reconstructs the full end-to-end timeline of a single inbound message from
 * its `trace_id` (a UUIDv7 assigned at the Parse Message node — Design §v1.1.8).
 * A `trace_id` is propagated through every logging table, so this handler runs
 * seven indexed lookups by `trace_id` in parallel — one per trace-carrying
 * table — and merges the rows into a single chronological `TraceTimelineEvent[]`:
 *
 *   routing_decisions     → kind 'routing_decision'      (ts = created_at)
 *   agent_invocations     → kind 'agent_invocation'      (ts = started_at)
 *   cascade_notifications → kind 'cascade_notification'  (ts = notified_at)
 *   screening_log         → kind 'screening'             (ts = created_at)
 *   guardrail_violations  → kind 'guardrail_violation'   (ts = created_at)
 *   query_cache           → kind 'query_cache_hit'       (ts = created_at)
 *   whatsapp_outbox       → kind 'whatsapp_outbox'       (ts = created_at)
 *
 * Each table's per-`trace_id` index (idx_*_trace, migration
 * 20260201_006_trace_ids_and_indexes.sql) keeps the seven lookups fast.
 *
 * Auth: admin JWT only (matches the sibling admin route /api/agents/test-route).
 *   - 401 when the token is missing or invalid.
 *   - 403 when the caller is not an admin.
 * A non-UUID `id` returns 400.
 *
 * Phone fields are masked for non-admin callers (Req 32.5). Because this route
 * is admin-gated, admins receive unmasked values; the masking branch is retained
 * as defense-in-depth and to match the documented contract.
 *
 * Returns: { ok: true, data: { trace_id, events: TraceTimelineEvent[] } }
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.8 Trace IDs, §v1.1.15
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 27.5, 32.4, 32.5
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Any RFC-4122 canonical UUID (the stored trace_ids are UUIDv7). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Row shapes (mirrors the trace-carrying tables) ───

interface RoutingDecisionRow {
  id: string;
  session_id: string;
  message_text: string | null;
  last_intent_before: string | null;
  agent_dispatched: string | null;
  reason: string | null;
  trace_id: string | null;
  created_at: string;
}

interface AgentInvocationRow {
  id: string;
  session_id: string;
  agent: string;
  started_at: string;
  completed_at: string | null;
  tokens_used: number | null;
  tools_called: unknown;
  success: boolean | null;
  error_message: string | null;
  trace_id: string | null;
}

interface CascadeNotificationRow {
  id: string;
  blood_request_id: string;
  donor_id: string;
  tier: number;
  notified_at: string;
  responded_at: string | null;
  response: string | null;
  trace_id: string | null;
}

interface ScreeningLogRow {
  id: string;
  donor_id: string;
  blood_request_id: string | null;
  screening_answers: unknown;
  screening_passed: boolean;
  deferral_applied: boolean;
  trace_id: string | null;
  created_at: string;
}

interface GuardrailViolationRow {
  id: string;
  session_id: string | null;
  agent_invocation_id: string | null;
  trace_id: string | null;
  rule_name: string;
  original_reply: string | null;
  repaired_reply: string | null;
  action: string;
  severity: string;
  created_at: string;
}

interface QueryCacheRow {
  id: string;
  query_hash: string;
  query_text: string;
  category: string;
  response: string;
  hit_count: number;
  trace_id: string | null;
  created_at: string;
  expires_at: string;
}

interface WhatsappOutboxRow {
  id: string;
  recipient_phone: string;
  message_body: unknown;
  status: string;
  attempts: number;
  max_attempts: number;
  last_attempt_at: string | null;
  error_message: string | null;
  trace_id: string | null;
  created_at: string;
  scheduled_at: string;
}

/** Unified, chronological timeline event (Design §v1.1.8). */
type TraceTimelineEvent =
  | { kind: 'routing_decision'; ts: string; data: RoutingDecisionRow }
  | { kind: 'agent_invocation'; ts: string; data: AgentInvocationRow }
  | { kind: 'cascade_notification'; ts: string; data: CascadeNotificationRow }
  | { kind: 'screening'; ts: string; data: ScreeningLogRow }
  | { kind: 'guardrail_violation'; ts: string; data: GuardrailViolationRow }
  | { kind: 'query_cache_hit'; ts: string; data: QueryCacheRow }
  | { kind: 'whatsapp_outbox'; ts: string; data: WhatsappOutboxRow };

/**
 * Mask a phone number for non-admin contexts (matches /api/routing/decisions).
 * Keeps the first 3 and last 4 characters, replacing the middle with asterisks.
 * e.g. "+919876543210" → "+91******3210"
 */
function maskPhone(phone: string): string {
  if (!phone || phone.length <= 7) return phone;
  const prefix = phone.slice(0, 3);
  const suffix = phone.slice(-4);
  const maskedLength = phone.length - 7;
  return `${prefix}${'*'.repeat(maskedLength)}${suffix}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ─── Auth: admin JWT only ───
  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 401 });
  }

  const isAdmin = payload.role === 'ADMIN';
  if (!isAdmin) {
    return NextResponse.json({ ok: false, error: 'Admin access required' }, { status: 403 });
  }

  // ─── Validate the trace id ───
  const { id } = await params;
  const traceId = (id ?? '').trim().toLowerCase();
  if (!UUID_RE.test(traceId)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid trace_id — must be a UUID' },
      { status: 400 }
    );
  }

  // ─── Seven indexed lookups by trace_id, in parallel ───
  const [
    routing,
    invocations,
    cascades,
    screenings,
    guardrails,
    cacheHits,
    outbox,
  ] = await Promise.all([
    supabase.from('routing_decisions').select('*').eq('trace_id', traceId),
    supabase.from('agent_invocations').select('*').eq('trace_id', traceId),
    supabase.from('cascade_notifications').select('*').eq('trace_id', traceId),
    supabase.from('screening_log').select('*').eq('trace_id', traceId),
    supabase.from('guardrail_violations').select('*').eq('trace_id', traceId),
    supabase.from('query_cache').select('*').eq('trace_id', traceId),
    supabase.from('whatsapp_outbox').select('*').eq('trace_id', traceId),
  ]);

  // If every table errored, the trace can't be reconstructed — surface a 500.
  const results = [routing, invocations, cascades, screenings, guardrails, cacheHits, outbox];
  const errors = results.filter((r) => r.error);
  if (errors.length === results.length) {
    console.error('[trace/[id]] all trace lookups failed:', errors.map((e) => e.error));
    return NextResponse.json(
      { ok: false, error: 'Failed to reconstruct trace timeline' },
      { status: 500 }
    );
  }
  // Log any partial failures but continue with what we have.
  for (const r of errors) {
    console.error('[trace/[id]] trace lookup error:', r.error);
  }

  // ─── Merge rows into a single timeline ───
  const events: TraceTimelineEvent[] = [];

  for (const row of (routing.data ?? []) as RoutingDecisionRow[]) {
    const data = isAdmin || !row.session_id
      ? row
      : { ...row, session_id: maskPhone(row.session_id) };
    events.push({ kind: 'routing_decision', ts: row.created_at, data });
  }

  for (const row of (invocations.data ?? []) as AgentInvocationRow[]) {
    const data = isAdmin || !row.session_id
      ? row
      : { ...row, session_id: maskPhone(row.session_id) };
    events.push({ kind: 'agent_invocation', ts: row.started_at, data });
  }

  for (const row of (cascades.data ?? []) as CascadeNotificationRow[]) {
    events.push({ kind: 'cascade_notification', ts: row.notified_at, data: row });
  }

  for (const row of (screenings.data ?? []) as ScreeningLogRow[]) {
    events.push({ kind: 'screening', ts: row.created_at, data: row });
  }

  for (const row of (guardrails.data ?? []) as GuardrailViolationRow[]) {
    const data = isAdmin || !row.session_id
      ? row
      : { ...row, session_id: maskPhone(row.session_id) };
    events.push({ kind: 'guardrail_violation', ts: row.created_at, data });
  }

  for (const row of (cacheHits.data ?? []) as QueryCacheRow[]) {
    events.push({ kind: 'query_cache_hit', ts: row.created_at, data: row });
  }

  for (const row of (outbox.data ?? []) as WhatsappOutboxRow[]) {
    const data = isAdmin || !row.recipient_phone
      ? row
      : { ...row, recipient_phone: maskPhone(row.recipient_phone) };
    events.push({ kind: 'whatsapp_outbox', ts: row.created_at, data });
  }

  // Chronological order (ts ASC). Stable for equal timestamps.
  events.sort((a, b) => {
    const ta = a.ts ? Date.parse(a.ts) : 0;
    const tb = b.ts ? Date.parse(b.ts) : 0;
    return ta - tb;
  });

  return NextResponse.json({
    ok: true,
    data: {
      trace_id: traceId,
      events,
    },
  });
}
