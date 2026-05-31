'use client';

import { ShieldAlert, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fmtDateTime } from '@/lib/helpers';

/**
 * GuardrailViolationsList — most-recent output-guardrail actions (Req 32.3,
 * Design §v1.1.13).
 *
 * Presentational component for the `data.recent_violations` slice of
 * `GET /api/system-health` (last 50 rows). Each row shows the rule that fired,
 * the action taken (repair / substitute / reject), a before→after preview of the
 * reply, and the timestamp.
 *
 * Rows are **clickable-ready**: the component exposes an `onRowClick(traceId)`
 * prop and wires keyboard + pointer handlers / affordances on every row with a
 * `trace_id`. Task 30.7 supplies the handler that deep-links to
 * `/dashboard/agent-routing/[traceId]`; until then a row simply renders without
 * an active handler. This panel makes no network calls — the owning page
 * (task 30.4) fetches once and passes the rows down.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.13 (GuardrailViolationsList), §v1.1.15
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 32.3
 */

// ─── Types (mirror src/app/api/system-health/route.ts GuardrailViolationRow) ───

export type GuardrailAction = 'repair' | 'substitute' | 'reject';

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

export interface GuardrailViolationsListProps {
  rows: GuardrailViolationRow[];
  /**
   * Called with the row's `trace_id` when a row is activated (click / Enter /
   * Space). Wired by task 30.7 to deep-link to the trace timeline. Rows without
   * a `trace_id`, or when this prop is omitted, are not interactive.
   */
  onRowClick?: (traceId: string) => void;
}

// ─── Action presentation ────────────────────────────────────────────────────────

const ACTION_STYLES: Record<GuardrailAction, string> = {
  repair: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  substitute: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  reject: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};

function actionStyle(action: string): string {
  return ACTION_STYLES[action as GuardrailAction] ?? 'bg-muted text-muted-foreground';
}

/** Clamp long reply text for the inline before/after preview. */
function preview(text: string | null, max = 80): string {
  if (!text) return '∅';
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

// ─── Single violation row ────────────────────────────────────────────────────────

function ViolationRow({
  row,
  onRowClick,
}: {
  row: GuardrailViolationRow;
  onRowClick?: (traceId: string) => void;
}) {
  const clickable = Boolean(row.trace_id && onRowClick);
  const activate = () => {
    if (row.trace_id && onRowClick) onRowClick(row.trace_id);
  };

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `View trace for guardrail violation ${row.rule_name}` : undefined}
      onClick={clickable ? activate : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activate();
              }
            }
          : undefined
      }
      className={`rounded-lg border p-3 space-y-2 ${
        clickable
          ? 'cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{row.rule_name}</span>
          <Badge variant="outline" className={`text-[10px] font-semibold shrink-0 ${actionStyle(row.action)}`}>
            {row.action}
          </Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground">{fmtDateTime(row.created_at)}</span>
          {clickable && <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
        <p className="text-muted-foreground">
          <span className="font-semibold text-foreground/70">before:</span> {preview(row.original_reply)}
        </p>
        <p className="text-muted-foreground">
          <span className="font-semibold text-foreground/70">after:</span> {preview(row.repaired_reply)}
        </p>
      </div>
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────────

export function GuardrailViolationsList({ rows, onRowClick }: GuardrailViolationsListProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <ShieldAlert className="size-4 text-red-500" />
          Recent Guardrail Violations
          {rows.length > 0 && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {rows.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No guardrail violations recorded.</p>
        ) : (
          <ScrollArea className="h-[360px] pr-3">
            <div className="space-y-2">
              {rows.map((row) => (
                <ViolationRow key={row.id} row={row} onRowClick={onRowClick} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default GuardrailViolationsList;
