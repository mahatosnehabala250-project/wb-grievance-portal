'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CircuitBreakerPanel } from '@/components/admin/v1_1/CircuitBreakerPanel';
import { OutboxQueuePanel } from '@/components/admin/v1_1/OutboxQueuePanel';
import { TokenBudgetMeter } from '@/components/admin/v1_1/TokenBudgetMeter';
import { LatencyPercentilesPanel, type LatencyPercentiles } from '@/components/admin/v1_1/LatencyPercentilesPanel';
import { InFlightCascadesStat } from '@/components/admin/v1_1/InFlightCascadesStat';
import {
  GuardrailViolationsList,
  type GuardrailViolationRow,
} from '@/components/admin/v1_1/GuardrailViolationsList';
import { authHeaders, fmtDateTime } from '@/lib/helpers';

/**
 * /dashboard/system-health — operational health page (Req 32.3).
 *
 * Single canonical source of truth for circuit-breaker state, queue depths,
 * token-budget consumption, latency percentiles, in-flight cascades, and recent
 * guardrail violations (Req 32 NFR). Expanded by tasks 30.3 / 30.4 from the
 * minimal task-27.7 scaffold.
 *
 * Data flow: this page performs ONE poll of `GET /api/system-health` and passes
 * each slice down to a presentational panel, so the page renders all health
 * widgets from a single request rather than N per-widget fetches. The
 * `CircuitBreakerPanel` (task 27.7) is the one exception — it is reused
 * unchanged and self-fetches the same endpoint so it also works standalone.
 *
 * Phones in `recent_violations.session_id` are not masked here because the
 * endpoint is admin-only (Req 32.5 masking applies only to non-admin surfaces,
 * which never reach this endpoint).
 *
 * NOTE: Live refresh uses polling (the established convention shared with
 * `CircuitBreakerPanel` / `CacheHitRateWidget`). The Design §v1.1.13
 * `system_health:realtime` Supabase subscription and the admin force-close
 * breaker action are tracked separately and not wired by this task.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.13 Frontend Additions, §v1.1.15
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 29.7, 32.3
 */

// ─── Types (mirror src/app/api/system-health/route.ts SystemHealthData) ────────

interface SystemHealthData {
  breakers: unknown[];
  outbox: { pending: number; failed: number; drainRatePerSec: number };
  today_tokens: number;
  latency_p95_per_agent: Record<string, number>;
  latency_per_agent: Record<string, LatencyPercentiles>;
  in_flight_cascades: number | null;
  recent_violations: GuardrailViolationRow[];
  generated_at: string;
}

/** Poll interval for the page-level fetch (kept in step with CircuitBreakerPanel). */
const POLL_INTERVAL_MS = 15_000;

export default function SystemHealthPage() {
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/system-health', { headers: authHeaders() });

      if (res.status === 401 || res.status === 403) {
        setError('Admin access required to view system health.');
        return;
      }
      if (!res.ok) {
        setError('Failed to load system health.');
        return;
      }

      const json = await res.json();
      if (!json.ok) {
        setError(json.error || 'Failed to load system health.');
        return;
      }

      setData(json.data as SystemHealthData);
      setError(null);
    } catch {
      setError('Network error while loading system health.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  return (
    <div className="space-y-6 p-4 lg:p-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live operational status of the multi-agent router and its outbound dependencies
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
          {data?.generated_at && <span>Updated {fmtDateTime(data.generated_at)}</span>}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1"
            onClick={fetchHealth}
            aria-label="Refresh system health"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-500" />
          {error}
        </p>
      )}

      {/* Circuit breakers — reused, self-fetching panel (task 27.7) */}
      <CircuitBreakerPanel pollIntervalMs={POLL_INTERVAL_MS} />

      {/* Queues + budget + cascades from the single page-level fetch */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {data ? (
            <OutboxQueuePanel
              pending={data.outbox.pending}
              failed={data.outbox.failed}
              drainRatePerSec={data.outbox.drainRatePerSec}
            />
          ) : (
            <PanelSkeleton loading={loading} />
          )}
        </div>
        <div>
          {data ? (
            <InFlightCascadesStat count={data.in_flight_cascades} />
          ) : (
            <PanelSkeleton loading={loading} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data ? (
          <TokenBudgetMeter todayTotalTokens={data.today_tokens} />
        ) : (
          <PanelSkeleton loading={loading} />
        )}
        {data ? (
          <LatencyPercentilesPanel latencyPerAgent={data.latency_per_agent} />
        ) : (
          <PanelSkeleton loading={loading} />
        )}
      </div>

      {/* Recent guardrail violations — rows are clickable-ready (task 30.7 wires onRowClick) */}
      {data ? (
        <GuardrailViolationsList rows={data.recent_violations} />
      ) : (
        <PanelSkeleton loading={loading} />
      )}
    </div>
  );
}

/** Loading / empty placeholder for a panel slot before the first fetch resolves. */
function PanelSkeleton({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return <div className="h-[140px] bg-muted animate-pulse rounded-xl" />;
}
