'use client';

import { Radio } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * InFlightCascadesStat — count of donor cascades awaiting a response (Req 32.3,
 * Design §v1.1.13).
 *
 * Presentational component for the `data.in_flight_cascades` slice of
 * `GET /api/system-health` — donors that have been notified for a blood request
 * but have not yet responded. The endpoint returns `null` when the underlying
 * `cascade_notifications` table/column is unavailable; this panel renders that
 * as an "unavailable" state rather than a misleading zero. The owning page
 * (task 30.4) fetches once and passes the value down.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.13, §v1.1.15
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 32.3
 */

export interface InFlightCascadesStatProps {
  /** Notified-not-responded donor count, or null when unavailable. */
  count: number | null;
}

export function InFlightCascadesStat({ count }: InFlightCascadesStatProps) {
  const unavailable = count === null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Radio className="size-4 text-rose-500" />
          In-Flight Cascades
        </CardTitle>
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <>
            <p className="text-3xl font-bold tabular-nums leading-none text-muted-foreground">—</p>
            <p className="text-xs text-muted-foreground mt-1">cascade tracking unavailable</p>
          </>
        ) : (
          <>
            <p className="text-3xl font-bold tabular-nums leading-none">
              {count.toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              notified donors awaiting a response
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default InFlightCascadesStat;
