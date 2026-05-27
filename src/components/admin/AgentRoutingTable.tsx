'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Search, Filter, Clock, Bot } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common';
import { fmtDateTime, authHeaders } from '@/lib/helpers';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RoutingDecision {
  id: string;
  session_id: string;
  message_text: string | null;
  last_intent_before: string | null;
  agent_dispatched: string | null;
  reason: string | null;
  trace_id: string | null;
  created_at: string;
}

export interface AgentRoutingTableProps {
  onRowClick?: (decision: RoutingDecision) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 10_000;

const AGENT_OPTIONS = [
  { value: '', label: 'All Agents' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'blood', label: 'Blood' },
  { value: 'donor', label: 'Donor' },
  { value: 'info', label: 'Info' },
  { value: 'welcome', label: 'Welcome' },
];

const INTENT_OPTIONS = [
  { value: '', label: 'All Intents' },
  { value: 'idle', label: 'Idle' },
  { value: 'welcome', label: 'Welcome' },
  { value: 'complaint_collecting', label: 'Complaint Collecting' },
  { value: 'complaint_confirming', label: 'Complaint Confirming' },
  { value: 'blood_collecting', label: 'Blood Collecting' },
  { value: 'blood_confirming', label: 'Blood Confirming' },
  { value: 'donor_pending_response', label: 'Donor Pending Response' },
  { value: 'seeker_confirming', label: 'Seeker Confirming' },
  { value: 'donor_registration', label: 'Donor Registration' },
  { value: 'donor_confirming', label: 'Donor Confirming' },
  { value: 'status_check', label: 'Status Check' },
  { value: 'info_query', label: 'Info Query' },
];

/** Badge color classes per agent type */
const AGENT_BADGE_STYLES: Record<string, string> = {
  complaint: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300 border-orange-200 dark:border-orange-800',
  blood: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 border-red-200 dark:border-red-800',
  donor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  welcome: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 border-purple-200 dark:border-purple-800',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskPhone(phone: string): string {
  if (!phone || phone.length <= 7) return phone;
  const prefix = phone.slice(0, 3);
  const suffix = phone.slice(-4);
  const maskedLength = phone.length - 7;
  return `${prefix}${'*'.repeat(maskedLength)}${suffix}`;
}

function truncateMessage(text: string | null, maxLen = 200): string {
  if (!text) return '—';
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

function getAgentBadgeStyle(agent: string | null): string {
  if (!agent) return 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400 border-gray-200 dark:border-gray-700';
  return AGENT_BADGE_STYLES[agent] || 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400 border-gray-200 dark:border-gray-700';
}

function formatAgentLabel(agent: string | null): string {
  if (!agent) return 'None';
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentRoutingTable({ onRowClick }: AgentRoutingTableProps) {
  // Filter state
  const [agentFilter, setAgentFilter] = useState('');
  const [intentFilter, setIntentFilter] = useState('');
  const [phoneSearch, setPhoneSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Data state
  const [decisions, setDecisions] = useState<RoutingDecision[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDecisions = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    else setRefreshing(true);

    setError(null);

    try {
      const params = new URLSearchParams();
      if (agentFilter) params.set('agent', agentFilter);
      if (intentFilter) params.set('intent', intentFilter);
      if (phoneSearch) params.set('phone', phoneSearch);
      if (fromDate) params.set('from', new Date(fromDate).toISOString());
      if (toDate) params.set('to', new Date(toDate).toISOString());
      params.set('limit', '100');

      const res = await fetch(`/api/routing/decisions?${params.toString()}`, {
        headers: authHeaders(),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      if (json.ok) {
        setDecisions(json.data);
        setTotal(json.total ?? json.data.length);
      } else {
        throw new Error(json.error || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch routing decisions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [agentFilter, intentFilter, phoneSearch, fromDate, toDate]);

  // Initial fetch + re-fetch on filter change
  useEffect(() => {
    fetchDecisions(false);
  }, [fetchDecisions]);

  // Polling every 10s
  useEffect(() => {
    pollRef.current = setInterval(() => {
      fetchDecisions(true);
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchDecisions]);

  const handleManualRefresh = () => {
    fetchDecisions(false);
  };

  // ─── Loading skeleton ───
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-9 w-32" />
          ))}
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Filters ─── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Agent filter */}
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="w-[150px]">
            <Bot className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="All Agents" />
          </SelectTrigger>
          <SelectContent>
            {AGENT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Intent filter */}
        <Select value={intentFilter} onValueChange={setIntentFilter}>
          <SelectTrigger className="w-[180px]">
            <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="All Intents" />
          </SelectTrigger>
          <SelectContent>
            {INTENT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Phone search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Phone number"
            value={phoneSearch}
            onChange={(e) => setPhoneSearch(e.target.value)}
            className="pl-8 w-[160px] h-9"
          />
        </div>

        {/* From date */}
        <div className="relative">
          <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="datetime-local"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="pl-8 w-[180px] h-9"
            title="From date"
          />
        </div>

        {/* To date */}
        <div className="relative">
          <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="datetime-local"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="pl-8 w-[180px] h-9"
            title="To date"
          />
        </div>

        {/* Refresh button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleManualRefresh}
          disabled={refreshing}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* ─── Total count ─── */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Showing {decisions.length} of {total} routing decisions
          {refreshing && <span className="ml-2 text-blue-500">● Updating…</span>}
        </p>
      </div>

      {/* ─── Error state ─── */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 p-3">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={handleManualRefresh}>
            Retry
          </Button>
        </div>
      )}

      {/* ─── Empty state ─── */}
      {!error && decisions.length === 0 && (
        <EmptyState
          message="No routing decisions found. Adjust your filters or wait for new messages."
          icon={Bot}
        />
      )}

      {/* ─── Table ─── */}
      {!error && decisions.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Message Preview</TableHead>
              <TableHead>Detected Intent</TableHead>
              <TableHead>Agent Dispatched</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {decisions.map((decision) => (
              <TableRow
                key={decision.id}
                className={onRowClick ? 'cursor-pointer' : ''}
                onClick={() => onRowClick?.(decision)}
              >
                <TableCell className="text-xs text-muted-foreground">
                  {fmtDateTime(decision.created_at)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {maskPhone(decision.session_id)}
                </TableCell>
                <TableCell className="max-w-[250px]">
                  <span className="text-xs text-foreground/80 line-clamp-2">
                    {truncateMessage(decision.message_text)}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[11px] font-medium">
                    {decision.last_intent_before || 'unknown'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`text-[11px] font-semibold ${getAgentBadgeStyle(decision.agent_dispatched)}`}
                  >
                    {formatAgentLabel(decision.agent_dispatched)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[200px]">
                  <span className="text-xs text-muted-foreground line-clamp-1">
                    {decision.reason || '—'}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
