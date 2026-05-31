'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Database,
  GitBranch,
  RefreshCw,
  Send,
  ShieldAlert,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { authHeaders, fmtDateTime } from '@/lib/helpers';

/**
 * TraceTimeline — per-conversation trace inspector (Req 32.4, Design §v1.1.13).
 *
 * Renders the full end-to-end timeline of a single inbound message, keyed by its
 * `trace_id` (a UUIDv7 assigned at the Parse Message node — Design §v1.1.8). It
 * fetches `GET /api/trace/[id]` (admin, task 25.5) which runs seven indexed
 * lookups by `trace_id` in parallel and merges the rows into a single
 * chronological `TraceTimelineEvent[]` spanning routing decisions, agent
 * invocations, cascade notifications, screening, guardrail violations, query
 * cache hits, and the WhatsApp outbox.
 *
 * One card per event, in time order, each with a kind-specific icon/label, the
 * event timestamp, a pass/fail status badge where meaningful, and the key fields
 * for that kind. Agent invocations also surface a computed duration
 * (`completed_at − started_at`).
 *
 * Phone fields arrive already masked for non-admin callers (the API route owns
 * masking — Req 32.5); this component renders whatever it receives.
 *
 * The design signature passes `events` in directly; this component accepts an
 * optional `events` prop for that (and for snapshot tests) but defaults to
 * self-contained fetching from `traceId` so the dedicated route page only needs
 * to hand it the param.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.8 Trace IDs, §v1.1.13
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 32.4, 32.5
 */

// ─── Row shapes (mirror src/app/api/trace/[id]/route.ts) ─────────────────────────

export interface RoutingDecisionRow {
  id: string;
  session_id: string;
  message_text: string | null;
  last_intent_before: string | null;
  agent_dispatched: string | null;
  reason: string | null;
  trace_id: string | null;
  created_at: string;
}

