'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  LayoutDashboard,
  Shield,
  TrendingUp,
  Activity,
  RefreshCw,
  Building2,
  ChevronRight,
  MapPin,
  Search,
  Filter,
  X,
  Eye,
  Calendar,
  Zap,
  BarChart3,
  Menu,
  ArrowUpDown,
  ChevronLeft,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  ResponsiveContainer,
} from 'recharts';

// ==============================
// TYPES
// ==============================
interface DashboardStats {
  totalComplaints: number;
  criticalIssues: number;
  resolvedToday: number;
  totalResolved: number;
  openIssues: number;
  inProgress: number;
  resolutionRate: number;
  avgResolutionDays: number;
}

interface BlockData { block: string; count: number }
interface IssueTypeData { issueType: string; count: number }
interface StatusData { status: string; count: number }
interface TrendData { month: string; label: string; open: number; resolved: number; critical: number; total: number }
interface Complaint {
  id: string;
  issueType: string;
  block: string;
  status: string;
  urgency: string;
  createdAt: string;
}
interface FilterOptions {
  blocks: string[];
  statuses: string[];
  urgencies: string[];
  issueTypes: string[];
}
interface ActiveFilters {
  block: string | null;
  status: string | null;
  urgency: string | null;
  issueType: string | null;
  search: string | null;
}

interface DashboardData {
  stats: DashboardStats;
  complaintsByBlock: BlockData[];
  complaintsByIssueType: IssueTypeData[];
  statusBreakdown: StatusData[];
  monthlyTrend: TrendData[];
  latestComplaints: Complaint[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  filterOptions: FilterOptions;
  activeFilters: ActiveFilters;
}

// ==============================
// COLOR PALETTE
// ==============================
const C = {
  navy: '#0A2463',
  blueDark: '#0D47A1',
  blue: '#1565C0',
  blueMid: '#1E88E5',
  blueLight: '#42A5F5',
  bluePale: '#E3F2FD',
  grayLight: '#F5F7FA',
  gray: '#E8ECF0',
  text: '#1A2332',
  textSec: '#5A6B7F',
  white: '#FFFFFF',
  green: '#22C55E',
  greenBg: '#F0FDF4',
  red: '#EF4444',
  redBg: '#FEF2F2',
  amber: '#F59E0B',
  amberBg: '#FFFBEB',
  orange: '#F97316',
  purple: '#8B5CF6',
};

const PIE_COLORS = [C.green, C.amber, C.red, C.blue, C.purple];

const BAR_CONFIG = { complaints: { label: 'Complaints', color: C.blue } };
const TREND_CONFIG = {
  open: { label: 'Open', color: C.red },
  resolved: { label: 'Resolved', color: C.green },
  critical: { label: 'Critical', color: C.amber },
};

// ==============================
// ISSUE TYPE ICONS
// ==============================
const ISSUE_ICONS: Record<string, React.ReactNode> = {
  'Water Supply': '💧',
  'Road Damage': '🛣️',
  'Electricity': '⚡',
  'Sanitation': '🧹',
  'Healthcare': '🏥',
  'Education': '📚',
};

// ==============================
// BADGES
// ==============================
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Open: 'bg-red-100 text-red-800 border-red-200',
    'In Progress': 'bg-amber-100 text-amber-800 border-amber-200',
    Resolved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  };
  return <Badge variant="outline" className={map[status] || 'bg-gray-100 text-gray-800 border-gray-200'}>{status}</Badge>;
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const map: Record<string, { cls: string; icon: React.ReactNode }> = {
    Critical: { cls: 'bg-red-500 text-white border-red-600', icon: <AlertTriangle className="h-3 w-3 mr-1" /> },
    High: { cls: 'bg-orange-100 text-orange-800 border-orange-300', icon: <AlertTriangle className="h-3 w-3 mr-1" /> },
    Medium: { cls: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: <Clock className="h-3 w-3 mr-1" /> },
    Low: { cls: 'bg-blue-100 text-blue-800 border-blue-300', icon: <Clock className="h-3 w-3 mr-1" /> },
  };
  const v = map[urgency] || map.Medium;
  return <Badge variant="outline" className={v.cls}>{v.icon}{urgency}</Badge>;
}

