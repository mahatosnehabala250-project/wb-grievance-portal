import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/cron/classifier-calibration   (Vercel Cron)
 *
 * Nightly classifier calibration job (task 18.7, Req 20.7, Design §v1.1.1
 * "Confidence calibration note"). Gemini Flash is not natively calibrated, so
 * the raw `confidence` the classifier emits is only a coarse signal. This job
 * recomputes the EMPIRICAL reliability of each agent class — and of each
 * confidence bucket — from the logged routing decisions joined with their
 * downstream outcome, then publishes the result so miscalibration is visible
 * on `/dashboard/agent-routing` and prompts/thresholds can be tuned.
 *
 *   reliability(agent)  = (# classifier decisions for `agent` whose downstream
 *                          agent_invocation succeeded) / (# classifier decisions
 *                          for `agent` that have a known outcome)
 *
 * A bucket/agent is flagged as MISCALIBRATED when the gap between the mean
 * stated confidence and the observed reliability exceeds CALIBRATION_GAP_THRESHOLD
 * (the classifier is over- or under-confident there).
 *
 * ─── Data sources (Design §v1.1.1, migration 20260201_001) ───────────────────
 * The classifier records every fallback decision on a `routing_decisions` row
 * with `classifier_used = true` and a numeric `confidence` (Req 20.7), tagged
 * with a `trace_id` (migration 20260201_001 §3). The downstream success signal
 * is `agent_invocations.success`, correlated by the shared `trace_id`
 * (migration 20260201_001 §4a). The Supabase REST client cannot express a SQL
 * JOIN, so both windows are fetched and joined in-process on `trace_id` — the
 * same read-and-aggregate-in-JS approach `src/app/api/system-health/route.ts`
 * uses for its per-agent latency rollup.
 *
 * ─── Where results are written (Design §v1.1.1) ──────────────────────────────
 * The design names NO dedicated calibration table — it says the job "surfaces
 * miscalibration on /dashboard/agent-routing". The convention-consistent sink
 * is the existing `system_config` key/value store (migration 20260101_009):
 * service-role writable, admin-readable, and already the resolution source for
 * the `getFeatureFlag` chain (`src/lib/featureFlags/getFeatureFlag.ts`). The
 * full calibration report is upserted as JSON under the key
 * `ROUTER_CLASSIFIER_CALIBRATION` so the dashboard can read the latest snapshot
 * with a single keyed lookup. No schema migration is required.
 *
 * ─── Schedule ────────────────────────────────────────────────────────────────
 * Registered in `vercel.json` `crons` as a nightly run at 02:30 UTC:
 *   { "path": "/api/cron/classifier-calibration", "schedule": "30 2 * * *" }
 * Vercel Cron invokes the route with a GET request.
 *
 * ─── Auth ────────────────────────────────────────────────────────────────────
 * Vercel automatically attaches `Authorization: Bearer ${CRON_SECRET}` to cron
 * invocations when `CRON_SECRET` is set. This handler rejects any request whose
 * bearer token does not match `process.env.CRON_SECRET` (fail-closed): if
 * `CRON_SECRET` is not configured the route refuses to run rather than exposing
 * routing analytics to an unauthenticated caller. Mirrors
 * `src/app/api/cron/idempotency-cleanup/route.ts`.
 *
 * Response: { ok: true, data: CalibrationReport }
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.1 (Confidence calibration note)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 20.7
 * @see supabase/migrations/20260201_001_router_classifier_cache_and_session_columns.sql — routing_decisions classifier_used/confidence/trace_id
 * @see supabase/migrations/20260101_001_routing_observability.sql — agent_invocations.success/trace_id
 * @see supabase/migrations/20260101_009_system_config.sql — system_config sink
 */

export const runtime = 'nodejs';
// Never serve a cached response for a cron mutation.
export const dynamic = 'force-dynamic';

/**
 * Service-role Supabase client — matches the convention used by the sibling
 * cron route and the v1.1 read routes (`/api/system-health`, `/api/routing/decisions`).
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** system_config key under which the latest calibration snapshot is published. */
const CALIBRATION_CONFIG_KEY = 'ROUTER_CLASSIFIER_CALIBRATION';

/** How far back to look when recomputing empirical reliability (days). */
const LOOKBACK_DAYS = 7;

/**
 * Confidence buckets. The 0.6 boundary is the act/ask threshold from
 * Design §v1.1.1 (`confidence ≥ 0.6` → dispatch, `< 0.6` → clarification), so
 * the first bucket isolates the decisions that were acted on below threshold
 * (these should be rare — they predate a threshold change or are clarification
 * routes) from the four "acted on" bands above it.
 */
const CONFIDENCE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0.0-0.6', min: 0.0, max: 0.6 },
  { label: '0.6-0.7', min: 0.6, max: 0.7 },
  { label: '0.7-0.8', min: 0.7, max: 0.8 },
  { label: '0.8-0.9', min: 0.8, max: 0.9 },
  { label: '0.9-1.0', min: 0.9, max: 1.0001 }, // upper-inclusive of 1.0
];