export interface AgentInvocationRow {
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

export interface CascadeNotificationRow {
  id: string;
  blood_request_id: string;
  donor_id: string;
  tier: number;
  notified_at: string;
  responded_at: string | null;
  response: string | null;
  trace_id: string | null;
}

export interface ScreeningLogRow {
  id: string;
  donor_id: string;
  blood_request_id: string | null;
  screening_answers: unknown;
  screening_passed: boolean;
  deferral_applied: boolean;
  trace_id: string | null;
  created_at: string;
}

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

export interface QueryCacheRow {
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

export interface WhatsappOutboxRow {
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
export type TraceTimelineEvent =
  | { kind: 'routing_decision'; ts: string; data: RoutingDecisionRow }
  | { kind: 'agent_invocation'; ts: string; data: AgentInvocationRow }
  | { kind: 'cascade_notification'; ts: string; data: CascadeNotificationRow }
  | { kind: 'screening'; ts: string; data: ScreeningLogRow }
  | { kind: 'guardrail_violation'; ts: string; data: GuardrailViolationRow }
  | { kind: 'query_cache_hit'; ts: string; data: QueryCacheRow }
  | { kind: 'whatsapp_outbox'; ts: string; data: WhatsappOutboxRow };

type TraceEventKind = TraceTimelineEvent['kind'];

interface TraceTimelineProps {
  /** The trace_id (UUIDv7) to reconstruct. */
  traceId: string;
  /**
   * Pre-loaded events. When provided, the component renders these directly and
   * skips its own fetch (matches the Design §v1.1.13 signature, useful for tests).
   * When omitted, the component fetches `GET /api/trace/<traceId>` itself.
   */
  events?: TraceTimelineEvent[];
}

// ─── Per-kind presentation ───────────────────────────────────────────────────────

const KIND_STYLES: Record<
  TraceEventKind,
  { label: string; icon: LucideIcon; dot: string; iconColor: string }
> = {
  routing_decision: {
    label: 'Routing Decision',
    icon: GitBranch,
    dot: 'bg-blue-500',
    iconColor: 'text-blue-500',
  },
  agent_invocation: {
    label: 'Agent Invocation',
    icon: Bot,
    dot: 'bg-violet-500',
    iconColor: 'text-violet-500',
  },
  cascade_notification: {
    label: 'Cascade Notification',
    icon: Users,
    dot: 'bg-rose-500',
    iconColor: 'text-rose-500',
  },
  screening: {
    label: 'Screening',
    icon: ClipboardCheck,
    dot: 'bg-teal-500',
    iconColor: 'text-teal-500',
  },
  guardrail_violation: {
    label: 'Guardrail Violation',
    icon: ShieldAlert,
    dot: 'bg-amber-500',
    iconColor: 'text-amber-500',
  },
  query_cache_hit: {
    label: 'Query Cache Hit',
    icon: Database,
    dot: 'bg-emerald-500',
    iconColor: 'text-emerald-500',
  },
  whatsapp_outbox: {
    label: 'WhatsApp Outbox',
    icon: Send,
    dot: 'bg-sky-500',
    iconColor: 'text-sky-500',
  },
};

const BADGE_OK = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300';
const BADGE_BAD = 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300';
const BADGE_WARN = 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300';
const BADGE_NEUTRAL = 'bg-muted text-muted-foreground';

/** Format a millisecond duration as a compact human string. */
function fmtDuration(ms: number): string {
  if (ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** A status pill (icon + label) shown in the card header for pass/fail kinds. */
function StatusBadge({
  ok,
  okLabel,
  badLabel,
}: {
  ok: boolean;
  okLabel: string;
  badLabel: string;
}) {
  return (
    <Badge variant="outline" className={`text-[10px] font-semibold gap-1 shrink-0 ${ok ? BADGE_OK : BADGE_BAD}`}>
      {ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
      {ok ? okLabel : badLabel}
    </Badge>
  );
}

/** One labelled key/value field within a card body. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm break-words">{children}</div>
    </div>
  );
}

const DASH = <span className="text-muted-foreground">—</span>;

/** Render the kind-specific status pill (or null if the kind has no pass/fail). */
function renderStatus(event: TraceTimelineEvent): React.ReactNode {
  switch (event.kind) {
    case 'agent_invocation':
      if (event.data.success === null) return null;
      return <StatusBadge ok={event.data.success} okLabel="Success" badLabel="Failed" />;
    case 'screening':
      return (
        <StatusBadge ok={event.data.screening_passed} okLabel="Passed" badLabel="Deferred" />
      );
    case 'whatsapp_outbox': {
      const s = event.data.status;
      const ok = s === 'sent' || s === 'delivered';
      const bad = s === 'failed';
      return (
        <Badge
          variant="outline"
          className={`text-[10px] font-semibold shrink-0 ${ok ? BADGE_OK : bad ? BADGE_BAD : BADGE_WARN}`}
        >
          {s}
        </Badge>
      );
    }
    default:
      return null;
  }
}

/** Render the kind-specific detail fields for one event. */
function renderDetails(event: TraceTimelineEvent): React.ReactNode {
  switch (event.kind) {
    case 'routing_decision': {
      const d = event.data;
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Agent dispatched">
            {d.agent_dispatched ? (
              <Badge variant="outline" className="text-xs font-semibold">
                {d.agent_dispatched}
              </Badge>
            ) : (
              <Badge variant="outline" className={`text-xs ${BADGE_NEUTRAL}`}>
                none (stale reset)
              </Badge>
            )}
          </Field>
          <Field label="Intent before">{d.last_intent_before || DASH}</Field>
          <Field label="Session">
            <span className="font-mono text-xs">{d.session_id || DASH}</span>
          </Field>
          <Field label="Reason">
            <span className="font-mono text-xs">{d.reason || DASH}</span>
          </Field>
          {d.message_text && (
            <div className="sm:col-span-2">
              <Field label="Message">
                <span className="text-muted-foreground">{d.message_text}</span>
              </Field>
            </div>
          )}
        </div>
      );
    }

    case 'agent_invocation': {
      const d = event.data;
      const duration =
        d.completed_at != null
          ? fmtDuration(Date.parse(d.completed_at) - Date.parse(d.started_at))
          : null;
      const toolCount = Array.isArray(d.tools_called) ? d.tools_called.length : null;
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Agent">
            <Badge variant="outline" className="text-xs font-semibold">
              {d.agent}
            </Badge>
          </Field>
          <Field label="Duration">{duration ?? <span className="text-muted-foreground">in&nbsp;progress</span>}</Field>
          <Field label="Tokens used">
            {d.tokens_used != null ? (
              <span className="font-mono text-xs">{d.tokens_used.toLocaleString('en-IN')}</span>
            ) : (
              <span className="text-muted-foreground">not captured</span>
            )}
          </Field>
          <Field label="Tools called">
            {toolCount != null ? <span className="font-mono text-xs">{toolCount}</span> : DASH}
          </Field>
          {d.error_message && (
            <div className="sm:col-span-2">
              <Field label="Error">
                <span className="text-red-600 dark:text-red-400">{d.error_message}</span>
              </Field>
            </div>
          )}
        </div>
      );
    }

    case 'cascade_notification': {
      const d = event.data;
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Tier">
            <Badge variant="outline" className="text-xs font-semibold">
              Tier {d.tier}
            </Badge>
          </Field>
          <Field label="Response">
            {d.response ? (
              <Badge
                variant="outline"
                className={`text-xs font-semibold ${
                  d.response === 'haan' ? BADGE_OK : d.response === 'nahi' ? BADGE_BAD : BADGE_WARN
                }`}
              >
                {d.response}
              </Badge>
            ) : (
              <span className="text-muted-foreground">awaiting</span>
            )}
          </Field>
          <Field label="Donor">
            <span className="font-mono text-xs">{d.donor_id}</span>
          </Field>
          <Field label="Responded at">
            {d.responded_at ? fmtDateTime(d.responded_at) : DASH}
          </Field>
        </div>
      );
    }

    case 'screening': {
      const d = event.data;
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Donor">
            <span className="font-mono text-xs">{d.donor_id}</span>
          </Field>
          <Field label="Deferral applied">
            {d.deferral_applied ? (
              <Badge variant="outline" className={`text-xs font-semibold ${BADGE_WARN}`}>
                Yes
              </Badge>
            ) : (
              <span className="text-muted-foreground">No</span>
            )}
          </Field>
          {d.blood_request_id && (
            <Field label="Blood request">
              <span className="font-mono text-xs">{d.blood_request_id}</span>
            </Field>
          )}
        </div>
      );
    }

    case 'guardrail_violation': {
      const d = event.data;
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Rule">
              <span className="font-mono text-xs">{d.rule_name}</span>
            </Field>
            <Field label="Action">
              <Badge variant="outline" className="text-xs font-semibold">
                {d.action}
              </Badge>
            </Field>
            <Field label="Severity">
              <Badge
                variant="outline"
                className={`text-xs font-semibold ${
                  d.severity === 'high' || d.severity === 'critical'
                    ? BADGE_BAD
                    : d.severity === 'medium'
                      ? BADGE_WARN
                      : BADGE_NEUTRAL
                }`}
              >
                {d.severity}
              </Badge>
            </Field>
          </div>
          {(d.original_reply || d.repaired_reply) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {d.original_reply && (
                <Field label="Original">
                  <span className="block rounded-md bg-muted/50 p-2 text-xs">{d.original_reply}</span>
                </Field>
              )}
              {d.repaired_reply && (
                <Field label="Repaired">
                  <span className="block rounded-md bg-muted/50 p-2 text-xs">{d.repaired_reply}</span>
                </Field>
              )}
            </div>
          )}
        </div>
      );
    }

