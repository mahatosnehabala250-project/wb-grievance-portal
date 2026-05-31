import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/system-health  (admin only)
 *
 * Powers the `/dashboard/system-health` page (task 30.4). Aggregates the v1.1
 * operational health signals into the single envelope defined in
 * Design §v1.1.15:
 *
 *   { ok, data: {
 *       breakers: CircuitState[],                 // circuit_state rows (Req 29.1, 29.7)
 *       outbox: { pending, failed, drainRatePerSec },  // whatsapp_outbox depth + drain (Req 29.5)
 *       today_tokens,                             // today's token consumption total
 *       latency_p95_per_agent,                    // Design §v1.1.15 shape (p95 per agent)
 *       latency_per_agent,                        // Req 32.3 — p50 / p95 / p99 per agent
 *       in_flight_cascades,                       // Req 32.3 — notified-not-responded count
 *       recent_violations: GuardrailViolation[],  // last 50 guardrail_violations (Req 32.3)
 *   } }
 *
 * Reads are direct, read-only SELECTs against the service-role client (the same
 * convention as `src/app/api/routing/decisions/route.ts`). Each signal is loaded
 * in isolation and **degrades gracefully**: if an optional table is missing or a
 * query fails, that slice falls back to a safe default (empty / zero) and the
 * rest of the payload is still returned. An operational gap in one table must
 * never blank out the whole health page.
 *
 * Phone numbers in `recent_violations.session_id` are NOT masked because this
 * endpoint is admin-only (Req 32.5 masks only for non-admin contexts; non-admins
 * never reach here).
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.15 Updated API Endpoint Contracts, §v1.1.10 Circuit Breakers
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 32.3, 29.7
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** A `circuit_state` row (columns mirror migration 20260201_005). */
export interface CircuitStateRow {
  name: string;
  state: string;
  consecutive_failures: number;
  window_start: string | null;
  opened_at: string | null;
  last_probe_at: string | null;
  updated_at: string | null;
}

/** whatsapp_outbox depth + recent drain rate. */
export interface OutboxStats {
  pending: number;
  failed: number;
  drainRatePerSec: number;
}

/** Per-agent reply latency percentiles (milliseconds). */
export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
  count: number;
}

/** A `guardrail_violations` row (columns mirror migration 20260201_003). */
export interface GuardrailViolationRow {
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

/** Full response payload shape. */
export interface SystemHealthData {
  breakers: CircuitStateRow[];
  outbox: OutboxStats;
  today_tokens: number;
  latency_p95_per_agent: Record<string, number>;
  latency_per_agent: Record<string, LatencyPercentiles>;
  in_flight_cascades: number | null;
  recent_violations: GuardrailViolationRow[];
  generated_at: string;
}

/** Window (seconds) used to estimate the outbox drain rate. */
const DRAIN_WINDOW_SECONDS = 60;
/** Hard cap on rows pulled for today's latency / token aggregation. */
const AGG_ROW_CAP = 10000;
/** Most-recent guardrail rows surfaced on the page (Req 32.3). */
const RECENT_VIOLATIONS_LIMIT = 50;

/** Start of the current UTC day as an ISO string. */
function startOfTodayISO(now = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Nearest-rank percentile over an ascending-sorted numeric array.
 * `p` is a fraction in [0, 1]. Returns 0 for an empty array.
 */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil(p * sortedAsc.length);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx];
}

/** Load circuit breaker rows. Degrades to [] if the table is absent. */
async function loadBreakers(): Promise<CircuitStateRow[]> {
  try {
    const { data, error } = await supabase
      .from('circuit_state')
      .select('name, state, consecutive_failures, window_start, opened_at, last_probe_at, updated_at')
      .order('name', { ascending: true });
    if (error || !data) return [];
    return data as CircuitStateRow[];
  } catch {
    return [];
  }
}

/** Load outbox depth + drain rate. Degrades to zeros if the table is absent. */
async function loadOutbox(now = new Date()): Promise<OutboxStats> {
  const fallback: OutboxStats = { pending: 0, failed: 0, drainRatePerSec: 0 };
  try {
    const since = new Date(now.getTime() - DRAIN_WINDOW_SECONDS * 1000).toISOString();

    const [pendingRes, failedRes, drainedRes] = await Promise.all([
      supabase.from('whatsapp_outbox').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('whatsapp_outbox').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      supabase
        .from('whatsapp_outbox')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent')
        .gte('last_attempt_at', since),
    ]);

    if (pendingRes.error && failedRes.error && drainedRes.error) return fallback;

    const drainedCount = drainedRes.count ?? 0;
    return {
      pending: pendingRes.count ?? 0,
      failed: failedRes.count ?? 0,
      drainRatePerSec: Number((drainedCount / DRAIN_WINDOW_SECONDS).toFixed(3)),
    };
  } catch {
    return fallback;
  }
}

