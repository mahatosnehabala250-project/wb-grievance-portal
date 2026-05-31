'use client';

import { Timer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * LatencyPercentilesPanel — per-agent reply latency p50 / p95 / p99 (Req 32.3,
 * Design §v1.1.13).
 *
 * Presentational component for the `data.latency_per_agent` slice of
 * `GET /api/system-health`. Renders one row per agent with the p50 / p95 / p99
 * reply latency (milliseconds) and the sample count the percentiles were
 * computed over. The owning page (task 30.4) fetches once and passes the slice
 * down; this panel makes no network calls.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.13, §v1.1.15
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 32.3
 */

// ─── Types (mirror src/app/api/system-health/route.ts LatencyPercentiles) ──────

export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
  count: number;
}

export interface LatencyPercentilesPanelProps {
  /** Map of agent name → latency percentiles (ms). */
  latencyPerAgent: Record<string, LatencyPercentiles>;
}

/** Friendly agent display name; falls back to capitalized raw name. */
function agentLabel(agent: string): string {
  switch (agent) {
    case 'complaint':
      return 'Complaint';
    case 'blood':
      return 'Blood';
    case 'donor':
      return 'Donor';
    case 'info':
      return 'Info';
    case 'clarification':
      return 'Clarification';
    case 'ceo':
    case 'router':
      return 'CEO Router';
    default:
      return agent.charAt(0).toUpperCase() + agent.slice(1);
  }
}

/** Format a millisecond latency: sub-second as "850ms", else "2.4s". */
function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 })}s`;
}

/** p95 above 4s breaches the §Performance NFR target; tint it red. */
function p95Tint(p95: number): string {
  if (p95 >= 4000) return 'text-red-600 dark:text-red-400 font-semibold';
  if (p95 >= 2500) return 'text-amber-600 dark:text-amber-400 font-medium';
  return '';
}

// ─── Panel ──────────────────────────────────────────────────────────────────────

export function LatencyPercentilesPanel({ latencyPerAgent }: LatencyPercentilesPanelProps) {
  const agents = Object.keys(latencyPerAgent).sort((a, b) => a.localeCompare(b));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Timer className="size-4 text-violet-500" />
          Reply Latency per Agent
        </CardTitle>
      </CardHeader>
      <CardContent>
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agent latency recorded today.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">p50</TableHead>
                <TableHead className="text-right">p95</TableHead>
                <TableHead className="text-right">p99</TableHead>
                <TableHead className="text-right">Samples</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => {
                const l = latencyPerAgent[agent];
                return (
                  <TableRow key={agent}>
                    <TableCell className="font-medium">{agentLabel(agent)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMs(l.p50)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${p95Tint(l.p95)}`}>{fmtMs(l.p95)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMs(l.p99)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {l.count.toLocaleString('en-IN')}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default LatencyPercentilesPanel;