    case 'query_cache_hit': {
      const d = event.data;
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Category">
            <Badge variant="outline" className="text-xs font-semibold">
              {d.category}
            </Badge>
          </Field>
          <Field label="Hit count">
            <span className="font-mono text-xs">{d.hit_count}</span>
          </Field>
          {d.query_text && (
            <div className="sm:col-span-2">
              <Field label="Query">
                <span className="text-muted-foreground">{d.query_text}</span>
              </Field>
            </div>
          )}
        </div>
      );
    }

    case 'whatsapp_outbox': {
      const d = event.data;
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Recipient">
            <span className="font-mono text-xs">{d.recipient_phone}</span>
          </Field>
          <Field label="Attempts">
            <span className="font-mono text-xs">
              {d.attempts} / {d.max_attempts}
            </span>
          </Field>
          {d.last_attempt_at && (
            <Field label="Last attempt">{fmtDateTime(d.last_attempt_at)}</Field>
          )}
          {d.error_message && (
            <div className="sm:col-span-2">
              <Field label="Error">
                <span className="text-red-600 dark:text-red-400">{d.error_message}</span>
              </Field>
            </div>
          )}
        </div>
      );
    }
  }
}

// ─── Single timeline event card ──────────────────────────────────────────────────

function TimelineRow({ event, isLast }: { event: TraceTimelineEvent; isLast: boolean }) {
  const style = KIND_STYLES[event.kind];
  const Icon = style.icon;

  return (
    <div className="relative flex gap-3 sm:gap-4">
      {/* Rail with dot + connecting line */}
      <div className="flex flex-col items-center">
        <span className={`mt-1.5 size-3 rounded-full ring-4 ring-background shrink-0 ${style.dot}`} aria-hidden />
        {!isLast && <span className="w-px flex-1 bg-border" aria-hidden />}
      </div>

      {/* Event card */}
      <div className="flex-1 pb-4 min-w-0">
        <div className="rounded-lg border p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Icon className={`size-4 shrink-0 ${style.iconColor}`} aria-hidden />
              <span className="text-sm font-medium truncate">{style.label}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {renderStatus(event)}
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {event.ts ? fmtDateTime(event.ts) : '—'}
              </span>
            </div>
          </div>
          {renderDetails(event)}
        </div>
      </div>
    </div>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────────────

export function TraceTimeline({ traceId, events: eventsProp }: TraceTimelineProps) {
  const controlled = eventsProp !== undefined;

  const [events, setEvents] = useState<TraceTimelineEvent[]>(eventsProp ?? []);
  const [loading, setLoading] = useState(!controlled);
  const [error, setError] = useState<string | null>(null);

  const fetchTrace = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/trace/${encodeURIComponent(traceId)}`, {
        headers: authHeaders(),
      });

      if (res.status === 401 || res.status === 403) {
        setError('Admin access required to view trace timelines.');
        setEvents([]);
        return;
      }

      if (res.status === 400) {
        setError('Invalid trace ID — expected a UUID.');
        setEvents([]);
        return;
      }

      if (!res.ok) {
        setError('Failed to load trace timeline.');
        return;
      }

      const json = await res.json();
      if (!json.ok) {
        setError(json.error || 'Failed to load trace timeline.');
        return;
      }

      setEvents((json.data?.events ?? []) as TraceTimelineEvent[]);
      setError(null);
    } catch {
      setError('Network error while loading trace timeline.');
    } finally {
      setLoading(false);
    }
  }, [traceId]);

  useEffect(() => {
    // Controlled mode: render the events handed in (and follow prop updates).
    if (controlled) {
      setEvents(eventsProp ?? []);
      setLoading(false);
      setError(null);
      return;
    }
    fetchTrace();
  }, [controlled, eventsProp, fetchTrace]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Activity className="size-4 text-blue-500" />
            Trace Timeline
            {!loading && !error && (
              <Badge variant="outline" className="text-[10px]">
                {events.length} event{events.length === 1 ? '' : 's'}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono hidden sm:inline">{traceId}</span>
            {!controlled && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1"
                onClick={fetchTrace}
                aria-label="Refresh trace timeline"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-[88px] bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500" />
            {error}
          </p>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Clock className="size-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No events found for this trace.</p>
            <p className="text-xs text-muted-foreground mt-1">
              The trace ID may be unknown, or its events may have aged out.
            </p>
          </div>
        ) : (
          <div className="pt-1">
            {events.map((event, i) => (
              <TimelineRow
                key={`${event.kind}-${event.data.id}`}
                event={event}
                isLast={i === events.length - 1}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TraceTimeline;
