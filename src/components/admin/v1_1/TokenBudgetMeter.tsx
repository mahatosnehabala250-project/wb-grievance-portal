'use client';

import { Coins } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * TokenBudgetMeter — today's session-token consumption (Req 32.3, Design §v1.1.13).
 *
 * Presentational component for the `data.today_tokens` slice of
 * `GET /api/system-health`. Renders the running total of tokens consumed across
 * all sessions since the start of the current UTC day.
 *
 * The Design §v1.1.13 signature also lists `topSessions` and `outliers`. The
 * shipped `GET /api/system-health` endpoint (task 30.5) currently aggregates the
 * day-total only, so those props are accepted as OPTIONAL here and rendered when
 * present — the meter stays correct against the live endpoint today and is
 * forward-compatible when per-session spend lands. The owning page (task 30.4)
 * fetches once and passes the slice down; this panel makes no network calls.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.13 (TokenBudgetMeter), §v1.1.11, §v1.1.15
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 32.3
 */

// ─── Types (Design §v1.1.13 TokenBudgetMeter) ──────────────────────────────────

export interface TokenSpender {
  sessionId: string;
  tokens: number;
  trend?: 'up' | 'down';
}

export interface TokenOutlier {
  sessionId: string;
  tokens: number;
  /** Standard deviations above the per-session mean. */
  sigmas: number;
}

export interface TokenBudgetMeterProps {
  /** Total tokens consumed across all sessions today (UTC day). */
  todayTotalTokens: number;
  /** Highest-spending sessions today (optional — see component docs). */
  topSessions?: TokenSpender[];
  /** Sessions whose spend is a statistical outlier (optional — see component docs). */
  outliers?: TokenOutlier[];
}

/** Compact token count, e.g. 12_500 → "12.5K", 3_400_000 → "3.4M". */
function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}K`;
  return n.toLocaleString('en-IN');
}

// ─── Session spend row ───────────────────────────────────────────────────────────

function SpenderRow({ spender }: { spender: TokenSpender }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="font-mono text-xs truncate text-muted-foreground">{spender.sessionId}</span>
      <span className="tabular-nums font-medium shrink-0">
        {spender.tokens.toLocaleString('en-IN')}
        {spender.trend === 'up' && <span className="text-red-500 ml-1" aria-label="trending up">▲</span>}
        {spender.trend === 'down' && <span className="text-emerald-500 ml-1" aria-label="trending down">▼</span>}
      </span>
    </div>
  );
}

// ─── Meter ──────────────────────────────────────────────────────────────────────

export function TokenBudgetMeter({ todayTotalTokens, topSessions, outliers }: TokenBudgetMeterProps) {
  const hasTopSessions = (topSessions?.length ?? 0) > 0;
  const hasOutliers = (outliers?.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Coins className="size-4 text-amber-500" />
          Token Budget — Today
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-3xl font-bold tabular-nums leading-none" title={`${todayTotalTokens.toLocaleString('en-IN')} tokens`}>
            {fmtTokens(todayTotalTokens)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            tokens consumed since start of day (UTC)
          </p>
        </div>

        {hasTopSessions && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Top spenders</p>
            <div className="space-y-1.5">
              {topSessions!.map((s) => (
                <SpenderRow key={s.sessionId} spender={s} />
              ))}
            </div>
          </div>
        )}

        {hasOutliers && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Outliers</p>
            <div className="space-y-1.5">
              {outliers!.map((o) => (
                <div key={o.sessionId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-mono text-xs truncate text-muted-foreground">{o.sessionId}</span>
                  <span className="tabular-nums font-medium shrink-0">
                    {o.tokens.toLocaleString('en-IN')}
                    <span className="text-red-500 ml-1">+{o.sigmas.toLocaleString('en-IN', { maximumFractionDigits: 1 })}σ</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TokenBudgetMeter;
