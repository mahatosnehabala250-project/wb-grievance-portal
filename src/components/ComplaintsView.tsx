'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Shield, LayoutDashboard, FileText, Users, Bell, Sun, Moon, Menu,
  Search, Filter, X, Eye, Download, Plus, ArrowUpDown, ChevronLeft,
  ChevronRight, Clock, AlertTriangle, CheckCircle2, Activity, MapPin,
  LogOut, RefreshCw, MoreHorizontal, Phone, CalendarDays, Hash,
  Building2, UserCog, TrendingUp, ArrowUpRight, ArrowDownRight,
  CircleDot, Send, Trash2, KeyRound,
  RotateCcw, Zap, Star, Clock3, CheckCircle, XCircle, ChevronDown,
  ArrowLeft, MessageSquare, ShieldCheck, Globe, BarChart2,
  Printer, UserCircle, Hand, Gauge, Timer, Award, BadgeCheck, PlayCircle, Ban, CircleCheckBig,
  Settings, CircleHelp, Monitor, Mail, Volume2, LayoutGrid, Keyboard,
  UserCheck, GitCompareArrows, CalendarClock, History, Tag, ClipboardList,
  AlertCircle, Info, CheckCircle2 as CheckCircleFill, Sparkles, Megaphone,
  ArrowUp, Flame, CalendarRange, TimerReset, GraduationCap, Droplets, Bus, Sprout,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent,
} from '@/components/ui/chart';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell,
  AreaChart, Area, ResponsiveContainer, Legend,
} from 'recharts';
import { toast } from 'sonner';
import { useTheme } from 'next-themes';
import { useAuthStore } from '@/lib/auth-store';
import { motion, AnimatePresence } from 'framer-motion';
import type { Complaint, ActivityLogEntry, AssignableUser, AppUser, DashboardData, ViewType, AuditEntry } from '@/lib/types';
import { NAVY, NAVY_DARK, STATUS_MAP, URGENCY_MAP, URGENCY_BORDER_MAP, ROLE_MAP, ROLE_COLORS, CATEGORIES, CATEGORY_COLORS } from '@/lib/constants';
import { fmtDate, fmtDateTime, fmtStatus, fmtUrgency, fmtRole, safeGetLocalStorage, safeSetLocalStorage, authHeaders, getDaysOld, getSLAInfo, playNotificationSound } from '@/lib/helpers';
import { StatusBadge, UrgencyBadge, RoleBadge, StatCard, MiniStat, PieLabel, LoadingSkeleton, EmptyState } from '@/components/common';
import { ComplaintDetailDialog } from '@/components/ComplaintDetailDialog';
import { NewComplaintDialog } from '@/components/NewComplaintDialog';

