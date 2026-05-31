'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { authHeaders, fmtDateTime } from '@/lib/helpers';

/**
 * CircuitBreakerPanel — live view of the three circuit breakers (Req 29.7, 32.3).
 *
 * Scope (task 27.7): the circuit-breaker *reading / display* concern only. This
 * panel fetches `GET /api/system-health` (admin, task 30.5) and renders the
 * `data.breakers` slice — one row per breaker with its name, current state
 * badge, consecutive-failure count, and `opened_at` timestamp. `circuit_state`
 * is the single canonical source of truth for breaker state (Design §v1.1.10),
 * surfaced here via the read-only admin endpoint.
 *
 * The richer System Health page (tasks 30.3 `CircuitBreakerCard` / 30.4
 * `system-health/page.tsx`) composes this alongside outbox, token, latency and
 * guardrail widgets and may add a Supabase Realtime subscription on
 * `circuit_state`. This component deliberately stays self-contained (its own
 * fetch + polling) so it works standalone and does not depend on components
 * owned by those tasks.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.10 Circuit Breakers, §v1.1.13
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 29.7, 32.3
 */

// ─── Types (mirror src/app/api/system-health/route.ts CircuitStateRow) ─────────

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerRow {
  name: string;
  state: string;
  consecutive_failures: number;
  window_start: string | null;
  opened_at: string | null;
  last_probe_at: string | null;
  updated_at: string | null;
}

interface CircuitBreakerPanelProps {
  /** Polling interval in milliseconds. Set to 0 to disable polling. Default 15s. */
  pollIntervalMs?: number;
}

// ─── State presentation map ────────────────────────────────────────────────────

const STATE_STYLES: Record<
  BreakerState,
  { label: string; badge: string; dot: string; icon: typeof CheckCircle2 }
> = {
  closed: {
    label: 'Closed',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    icon: CheckCircle2,
  },
  half_open: {
    label: 'Half-open',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    dot: 'bg-amber-500',
    icon: Activity,
  },
  open: {
    label: 'Open',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
    dot: 'bg-red-500',
    icon: AlertTriangle,
  },
};

/** Normalize an arbitrary state string to a known BreakerState (defaults to open as worst case). */
function normalizeState(state: string): BreakerState {
  if (state === 'closed' || state === 'open' || state === 'half_open') return state;
  return 'open';
}

/** Human-friendly breaker display name. */
function breakerLabel(name: string): string {
  switch (name) {
    case 'gemini':
      return 'Gemini (LLM)';
    case 'whatsapp':
      return 'WhatsApp Cloud API';
    case 'embeddings':
      return 'Embeddings';
    default:
      return name.charAt(0).toUpperCase() + name.slice(1);
  }
}

// ─── Single breaker row ─────────────────────────────────────────────────────────

function BreakerRow({ breaker }: { breaker: CircuitBreakerRow }) {
  const state = normalizeState(breaker.state);
  const style = STATE_STYLES[state];
  const Icon = style.icon;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`size-2.5 rounded-full shrink-0 ${style.dot}`} aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{breakerLabel(breaker.name)}</p>
          <p className="text-xs text-muted-foreground">
            {breaker.consecutive_failures} consecutive failure
            {breaker.consecutive_failures === 1 ? '' : 's'}
            {breaker.opened_at ? ` · opened ${fmtDateTime(breaker.opened_at)}` : ''}
          </p>
        </div>
      </div>
      <Badge variant="outline" className={`text-xs font-semibold gap-1 shrink-0 ${style.badge}`}>
        <Icon className="size-3" />
        {style.label}
      </Badge>
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────────

export function CircuitBreakerPanel({ pollIntervalMs = 15_000 }: CircuitBreakerPanelProps) {
  const [breakers, setBreakers] = useState<CircuitBreakerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchBreakers = useCallback(async () => {
    try {
      const res = await fetch('/api/system-health', { headers: authHeaders() });

      if (res.status === 401 || res.status === 403) {
        setError('Admin access required to view circuit breaker state.');
        setBreakers([]);
        return;
      }

      if (!res.ok) {
        setError('Failed to load circuit breaker state.');
        return;
      }

      const json = await res.json();
      if (!json.ok) {
        setError(json.error || 'Failed to load circuit breaker state.');
        return;
      }

      setBreakers((json.data?.breakers ?? []) as CircuitBreakerRow[]);
      setLastUpdated(json.data?.generated_at ?? new Date().toISOString());
      setError(null);
    } catch {
      setError('Network error while loading circuit breaker state.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBreakers();
    if (pollIntervalMs <= 0) return;
    const interval = setInterval(fetchBreakers, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchBreakers, pollIntervalMs]);

  const openCount = breakers.filter((b) => normalizeState(b.state) !== 'closed').length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Zap className="size-4 text-amber-500" />
            Circuit Breakers
            {!loading && openCount > 0 && (
              <Badge variant="outline" className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
                {openCount} degraded
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {lastUpdated && <span>Updated {fmtDateTime(lastUpdated)}</span>}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1"
              onClick={fetchBreakers}
              aria-label="Refresh circuit breaker state"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-[58px] bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500" />
            {error}
          </p>
        ) : breakers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No circuit breakers configured.</p>
        ) : (
          breakers.map((breaker) => <BreakerRow key={breaker.name} breaker={breaker} />)
        )}
      </CardContent>
    </Card>
  );
}

export default CircuitBreakerPanel;