// ==============================
// STAT CARD
// ==============================
function StatCard({
  title, value, icon: Icon, trend, trendLabel, color, bgColor, loading,
  subtitle,
}: {
  title: string; value: number | string; icon: React.ElementType;
  trend?: string; trendLabel?: string; color: string; bgColor: string;
  loading?: boolean; subtitle?: string;
}) {
  return (
    <Card className="border-0 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden group relative">
      {/* Subtle gradient top border */}
      <div className="absolute top-0 left-0 right-0 h-1 opacity-80" style={{ background: `linear-gradient(90deg, ${color}, ${color}88)` }} />
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5 flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#5A6B7F] uppercase tracking-wider">{title}</p>
            {loading ? (
              <Skeleton className="h-9 w-20" />
            ) : (
              <>
                <p className="text-3xl font-extrabold text-[#1A2332] tabular-nums tracking-tight">{value}</p>
                {subtitle && <p className="text-xs text-[#5A6B7F]">{subtitle}</p>}
                {trend && trendLabel && (
                  <div className="flex items-center gap-1 text-xs">
                    <span className={`font-bold ${trend.startsWith('-') ? 'text-green-600' : 'text-blue-600'}`}>{trend}</span>
                    <span className="text-[#5A6B7F]">{trendLabel}</span>
                  </div>
                )}
              </>
            )}
          </div>
          <div
            className="flex items-center justify-center rounded-xl p-3 group-hover:scale-110 transition-transform duration-300"
            style={{ backgroundColor: bgColor }}
          >
            <Icon className="h-5 w-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ==============================
// SKELETONS
// ==============================
function ChartSkeleton() {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-2 h-[300px] px-4">
          {[40, 65, 50, 80, 55, 70, 45, 60, 75, 85, 55, 90].map((h, i) => (
            <Skeleton key={i} className="w-full rounded-t-md flex-shrink-0" style={{ height: `${h}%` }} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-72" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">{[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-28" /><Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" /><Skeleton className="h-4 w-24" />
          </div>
        ))}</div>
      </CardContent>
    </Card>
  );
}

// ==============================
// PIE LABEL
// ==============================
function PieCustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: {
  cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number;
}) {
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" className="text-[11px] font-bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

// ==============================
// COMPLAINT DETAIL DIALOG
// ==============================
function ComplaintDetailDialog({ complaint, open, onOpenChange }: {
  complaint: Complaint | null; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  if (!complaint) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border-0 shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-5 w-5 text-blue-600" />
            Complaint Details
          </DialogTitle>
          <DialogDescription>View full details of this citizen grievance</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Issue Type', value: complaint.issueType, icon: ISSUE_ICONS[complaint.issueType] || '📋' },
              { label: 'Block', value: complaint.block },
              { label: 'Status', value: complaint.status },
              { label: 'Urgency', value: complaint.urgency },
              { label: 'Filed On', value: new Date(complaint.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) },
              { label: 'Complaint ID', value: complaint.id },
            ].map((item) => (
              <div key={item.label} className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                <p className="text-[10px] font-semibold text-[#5A6B7F] uppercase tracking-wider mb-1">{item.label}</p>
                <div className="flex items-center gap-1.5">
                  {item.icon && <span className="text-sm">{item.icon}</span>}
                  {item.label === 'Status' ? (
                    <StatusBadge status={item.value} />
                  ) : item.label === 'Urgency' ? (
                    <UrgencyBadge urgency={item.value} />
                  ) : (
                    <span className="text-sm font-semibold text-[#1A2332]">{item.value}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ==============================
// MAIN DASHBOARD
// ==============================
export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterBlock, setFilterBlock] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterUrgency, setFilterUrgency] = useState('');
  const [filterIssueType, setFilterIssueType] = useState('');
  const [page, setPage] = useState(1);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (searchQuery) count++;
    if (filterBlock) count++;
    if (filterStatus) count++;
    if (filterUrgency) count++;
    if (filterIssueType) count++;
    return count;
  }, [searchQuery, filterBlock, filterStatus, filterUrgency, filterIssueType]);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setFilterBlock('');
    setFilterStatus('');
    setFilterUrgency('');
    setFilterIssueType('');
    setPage(1);
  }, []);

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (filterBlock) params.set('block', filterBlock);
    if (filterStatus) params.set('status', filterStatus);
    if (filterUrgency) params.set('urgency', filterUrgency);
    if (filterIssueType) params.set('issueType', filterIssueType);
    params.set('page', String(page));
    params.set('pageSize', '10');
    return params.toString();
  }, [searchQuery, filterBlock, filterStatus, filterUrgency, filterIssueType, page]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const q = buildQuery();
      const response = await fetch(`/api/complaints${q ? `?${q}` : ''}`);
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      setData(result);
      setLastUpdated(new Date());
    } catch {
      setError('Unable to load complaint data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [searchQuery, filterBlock, filterStatus, filterUrgency, filterIssueType]);

  // Auto-refresh every 60s
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(debouncedSearch), 400);
    return () => clearTimeout(timer);
  }, [debouncedSearch]);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: C.grayLight }}>
      {/* ===== HEADER ===== */}
      <header
        className="sticky top-0 z-50 shadow-lg"
        style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.blueDark} 50%, ${C.blue} 100%)` }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Left */}
            <div className="flex items-center gap-3">
              {/* Mobile hamburger */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden flex items-center justify-center rounded-lg bg-white/15 p-2 text-white"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm p-2.5 shadow-inner">
                <Shield className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-white font-bold text-base sm:text-lg leading-tight tracking-tight">
                  West Bengal Grievance Portal
                </h1>
                <p className="text-blue-200/80 text-[11px]">
                  District Administration Dashboard — Nadia
                </p>
              </div>
            </div>

            {/* Center: Nav (desktop) */}
            <nav className="hidden md:flex items-center gap-1">
              {[
                { label: 'Dashboard', icon: LayoutDashboard, active: true },
                { label: 'Analytics', icon: BarChart3 },
                { label: 'Reports', icon: FileText },
              ].map((item) => (
                <button
                  key={item.label}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    item.active
                      ? 'bg-white/20 text-white shadow-sm'
                      : 'text-blue-100 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              ))}
            </nav>

            {/* Right */}
            <div className="flex items-center gap-2">
              {lastUpdated && (
                <span className="text-blue-200/70 text-[11px] hidden lg:block tabular-nums">
                  Updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
              <Button
                variant="ghost" size="sm" onClick={fetchData} disabled={loading}
                className="text-white hover:bg-white/15 transition-colors"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-300 text-[11px] font-medium hidden sm:inline">Live</span>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/10 bg-navy/95 backdrop-blur-sm">
            <nav className="max-w-7xl mx-auto px-4 py-3 space-y-1">
              {[
                { label: 'Dashboard', icon: LayoutDashboard, active: true },
                { label: 'Analytics', icon: BarChart3 },
                { label: 'Reports', icon: FileText },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    item.active ? 'bg-white/20 text-white' : 'text-blue-100 hover:bg-white/10'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              ))}
              <div className="pt-2 border-t border-white/10">
                <div className="flex items-center gap-2 px-4 text-blue-200/70 text-xs">
                  <Shield className="h-4 w-4" />
                  <span>West Bengal Grievance Portal</span>
                </div>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* ===== MAIN CONTENT ===== */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-6 space-y-5">
        {/* Page Title + Search + Filter */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold" style={{ color: C.text }}>
                Complaints Overview
              </h2>
              <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: C.textSec }}>
                <MapPin className="h-3.5 w-3.5" />
                Monitor and manage citizen grievances across all blocks
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search complaints..."
                value={debouncedSearch}
                onChange={(e) => setDebouncedSearch(e.target.value)}
                className="pl-9 pr-8 h-9 w-52 sm:w-64 bg-white border-gray-200 text-sm focus:border-blue-400 focus:ring-blue-400/20"
              />
              {debouncedSearch && (
                <button
                  onClick={() => setDebouncedSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/* Filter Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilterPanelOpen(!filterPanelOpen)}
              className={`h-9 gap-1.5 text-xs border-gray-200 ${
                filterPanelOpen || activeFilterCount > 0
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'text-[#5A6B7F] hover:bg-gray-50'
              }`}
            >
              <Filter className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span className="flex items-center justify-center h-4 w-4 rounded-full bg-blue-600 text-white text-[10px] font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Active Filters */}
        {activeFilterCount > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-[#5A6B7F]">Active filters:</span>
            {filterBlock && (
              <Badge variant="secondary" className="gap-1 text-xs pr-1">
                {filterBlock}
                <button onClick={() => setFilterBlock('')} className="ml-0.5 hover:bg-gray-200 rounded p-0.5"><X className="h-3 w-3" /></button>
              </Badge>
            )}
            {filterStatus && (
              <Badge variant="secondary" className="gap-1 text-xs pr-1">
                {filterStatus}
                <button onClick={() => setFilterStatus('')} className="ml-0.5 hover:bg-gray-200 rounded p-0.5"><X className="h-3 w-3" /></button>
              </Badge>
            )}
            {filterUrgency && (
              <Badge variant="secondary" className="gap-1 text-xs pr-1">
                {filterUrgency}
                <button onClick={() => setFilterUrgency('')} className="ml-0.5 hover:bg-gray-200 rounded p-0.5"><X className="h-3 w-3" /></button>
              </Badge>
            )}
            {filterIssueType && (
              <Badge variant="secondary" className="gap-1 text-xs pr-1">
                {filterIssueType}
                <button onClick={() => setFilterIssueType('')} className="ml-0.5 hover:bg-gray-200 rounded p-0.5"><X className="h-3 w-3" /></button>
              </Badge>
            )}
            <button
              onClick={clearFilters}
              className="text-xs text-red-600 hover:text-red-700 font-medium ml-1"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Filter Panel */}
        {filterPanelOpen && (
          <Card className="border-0 shadow-sm bg-white">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] font-semibold text-[#5A6B7F] uppercase tracking-wider mb-1.5 block">Block</label>
                  <select
                    value={filterBlock}
                    onChange={(e) => setFilterBlock(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 outline-none"
                  >
                    <option value="">All Blocks</option>
                    {data?.filterOptions.blocks.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-[#5A6B7F] uppercase tracking-wider mb-1.5 block">Status</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 outline-none"
                  >
                    <option value="">All Statuses</option>
                    {data?.filterOptions.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-[#5A6B7F] uppercase tracking-wider mb-1.5 block">Urgency</label>
                  <select
                    value={filterUrgency}
                    onChange={(e) => setFilterUrgency(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 outline-none"
                  >
                    <option value="">All Urgencies</option>
                    {data?.filterOptions.urgencies.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-[#5A6B7F] uppercase tracking-wider mb-1.5 block">Issue Type</label>
                  <select
                    value={filterIssueType}
                    onChange={(e) => setFilterIssueType(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 outline-none"
                  >
                    <option value="">All Types</option>
                    {data?.filterOptions.issueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error State */}
        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              <p className="text-red-700 text-sm">{error}</p>
              <Button variant="outline" size="sm" onClick={fetchData} className="ml-auto border-red-200 text-red-700 hover:bg-red-100">Retry</Button>
            </CardContent>
          </Card>
        )}

        {/* ===== KPI CARDS ===== */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            title="Total Complaints" value={data?.stats.totalComplaints ?? '—'} icon={FileText}
            trend="+12%" trendLabel="from last month" color={C.blue} bgColor={C.bluePale}
            loading={loading}
          />
          <StatCard
            title="Critical Issues" value={data?.stats.criticalIssues ?? '—'} icon={AlertTriangle}
            trend="-5%" trendLabel="from last week" color={C.red} bgColor={C.redBg}
            loading={loading}
          />
          <StatCard
            title="Resolved Today" value={data?.stats.resolvedToday ?? '—'} icon={CheckCircle2}
            trend="+23%" trendLabel="efficiency rate" color={C.green} bgColor={C.greenBg}
            loading={loading}
          />
          <StatCard
            title="Resolution Rate" value={loading ? '—' : `${data?.stats.resolutionRate ?? 0}%`}
            icon={Zap} color={C.amber} bgColor={C.amberBg}
            loading={loading} subtitle="Overall performance"
          />
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {[
            { label: 'Open', value: data?.stats.openIssues, icon: Activity, color: C.red, bg: C.redBg },
            { label: 'In Progress', value: data?.stats.inProgress, icon: Clock, color: C.amber, bg: C.amberBg },
            { label: 'Total Resolved', value: data?.stats.totalResolved, icon: CheckCircle2, color: C.green, bg: C.greenBg },
          ].map((item) => (
            <Card key={item.label} className="border-0 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4 sm:p-5 flex items-center gap-3 sm:gap-4">
                <div className="flex items-center justify-center rounded-lg p-2 sm:p-2.5 shrink-0" style={{ backgroundColor: item.bg }}>
                  <item.icon className="h-4 w-4 sm:h-5 sm:w-5" style={{ color: item.color }} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] sm:text-xs font-semibold text-[#5A6B7F] uppercase tracking-wider">{item.label}</p>
                  <p className="text-lg sm:text-2xl font-extrabold text-[#1A2332] tabular-nums">
                    {loading ? <Skeleton className="h-6 w-10 inline-block" /> : item.value ?? '—'}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ===== CHARTS ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
          {/* Bar Chart */}
          {loading || !data ? (
            <div className="lg:col-span-2"><ChartSkeleton /></div>
          ) : (
            <Card className="lg:col-span-2 border-0 shadow-sm">
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold text-[#1A2332] flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-blue-600" />
                      Complaints by Block
                    </CardTitle>
                    <CardDescription className="text-[11px] mt-0.5">Distribution across administrative blocks</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <ChartContainer config={BAR_CONFIG} className="h-[300px] w-full">
                  <BarChart data={data.complaintsByBlock} margin={{ top: 10, right: 10, left: -10, bottom: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8ECF0" />
                    <XAxis dataKey="block" tick={{ fontSize: 10, fill: '#5A6B7F' }} tickLine={false} axisLine={{ stroke: '#E8ECF0' }} angle={-35} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 10, fill: '#5A6B7F' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <ChartTooltip cursor={{ fill: 'rgba(21, 101, 192, 0.06)' }} content={<ChartTooltipContent />} />
                    <Bar dataKey="count" name="Complaints" fill={C.blue} radius={[6, 6, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          {/* Pie Chart */}
          {loading || !data ? (
            <ChartSkeleton />
          ) : (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-semibold text-[#1A2332] flex items-center gap-2">
                  <Activity className="h-4 w-4 text-blue-600" />
                  Status Breakdown
                </CardTitle>
                <CardDescription className="text-[11px] mt-0.5">Current status of all complaints</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ChartContainer
                  config={{ Open: { label: 'Open', color: C.red }, 'In Progress': { label: 'In Progress', color: C.amber }, Resolved: { label: 'Resolved', color: C.green } }}
                  className="h-[240px] w-full"
                >
                  <PieChart>
                    <Pie data={data.statusBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="count" nameKey="status" label={PieCustomLabel} labelLine={false}>
                      {data.statusBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </PieChart>
                </ChartContainer>
                <div className="flex flex-wrap justify-center gap-3 mt-1">
                  {data.statusBreakdown.map((item, i) => (
                    <div key={item.status} className="flex items-center gap-1.5 text-[11px]">
                      <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-[#5A6B7F]">{item.status}</span>
                      <span className="font-bold text-[#1A2332]">{item.count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ===== TREND CHART + ISSUE TYPES ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
          {/* Monthly Trend */}
          {loading || !data ? (
            <div className="lg:col-span-1"><ChartSkeleton /></div>
          ) : (
            <Card className="lg:col-span-1 border-0 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-semibold text-[#1A2332] flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-blue-600" />
                  Monthly Trend
                </CardTitle>
                <CardDescription className="text-[11px] mt-0.5">Complaint volume over time</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ChartContainer config={TREND_CONFIG} className="h-[240px] w-full">
                  <AreaChart data={data.monthlyTrend} margin={{ top: 10, right: 5, left: -15, bottom: 5 }}>
                    <defs>
                      <linearGradient id="gradOpen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.red} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={C.red} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.green} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={C.green} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8ECF0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#5A6B7F' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: '#5A6B7F' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area type="monotone" dataKey="open" stroke={C.red} fill="url(#gradOpen)" strokeWidth={2} name="Open" />
                    <Area type="monotone" dataKey="resolved" stroke={C.green} fill="url(#gradResolved)" strokeWidth={2} name="Resolved" />
                  </AreaChart>
                </ChartContainer>
                <div className="flex flex-wrap justify-center gap-3 mt-1">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <div className="h-2.5 w-2.5 rounded-sm bg-red-500" />
                    <span className="text-[#5A6B7F]">Open</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <div className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                    <span className="text-[#5A6B7F]">Resolved</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Issue Type Distribution */}
          {loading || !data ? (
            <div className="lg:col-span-2"><ChartSkeleton /></div>
          ) : (
            <Card className="lg:col-span-2 border-0 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-semibold text-[#1A2332] flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                  Issue Type Distribution
                </CardTitle>
                <CardDescription className="text-[11px] mt-0.5">Breakdown of complaints by category</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {data.complaintsByIssueType.map((item) => {
                    const total = data.complaintsByIssueType.reduce((s, i) => s + i.count, 0);
                    const pct = Math.round((item.count / total) * 100);
                    return (
                      <div
                        key={item.issueType}
                        className="p-3.5 rounded-xl bg-white border border-gray-100 hover:shadow-md hover:border-blue-100 transition-all duration-200 cursor-default group"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-base">{ISSUE_ICONS[item.issueType] || '📋'}</span>
                            <span className="text-xs font-medium text-[#5A6B7F] group-hover:text-[#1A2332] transition-colors">
                              {item.issueType}
                            </span>
                          </div>
                          <span className="text-[11px] font-bold text-[#1A2332] bg-gray-50 px-1.5 py-0.5 rounded">{pct}%</span>
                        </div>
                        <p className="text-2xl font-extrabold tabular-nums" style={{ color: C.blue }}>{item.count}</p>
                        <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${C.blue}, ${C.blueLight})` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ===== COMPLAINTS TABLE ===== */}
        {loading || !data ? (
          <TableSkeleton />
        ) : (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold text-[#1A2332] flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600" />
                    Latest Complaints
                    {data.pagination.total > 0 && (
                      <span className="text-xs font-normal text-[#5A6B7F] ml-1">
                        ({data.pagination.total} total)
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription className="text-[11px] mt-0.5">
                    Most recently filed citizen grievances
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {data.pagination.totalPages > 1 && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline" size="icon" className="h-7 w-7"
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <span className="text-xs text-[#5A6B7F] px-1">
                        {page} / {data.pagination.totalPages}
                      </span>
                      <Button
                        variant="outline" size="icon" className="h-7 w-7"
                        disabled={page >= data.pagination.totalPages}
                        onClick={() => setPage(page + 1)}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50/80 hover:bg-gray-50/80">
                        <TableHead className="text-[10px] font-bold text-[#5A6B7F] uppercase tracking-wider h-10">#</TableHead>
                        <TableHead className="text-[10px] font-bold text-[#5A6B7F] uppercase tracking-wider h-10">Issue Type</TableHead>
                        <TableHead className="text-[10px] font-bold text-[#5A6B7F] uppercase tracking-wider h-10">Block</TableHead>
                        <TableHead className="text-[10px] font-bold text-[#5A6B7F] uppercase tracking-wider h-10">Status</TableHead>
                        <TableHead className="text-[10px] font-bold text-[#5A6B7F] uppercase tracking-wider h-10">Urgency</TableHead>
                        <TableHead className="text-[10px] font-bold text-[#5A6B7F] uppercase tracking-wider h-10 text-right">Date</TableHead>
                        <TableHead className="text-[10px] font-bold text-[#5A6B7F] uppercase tracking-wider h-10 w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.latestComplaints.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-10 text-sm text-[#5A6B7F]">
                            No complaints found matching your filters.
                          </TableCell>
                        </TableRow>
                      ) : (
                        data.latestComplaints.map((complaint, index) => (
                          <TableRow
                            key={complaint.id}
                            className="hover:bg-blue-50/30 transition-colors border-b border-gray-50 cursor-pointer"
                            onClick={() => setSelectedComplaint(complaint)}
                          >
                            <TableCell className="py-2.5 text-xs text-[#5A6B7F] tabular-nums">
                              {(page - 1) * 10 + index + 1}
                            </TableCell>
                            <TableCell className="py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="text-sm">{ISSUE_ICONS[complaint.issueType] || '📋'}</span>
                                <span className="font-medium text-sm text-[#1A2332]">{complaint.issueType}</span>
                              </div>
                            </TableCell>
                            <TableCell className="py-2.5">
                              <span className="text-sm text-[#5A6B7F]">{complaint.block}</span>
                            </TableCell>
                            <TableCell className="py-2.5"><StatusBadge status={complaint.status} /></TableCell>
                            <TableCell className="py-2.5"><UrgencyBadge urgency={complaint.urgency} /></TableCell>
                            <TableCell className="py-2.5 text-right">
                              <span className="text-xs text-[#5A6B7F] tabular-nums">
                                {new Date(complaint.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </span>
                            </TableCell>
                            <TableCell className="py-2.5">
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-[#5A6B7F] hover:text-blue-600 hover:bg-blue-50">
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* ===== FOOTER ===== */}
      <footer
        className="mt-auto"
        style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.blueDark} 100%)` }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-blue-200/70 text-[11px]">
              <Shield className="h-3.5 w-3.5" />
              <span>&copy; {new Date().getFullYear()} Government of West Bengal &mdash; District Administration</span>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-blue-300/60">
              <span className="hover:text-white cursor-pointer transition-colors">Privacy Policy</span>
              <span className="hover:text-white cursor-pointer transition-colors">Terms of Use</span>
              <span className="hover:text-white cursor-pointer transition-colors">Contact Support</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Complaint Detail Dialog */}
      <ComplaintDetailDialog
        complaint={selectedComplaint}
        open={!!selectedComplaint}
        onOpenChange={(v) => { if (!v) setSelectedComplaint(null); }}
      />
    </div>
  );
}
