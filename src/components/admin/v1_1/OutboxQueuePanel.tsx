'use client';

import { Inbox, AlertTriangle, Gauge } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * OutboxQueuePanel — WhatsApp outbox depth + drain rate (Req 32.3, Design §v1.1.13).
 *
 * Presentational component for the `data.outbox` slice of `GET /api/system-health`.
 * Renders pending / failed queue depth and the recent drain rate (messages
 * successfully sent per second over the last drain window). The owning page
 * (`/dashboard/system-health`, task 30.4) performs the single fetch + polling
 * and passes the slice down, so this panel makes no network calls itself.
 *
 * A non-zero `failed` count is surfaced as a degraded badge so operators can
 * spot a stuck queue at a glance.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.13 (OutboxDepthGauge), §v1.1.15
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 32.3
 */

// ─── Types (mirror src/app/api/system-health/route.ts OutboxStats) ──────────────

export interface OutboxQueuePanelProps {
  /** Messages currently queued for send. */
  pending: number;
  /** Messages that have exhausted retries / errored. */
  failed: number;
  /** Recent successful-send throughput (messages / second). */
  drainRatePerSec: number;
}

// ─── Single stat tile ────────────────────────────────────────────────────────────

function StatTile({
  icon: Icon,
  label,
  value,
  tint,
  hint,
}: {
  icon: typeof Inbox;
  label: string;
  value: string;
  tint: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <span className={`flex size-9 items-center justify-center rounded-md shrink-0 ${tint}`}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-bold tabular-nums leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
        {hint && <p className="text-[10px] text-muted-foreground/80">{hint}</p>}
      </div>
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────────

export function OutboxQueuePanel({ pending, failed, drainRatePerSec }: OutboxQueuePanelProps) {
  const hasFailures = failed > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Inbox className="size-4 text-blue-500" />
          WhatsApp Outbox
          {hasFailures && (
            <Badge
              variant="outline"
              className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
            >
              {failed.toLocaleString('en-IN')} failed
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <StatTile
          icon={Inbox}
          label="Pending"
          value={pending.toLocaleString('en-IN')}
          tint="bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300"
        />
        <StatTile
          icon={AlertTriangle}
          label="Failed"
          value={failed.toLocaleString('en-IN')}
          tint={
            hasFailures
              ? 'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300'
              : 'bg-muted text-muted-foreground'
          }
        />
        <StatTile
          icon={Gauge}
          label="Drain rate"
          value={`${drainRatePerSec.toLocaleString('en-IN', { maximumFractionDigits: 3 })}/s`}
          tint="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300"
          hint="sent · last 60s"
        />
      </CardContent>
    </Card>
  );
}

export default OutboxQueuePanel;
