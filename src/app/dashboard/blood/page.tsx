'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Droplets,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Users,
  ArrowUpRight,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { authHeaders, fmtDateTime } from '@/lib/helpers';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BloodRequest {
  id: string;
  blood_group: string;
  units_needed: number;
  urgency: 'critical' | 'urgent' | 'routine';
  hospital: string;
  district: string;
  block?: string;
  cascade_tier: number;
  donors_confirmed_count: number;
  donors_standby_count: number;
  status: string;
  created_at: string;
  seeker_phone?: string;
  contact_phone?: string;
}

interface QuickStats {
  totalActive: number;
  fulfilledToday: number;
  pending: number;
  criticalSOS: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const URGENCY_STYLES: Record<string, { badge: string; label: string }> = {
  critical: {
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 border-red-200 dark:border-red-800',
    label: 'Critical / SOS',
  },
  urgent: {
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    label: 'Urgent',
  },
  routine: {
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    label: 'Routine',
  },
};

// ─── Page Component ──────────────────────────────────────────────────────────

export default function BloodDashboardPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<BloodRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [escalating, setEscalating] = useState<string | null>(null);
  const [stats, setStats] = useState<QuickStats>({
    totalActive: 0,
    fulfilledToday: 0,
    pending: 0,
    criticalSOS: 0,
  });

  // ─── Fetch blood requests ───
  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/blood-requests', {
        headers: authHeaders(),
      });

      if (!res.ok) {
        // If API doesn't exist yet, use empty state
        setRequests([]);
        setLoading(false);
        return;
      }

      const json = await res.json();
      const data: BloodRequest[] = json.data || json.requests || [];

      setRequests(data);

      // Compute quick stats
      const active = data.filter(
        (r) => r.status !== 'fulfilled' && r.status !== 'cancelled' && r.status !== 'expired'
      );
      const fulfilledToday = data.filter((r) => {
        if (r.status !== 'fulfilled' && r.status !== 'donor_found') return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return new Date(r.created_at) >= today;
      });
      const pending = active.filter((r) => r.donors_confirmed_count === 0);
      const critical = active.filter((r) => r.urgency === 'critical');

      setStats({
        totalActive: active.length,
        fulfilledToday: fulfilledToday.length,
        pending: pending.length,
        criticalSOS: critical.length,
      });
    } catch {
      // Silent fail — show empty state
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
    const interval = setInterval(fetchRequests, 15_000); // Refresh every 15s
    return () => clearInterval(interval);
  }, [fetchRequests]);

  // ─── Escalate handler ───
  const handleEscalate = useCallback(
    async (requestId: string, mode: 'next_tier' | 'sos') => {
      setEscalating(requestId);
      try {
        const res = await fetch('/api/blood-requests/escalate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders(),
          },
          body: JSON.stringify({ blood_request_id: requestId, mode }),
        });

        if (res.ok) {
          // Refresh data after escalation
          await fetchRequests();
        }
      } catch {
        // Silent fail
      } finally {
        setEscalating(null);
      }
    },
    [fetchRequests]
  );

  // ─── Sort: critical pinned to top, then urgent, then routine ───
  const sortedRequests = [...requests]
    .filter(
      (r) => r.status !== 'fulfilled' && r.status !== 'cancelled' && r.status !== 'expired'
    )
    .sort((a, b) => {
      const urgencyOrder = { critical: 0, urgent: 1, routine: 2 };
      const aOrder = urgencyOrder[a.urgency] ?? 3;
      const bOrder = urgencyOrder[b.urgency] ?? 3;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return (
    <div className="space-y-6 p-4 lg:p-6 max-w-[1400px] mx-auto">
      {/* ─── Page Header ─── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Blood Operations Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor active blood requests, cascade progression, and donor responses
        </p>
      </div>

      {/* ─── Quick Stats ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Droplets className="h-4 w-4" />
              Active Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalActive}</div>
            <p className="text-xs text-muted-foreground mt-1">Currently open</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Fulfilled Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-600">{stats.fulfilledToday}</div>
            <p className="text-xs text-muted-foreground mt-1">Requests completed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              Pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600">{stats.pending}</div>
            <p className="text-xs text-muted-foreground mt-1">No donors confirmed yet</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Critical / SOS
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{stats.criticalSOS}</div>
            <p className="text-xs text-muted-foreground mt-1">Immediate attention needed</p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Active Requests List ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" />
            Active Blood Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 w-full rounded-lg" />
              ))}
            </div>
          ) : sortedRequests.length === 0 ? (
            <div className="text-center py-12">
              <Droplets className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No active blood requests at the moment
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedRequests.map((request) => (
                <BloodRequestCard
                  key={request.id}
                  request={request}
                  onNavigate={() => router.push(`/dashboard/blood/requests/${request.id}`)}
                  onEscalate={(mode) => handleEscalate(request.id, mode)}
                  isEscalating={escalating === request.id}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Blood Request Card ──────────────────────────────────────────────────────

interface BloodRequestCardProps {
  request: BloodRequest;
  onNavigate: () => void;
  onEscalate: (mode: 'next_tier' | 'sos') => void;
  isEscalating: boolean;
}

function BloodRequestCard({ request, onNavigate, onEscalate, isEscalating }: BloodRequestCardProps) {
  const urgencyStyle = URGENCY_STYLES[request.urgency] || URGENCY_STYLES.routine;
  const isCritical = request.urgency === 'critical';
  const confirmRatio = `${request.donors_confirmed_count}/${request.units_needed}`;
  const isFulfilled = request.donors_confirmed_count >= request.units_needed;

  return (
    <div
      className={`rounded-lg border p-4 transition-colors hover:bg-muted/50 cursor-pointer ${
        isCritical
          ? 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20'
          : 'border-border'
      }`}
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onNavigate();
        }
      }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Left: Blood group + urgency */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
            <span className="text-sm font-bold text-red-700 dark:text-red-300">
              {request.blood_group}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">
                {request.units_needed} unit{request.units_needed > 1 ? 's' : ''} needed
              </span>
              <Badge variant="outline" className={`text-[10px] font-semibold ${urgencyStyle.badge}`}>
                {urgencyStyle.label}
              </Badge>
              {isFulfilled && (
                <Badge variant="outline" className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                  Fulfilled
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {request.hospital} • {request.district}
              {request.block ? ` • ${request.block}` : ''}
            </p>
          </div>
        </div>

        {/* Right: Cascade info + actions */}
        <div className="flex items-center gap-3 sm:ml-auto flex-wrap">
          {/* Cascade tier */}
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Tier</p>
            <p className="text-sm font-bold">{request.cascade_tier || 0}</p>
          </div>

          {/* Donors confirmed ratio */}
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Confirmed</p>
            <p className={`text-sm font-bold ${isFulfilled ? 'text-emerald-600' : ''}`}>
              {confirmRatio}
            </p>
          </div>

          {/* Time elapsed */}
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Created</p>
            <p className="text-xs text-muted-foreground">{fmtDateTime(request.created_at)}</p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              disabled={isEscalating || isFulfilled}
              onClick={() => onEscalate('next_tier')}
            >
              <ArrowUpRight className="h-3 w-3 mr-1" />
              Escalate
            </Button>
            {isCritical && (
              <Button
                variant="destructive"
                size="sm"
                className="text-xs h-7"
                disabled={isEscalating || isFulfilled}
                onClick={() => onEscalate('sos')}
              >
                <Zap className="h-3 w-3 mr-1" />
                SOS
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
