'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  History, Search, Filter, ChevronLeft, ChevronRight,
  Clock, User, FileText, ArrowUpDown, Shield, CircleDot,
  RefreshCw, Download,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import type { AuditEntry } from '@/lib/types';
import { NAVY, NAVY_DARK } from '@/lib/constants';
import { fmtDateTime, authHeaders, safeGetLocalStorage, safeSetLocalStorage } from '@/lib/helpers';
import { EmptyState } from '@/components/common';

const PAGE_SIZE = 20;

const ACTION_TYPES = [
  { value: '', label: 'All Actions' },
  { value: 'CREATED', label: 'Created' },
  { value: 'STATUS_CHANGED', label: 'Status Change' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'UNASSIGNED', label: 'Unassigned' },
  { value: 'ESCALATED', label: 'Escalation' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'LOGOUT', label: 'Logout' },
];

const DATE_RANGES = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
];

function getActionBadgeStyle(action: string) {
  const map: Record<string, string> = {
    LOGIN: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    LOGOUT: 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400 border-gray-200 dark:border-gray-700',
    STATUS_CHANGED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    ESCALATED: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 border-red-200 dark:border-red-800',
    CREATED: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300 border-sky-200 dark:border-sky-800',
    ASSIGNED: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300 border-violet-200 dark:border-violet-800',
    UNASSIGNED: 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400 border-gray-200 dark:border-gray-700',
    RESOLVED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    REJECTED: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300 border-rose-200 dark:border-rose-800',
  };
  return map[action] || 'bg-muted text-muted-foreground border-border';
}

function getActionDotColor(action: string) {
  const map: Record<string, string> = {
    LOGIN: 'bg-emerald-500',
    LOGOUT: 'bg-gray-400',
    STATUS_CHANGED: 'bg-blue-500',
    ESCALATED: 'bg-red-500',
    CREATED: 'bg-sky-500',
    ASSIGNED: 'bg-violet-500',
    UNASSIGNED: 'bg-gray-400',
    RESOLVED: 'bg-emerald-500',
    REJECTED: 'bg-rose-500',
  };
  return map[action] || 'bg-gray-400';
}

function formatActionLabel(action: string) {
  return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getStartDate(range: string): string | null {
  const now = new Date();
  switch (range) {
    case 'today': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return start.toISOString();
    }
    case 'week': {
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
      return start.toISOString();
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return start.toISOString();
    }
    default:
      return null;
  }
}

