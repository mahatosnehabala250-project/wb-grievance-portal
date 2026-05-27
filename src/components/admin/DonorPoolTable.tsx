'use client';

import { useState, useMemo } from 'react';
import { Users, Filter, ArrowUpDown, Droplets } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common';
import { fmtDateTime } from '@/lib/helpers';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DonorPoolEntry {
  id: string;
  name: string;
  phone: string; // masked for display
  blood_group: string;
  district: string;
  block: string;
  total_donations: number;
  next_eligible_date: string | null;
  response_status: 'pending' | 'accepted' | 'standby' | 'declined' | 'expired' | null;
  tier: number | null;
  notified_at: string | null;
  responded_at: string | null;
}

export interface DonorPoolTableProps {
  bloodRequestId: string;
  donors: Array<DonorPoolEntry>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

type SortField = 'tier' | 'status' | 'donations';
type SortDirection = 'asc' | 'desc';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'standby', label: 'Standby' },
  { value: 'declined', label: 'Declined' },
  { value: 'expired', label: 'Expired' },
];

const STATUS_BADGE_STYLES: Record<string, string> = {
  accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  standby: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800',
  declined: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 border-red-200 dark:border-red-800',
  pending: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  expired: 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400 border-gray-200 dark:border-gray-700',
};

const STATUS_SORT_ORDER: Record<string, number> = {
  accepted: 1,
  pending: 2,
  standby: 3,
  declined: 4,
  expired: 5,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskPhone(phone: string): string {
  if (!phone || phone.length <= 4) return phone;
  return '****' + phone.slice(-4);
}

function getStatusBadgeStyle(status: string | null): string {
  if (!status) return 'bg-gray-100 text-gray-500 dark:bg-gray-800/50 dark:text-gray-400 border-gray-200 dark:border-gray-700';
  return STATUS_BADGE_STYLES[status] || STATUS_BADGE_STYLES.expired;
}

function formatStatus(status: string | null): string {
  if (!status) return 'Not Notified';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatEligibleDate(dateStr: string | null): { text: string; eligible: boolean } {
  if (!dateStr) return { text: '—', eligible: true };
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eligible = date <= today;
  const text = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return { text, eligible };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DonorPoolTable({ bloodRequestId, donors }: DonorPoolTableProps) {
  // Filter state
  const [statusFilter, setStatusFilter] = useState('');

  // Sort state
  const [sortField, setSortField] = useState<SortField>('tier');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Toggle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Filtered and sorted donors
  const filteredDonors = useMemo(() => {
    if (!donors || donors.length === 0) return [];

    let result = [...donors];

    // Apply status filter
    if (statusFilter) {
      result = result.filter((d) => d.response_status === statusFilter);
    }

    // Apply sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'tier':
          cmp = (a.tier ?? 99) - (b.tier ?? 99);
          break;
        case 'status':
          cmp = (STATUS_SORT_ORDER[a.response_status ?? ''] ?? 99) - (STATUS_SORT_ORDER[b.response_status ?? ''] ?? 99);
          break;
        case 'donations':
          cmp = a.total_donations - b.total_donations;
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [donors, statusFilter, sortField, sortDirection]);

  // Status breakdown
  const statusBreakdown = useMemo(() => {
    if (!donors || donors.length === 0) return {};
    const counts: Record<string, number> = {};
    for (const d of donors) {
      const key = d.response_status || 'not_notified';
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [donors]);

  // ─── Empty state ───
  if (!donors || donors.length === 0) {
    return (
      <EmptyState
        message="No donors in the pool for this blood request yet. Donors will appear here once the cascade begins."
        icon={Users}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Filters ─── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status filter */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ─── Summary ─── */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{filteredDonors.length}</span>
          {statusFilter ? ` matching` : ''} of {donors.length} donors in pool
        </p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(statusBreakdown).map(([status, count]) => (
            <Badge
              key={status}
              variant="outline"
              className={`text-[10px] font-medium ${getStatusBadgeStyle(status === 'not_notified' ? null : status)}`}
            >
              {formatStatus(status === 'not_notified' ? null : status)}: {count}
            </Badge>
          ))}
        </div>
      </div>

      {/* ─── Table ─── */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>
                <span className="flex items-center gap-1">
                  <Droplets className="h-3 w-3" />
                  Blood Group
                </span>
              </TableHead>
              <TableHead>Location</TableHead>
              <TableHead>
                <button
                  type="button"
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                  onClick={() => handleSort('donations')}
                >
                  Donations
                  <ArrowUpDown className={`h-3 w-3 ${sortField === 'donations' ? 'text-foreground' : 'text-muted-foreground'}`} />
                </button>
              </TableHead>
              <TableHead>Eligible</TableHead>
              <TableHead>
                <button
                  type="button"
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                  onClick={() => handleSort('tier')}
                >
                  Tier
                  <ArrowUpDown className={`h-3 w-3 ${sortField === 'tier' ? 'text-foreground' : 'text-muted-foreground'}`} />
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                  onClick={() => handleSort('status')}
                >
                  Status
                  <ArrowUpDown className={`h-3 w-3 ${sortField === 'status' ? 'text-foreground' : 'text-muted-foreground'}`} />
                </button>
              </TableHead>
              <TableHead>Notified</TableHead>
              <TableHead>Responded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDonors.map((donor) => {
              const eligibility = formatEligibleDate(donor.next_eligible_date);
              return (
                <TableRow key={donor.id}>
                  <TableCell className="font-medium text-sm">
                    {donor.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[11px] font-semibold bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800">
                      {donor.blood_group}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <span className="block">{donor.district}</span>
                    {donor.block && (
                      <span className="text-[10px] text-muted-foreground/70">{donor.block}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {donor.total_donations}
                  </TableCell>
                  <TableCell>
                    {eligibility.text === '—' ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <span className={`text-xs ${eligibility.eligible ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400'}`}>
                        {eligibility.eligible ? '✓ Now' : eligibility.text}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {donor.tier != null ? (
                      <Badge variant="outline" className="text-[11px] font-medium">
                        Tier {donor.tier}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-[11px] font-semibold ${getStatusBadgeStyle(donor.response_status)}`}
                    >
                      {formatStatus(donor.response_status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {donor.notified_at ? fmtDateTime(donor.notified_at) : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {donor.responded_at ? fmtDateTime(donor.responded_at) : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ─── Phone masking note ─── */}
      {filteredDonors.length > 0 && (
        <p className="text-[10px] text-muted-foreground/60">
          Phone numbers are masked (last 4 digits only). Admin access required to view full numbers.
        </p>
      )}
    </div>
  );
}
