'use client';

import { useMemo } from 'react';
import { Check, Clock, Users, XCircle, Timer } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { getTierSchedule, type Urgency, type TierConfig } from '@/lib/cascade/tierSchedule';

export interface CascadeNotificationEntry {
  tier: number;
  donor_id: string;
  donor_name?: string;
  notified_at: string;
  responded_at?: string;
  response?: 'haan' | 'nahi' | 'timeout' | null;
}

export interface CascadeVisualizerProps {
  bloodRequestId: string;
  urgency: 'routine' | 'urgent' | 'critical';
  currentTier: number;
  notifications: CascadeNotificationEntry[];
  donorsConfirmed: number;
  unitsNeeded: number;
}

interface TierSummary {
  tier: number;
  config: TierConfig;
  notified: number;
  accepted: number;
  declined: number;
  pending: number;
}

/**
 * CascadeVisualizer — visualizes the cascade progression for a blood request.
 *
 * Shows a horizontal timeline with tier nodes, wait times between tiers,
 * donor notification counts, response breakdowns, and fulfillment progress.
 *
 * @see Requirements 16.1, 16.3 — Blood Operations Dashboard, Cascade Visualizer
 * @see Design §JS-15B — Donor Cascade Engine
 */
export function CascadeVisualizer({
  bloodRequestId,
  urgency,
  currentTier,
  notifications,
  donorsConfirmed,
  unitsNeeded,
}: CascadeVisualizerProps) {
  const schedule = getTierSchedule(urgency as Urgency);
  const isFulfilled = donorsConfirmed >= unitsNeeded;
  const progressPercent = unitsNeeded > 0
    ? Math.min(100, Math.round((donorsConfirmed / unitsNeeded) * 100))
    : 0;

  /** Aggregate notifications by tier */
  const tierSummaries: TierSummary[] = useMemo(() => {
    return schedule.map((config) => {
      const tierNotifs = notifications.filter((n) => n.tier === config.tier);
      const accepted = tierNotifs.filter((n) => n.response === 'haan').length;
      const declined = tierNotifs.filter(
        (n) => n.response === 'nahi' || n.response === 'timeout'
      ).length;
      const pending = tierNotifs.filter(
        (n) => n.response === null || n.response === undefined
      ).length;

      return {
        tier: config.tier,
        config,
        notified: tierNotifs.length,
        accepted,
        declined,
        pending,
      };
    });
  }, [schedule, notifications]);

  /** Format wait time for display */
  function formatWait(minutes: number): string {
    if (minutes === 0) return 'Immediate';
    if (minutes < 60) return `${minutes}m wait`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) return `${hours}h wait`;
    return `${hours}h ${mins}m wait`;
  }

  /** Determine tier visual status */
  function getTierStatus(tier: number): 'completed' | 'active' | 'future' {
    if (tier < currentTier) return 'completed';
    if (tier === currentTier) return 'active';
    return 'future';
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Cascade Progress</CardTitle>
            <Badge
              variant={
                urgency === 'critical'
                  ? 'destructive'
                  : urgency === 'urgent'
                    ? 'default'
                    : 'secondary'
              }
              className="text-xs"
            >
              {urgency}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              {bloodRequestId}
            </span>
            {isFulfilled && (
              <Badge className="bg-green-600 text-white text-xs">
                <Check className="size-3" />
                Fulfilled
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Horizontal timeline with tier nodes */}
        <div className="relative">
          <div className="flex items-start">
            {tierSummaries.map((summary, i) => {
              const status = getTierStatus(summary.tier);
              const isLast = i === tierSummaries.length - 1;

              return (
                <div key={summary.tier} className="flex flex-col items-center flex-1 min-w-0">
                  {/* Node row with connectors */}
                  <div className="flex items-center w-full">
                    {/* Left connector */}
                    {i > 0 && (
                      <div className="flex flex-col items-center flex-1">
                        <div
                          className={cn(
                            'h-0.5 w-full',
                            status === 'future' ? 'bg-muted' : 'bg-primary'
                          )}
                        />
                        {/* Wait time label on connector */}
                        <span className="text-[9px] text-muted-foreground mt-0.5 whitespace-nowrap">
                          {formatWait(summary.config.waitMinutes)}
                        </span>
                      </div>
                    )}

                    {/* Tier circle node */}
                    <div
                      className={cn(
                        'size-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold transition-all',
                        status === 'completed' &&
                          'bg-primary text-primary-foreground',
                        status === 'active' &&
                          'bg-primary text-primary-foreground ring-4 ring-primary/30 animate-pulse',
                        status === 'future' &&
                          'bg-muted text-muted-foreground border-2 border-dashed border-muted-foreground/30'
                      )}
                    >
                      {status === 'completed' ? (
                        <Check className="size-5" />
                      ) : (
                        summary.tier
                      )}
                    </div>

                    {/* Right connector */}
                    {!isLast && (
                      <div className="flex flex-col items-center flex-1">
                        <div
                          className={cn(
                            'h-0.5 w-full',
                            getTierStatus(tierSummaries[i + 1].tier) === 'future'
                              ? 'bg-muted'
                              : 'bg-primary'
                          )}
                        />
                      </div>
                    )}
                  </div>

                  {/* Tier label */}
                  <span className="mt-2 text-xs font-medium text-muted-foreground">
                    Tier {summary.tier}
                  </span>

                  {/* Scope label */}
                  <span className="text-[10px] text-muted-foreground/70 capitalize">
                    {summary.config.scope}
                  </span>

                  {/* Tier stats */}
                  <div className="mt-2 flex flex-col items-center gap-1">
                    {/* Donors notified count */}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="size-3" />
                      <span>
                        {summary.notified > 0
                          ? summary.notified
                          : summary.config.count > 0
                            ? summary.config.count
                            : 'All'}
                      </span>
                    </div>

                    {/* Response breakdown pills */}
                    {summary.notified > 0 && (
                      <div className="flex flex-wrap justify-center gap-1 mt-0.5">
                        {summary.accepted > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
                            <Check className="size-2.5" />
                            {summary.accepted}
                          </span>
                        )}
                        {summary.declined > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
                            <XCircle className="size-2.5" />
                            {summary.declined}
                          </span>
                        )}
                        {summary.pending > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                            <Timer className="size-2.5" />
                            {summary.pending}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Future tier placeholder */}
                    {summary.notified === 0 && status === 'future' && (
                      <span className="text-[10px] text-muted-foreground/50 italic">
                        Waiting
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Summary bar: confirmed / needed ratio */}
        <div className="space-y-2 pt-2 border-t">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Clock className="size-3.5" />
              Donors confirmed
            </span>
            <span className="font-semibold">
              {donorsConfirmed} / {unitsNeeded} units
            </span>
          </div>
          <Progress
            value={progressPercent}
            className={cn(
              'h-2.5',
              isFulfilled && '[&>[data-slot=progress-indicator]]:bg-green-600'
            )}
          />
          {/* Legend */}
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-green-500" />
              Accepted
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-amber-500" />
              Pending
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-red-500" />
              Declined/Timeout
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