export function ComplaintsView({ initialComplaint, initialFilterStatus }: { initialComplaint?: Complaint; initialFilterStatus?: string }) {
  const user = useAuthStore((s) => s.user);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 0 });

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState(initialFilterStatus || '');
  const [filterUrgency, setFilterUrgency] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBlock, setFilterBlock] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterAssigned, setFilterAssigned] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [sortField, setSortField] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [newComplaintOpen, setNewComplaintOpen] = useState(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Status update loading per row
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  // Flash animation set
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  // Block filter options (dynamic)
  const [blockOptions, setBlockOptions] = useState<string[]>([]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch complaints
  const fetchComplaints = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (filterStatus) params.set('status', filterStatus);
      if (filterUrgency) params.set('urgency', filterUrgency);
      if (filterCategory) params.set('category', filterCategory);
      if (filterBlock) params.set('block', filterBlock);
      if (filterSource) params.set('source', filterSource);
      if (filterAssigned) params.set('assigned', filterAssigned);
      if (filterDateFrom) params.set('dateFrom', filterDateFrom);
      if (filterDateTo) params.set('dateTo', filterDateTo);
      params.set('page', String(page));
      params.set('limit', String(pagination.limit));

      const res = await fetch(`/api/complaints?${params.toString()}`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setComplaints(json.complaints);
        setPagination(json.pagination);
        // Derive block options from fetched complaints
        const blocks = [...new Set(json.complaints.map((c: Complaint) => c.block))].sort() as string[];
        setBlockOptions(blocks);
      } else {
        toast.error('Failed to load complaints');
      }
    } catch {
      toast.error('Network error');
    }
    setLoading(false);
  }, [debouncedSearch, filterStatus, filterUrgency, filterCategory, filterBlock, filterSource, filterAssigned, filterDateFrom, filterDateTo, page, pagination.limit]);

  useEffect(() => { fetchComplaints(); }, [fetchComplaints]);

  // Open initial complaint if passed
  useEffect(() => {
    if (initialComplaint) {
      setSelectedComplaint(initialComplaint);
      setDetailOpen(true);
    }
  }, [initialComplaint]);

  const updateFilter = useCallback((setter: (v: string) => void, val: string) => {
    setter(val);
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch(''); setDebouncedSearch('');
    setFilterStatus(''); setFilterUrgency('');
    setFilterCategory(''); setFilterBlock('');
    setFilterSource(''); setFilterAssigned('');
    setFilterDateFrom(''); setFilterDateTo('');
    setPage(1);
  }, []);

  const activeFilterCount = [debouncedSearch, filterStatus, filterUrgency, filterCategory, filterBlock, filterSource, filterAssigned, filterDateFrom, filterDateTo].filter(Boolean).length;

  // Active filters for chips display
  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (debouncedSearch) chips.push({ key: 'search', label: `Search: "${debouncedSearch}"`, clear: () => { setSearch(''); setDebouncedSearch(''); setPage(1); } });
    if (filterStatus) chips.push({ key: 'status', label: `Status: ${fmtStatus(filterStatus)}`, clear: () => updateFilter(setFilterStatus, '') });
    if (filterUrgency) chips.push({ key: 'urgency', label: `Urgency: ${fmtUrgency(filterUrgency)}`, clear: () => updateFilter(setFilterUrgency, '') });
    if (filterCategory) chips.push({ key: 'category', label: `Category: ${filterCategory}`, clear: () => updateFilter(setFilterCategory, '') });
    if (filterBlock) chips.push({ key: 'block', label: `Block: ${filterBlock}`, clear: () => updateFilter(setFilterBlock, '') });
    if (filterSource) chips.push({ key: 'source', label: `Source: ${filterSource}`, clear: () => updateFilter(setFilterSource, '') });
    if (filterAssigned) chips.push({ key: 'assigned', label: filterAssigned === 'assigned' ? 'Assigned' : 'Unassigned', clear: () => updateFilter(setFilterAssigned, '') });
    if (filterDateFrom) chips.push({ key: 'dateFrom', label: `From: ${filterDateFrom}`, clear: () => { setFilterDateFrom(''); setPage(1); } });
    if (filterDateTo) chips.push({ key: 'dateTo', label: `To: ${filterDateTo}`, clear: () => { setFilterDateTo(''); setPage(1); } });
    return chips;
  }, [debouncedSearch, filterStatus, filterUrgency, filterCategory, filterBlock, filterSource, filterAssigned, filterDateFrom, filterDateTo]);

  // Select all toggle (defined before useEffect that uses it)
  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === complaints.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(complaints.map((c) => c.id)));
    }
  }, [selectedIds.size, complaints]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Ctrl+A support for select all
  useEffect(() => {
    function handleSelectAll(e: Event) {
      toggleSelectAll();
    }
    document.addEventListener('wb:select-all', handleSelectAll);
    return () => document.removeEventListener('wb:select-all', handleSelectAll);
  }, [toggleSelectAll]);

  const handleSort = useCallback((field: string) => {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }, [sortField]);

  const handleStatusUpdate = useCallback(async (id: string, status: string) => {
    setUpdatingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/complaints/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success('Status updated', { description: `Marked as ${fmtStatus(status)}` });
        fetchComplaints();
        // Flash animation
        setFlashIds((prev) => new Set(prev).add(id));
        setTimeout(() => {
          setFlashIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, 1000);
      } else {
        toast.error('Failed to update status');
      }
    } catch {
      toast.error('Network error');
    }
    setUpdatingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [fetchComplaints]);

  const handleComplaintUpdate = useCallback(() => {
    fetchComplaints();
  }, [fetchComplaints]);

  const handleBulkAction = useCallback(async (status: string, actionLabel: string) => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedIds);
      const res = await fetch('/api/complaints/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ids, status }),
      });
      if (res.ok) {
        toast.success(`${actionLabel} ${ids.length} complaint${ids.length > 1 ? 's' : ''}`);
        setSelectedIds(new Set());
        fetchComplaints();
      } else {
        toast.error('Bulk action failed');
      }
    } catch {
      toast.error('Network error');
    }
    setBulkLoading(false);
  }, [selectedIds, fetchComplaints]);

  const exportCSV = useCallback((items?: Complaint[]) => {
    const data = items || complaints;
    const h = ['Ticket #', 'Citizen', 'Phone', 'Issue', 'Category', 'Block', 'District', 'Urgency', 'Status', 'Source', 'Created', 'Assigned'];
    const rows = data.map((c) => [c.ticketNo, c.citizenName || '', c.phone || '', c.issue, c.category, c.block, c.district, c.urgency, c.status, c.source, fmtDate(c.createdAt), c.assignedToId ? 'Yes' : 'No']);
    const csv = [h, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wb-complaints-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('Export complete', { description: `${data.length} complaints exported` });
  }, [complaints]);

  // Server-side CSV export via /api/export API
  const handleServerExport = useCallback(() => {
    const params = new URLSearchParams();
    params.set('format', 'csv');
    if (filterStatus) params.set('status', filterStatus);
    const token = safeGetLocalStorage('wb_token');
    if (token) params.set('token', token);
    const url = `/api/export?${params.toString()}`;
    window.open(url, '_blank');
    toast.success('Export started', { description: 'Your CSV file is being downloaded' });
  }, [filterStatus]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">Complaints</h2>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <FileText className="h-3.5 w-3.5" />
            {pagination.total} total complaints
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={() => setNewComplaintOpen(true)} className="text-xs gap-1 text-white" style={{ backgroundColor: NAVY }}>
            <Plus className="h-3.5 w-3.5" /> New Complaint
          </Button>
          <Button variant="outline" size="sm" onClick={handleServerExport} className="text-xs gap-1">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* ═══ STATISTICS SUMMARY BAR (Compact Inline Pills) ═══ */}
      {!loading && pagination.total > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30 text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              Total <span className="font-black text-blue-700 dark:text-blue-400">{pagination.total}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30 text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              Open <span className="font-black text-red-700 dark:text-red-400">{complaints.filter(c => c.status === 'OPEN').length}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              In Progress <span className="font-black text-amber-700 dark:text-amber-400">{complaints.filter(c => c.status === 'IN_PROGRESS').length}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30 text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Resolved <span className="font-black text-emerald-700 dark:text-emerald-400">{complaints.filter(c => c.status === 'RESOLVED').length}</span>
            </span>
          </div>
        </motion.div>
      )}

      {/* ═══ BULK ACTIONS TOOLBAR ═══ */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, ticket, issue, block..."
                value={search}
                onChange={(e) => updateFilter(setSearch, e.target.value)}
                className="pl-9 pr-8 h-9 text-sm"
              />
              {search && (
                <button onClick={() => updateFilter(setSearch, '')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Filter Count + Clear */}
            {activeFilterCount > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="text-xs gap-1 h-9">
                <X className="h-3 w-3" /> Clear All ({activeFilterCount})
              </Button>
            )}
          </div>

          {/* Filter Row */}
          <div className="flex flex-wrap gap-2 mt-3">
            <Select value={filterStatus} onValueChange={(v) => updateFilter(setFilterStatus, v === '_all' ? '' : v)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Status</SelectItem>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterUrgency} onValueChange={(v) => updateFilter(setFilterUrgency, v === '_all' ? '' : v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="All Urgency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Urgency</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterCategory} onValueChange={(v) => updateFilter(setFilterCategory, v === '_all' ? '' : v)}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Categories</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            {user?.role !== 'BLOCK' && (
              <Select value={filterBlock} onValueChange={(v) => updateFilter(setFilterBlock, v === '_all' ? '' : v)}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="All Blocks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Blocks</SelectItem>
                  {blockOptions.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={filterSource} onValueChange={(v) => updateFilter(setFilterSource, v === '_all' ? '' : v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="All Sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Sources</SelectItem>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                <SelectItem value="MANUAL">Manual</SelectItem>
                <SelectItem value="WEB">Web</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterAssigned} onValueChange={(v) => updateFilter(setFilterAssigned, v === '_all' ? '' : v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="Assigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
              </SelectContent>
            </Select>

            <Input type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }} className="h-8 w-[130px] text-xs" placeholder="From" />
            <Input type="date" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }} className="h-8 w-[130px] text-xs" placeholder="To" />
          </div>

          {/* Filter Chips */}
          {activeFilterChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {activeFilterChips.map((chip) => (
                <span key={chip.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted border border-border text-[11px] text-muted-foreground">
                  <span className="truncate max-w-[120px]">{chip.label}</span>
                  <button onClick={chip.clear} className="hover:text-foreground transition-colors"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ FLOATING BULK ACTION TOOLBAR ═══ */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 80 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl shadow-2xl border border-white/10" style={{ background: 'linear-gradient(135deg, #0A2463 0%, #1a3a7a 100%)' }}>
              <div className="flex items-center gap-2 mr-2">
                <div className="h-8 w-8 rounded-lg bg-white/15 flex items-center justify-center">
                  <ClipboardList className="h-4 w-4 text-white" />
                </div>
                <span className="text-sm font-black text-white">{selectedIds.size} selected</span>
              </div>
              <div className="w-px h-6 bg-white/20" />
              <Button
                size="sm"
                disabled={bulkLoading}
                onClick={() => handleBulkAction('IN_PROGRESS', 'Marked In Progress')}
                className="h-8 gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded-lg"
              >
                {bulkLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
                Mark In Progress
              </Button>
              <Button
                size="sm"
                disabled={bulkLoading}
                onClick={() => handleBulkAction('RESOLVED', 'Resolved')}
                className="h-8 gap-1.5 text-xs bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg"
              >
                <CheckCircle2 className="h-3 w-3" />
                Resolve
              </Button>
              <Button
                size="sm"
                disabled={bulkLoading}
                onClick={() => handleBulkAction('OPEN', 'Escalated')}
                className="h-8 gap-1.5 text-xs bg-red-500 hover:bg-red-600 text-white rounded-lg"
              >
                <ArrowUp className="h-3 w-3" />
                Escalate
              </Button>
              <div className="w-px h-6 bg-white/20" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => exportCSV()}
                className="h-8 gap-1.5 text-xs text-white/80 hover:text-white hover:bg-white/10 rounded-lg"
              >
                <Download className="h-3 w-3" /> Export
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
                className="h-8 gap-1.5 text-xs text-white/80 hover:text-white hover:bg-white/10 rounded-lg"
              >
                <X className="h-3 w-3" /> Clear
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table (Desktop) */}
      {!loading && complaints.length === 0 ? (
        <EmptyState message="No complaints found matching your filters" />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className="border-0 shadow-sm overflow-hidden">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-10">
                      <input type="checkbox" checked={selectedIds.size === complaints.length && complaints.length > 0} onChange={toggleSelectAll} className="cursor-pointer rounded" />
                    </TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-muted" onClick={() => handleSort('ticketNo')}>
                      <span className="flex items-center gap-1">Ticket # <ArrowUpDown className="h-3 w-3" /></span>
                    </TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">Citizen</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">Category</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">Block</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">Urgency</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-muted" onClick={() => handleSort('status')}>
                      <span className="flex items-center gap-1">Status <ArrowUpDown className="h-3 w-3" /></span>
                    </TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-muted" onClick={() => handleSort('createdAt')}>
                      <span className="flex items-center gap-1">Date <ArrowUpDown className="h-3 w-3" /></span>
                    </TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">Age</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 10 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    complaints.map((c, idx) => (
                      <TableRow key={c.id} className={`table-row-hover hover:border-l-2 hover:border-l-sky-400 border-l-2 border-l-transparent ${idx % 2 === 1 ? 'bg-muted/20' : ''} ${flashIds.has(c.id) ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}>
                        <TableCell>
                          <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} className="cursor-pointer rounded" />
                        </TableCell>
                        <TableCell className="font-mono text-xs font-bold">{c.ticketNo}</TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">{c.citizenName || 'Anonymous'}</p>
                            {c.phone && <p className="text-[10px] text-muted-foreground">{c.phone}</p>}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{c.category}</TableCell>
                        <TableCell className="text-xs">{c.block}</TableCell>
                        <TableCell><UrgencyBadge urgency={c.urgency} /></TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="cursor-pointer" disabled={updatingIds.has(c.id)}>
                                {updatingIds.has(c.id) ? (
                                  <Badge variant="outline" className="text-[11px] font-semibold px-2 py-0.5 gap-1">
                                    <RefreshCw className="h-3 w-3 animate-spin" />Updating...
                                  </Badge>
                                ) : (
                                  <StatusBadge status={c.status} />
                                )}
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">Change Status</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleStatusUpdate(c.id, 'OPEN')}><CircleDot className="h-3.5 w-3.5 text-red-500 mr-2" />Open</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusUpdate(c.id, 'IN_PROGRESS')}><Clock className="h-3.5 w-3.5 text-amber-500 mr-2" />In Progress</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusUpdate(c.id, 'RESOLVED')}><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mr-2" />Resolved</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusUpdate(c.id, 'REJECTED')}><X className="h-3.5 w-3.5 text-gray-500 mr-2" />Rejected</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(c.createdAt)}</TableCell>
                        <TableCell>
                          {(() => {
                            const sla = getSLAInfo(c.createdAt, c.status);
                            return (
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${sla.bg} ${sla.text}`}>
                                {sla.level === 'breached' && <Flame className="h-3 w-3" />}
                                {sla.days}d
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setSelectedComplaint(c); setDetailOpen(true); }}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </div>

          {/* Cards (Mobile) — Enhanced with urgency borders, category icon, days ago badge, hover lift */}
          <div className="md:hidden space-y-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)
            ) : (
              complaints.map((c) => {
                const daysOld = getDaysOld(c.createdAt);
                const urgencyColor = URGENCY_BORDER_MAP[c.urgency] || '#6B7280';
                const urgencyBorderClass = c.urgency === 'CRITICAL' ? 'border-l-critical' : c.urgency === 'HIGH' ? 'border-l-high' : c.urgency === 'MEDIUM' ? 'border-l-medium' : 'border-l-low';
                const CategoryIcon = c.category === 'Roads & Infrastructure' ? Building2 : c.category === 'Water Supply' ? Droplets : c.category === 'Electricity' ? Zap : c.category === 'Healthcare' ? Activity : c.category === 'Education' ? GraduationCap : c.category === 'Public Transport' ? Bus : c.category === 'Sanitation' ? Trash2 : c.category === 'Law & Order' ? Shield : c.category === 'Agriculture' ? Sprout : FileText;
                return (
                  <Card key={c.id} className={`border-0 shadow-sm ${urgencyBorderClass} overflow-hidden hover:shadow-md hover:translate-y-[-1px] transition-all duration-200 active:scale-[0.99]`} style={{ borderLeftColor: urgencyColor }}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-xs font-bold text-foreground shrink-0">{c.ticketNo}</span>
                          <span className="h-4 w-4 rounded-md bg-muted/80 flex items-center justify-center shrink-0">
                            <CategoryIcon className="h-2.5 w-2.5 text-muted-foreground" />
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <UrgencyBadge urgency={c.urgency} />
                          <StatusBadge status={c.status} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-base font-semibold leading-relaxed text-foreground">{c.issue}</p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] text-muted-foreground">{c.citizenName || 'Anonymous'}</span>
                          <span className="text-muted-foreground/40 text-[10px]">&middot;</span>
                          <span className="text-[11px] text-muted-foreground">{c.block}, {c.district}</span>
                          <span className="text-muted-foreground/40 text-[10px]">&middot;</span>
                          <span className="text-[11px] text-muted-foreground">{c.category}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-2.5 border-t border-border/40">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />{fmtDate(c.createdAt)}
                          </span>
                          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                            daysOld > 7 ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400'
                            : daysOld >= 3 ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
                            : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                          }`}>
                            {daysOld > 7 && <Flame className="h-2.5 w-2.5" />}
                            {daysOld === 0 ? 'Today' : daysOld === 1 ? '1d' : `${daysOld}d`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-muted-foreground/50 lg:hidden">Tap to view</span>
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => { setSelectedComplaint(c); setDetailOpen(true); }}>
                            <Eye className="h-3.5 w-3.5" /> Details
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {(page - 1) * pagination.limit + 1}&ndash;{Math.min(page * pagination.limit, pagination.total)} of {pagination.total}
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {Array.from({ length: Math.min(pagination.totalPages, 5) }, (_, i) => {
                  let p = i + 1;
                  if (pagination.totalPages > 5) {
                    if (page <= 3) p = i + 1;
                    else if (page >= pagination.totalPages - 2) p = pagination.totalPages - 4 + i;
                    else p = page - 2 + i;
                  }
                  return (
                    <Button key={p} variant={p === page ? 'default' : 'outline'} size="sm" className="h-8 w-8 p-0 text-xs" onClick={() => setPage(p)} style={p === page ? { backgroundColor: NAVY, color: 'white' } : {}}>
                      {p}
                    </Button>
                  );
                })}
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail Dialog */}
      <ComplaintDetailDialog
        complaint={selectedComplaint}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={handleComplaintUpdate}
      />

      {/* New Complaint Dialog */}
      <NewComplaintDialog
        open={newComplaintOpen}
        onOpenChange={setNewComplaintOpen}
        onCreated={fetchComplaints}
      />
    </div>
  );
}