/**
 * Absolute gap between mean stated confidence and observed reliability above
 * which a bucket/agent is flagged as miscalibrated.
 */
const CALIBRATION_GAP_THRESHOLD = 0.15;

/** Per-(agent, bucket) empirical reliability stats. */
export interface BucketStats {
  agent: string;
  bucket: string;
  /** Decisions in this cell that have a known downstream outcome. */
  decisions: number;
  /** Of those, how many had a successful downstream invocation. */
  successes: number;
  /** successes / decisions, or null when decisions === 0. */
  reliability: number | null;
  /** Mean stated classifier confidence in this cell, or null when empty. */
  mean_confidence: number | null;
  /** |mean_confidence - reliability|, or null when not computable. */
  calibration_gap: number | null;
  /** True when calibration_gap > CALIBRATION_GAP_THRESHOLD. */
  miscalibrated: boolean;
}

/** Per-agent rollup across all buckets. */
export interface AgentStats {
  agent: string;
  decisions: number;
  successes: number;
  reliability: number | null;
  mean_confidence: number | null;
  calibration_gap: number | null;
  miscalibrated: boolean;
}

/** The full snapshot persisted to system_config and returned to the caller. */
export interface CalibrationReport {
  generated_at: string;
  lookback_days: number;
  window_start: string;
  /** Total classifier_used routing_decisions scanned in the window. */
  total_classifier_decisions: number;
  /** Of those, how many had a join-able downstream outcome by trace_id. */
  decisions_with_outcome: number;
  per_agent: AgentStats[];
  per_bucket: BucketStats[];
  /** Convenience list of the cells the dashboard should highlight. */
  miscalibrated_cells: { agent: string; bucket: string; calibration_gap: number }[];
}

/** Round to 4 dp, preserving null. */
function round4(n: number | null): number | null {
  if (n === null) return null;
  return Math.round(n * 10000) / 10000;
}

/** Resolve which confidence bucket a value falls into. Out-of-range → null. */
function bucketFor(confidence: number): string | null {
  for (const b of CONFIDENCE_BUCKETS) {
    if (confidence >= b.min && confidence < b.max) return b.label;
  }
  return null;
}

/**
 * Pure calibration computation, separated from IO so it is unit-testable and
 * deterministic. Joins classifier decisions to outcomes by `trace_id`, then
 * rolls up reliability per agent and per (agent, bucket).
 */
export function computeCalibration(
  decisions: { agent: string | null; confidence: number | null; trace_id: string | null }[],
  outcomeByTrace: Map<string, boolean>,
  opts: { generatedAt: string; windowStart: string; lookbackDays: number }
): CalibrationReport {
  // Accumulators keyed by agent and by `${agent}|${bucket}`.
  const agentAcc = new Map<string, { decisions: number; successes: number; confSum: number }>();
  const bucketAcc = new Map<
    string,
    { agent: string; bucket: string; decisions: number; successes: number; confSum: number }
  >();

  let withOutcome = 0;

  for (const d of decisions) {
    const agent = d.agent ?? 'unknown';
    const confidence = typeof d.confidence === 'number' ? d.confidence : null;
    const traceId = d.trace_id;

    // Only decisions whose downstream outcome is known contribute to reliability.
    if (!traceId || !outcomeByTrace.has(traceId) || confidence === null) continue;
    const success = outcomeByTrace.get(traceId) === true;
    withOutcome += 1;

    // Per-agent rollup.
    const a = agentAcc.get(agent) ?? { decisions: 0, successes: 0, confSum: 0 };
    a.decisions += 1;
    a.successes += success ? 1 : 0;
    a.confSum += confidence;
    agentAcc.set(agent, a);

    // Per-(agent, bucket) rollup.
    const bucketLabel = bucketFor(confidence);
    if (bucketLabel) {
      const cellKey = `${agent}|${bucketLabel}`;
      const c =
        bucketAcc.get(cellKey) ??
        { agent, bucket: bucketLabel, decisions: 0, successes: 0, confSum: 0 };
      c.decisions += 1;
      c.successes += success ? 1 : 0;
      c.confSum += confidence;
      bucketAcc.set(cellKey, c);
    }
  }

  const per_agent: AgentStats[] = [...agentAcc.values()]
    .map((a) => {
      const reliability = a.decisions > 0 ? a.successes / a.decisions : null;
      const mean_confidence = a.decisions > 0 ? a.confSum / a.decisions : null;
      const gap =
        reliability !== null && mean_confidence !== null
          ? Math.abs(mean_confidence - reliability)
          : null;
      return {
        agent: a.agent,
        decisions: a.decisions,
        successes: a.successes,
        reliability: round4(reliability),
        mean_confidence: round4(mean_confidence),
        calibration_gap: round4(gap),
        miscalibrated: gap !== null && gap > CALIBRATION_GAP_THRESHOLD,
      };
    })
    .sort((x, y) => x.agent.localeCompare(y.agent));

  const per_bucket: BucketStats[] = [...bucketAcc.values()]
    .map((c) => {
      const reliability = c.decisions > 0 ? c.successes / c.decisions : null;
      const mean_confidence = c.decisions > 0 ? c.confSum / c.decisions : null;
      const gap =
        reliability !== null && mean_confidence !== null
          ? Math.abs(mean_confidence - reliability)
          : null;
      return {
        agent: c.agent,
        bucket: c.bucket,
        decisions: c.decisions,
        successes: c.successes,
        reliability: round4(reliability),
        mean_confidence: round4(mean_confidence),
        calibration_gap: round4(gap),
        miscalibrated: gap !== null && gap > CALIBRATION_GAP_THRESHOLD,
      };
    })
    .sort((x, y) => x.agent.localeCompare(y.agent) || x.bucket.localeCompare(y.bucket));

  const miscalibrated_cells = per_bucket
    .filter((c) => c.miscalibrated && c.calibration_gap !== null)
    .map((c) => ({ agent: c.agent, bucket: c.bucket, calibration_gap: c.calibration_gap as number }));

  return {
    generated_at: opts.generatedAt,
    lookback_days: opts.lookbackDays,
    window_start: opts.windowStart,
    total_classifier_decisions: decisions.length,
    decisions_with_outcome: withOutcome,
    per_agent,
    per_bucket,
    miscalibrated_cells,
  };
}