export function AuditLogView() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateRange, setDateRange] = useState('all');

  // Restore filters from localStorage
  useEffect(() => {
    const saved = safeGetLocalStorage('wb_audit_filters');
    if (saved) {
      try {
        const filters = JSON.parse(saved);
        if (filters.actionFilter) setActionFilter(filters.actionFilter);
        if (filters.dateRange) setDateRange(filters.dateRange);
      } catch { /* ignore */ }
    }
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));
      if (actionFilter) params.set('action', actionFilter);

      const res = await fetch(`/api/audit-log?${params.toString()}`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        let filteredEntries = json.entries || [];

        // Client-side search filtering
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          filteredEntries = filteredEntries.filter((e: AuditEntry) =>
            (e.actorName || '').toLowerCase().includes(q) ||
            (e.description || '').toLowerCase().includes(q) ||
            (e.action || '').toLowerCase().includes(q) ||
            (e.ticketNo || '').toLowerCase().includes(q)
          );
        }

        // Client-side date range filtering
        if (dateRange !== 'all') {
          const startDate = getStartDate(dateRange);
          if (startDate) {
            filteredEntries = filteredEntries.filter((e: AuditEntry) =>
              new Date(e.createdAt) >= new Date(startDate)
            );
          }
        }

        setEntries(filteredEntries);
        setTotal(json.total || 0);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to fetch audit logs');
      }
    } catch {
      toast.error('Network error');
    }
    setLoading(false);
  }, [page, actionFilter, searchQuery, dateRange]);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  // Persist filters
  useEffect(() => {
    safeSetLocalStorage('wb_audit_filters', JSON.stringify({ actionFilter, dateRange }));
  }, [actionFilter, dateRange]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim() && dateRange === 'all') return entries;
    return entries;
  }, [entries, searchQuery, dateRange]);

  // Summary stats
  const actionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    entries.forEach((e) => {
      counts[e.action] = (counts[e.action] || 0) + 1;
    });
    return counts;
  }, [entries]);

  // Unique actors
  const uniqueActors = useMemo(() => {
    const actors = new Set<string>();
    entries.forEach((e) => {
      if (e.actorName) actors.add(e.actorName);
    });
    return actors.size;
  }, [entries]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center gap-3 mb-1">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center shadow-sm" style={{ backgroundColor: NAVY }}>
            <History className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Audit Log</h2>
            <p className="text-xs text-muted-foreground">Track all system actions and user activity</p>
          </div>
        </div>
      </motion.div>

      {/* Summary Cards */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
      >
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-blue-50 dark:bg-blue-950/40">
                <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total Events</p>
                <p className="text-lg font-black text-foreground">{total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-emerald-50 dark:bg-emerald-950/40">
                <User className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Active Users</p>
                <p className="text-lg font-black text-foreground">{uniqueActors}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-violet-50 dark:bg-violet-950/40">
                <ArrowUpDown className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Action Types</p>
                <p className="text-lg font-black text-foreground">{Object.keys(actionCounts).length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-amber-50 dark:bg-amber-950/40">
                <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Escalations</p>
                <p className="text-lg font-black text-foreground">{actionCounts['ESCALATED'] || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Filters Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              {/* Search */}
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by user, action, description, or ticket..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
                  className="pl-9 h-9 text-sm"
                />
              </div>

              {/* Action Filter */}
              <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v === '__all__' ? '' : v); setPage(0); }}>
                <SelectTrigger className="h-9 w-full sm:w-[180px] text-sm">
                  <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="Action Type" />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map((type) => (
                    <SelectItem key={type.value || '__all__'} value={type.value || '__all__'}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Date Range Filter */}
              <Select value={dateRange} onValueChange={(v) => { setDateRange(v); setPage(0); }}>
                <SelectTrigger className="h-9 w-full sm:w-[150px] text-sm">
                  <Clock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="Date Range" />
                </SelectTrigger>
                <SelectContent>
                  {DATE_RANGES.map((range) => (
                    <SelectItem key={range.value} value={range.value}>
                      {range.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Refresh */}
              <Button variant="outline" size="sm" onClick={fetchAuditLogs} disabled={loading} className="h-9 gap-1.5 text-xs shrink-0">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {/* Active Filters */}
            {(actionFilter || dateRange !== 'all' || searchQuery) && (
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Active Filters:</span>
                {searchQuery && (
                  <Badge variant="outline" className="text-[11px] gap-1">
                    Search: &quot;{searchQuery}&quot;
                    <button onClick={() => setSearchQuery('')} className="hover:text-red-500 ml-0.5">&times;</button>
                  </Badge>
                )}
                {actionFilter && (
                  <Badge variant="outline" className="text-[11px] gap-1">
                    Action: {formatActionLabel(actionFilter)}
                    <button onClick={() => setActionFilter('')} className="hover:text-red-500 ml-0.5">&times;</button>
                  </Badge>
                )}
                {dateRange !== 'all' && (
                  <Badge variant="outline" className="text-[11px] gap-1">
                    Date: {DATE_RANGES.find(r => r.value === dateRange)?.label}
                    <button onClick={() => setDateRange('all')} className="hover:text-red-500 ml-0.5">&times;</button>
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => { setSearchQuery(''); setActionFilter(''); setDateRange('all'); setPage(0); }}
                >
                  Clear All
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Audit Log Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3 }}
      >
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardHeader className="pb-3 px-4 pt-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <CircleDot className="h-4 w-4" style={{ color: NAVY }} />
                System Activity
                <Badge variant="secondary" className="text-[10px] font-normal ml-1">
                  {total} entries
                </Badge>
              </CardTitle>
              {(actionFilter || dateRange !== 'all' || searchQuery) && (
                <span className="text-[11px] text-muted-foreground">
                  Showing {filteredEntries.length} of {total}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-4 w-24 shrink-0" />
                    <Skeleton className="h-4 w-28 shrink-0" />
                    <Skeleton className="h-5 w-20 shrink-0" />
                    <Skeleton className="h-4 flex-1" />
                  </div>
                ))}
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="py-12">
                <EmptyState
                  message={searchQuery || actionFilter || dateRange !== 'all'
                    ? 'No audit logs match your filters. Try adjusting your search criteria.'
                    : 'No audit log entries found. System activity will appear here.'}
                  icon={History}
                  action={searchQuery || actionFilter || dateRange !== 'all' ? 'Clear Filters' : undefined}
                  onAction={searchQuery || actionFilter || dateRange !== 'all' ? () => { setSearchQuery(''); setActionFilter(''); setDateRange('all'); } : undefined}
                />
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent bg-muted/50 sticky top-0 z-10">
                        <TableHead className="text-[10px] font-bold uppercase tracking-widest w-[180px]">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Timestamp
                          </div>
                        </TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-widest w-[140px]">
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3" /> User
                          </div>
                        </TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-widest w-[130px]">
                          <div className="flex items-center gap-1">
                            <ArrowUpDown className="h-3 w-3" /> Action
                          </div>
                        </TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-widest">
                          <div className="flex items-center gap-1">
                            <FileText className="h-3 w-3" /> Details
                          </div>
                        </TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-widest w-[120px]">
                          Ticket
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEntries.map((entry, idx) => (
                        <TableRow
                          key={entry.id}
                          className="border-l-2 border-l-transparent hover:border-l-sky-400 hover:bg-muted/30 table-row-hover"
                        >
                          <TableCell className="py-2.5 text-xs text-muted-foreground font-mono">
                            <div className="flex items-center gap-1.5">
                              <div className={`h-2 w-2 rounded-full shrink-0 ${getActionDotColor(entry.action)}`} />
                              {fmtDateTime(entry.createdAt)}
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: NAVY }}>
                                {(entry.actorName || 'S').charAt(0).toUpperCase()}
                              </div>
                              <span className="text-xs font-medium text-foreground truncate max-w-[100px]">
                                {entry.actorName || 'System'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <Badge variant="outline" className={`text-[10px] font-semibold whitespace-nowrap ${getActionBadgeStyle(entry.action)}`}>
                              {formatActionLabel(entry.action)}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2.5 text-xs text-foreground/80 leading-relaxed max-w-[350px]">
                            <p className="line-clamp-2">{entry.description || '—'}</p>
                          </TableCell>
                          <TableCell className="py-2.5">
                            {entry.ticketNo ? (
                              <Badge variant="outline" className="text-[10px] font-mono bg-muted/50">
                                {entry.ticketNo}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden p-3 space-y-2">
                  {filteredEntries.map((entry) => (
                    <div key={entry.id} className="p-3 rounded-xl bg-muted/50 border border-border/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className={`text-[10px] font-semibold ${getActionBadgeStyle(entry.action)}`}>
                          <span className={`h-1.5 w-1.5 rounded-full mr-1 ${getActionDotColor(entry.action)}`} />
                          {formatActionLabel(entry.action)}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {fmtDateTime(entry.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/80 leading-relaxed">{entry.description || '—'}</p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <div className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: NAVY }}>
                            {(entry.actorName || 'S').charAt(0).toUpperCase()}
                          </div>
                          <span className="text-[11px] font-medium">{entry.actorName || 'System'}</span>
                        </div>
                        {entry.ticketNo && (
                          <Badge variant="outline" className="text-[10px] font-mono bg-muted/50">
                            {entry.ticketNo}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
                    <p className="text-[11px] text-muted-foreground">
                      Page {page + 1} of {totalPages} &middot; {total} total entries
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        className="h-7 px-2 text-xs"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline ml-1">Previous</span>
                      </Button>
                      {/* Page Numbers */}
                      <div className="hidden sm:flex items-center gap-0.5">
                        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                          let pageNum: number;
                          if (totalPages <= 7) {
                            pageNum = i;
                          } else if (page < 3) {
                            pageNum = i;
                          } else if (page > totalPages - 4) {
                            pageNum = totalPages - 7 + i;
                          } else {
                            pageNum = page - 3 + i;
                          }
                          return (
                            <Button
                              key={pageNum}
                              variant={page === pageNum ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => setPage(pageNum)}
                              className={`h-7 w-7 text-[11px] p-0 ${page === pageNum ? '' : ''}`}
                              style={page === pageNum ? { backgroundColor: NAVY, color: 'white' } : undefined}
                            >
                              {pageNum + 1}
                            </Button>
                          );
                        })}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                        className="h-7 px-2 text-xs"
                      >
                        <span className="hidden sm:inline mr-1">Next</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
