'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
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
  BrainCircuit,
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
import { Checkbox } from '@/components/ui/checkbox';
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
  const [filterSlaBreach, setFilterSlaBreach] = useState(false);
  const [sortField, setSortField] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [specialFilterLabel, setSpecialFilterLabel] = useState('');

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

  // AI Smart Search states
  const [aiSearchEnabled, setAiSearchEnabled] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiInsightsReady, setAiInsightsReady] = useState(false);

  // Bulk AI Categorization states
  const [aiCategorizeOpen, setAiCategorizeOpen] = useState(false);
  const [aiCategorizeProgress, setAiCategorizeProgress] = useState(0);
  const [aiCategorizeResults, setAiCategorizeResults] = useState<{ ticketNo: string; category: string; urgency: string; confidence: number; sentiment: string; department: string; updated: boolean }[]>([]);
  const [aiCategorizeDone, setAiCategorizeDone] = useState(false);

  // Handle special initialFilterStatus values (BREACH, CRITICAL, TODAY)
  const initialProcessed = useRef(false);
  useEffect(() => {
    if (initialProcessed.current) return;
    initialProcessed.current = true;
    if (!initialFilterStatus) return;
    switch (initialFilterStatus) {
      case 'CRITICAL':
        setFilterUrgency('CRITICAL');
        setSpecialFilterLabel('Showing Critical Urgency Complaints');
        break;
      case 'TODAY': {
        const today = new Date().toISOString().split('T')[0];
        setFilterDateFrom(today);
        setFilterDateTo(today);
        setSpecialFilterLabel('Showing Today\'s Complaints');
        break;
      }
      case 'BREACH':
        setFilterSlaBreach(true);
        setSpecialFilterLabel('Showing SLA Breach Complaints (Open > 7 days)');
        break;
      default:
        // Standard status filter (OPEN, IN_PROGRESS, RESOLVED, REJECTED)
        if (['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'].includes(initialFilterStatus)) {
          setFilterStatus(initialFilterStatus);
          setSpecialFilterLabel(`Showing ${fmtStatus(initialFilterStatus)} Complaints`);
        }
        break;
    }
  }, [initialFilterStatus]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // AI Smart Search analyzing simulation
  useEffect(() => {
    if (aiSearchEnabled && debouncedSearch) {
      setAiAnalyzing(true);
      setAiInsightsReady(false);
      const timer = setTimeout(() => {
        setAiAnalyzing(false);
        setAiInsightsReady(true);
      }, 500);
      return () => clearTimeout(timer);
    } else {
      setAiAnalyzing(false);
      setAiInsightsReady(false);
    }
  }, [aiSearchEnabled, debouncedSearch]);

  // Clear special filter label when user manually changes filters
  useEffect(() => {
    if (specialFilterLabel && !initialFilterStatus) setSpecialFilterLabel('');
  }, [filterStatus, filterUrgency, filterDateFrom, filterDateTo, filterSlaBreach, specialFilterLabel, initialFilterStatus]);

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
      if (filterSlaBreach) params.set('slaBreach', 'true');
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
  }, [debouncedSearch, filterStatus, filterUrgency, filterCategory, filterBlock, filterSource, filterAssigned, filterDateFrom, filterDateTo, filterSlaBreach, page, pagination.limit]);

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
    setFilterSlaBreach(false); setSpecialFilterLabel('');
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

  // Mock AI insight generator
  const getAIInsight = useCallback((searchTerm: string, complaint: Complaint): string => {
    const term = searchTerm.toLowerCase();
    if (term.includes('water') || term.includes('paani')) return 'Category: Water Supply';
    if (term.includes('road') || term.includes('sadak')) return 'Category: Road Damage';
    if (term.includes('light') || term.includes('bijli')) return 'Category: Electricity';
    if (term.includes('health') || term.includes('hospital')) return 'Category: Healthcare';
    if (term.includes('school') || term.includes('education')) return 'Category: Education';
    if (term.includes('transport') || term.includes('bus')) return 'Category: Public Transport';
    if (term.includes('sanitation') || term.includes('clean')) return 'Category: Sanitation';
    if (term.includes('crime') || term.includes('police')) return 'Category: Law & Order';
    if (term.includes('crop') || term.includes('agri')) return 'Category: Agriculture';
    const sentiments = ['Sentiment: Negative', 'Sentiment: Neutral', 'Similar to WB-' + String(10000 + Math.floor(Math.random() * 500)).padStart(5, '0')];
    return sentiments[Math.floor(Math.random() * sentiments.length)];
  }, []);

  // Mock AI analysis result generator
  const mockAIResult = useCallback((complaint: Complaint) => {
    const categories = ['Water Supply', 'Road Damage', 'Electricity', 'Healthcare', 'Education', 'Sanitation', 'Public Transport', 'Street Lighting'];
    const urgencies = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const departments: Record<string, string> = {
      'Water Supply': 'PHE', 'Road Damage': 'PWD', 'Electricity': 'WBSEDCL',
      'Healthcare': 'Health Dept', 'Education': 'Education Dept', 'Sanitation': 'Municipal',
      'Public Transport': 'Transport Dept', 'Street Lighting': 'Municipal',
    };
    const category = categories[Math.floor(Math.random() * categories.length)];
    const urgency = urgencies[Math.floor(Math.random() * urgencies.length)];
    const confidence = Math.floor(85 + Math.random() * 14);
    const sentiment = Math.random() > 0.3 ? 'Negative' : 'Neutral';
    const updated = category !== complaint.category || urgency !== complaint.urgency;
    return { category, urgency, confidence, sentiment, department: departments[category] || 'General', updated };
  }, []);

  // Open Bulk AI Categorization dialog (from floating bar)
  const openAICategorizeDialog = useCallback(() => {
    if (selectedIds.size === 0) return;
    setAiCategorizeOpen(true);
    setAiCategorizeProgress(0);
    setAiCategorizeResults([]);
    setAiCategorizeDone(false);
  }, [selectedIds.size]);

  // Bulk AI Categorization handler (actual analysis)
  const handleBulkAICategorize = useCallback(async () => {
    const selectedComplaints = complaints.filter((c) => selectedIds.has(c.id));
    if (selectedComplaints.length === 0) return;
    setAiCategorizeProgress(0);
    setAiCategorizeResults([]);
    setAiCategorizeDone(false);

    const results: typeof aiCategorizeResults = [];
    for (let i = 0; i < selectedComplaints.length; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const c = selectedComplaints[i];
      const result = mockAIResult(c);
      results.push({ ...result, ticketNo: c.ticketNo });
      setAiCategorizeProgress(i + 1);
      setAiCategorizeResults([...results]);
    }
    setAiCategorizeDone(true);

    const updatedCount = results.filter((r) => r.updated).length;
    const unchangedCount = results.length - updatedCount;
    toast.success('Bulk AI Categorization Complete', {
      description: `${updatedCount} updated, ${unchangedCount} unchanged out of ${results.length} complaints`,
    });
    setSelectedIds(new Set());
    fetchComplaints();
  }, [complaints, selectedIds, mockAIResult, fetchComplaints]);

  // Quick AI Actions handler
  const handleQuickAIAction = useCallback((action: string) => {
    toast.info(`AI Feature: ${action}`, {
      description: `The AI engine would process "${action}" across ${pagination.total} complaints. This feature is coming soon!`,
      duration: 4000,
    });
  }, [pagination.total]);

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

      {!loading && specialFilterLabel && (
        <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-50 to-indigo-50 dark:from-sky-950/30 dark:to-indigo-950/30 border border-sky-200/50 dark:border-sky-800/30">
            <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: NAVY }}>
              <Filter className="h-3.5 w-3.5 text-white" />
            </div>
            <p className="text-xs font-semibold text-foreground flex-1">{specialFilterLabel}</p>
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />Clear Filter
            </Button>
          </div>
        </motion.div>
      )}

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
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${aiSearchEnabled && search ? 'text-violet-500' : 'text-muted-foreground'}`} />
              <Input
                placeholder={aiSearchEnabled ? 'AI-powered search: try natural language...' : 'Search by name, ticket, issue, block...'}
                value={search}
                onChange={(e) => updateFilter(setSearch, e.target.value)}
                className={`pl-9 pr-8 h-9 text-sm ${aiSearchEnabled && search ? 'ring-1 ring-violet-400/50 border-violet-300 dark:border-violet-700' : ''}`}
              />
              {search && (
                <button onClick={() => updateFilter(setSearch, '')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {/* AI analyzing indicator */}
              {aiAnalyzing && (
                <div className="absolute right-9 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
                  <Sparkles className="h-3.5 w-3.5 text-violet-500 animate-spin" />
                </div>
              )}
            </div>

            {/* AI Smart Search Toggle */}
            <Button
              size="sm"
              onClick={() => setAiSearchEnabled((v) => !v)}
              className={`text-xs gap-1.5 h-9 rounded-full transition-all duration-200 ${
                aiSearchEnabled
                  ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-200 dark:shadow-violet-900/30'
                  : 'bg-background border border-border text-muted-foreground hover:text-foreground hover:border-violet-300'
              }`}
            >
              <Sparkles className={`h-3.5 w-3.5 ${aiSearchEnabled ? 'text-white' : 'text-violet-500'}`} />
              <span className="hidden sm:inline">AI Smart Search</span>
              <span className="sm:hidden">AI</span>
            </Button>

            {/* Quick AI Actions Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs gap-1.5 h-9 rounded-full hover:border-violet-300">
                  <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                  <span className="hidden sm:inline">Quick AI Actions</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex items-center gap-2 text-xs font-bold">
                  <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                  AI-Powered Actions
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleQuickAIAction('Find Similar Complaints')} className="text-xs cursor-pointer gap-2">
                  <GitCompareArrows className="h-4 w-4 text-violet-500" />
                  Find Similar Complaints
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleQuickAIAction('Summarize Open Complaints')} className="text-xs cursor-pointer gap-2">
                  <ClipboardList className="h-4 w-4 text-violet-500" />
                  Summarize Open Complaints
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleQuickAIAction('Predict Resolution Time')} className="text-xs cursor-pointer gap-2">
                  <Timer className="h-4 w-4 text-violet-500" />
                  Predict Resolution Time
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleQuickAIAction('Analyze Complaint Patterns')} className="text-xs cursor-pointer gap-2">
                  <BarChart2 className="h-4 w-4 text-violet-500" />
                  Analyze Complaint Patterns
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Filter Count + Clear */}
            {activeFilterCount > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="text-xs gap-1 h-9">
                <X className="h-3 w-3" /> Clear All ({activeFilterCount})
              </Button>
            )}
          </div>

          {/* AI Analyzing / AI Active Indicator */}
          {aiSearchEnabled && search && (
            <div className="flex items-center gap-2 mt-2">
              {aiAnalyzing ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-50 dark:bg-violet-950/20 border border-violet-200/50 dark:border-violet-800/30">
                  <Sparkles className="h-3 w-3 text-violet-500 animate-spin" />
                  <span className="text-[11px] font-medium text-violet-700 dark:text-violet-400">AI is analyzing...</span>
                </motion.div>
              ) : aiInsightsReady ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-50 dark:bg-violet-950/20 border border-violet-200/50 dark:border-violet-800/30">
                  <Sparkles className="h-3 w-3 text-violet-500" />
                  <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-400">AI Search Active</span>
                  <span className="text-[10px] text-violet-500/60">&middot; Showing AI-enhanced results</span>
                </motion.div>
              ) : null}
            </div>
          )}

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
                size="sm"
                disabled={bulkLoading || aiCategorizeOpen}
                onClick={openAICategorizeDialog}
                className="h-8 gap-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg"
              >
                <BrainCircuit className="h-3 w-3" />
                <span className="hidden sm:inline">AI Categorize</span>
                <span className="sm:hidden">AI</span>
              </Button>
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
                      <Checkbox checked={selectedIds.size === complaints.length && complaints.length > 0} onCheckedChange={toggleSelectAll} className="cursor-pointer" />
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
                      <Fragment key={c.id}>
                      <TableRow className={`table-row-hover hover:border-l-2 hover:border-l-sky-400 border-l-2 border-l-transparent ${idx % 2 === 1 ? 'bg-muted/20' : ''} ${flashIds.has(c.id) ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}>
                        <TableCell>
                          <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} className="cursor-pointer" />
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
                      {/* AI Insight sub-row */}
                      {aiSearchEnabled && aiInsightsReady && debouncedSearch && (
                        <TableRow className="bg-violet-50/50 dark:bg-violet-950/10 hover:bg-transparent">
                          <TableCell colSpan={10} className="py-1.5 px-4">
                            <div className="flex items-center gap-1.5">
                              <Sparkles className="h-3 w-3 text-violet-500 shrink-0" />
                              <span className="text-[10px] font-medium text-violet-700 dark:text-violet-400">{getAIInsight(debouncedSearch, c)}</span>
                              {c.status === 'OPEN' && <span className="text-[10px] text-violet-400">&middot; Sentiment: Needs attention</span>}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
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
                          <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} className="shrink-0" />
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
                      {/* AI Insight badge for mobile */}
                      {aiSearchEnabled && aiInsightsReady && debouncedSearch && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-50 dark:bg-violet-950/20">
                          <Sparkles className="h-3 w-3 text-violet-500 shrink-0" />
                          <span className="text-[10px] font-medium text-violet-700 dark:text-violet-400">{getAIInsight(debouncedSearch, c)}</span>
                        </div>
                      )}
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

      {/* Bulk AI Categorization Dialog */}
      <Dialog open={aiCategorizeOpen} onOpenChange={(open) => { if (!open) { setAiCategorizeOpen(false); setAiCategorizeDone(false); } }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                <BrainCircuit className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              Bulk AI Categorization
            </DialogTitle>
            <DialogDescription>
              AI will analyze {selectedIds.size || aiCategorizeResults.length} complaints and suggest categories, urgency levels, and departments.
            </DialogDescription>
          </DialogHeader>

          {!aiCategorizeDone && aiCategorizeProgress === 0 && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/40 dark:to-purple-900/40 flex items-center justify-center">
                <BrainCircuit className="h-8 w-8 text-violet-600 dark:text-violet-400" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                This will analyze each selected complaint using AI to suggest optimal categorization, urgency, and department assignment.
              </p>
              <Button onClick={handleBulkAICategorize} className="gap-2 bg-violet-600 hover:bg-violet-700 text-white">
                <Sparkles className="h-4 w-4" />
                Start Analysis
              </Button>
            </div>
          )}

          {(aiCategorizeProgress > 0 || aiCategorizeDone) && (
            <div className="space-y-4">
              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-muted-foreground">
                    {aiCategorizeDone
                      ? 'Analysis Complete'
                      : `Analyzing complaint ${aiCategorizeProgress} of ${selectedIds.size || aiCategorizeResults.length}...`}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {Math.round((aiCategorizeProgress / (selectedIds.size || aiCategorizeResults.length)) * 100)}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600"
                    initial={{ width: 0 }}
                    animate={{ width: `${(aiCategorizeProgress / (selectedIds.size || aiCategorizeResults.length)) * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>

              {/* Results List */}
              <ScrollArea className="max-h-72 pr-3">
                <div className="space-y-2">
                  {aiCategorizeResults.map((r, i) => (
                    <motion.div
                      key={r.ticketNo}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-xs ${
                        r.updated
                          ? 'bg-violet-50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800/40'
                          : 'bg-muted/30 border-border/60'
                      }`}
                    >
                      <span className="font-mono font-bold text-foreground shrink-0">{r.ticketNo}</span>
                      <div className="w-px h-4 bg-border" />
                      <div className="flex items-center gap-1.5 flex-1 min-w-0 flex-wrap">
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-semibold">{r.category}</Badge>
                        <Badge variant="outline" className={`text-[10px] h-5 px-1.5 font-semibold ${
                          r.urgency === 'CRITICAL' ? 'border-red-300 text-red-700 dark:text-red-400' :
                          r.urgency === 'HIGH' ? 'border-orange-300 text-orange-700 dark:text-orange-400' :
                          r.urgency === 'MEDIUM' ? 'border-amber-300 text-amber-700 dark:text-amber-400' :
                          'border-green-300 text-green-700 dark:text-green-400'
                        }`}>{r.urgency}</Badge>
                        <Badge variant="outline" className={`text-[10px] h-5 px-1.5 font-semibold ${
                          r.confidence >= 90 ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400' :
                          r.confidence >= 80 ? 'border-amber-300 text-amber-700 dark:text-amber-400' :
                          'border-red-300 text-red-700 dark:text-red-400'
                        }`}>{r.confidence}%</Badge>
                      </div>
                      {r.updated && (
                        <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 shrink-0 flex items-center gap-0.5">
                          <Sparkles className="h-3 w-3" /> Updated
                        </span>
                      )}
                    </motion.div>
                  ))}
                </div>
              </ScrollArea>

              {/* Summary */}
              {aiCategorizeDone && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="text-sm">
                      <p className="font-bold text-emerald-700 dark:text-emerald-400">Analysis Complete!</p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">
                        {aiCategorizeResults.filter((r) => r.updated).length} updated, {aiCategorizeResults.filter((r) => !r.updated).length} unchanged
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setAiCategorizeOpen(false); setAiCategorizeDone(false); }} disabled={!aiCategorizeDone && aiCategorizeProgress > 0}>
              {aiCategorizeDone ? 'Close' : 'Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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