export async function GET(request: NextRequest) {
  // ─── Auth: Vercel Cron bearer secret (fail-closed) ───
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error('[cron/classifier-calibration] CRON_SECRET is not configured — refusing to run');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not configured' },
      { status: 401 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const windowStartIso = windowStart.toISOString();

    // ─── 1) Classifier-driven routing decisions in the window (Req 20.7) ───
    const { data: decisionRows, error: decisionsErr } = await supabase
      .from('routing_decisions')
      .select('agent_dispatched, confidence, trace_id, created_at')
      .eq('classifier_used', true)
      .gte('created_at', windowStartIso);

    if (decisionsErr) {
      console.error('[cron/classifier-calibration] routing_decisions query failed:', decisionsErr);
      return NextResponse.json(
        { ok: false, error: 'Failed to read routing_decisions', details: decisionsErr.message },
        { status: 500 }
      );
    }

    const decisions = (decisionRows ?? []).map((r) => ({
      agent: (r as { agent_dispatched: string | null }).agent_dispatched,
      confidence: (r as { confidence: number | null }).confidence,
      trace_id: (r as { trace_id: string | null }).trace_id,
    }));

    // ─── 2) Downstream outcomes for those traces (agent_invocations.success) ───
    // Only fetch invocations whose trace_id appears in our decision set, in
    // chunks to stay within URL length limits on the `in` filter.
    const traceIds = [...new Set(decisions.map((d) => d.trace_id).filter((t): t is string => !!t))];
    const outcomeByTrace = new Map<string, boolean>();

    const CHUNK = 200;
    for (let i = 0; i < traceIds.length; i += CHUNK) {
      const chunk = traceIds.slice(i, i + CHUNK);
      const { data: invRows, error: invErr } = await supabase
        .from('agent_invocations')
        .select('trace_id, success')
        .in('trace_id', chunk);

      if (invErr) {
        console.error('[cron/classifier-calibration] agent_invocations query failed:', invErr);
        return NextResponse.json(
          { ok: false, error: 'Failed to read agent_invocations', details: invErr.message },
          { status: 500 }
        );
      }

      for (const row of invRows ?? []) {
        const tid = (row as { trace_id: string | null }).trace_id;
        const success = (row as { success: boolean | null }).success;
        if (!tid || success === null) continue;
        // A trace is "successful" if ANY of its invocations succeeded (the flow
        // completed). Once true, keep it true.
        outcomeByTrace.set(tid, outcomeByTrace.get(tid) === true || success === true);
      }
    }

    // ─── 3) Compute the calibration report ───
    const report = computeCalibration(decisions, outcomeByTrace, {
      generatedAt: now.toISOString(),
      windowStart: windowStartIso,
      lookbackDays: LOOKBACK_DAYS,
    });

    // ─── 4) Publish the snapshot to system_config for /dashboard/agent-routing ───
    const { error: upsertErr } = await supabase
      .from('system_config')
      .upsert(
        { key: CALIBRATION_CONFIG_KEY, value: JSON.stringify(report) },
        { onConflict: 'key' }
      );

    if (upsertErr) {
      console.error('[cron/classifier-calibration] system_config upsert failed:', upsertErr);
      return NextResponse.json(
        { ok: false, error: 'Failed to persist calibration report', details: upsertErr.message },
        { status: 500 }
      );
    }

    console.log(
      `[cron/classifier-calibration] Calibrated ${report.total_classifier_decisions} decision(s), ` +
        `${report.decisions_with_outcome} with outcome, ${report.miscalibrated_cells.length} miscalibrated cell(s)`
    );

    return NextResponse.json({ ok: true, data: report });
  } catch (err) {
    console.error('[cron/classifier-calibration] Error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
