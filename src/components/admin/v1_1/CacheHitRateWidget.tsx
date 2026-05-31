'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, DatabaseZap, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { authHeaders, fmtDateTime } from '@/lib/helpers';

/**
 * CacheHitRateWidget — Semantic Cache hit-rate panel for `/dashboard/agents`
 * (task 24.6, Req 26.6 — Design §v1.1.7).
 *
 * Fetches `GET /api/cache/stats` (admin) and renders the per-category cache hit
 * rate over two windows (last 24h / last 7d). For each category
 * (`status | scheme | help`) and the overall rollup it shows:
 *   hits   = Σ query_cache.hit_count   (requests served from cache, Req 26.3)
 *   misses = row count                  (cached entries, each created on a miss)
 *   hit_rate = hits / (hits + misses)
 *
 * Self-contained (own fetch + polling) so it drops onto the existing Agent
 * Configuration page without depending on components owned by other dashboard
 * tasks. Degrades gracefully: an empty cache renders a "no activity" state, and
 * a 401/403 renders an admin-only message rather than throwing.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.7 Semantic Cache
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 26.6
 */

// ─── Types (mirror src/lib/semanticCache/stats.ts) ─────────────────────────────

export interface CategoryStat {
  category: string;
  hits: number;
  misses: number;
  total: number;
  hit_rate: number;
}

export interface WindowStats {
  window: string;
  since: string;
  categories: CategoryStat[];
  overall: CategoryStat;
}

interface CacheHitRateWidgetProps {
  /** Polling interval in milliseconds. Set to 0 to disable polling. Default 30s. */
  pollIntervalMs?: number;
}

// ─── Category presentation ─────────────────────────────────────────────────────

/** Friendly labels for the shipped category values (`status | scheme | help`). */
const CATEGORY_LABELS: Record<string, string> = {
  status: 'Ticket Status',
  scheme: 'Scheme Info',
  help: 'Help / Fallback',
  all: 'All Categories',
};

/** Bar tint per category for quick visual scanning. */
const CATEGORY_BAR: Record<string, string> = {
  status: '[&_[data-slot=progress-indicator]]:bg-blue-500',
  scheme: '[&_[data-slot=progress-indicator]]:bg-emerald-500',
  help: '[&_[data-slot=progress-indicator]]:bg-amber-500',
  all: '[&_[data-slot=progress-indicator]]:bg-primary',
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** Format a 0–1 rate as a whole-number percentage string. */
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// ─── Single category row ────────────────────────────────────────────────────────

function CategoryRow({ stat }: { stat: CategoryStat }) {
  const barTint = CATEGORY_BAR[stat.category] ?? CATEGORY_BAR.all;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">{categoryLabel(stat.category)}</span>
        <span className="text-muted-foreground tabular-nums">
          <span className="font-semibold text-foreground">{pct(stat.hit_rate)}</span>
          {' · '}
          {stat.hits.toLocaleString('en-IN')} hits / {stat.misses.toLocaleString('en-IN')} entries
        </span>
      </div>
      <Progress value={stat.hit_rate * 100} className={`h-2 ${barTint}`} />
    </div>
  );
}

// ─── Window panel ────────────────────────────────────────────────────────────────

function WindowPanel({ stats }: { stats: WindowStats }) {
  const hasActivity = stats.overall.total > 0;

  return (
    <div className="space-y-4 pt-1">
      {/* Overall rollup headline */}
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-2xl font-bold tabular-nums">{pct(stats.overall.hit_rate)}</p>
          <p className="text-xs text-muted-foreground">
            overall hit rate · {stats.overall.hits.toLocaleString('en-IN')} hits across{' '}
            {stats.overall.total.toLocaleString('en-IN')} requests
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">
          since {fmtDateTime(stats.since)}
        </Badge>
      </div>

      {!hasActivity ? (
        <p className="text-sm text-muted-foreground">
          No cache activity in this window yet.
        </p>
      ) : (
        <div className="space-y-3">
          {stats.categories.map((stat) => (
            <CategoryRow key={stat.category} stat={stat} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Widget ────────────────────────────────────────────────────────────────────

export function CacheHitRateWidget({ pollIntervalMs = 30_000 }: CacheHitRateWidgetProps) {
  const [windows, setWindows] = useState<WindowStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/cache/stats', { headers: authHeaders() });

      if (res.status === 401 || res.status === 403) {
        setError('Admin access required to view cache statistics.');
        setWindows([]);
        return;
      }

      if (!res.ok) {
        setError('Failed to load cache statistics.');
        return;
      }

      const json = await res.json();
      if (!json.ok) {
        setError(json.error || 'Failed to load cache statistics.');
        return;
      }

      setWindows((json.data?.windows ?? []) as WindowStats[]);
      setLastUpdated(json.data?.generated_at ?? new Date().toISOString());
      setError(null);
    } catch {
      setError('Network error while loading cache statistics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    if (pollIntervalMs <= 0) return;
    const interval = setInterval(fetchStats, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchStats, pollIntervalMs]);

  const defaultWindow = windows[0]?.window;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <DatabaseZap className="size-4 text-blue-500" />
            Semantic Cache Hit Rate
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {lastUpdated && <span>Updated {fmtDateTime(lastUpdated)}</span>}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1"
              onClick={fetchStats}
              aria-label="Refresh cache statistics"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-muted animate-pulse rounded-md" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500" />
            {error}
          </p>
        ) : windows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cache statistics available.</p>
        ) : (
          <Tabs defaultValue={defaultWindow} className="gap-3">
            <TabsList>
              {windows.map((w) => (
                <TabsTrigger key={w.window} value={w.window}>
                  {w.window === '24h' ? 'Last 24h' : w.window === '7d' ? 'Last 7d' : w.window}
                </TabsTrigger>
              ))}
            </TabsList>
            {windows.map((w) => (
              <TabsContent key={w.window} value={w.window}>
                <WindowPanel stats={w} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

export default CacheHitRateWidget;
