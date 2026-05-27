'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Droplets, MapPin, Building2, Clock, User,
  AlertTriangle, Zap, Phone, Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CascadeVisualizer, type CascadeNotificationEntry } from '@/components/admin/CascadeVisualizer';
import { DonorPoolTable, type DonorPoolEntry } from '@/components/admin/DonorPoolTable';
import { authHeaders, fmtDateTime } from '@/lib/helpers';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BloodRequest {
  id: string;
  blood_group: string;
  units_needed: number;
  urgency: 'routine' | 'urgent' | 'critical';
  hospital: string;
  district: string;
  block: string;
  status: string;
  cascade_tier: number;
  donors_confirmed_count: number;
  donors_standby_count: number;
  created_at: string;
  seeker_phone?: string;
  seeker_name?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  searching: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  donor_found: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  fulfilled: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};

const URGENCY_STYLES: Record<string, string> = {
  routine: 'bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300',
  urgent: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskPhone(phone: string | undefined): string {
  if (!phone) return '—';
  if (phone.length <= 4) return '****';
  return '****' + phone.slice(-4);
}

function formatStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function BloodRequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.id as string;

  const [request, setRequest] = useState<BloodRequest | null>(null);
  const [notifications, setNotifications] = useState<CascadeNotificationEntry[]>([]);
  const [donorPool, setDonorPool] = useState<DonorPoolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [escalating, setEscalating] = useState(false);
  const [sosTriggering, setSosTriggering] = useState(false);

  // ─── Fetch all data ───
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/blood-requests/${requestId}`, {
        headers: authHeaders(),
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch blood request: ${res.status}`);
      }

      const json = await res.json();
      if (!json.ok) {
        throw new Error(json.error || 'Failed to load blood request');
      }

      setRequest(json.data.request);
      setNotifications(json.data.notifications || []);
      setDonorPool(json.data.donor_pool || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    if (requestId) {
      fetchData();
    }
  }, [requestId, fetchData]);

  // ─── Admin actions ───
  const handleEscalate = async () => {
    if (!request) return;
    setEscalating(true);
    try {
      const res = await fetch('/api/blood-requests/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          blood_request_id: request.id,
          mode: 'next_tier',
        }),
      });

      if (res.ok) {
        await fetchData(); // Refresh data after escalation
      }
    } catch {
      // Silent fail — user can retry
    } finally {
      setEscalating(false);
    }
  };

  const handleSOS = async () => {
    if (!request) return;
    setSosTriggering(true);
    try {
      const res = await fetch('/api/blood-requests/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          blood_request_id: request.id,
          mode: 'sos',
        }),
      });

      if (res.ok) {
        await fetchData();
      }
    } catch {
      // Silent fail
    } finally {
      setSosTriggering(false);
    }
  };

  // ─── Loading state ───
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ─── Error state ───
  if (error || !request) {
    return (
      <div className="space-y-4 p-4 lg:p-6 max-w-[1400px] mx-auto">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {error || 'Blood request not found'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 lg:p-6 max-w-[1400px] mx-auto">
      {/* ─── Header ─── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Blood Requests
          </Button>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Droplets className="h-6 w-6 text-red-500" />
            Blood Request Detail
          </h1>
          <p className="text-sm text-muted-foreground font-mono">{request.id}</p>
        </div>

        {/* Admin Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleEscalate}
            disabled={escalating}
          >
            {escalating ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 mr-1" />
            )}
            Escalate to Next Tier
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleSOS}
            disabled={sosTriggering}
          >
            {sosTriggering ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5 mr-1" />
            )}
            SOS Mode
          </Button>
        </div>
      </div>

      {/* ─── Request Info Card ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Request Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Blood Group */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Droplets className="h-3 w-3" />
                Blood Group
              </p>
              <Badge
                variant="outline"
                className="text-sm font-bold bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800"
              >
                {request.blood_group}
              </Badge>
            </div>

            {/* Units Needed */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Units Needed</p>
              <p className="text-sm font-semibold">
                {request.donors_confirmed_count} / {request.units_needed} confirmed
              </p>
            </div>

            {/* Urgency */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Urgency</p>
              <Badge
                variant="outline"
                className={`text-xs font-semibold ${URGENCY_STYLES[request.urgency] || ''}`}
              >
                {request.urgency.charAt(0).toUpperCase() + request.urgency.slice(1)}
              </Badge>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Status</p>
              <Badge
                variant="outline"
                className={`text-xs font-semibold ${STATUS_STYLES[request.status] || ''}`}
              >
                {formatStatus(request.status)}
              </Badge>
            </div>

            {/* Hospital */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                Hospital
              </p>
              <p className="text-sm font-medium">{request.hospital || '—'}</p>
            </div>

            {/* District */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                District
              </p>
              <p className="text-sm font-medium">{request.district || '—'}</p>
            </div>

            {/* Block */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Block</p>
              <p className="text-sm font-medium">{request.block || '—'}</p>
            </div>

            {/* Created At */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Created
              </p>
              <p className="text-sm font-medium">{fmtDateTime(request.created_at)}</p>
            </div>
          </div>

          <Separator className="my-4" />

          {/* Seeker Info */}
          <div className="flex items-center gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3" />
                Seeker
              </p>
              <p className="text-sm font-medium">{request.seeker_name || 'Anonymous'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="h-3 w-3" />
                Phone (masked)
              </p>
              <p className="text-sm font-mono">{maskPhone(request.seeker_phone)}</p>
            </div>
            {request.donors_standby_count > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Standby Donors</p>
                <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                  {request.donors_standby_count}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Cascade Visualizer ─── */}
      <CascadeVisualizer
        bloodRequestId={request.id}
        urgency={request.urgency}
        currentTier={request.cascade_tier}
        notifications={notifications}
        donorsConfirmed={request.donors_confirmed_count}
        unitsNeeded={request.units_needed}
      />

      {/* ─── Donor Pool Table ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Donor Pool</CardTitle>
        </CardHeader>
        <CardContent>
          <DonorPoolTable
            bloodRequestId={request.id}
            donors={donorPool}
          />
        </CardContent>
      </Card>
    </div>
  );
}