/**
 * Load today's agent invocations once and derive both the token total and the
 * per-agent latency percentiles. Degrades to empty aggregates on failure.
 */
async function loadInvocationAggregates(now = new Date()): Promise<{
  today_tokens: number;
  latency_per_agent: Record<string, LatencyPercentiles>;
  latency_p95_per_agent: Record<string, number>;
}> {
  const empty = { today_tokens: 0, latency_per_agent: {}, latency_p95_per_agent: {} };
  try {
    const { data, error } = await supabase
      .from('agent_invocations')
      .select('agent, tokens_used, started_at, completed_at')
      .gte('started_at', startOfTodayISO(now))
      .order('started_at', { ascending: false })
      .limit(AGG_ROW_CAP);

    if (error || !data) return empty;

    let todayTokens = 0;
    const latenciesByAgent: Record<string, number[]> = {};

    for (const row of data as Array<Record<string, unknown>>) {
      const tokens = typeof row.tokens_used === 'number' ? row.tokens_used : Number(row.tokens_used);
      if (Number.isFinite(tokens)) todayTokens += tokens;

      const agent = typeof row.agent === 'string' ? row.agent : 'unknown';
      const startedAt = row.started_at ? new Date(row.started_at as string).getTime() : NaN;
      const completedAt = row.completed_at ? new Date(row.completed_at as string).getTime() : NaN;
      if (Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt) {
        (latenciesByAgent[agent] ??= []).push(completedAt - startedAt);
      }
    }

    const latencyPerAgent: Record<string, LatencyPercentiles> = {};
    const latencyP95PerAgent: Record<string, number> = {};
    for (const [agent, latencies] of Object.entries(latenciesByAgent)) {
      latencies.sort((a, b) => a - b);
      const p50 = percentile(latencies, 0.5);
      const p95 = percentile(latencies, 0.95);
      const p99 = percentile(latencies, 0.99);
      latencyPerAgent[agent] = { p50, p95, p99, count: latencies.length };
      latencyP95PerAgent[agent] = p95;
    }

    return {
      today_tokens: todayTokens,
      latency_per_agent: latencyPerAgent,
      latency_p95_per_agent: latencyP95PerAgent,
    };
  } catch {
    return empty;
  }
}

/**
 * In-flight cascade count = notified donors still awaiting a response.
 * Optional signal: returns null (omit-friendly) if the table/column is absent.
 */
async function loadInFlightCascades(): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from('cascade_notifications')
      .select('id', { count: 'exact', head: true })
      .is('responded_at', null);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

/** Load the most recent guardrail violations. Degrades to [] if absent. */
async function loadRecentViolations(): Promise<GuardrailViolationRow[]> {
  try {
    const { data, error } = await supabase
      .from('guardrail_violations')
      .select('id, session_id, agent_invocation_id, trace_id, rule_name, original_reply, repaired_reply, action, severity, created_at')
      .order('created_at', { ascending: false })
      .limit(RECENT_VIOLATIONS_LIMIT);
    if (error || !data) return [];
    return data as GuardrailViolationRow[];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  // ─── Auth: admin JWT only ───
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

  // ─── Gather every health signal in parallel; each degrades independently ───
  const now = new Date();
  const [breakers, outbox, aggregates, inFlightCascades, recentViolations] = await Promise.all([
    loadBreakers(),
    loadOutbox(now),
    loadInvocationAggregates(now),
    loadInFlightCascades(),
    loadRecentViolations(),
  ]);

  const data: SystemHealthData = {
    breakers,
    outbox,
    today_tokens: aggregates.today_tokens,
    latency_p95_per_agent: aggregates.latency_p95_per_agent,
    latency_per_agent: aggregates.latency_per_agent,
    in_flight_cascades: inFlightCascades,
    recent_violations: recentViolations,
    generated_at: now.toISOString(),
  };

  return NextResponse.json({ ok: true, data });
}
