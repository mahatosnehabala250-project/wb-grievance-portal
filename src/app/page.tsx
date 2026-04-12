'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, FileText, LayoutDashboard, Shield, TrendingUp,
  Activity, RefreshCw, Building2, ChevronRight, MapPin, Search, Filter, X, Eye,
  Calendar, Zap, BarChart3, Menu, ChevronLeft, Download, Plus, Send, Users,
  Target, Timer, ArrowDownUp, CircleDot,
} from 'lucide-react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell,
  AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import { toast } from 'sonner';

// ============================== TYPES ==============================
interface DashboardStats {
  totalComplaints: number; criticalIssues: number; resolvedToday: number;
  totalResolved: number; openIssues: number; inProgress: number;
  resolutionRate: number; avgResolutionDays: number;
}
interface BlockData { block: string; count: number }
interface IssueTypeData { issueType: string; count: number }
interface StatusData { status: string; count: number }
interface TrendData { month: string; label: string; open: number; resolved: number; critical: number; total: number }
interface BlockBreakdown { block: string; open: number; resolved: number; critical: number; inProgress: number; total: number }
interface Complaint { id: string; issueType: string; block: string; status: string; urgency: string; createdAt: string }
interface FilterOptions { blocks: string[]; statuses: string[]; urgencies: string[]; issueTypes: string[] }
interface DashboardData {
  stats: DashboardStats; complaintsByBlock: BlockData[]; complaintsByIssueType: IssueTypeData[];
  statusBreakdown: StatusData[]; monthlyTrend: TrendData[]; blockBreakdown: BlockBreakdown[];
  latestComplaints: Complaint[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  filterOptions: FilterOptions;
}

// ============================== COLORS ==============================
const C = {
  navy: '#0A2463', blueDark: '#0D47A1', blue: '#1565C0', blueMid: '#1E88E5',
  blueLight: '#42A5F5', bluePale: '#E3F2FD', grayLight: '#F5F7FA', gray: '#E8ECF0',
  text: '#1A2332', textSec: '#5A6B7F', white: '#FFFFFF', green: '#22C55E',
  greenBg: '#F0FDF4', red: '#EF4444', redBg: '#FEF2F2', amber: '#F59E0B',
  amberBg: '#FFFBEB', orange: '#F97316', purple: '#8B5CF6',
};

const PIE_COLORS = [C.green, C.amber, C.red, C.blue, C.purple];
const BAR_CFG = { complaints: { label: 'Complaints', color: C.blue } };
const TREND_CFG = { open: { label: 'Open', color: C.red }, resolved: { label: 'Resolved', color: C.green } };
const RADAR_CFG = { open: { label: 'Open', color: C.red }, resolved: { label: 'Resolved', color: C.green }, critical: { label: 'Critical', color: C.amber } };

const ISSUE_ICONS: Record<string, string> = {
  'Water Supply': '💧', 'Road Damage': '🛣️', 'Electricity': '⚡',
  'Sanitation': '🧹', 'Healthcare': '🏥', 'Education': '📚',
};

// ============================== ANIMATED COUNTER ==============================
function useCountUp(target: number, duration = 800) {
  const [count, setCount] = useState(0);
  const prev = useRef(0);

  useEffect(() => {
    if (target === prev.current) return;
    const start = prev.current;
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setCount(Math.round(start + (target - start) * eased));
      if (progress < 1) requestAnimationFrame(animate);
      else prev.current = target;
    }
    requestAnimationFrame(animate);
  }, [target, duration]);

  return count;
}

// ============================== BADGES ==============================
function StatusBadge({ status }: { status: string }) {
  const m: Record<string, string> = {
    Open: 'bg-red-100 text-red-800 border-red-200',
    'In Progress': 'bg-amber-100 text-amber-800 border-amber-200',
    Resolved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  };
  return <Badge variant="outline" className={m[status] || 'bg-gray-100 text-gray-800 border-gray-200'}>{status}</Badge>;
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const m: Record<string, { cls: string; icon: React.ReactNode }> = {
    Critical: { cls: 'bg-red-500 text-white border-red-600', icon: <AlertTriangle className="h-3 w-3 mr-1" /> },
    High: { cls: 'bg-orange-100 text-orange-800 border-orange-300', icon: <AlertTriangle className="h-3 w-3 mr-1" /> },
    Medium: { cls: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: <Clock className="h-3 w-3 mr-1" /> },
    Low: { cls: 'bg-blue-100 text-blue-800 border-blue-300', icon: <Clock className="h-3 w-3 mr-1" /> },
  };
  const v = m[urgency] || m.Medium;
  return <Badge variant="outline" className={v.cls}>{v.icon}{urgency}</Badge>;
}

// ============================== STAT CARD ==============================
function StatCard({ title, value, icon: Icon, trend, trendLabel, color, bgColor, subtitle }: {
  title: string; value: number; icon: React.ElementType;
  trend?: string; trendLabel?: string; color: string; bgColor: string; subtitle?: string;
}) {
  const display = useCountUp(value);
  return (
    <Card className="border-0 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden group relative">
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: `linear-gradient(90deg, ${color}, ${color}88)` }} />
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5 flex-1 min-w-0">
            <p className="text-[10px] sm:text-xs font-semibold text-[#5A6B7F] uppercase tracking-wider">{title}</p>
            <p className="text-2xl sm:text-3xl font-extrabold text-[#1A2332] tabular-nums tracking-tight">{display}</p>
            {subtitle && <p className="text-[10px] sm:text-xs text-[#5A6B7F]">{subtitle}</p>}
            {trend && trendLabel && (
              <div className="flex items-center gap-1 text-[10px] sm:text-xs">
                <span className={`font-bold ${trend.startsWith('-') ? 'text-green-600' : 'text-blue-600'}`}>{trend}</span>
                <span className="text-[#5A6B7F]">{trendLabel}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-center rounded-xl p-3 group-hover:scale-110 transition-transform duration-300" style={{ backgroundColor: bgColor }}>
            <Icon className="h-5 w-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================== SKELETONS ==============================
function ChartSkeleton() {
  return (<Card className="border-0 shadow-sm"><CardHeader className="pb-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-64" /></CardHeader><CardContent><div className="flex items-end justify-between gap-2 h-[300px] px-4">{[40,65,50,80,55,70,45,60,75,85,55,90].map((h,i)=><Skeleton key={i} className="w-full rounded-t-md flex-shrink-0" style={{height:`${h}%`}} />)}</div></CardContent></Card>);
}

function TableSkeleton() {
  return (<Card className="border-0 shadow-sm"><CardHeader className="pb-2"><Skeleton className="h-6 w-56" /><Skeleton className="h-4 w-72" /></CardHeader><CardContent><div className="space-y-3">{[...Array(5)].map((_,i)=><div key={i} className="flex items-center gap-4"><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-28" /><Skeleton className="h-6 w-20 rounded-full" /><Skeleton className="h-6 w-20 rounded-full" /><Skeleton className="h-4 w-24" /></div>)}</div></CardContent></Card>);
}

// ============================== PIE LABEL ==============================
function PieCustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: {
  cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number;
}) {
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  return (
    <text x={cx + r * Math.cos(-midAngle * RADIAN)} y={cy + r * Math.sin(-midAngle * RADIAN)}
      fill="white" textAnchor="middle" dominantBaseline="central" className="text-[11px] font-bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

// ============================== COMPLAINT DETAIL DIALOG ==============================
function ComplaintDetailDialog({ complaint, open, onOpenChange }: {
  complaint: Complaint | null; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  if (!complaint) return null;
  const fields = [
    { label: 'Issue Type', value: complaint.issueType, icon: ISSUE_ICONS[complaint.issueType] || '📋' },
    { label: 'Block', value: complaint.block },
    { label: 'Status', value: complaint.status },
    { label: 'Urgency', value: complaint.urgency },
    { label: 'Filed On', value: new Date(complaint.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) },
    { label: 'Complaint ID', value: complaint.id.slice(0, 12) },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border-0 shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><FileText className="h-5 w-5 text-blue-600" />Complaint Details</DialogTitle>
          <DialogDescription>Full details of this citizen grievance</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 mt-1">
          {fields.map((f) => (
            <div key={f.label} className="p-3 rounded-lg bg-gray-50 border border-gray-100">
              <p className="text-[10px] font-semibold text-[#5A6B7F] uppercase tracking-wider mb-1">{f.label}</p>
              <div className="flex items-center gap-1.5">
                {'icon' in f && f.icon && <span className="text-sm">{f.icon as string}</span>}
                {f.label === 'Status' ? <StatusBadge status={f.value} /> : f.label === 'Urgency' ? <UrgencyBadge urgency={f.value} /> : <span className="text-sm font-semibold text-[#1A2332]">{f.value}</span>}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================== NEW COMPLAINT DIALOG ==============================
function NewComplaintDialog({ open, onOpenChange, onSuccess }: {
  open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void;
}) {
  const [form, setForm] = useState({ issueType: '', block: '', urgency: '' });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};
    if (!form.issueType) errs.issueType = 'Required';
    if (!form.block) errs.block = 'Required';
    if (!form.urgency) errs.urgency = 'Required';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to create');
      }
      toast.success('Complaint filed successfully!', { description: `New ${form.issueType} complaint for ${form.block}` });
      setForm({ issueType: '', block: '', urgency: '' });
      onOpenChange(false);
      onSuccess();
    } catch (e) {
      toast.error('Failed to file complaint', { description: e instanceof Error ? e.message : 'Unknown error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg border-0 shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><Plus className="h-5 w-5 text-blue-600" />File New Complaint</DialogTitle>
          <DialogDescription>Submit a new citizen grievance to the system</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-1">
          <div>
            <label className="text-[10px] font-semibold text-[#5A6B7F] uppercase tracking-wider mb-1.5 block">Issue Type *</label>
            <select value={form.issueType} onChange={(e) => setForm({ ...form, issueType: e.target.value })}
              className={`w-full h-10 px-3 rounded-lg border text-sm bg-white outline-none transition-colors ${errors.issueType ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20'}`}>
              <option value="">Select issue type...</option>
              {Object.entries(ISSUE_ICONS).map(([k, v]) => <option key={k} value={k}>{v} {k}</option>)}
            </select>
            {errors.issueType && <p className="text-red-500 text-[11px] mt-1">{errors.issueType}</p>}
          </div>
          <div>
            <label className="text-[10px] font-semibold text-[#5A6B7F] uppercase tracking-wider mb-1.5 block">Block *</label>
            <select value={form.block} onChange={(e) => setForm({ ...form, block: e.target.value })}
              className={`w-full h-10 px-3 rounded-lg border text-sm bg-white outline-none transition-colors ${errors.block ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20'}`}>
              <option value="">Select block...</option>
              {['Krishnanagar', 'Ranaghat', 'Kalyani', 'Shantipur', 'Chakdaha', 'Haringhata'].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            {errors.block && <p className="text-red-500 text-[11px] mt-1">{errors.block}</p>}
          </div>
          <div>
            <label className="text-[10px] font-semibold text-[#5A6B7F] uppercase tracking-wider mb-1.5 block">Urgency *</label>
            <div className="grid grid-cols-4 gap-2">
              {['Low', 'Medium', 'High', 'Critical'].map((u) => {
                const colors: Record<string, string> = {
                  Low: 'border-blue-200 bg-blue-50 text-blue-800',
                  Medium: 'border-yellow-200 bg-yellow-50 text-yellow-800',
                  High: 'border-orange-200 bg-orange-50 text-orange-800',
                  Critical: 'border-red-300 bg-red-50 text-red-800',
                };
                const selected: Record<string, string> = {
                  Low: 'border-blue-500 bg-blue-100 text-blue-900 ring-2 ring-blue-500/20',
                  Medium: 'border-yellow-500 bg-yellow-100 text-yellow-900 ring-2 ring-yellow-500/20',
                  High: 'border-orange-500 bg-orange-100 text-orange-900 ring-2 ring-orange-500/20',
                  Critical: 'border-red-500 bg-red-100 text-red-900 ring-2 ring-red-500/20',
                };
                return (
                  <button key={u} type="button" onClick={() => setForm({ ...form, urgency: u })}
                    className={`px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all duration-200 ${form.urgency === u ? selected[u] : colors[u]} hover:opacity-80`}>
                    {u === 'Critical' && <AlertTriangle className="h-3 w-3 inline mr-1" />}
                    {u === 'High' && <AlertTriangle className="h-3 w-3 inline mr-1" />}
                    {u === 'Medium' && <Clock className="h-3 w-3 inline mr-1" />}
                    {u === 'Low' && <Clock className="h-3 w-3 inline mr-1" />}
                    {u}
                  </button>
                );
              })}
            </div>
            {errors.urgency && <p className="text-red-500 text-[11px] mt-1">{errors.urgency}</p>}
          </div>
        </div>
        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-sm">Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white gap-1.5 min-w-[120px]">
            {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? 'Filing...' : 'File Complaint'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================== CSV EXPORT ==============================
function exportCSV(complaints: Complaint[]) {
  const headers = ['#', 'Issue Type', 'Block', 'Status', 'Urgency', 'Date'];
  const rows = complaints.map((c, i) => [i + 1, c.issueType, c.block, c.status, c.urgency, c.createdAt]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wb-complaints-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success('Export complete', { description: `${complaints.length} complaints exported as CSV` });
}

// ============================== MAIN DASHBOARD ==============================
export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [newComplaintOpen, setNewComplaintOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterBlock, setFilterBlock] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterUrgency, setFilterUrgency] = useState('');
  const [filterIssueType, setFilterIssueType] = useState('');
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const activeFilterCount = useMemo(() => [searchQuery, filterBlock, filterStatus, filterUrgency, filterIssueType].filter(Boolean).length,
    [searchQuery, filterBlock, filterStatus, filterUrgency, filterIssueType]);

  const clearFilters = useCallback(() => {
    setDebouncedSearch(''); setSearchQuery(''); setFilterBlock(''); setFilterStatus('');
    setFilterUrgency(''); setFilterIssueType(''); setPage(1);
  }, []);

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (searchQuery) p.set('search', searchQuery);
    if (filterBlock) p.set('block', filterBlock);
    if (filterStatus) p.set('status', filterStatus);
    if (filterUrgency) p.set('urgency', filterUrgency);
    if (filterIssueType) p.set('issueType', filterIssueType);
    p.set('page', String(page));
    p.set('pageSize', '10');
    return p.toString();
  }, [searchQuery, filterBlock, filterStatus, filterUrgency, filterIssueType, page]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const q = buildQuery();
      const res = await fetch(`/api/complaints${q ? `?${q}` : ''}`);
      if (!res.ok) throw new Error('Failed');
      const result = await res.json();
      setData(result); setLastUpdated(new Date());
    } catch { setError('Unable to load complaint data. Please try again.'); }
    finally { setLoading(false); }
  }, [buildQuery]);

  useEffect(() => { setPage(1); }, [searchQuery, filterBlock, filterStatus, filterUrgency, filterIssueType]);
  useEffect(() => { fetchData(); const i = setInterval(fetchData, 60000); return () => clearInterval(i); }, [fetchData]);
  useEffect(() => { const t = setTimeout(() => setSearchQuery(debouncedSearch), 400); return () => clearTimeout(t); }, [debouncedSearch]);

  // All complaints for CSV export
  const [allComplaints, setAllComplaints] = useState<Complaint[]>([]);
  useEffect(() => {
    if (!loading && data) {
      fetch('/api/complaints?pageSize=100')
        .then((r) => r.json())
        .then((d) => setAllComplaints(d.latestComplaints || []))
        .catch(() => {});
    }
  }, [data, loading]);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: C.grayLight }}>
      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-50 shadow-lg" style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.blueDark} 50%, ${C.blue} 100%)` }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden flex items-center justify-center rounded-lg bg-white/15 p-2 text-white"><Menu className="h-5 w-5" /></button>
              <div className="flex items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm p-2.5 shadow-inner"><Shield className="h-6 w-6 sm:h-7 sm:w-7 text-white" /></div>
              <div className="hidden sm:block">
                <h1 className="text-white font-bold text-base sm:text-lg leading-tight tracking-tight">West Bengal Grievance Portal</h1>
                <p className="text-blue-200/80 text-[11px]">District Administration Dashboard — Nadia</p>
              </div>
            </div>
            <nav className="hidden md:flex items-center gap-1">
              {[{ label: 'Dashboard', icon: LayoutDashboard, active: true }, { label: 'Analytics', icon: BarChart3 }, { label: 'Reports', icon: FileText }].map((item) => (
                <button key={item.label} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${item.active ? 'bg-white/20 text-white shadow-sm' : 'text-blue-100 hover:bg-white/10 hover:text-white'}`}>
                  <item.icon className="h-4 w-4" />{item.label}
                </button>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              {lastUpdated && <span className="text-blue-200/70 text-[11px] hidden lg:block tabular-nums">Updated {lastUpdated.toLocaleTimeString()}</span>}
              <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading} className="text-white hover:bg-white/15"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-300 text-[11px] font-medium hidden sm:inline">Live</span>
              </div>
            </div>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/10 bg-navy/95 backdrop-blur-sm">
            <nav className="max-w-7xl mx-auto px-4 py-3 space-y-1">
              {[{ label: 'Dashboard', icon: LayoutDashboard, active: true }, { label: 'Analytics', icon: BarChart3 }, { label: 'Reports', icon: FileText }].map((item) => (
                <button key={item.label} onClick={() => setMobileMenuOpen(false)} className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${item.active ? 'bg-white/20 text-white' : 'text-blue-100 hover:bg-white/10'}`}>
                  <item.icon className="h-4 w-4" />{item.label}
                </button>
              ))}
            </nav>
          </div>
        )}
      </header>

      {/* ===== MAIN ===== */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-6 space-y-5">
        {/* Title + Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold" style={{ color: C.text }}>Complaints Overview</h2>
            <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: C.textSec }}>
              <MapPin className="h-3.5 w-3.5" />Monitor and manage citizen grievances across all blocks
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="Search..." value={debouncedSearch} onChange={(e) => setDebouncedSearch(e.target.value)}
                className="pl-9 pr-8 h-9 w-48 sm:w-56 bg-white border-gray-200 text-sm focus:border-blue-400 focus:ring-blue-400/20" />
              {debouncedSearch && <button onClick={() => setDebouncedSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="h-3.5 w-3.5" /></button>}
            </div>
            <Button variant="outline" size="sm" onClick={() => setFilterPanelOpen(!filterPanelOpen)}
              className={`h-9 gap-1.5 text-xs border-gray-200 ${filterPanelOpen || activeFilterCount > 0 ? 'bg-blue-50 border-blue-300 text-blue-700' : 'text-[#5A6B7F] hover:bg-gray-50'}`}>
              <Filter className="h-3.5 w-3.5" /><span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && <span className="flex items-center justify-center h-4 w-4 rounded-full bg-blue-600 text-white text-[10px] font-bold">{activeFilterCount}</span>}
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportCSV(allComplaints)} disabled={loading}
              className="h-9 gap-1.5 text-xs border-gray-200 text-[#5A6B7F] hover:bg-gray-50">
              <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Export</span>
            </Button>
            <Button size="sm" onClick={() => setNewComplaintOpen(true)}
              className="h-9 gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
              <Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">New Complaint</span>
            </Button>
          </div>
        </div>

        {/* Active Filters */}
        {activeFilterCount > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-[#5A6B7F]">Active:</span>
            {filterBlock && <Badge variant="secondary" className="gap-1 text-xs pr-1">{filterBlock}<button onClick={() => setFilterBlock('')} className="hover:bg-gray-200 rounded p-0.5"><X className="h-3 w-3" /></button></Badge>}
            {filterStatus && <Badge variant="secondary" className="gap-1 text-xs pr-1">{filterStatus}<button onClick={() => setFilterStatus('')} className="hover:bg-gray-200 rounded p-0.5"><X className="h-3 w-3" /></button></Badge>}
            {filterUrgency && <Badge variant="secondary" className="gap-1 text-xs pr-1">{filterUrgency}<button onClick={() => setFilterUrgency('')} className="hover:bg-gray-200 rounded p-0.5"><X className="h-3 w-3" /></button></Badge>}
            {filterIssueType && <Badge variant="secondary" className="gap-1 text-xs pr-1">{filterIssueType}<button onClick={() => setFilterIssueType('')} className="hover:bg-gray-200 rounded p-0.5"><X className="h-3 w-3" /></button></Badge>}
            <button onClick={clearFilters} className="text-xs text-red-600 hover:text-red-700 font-medium ml-1">Clear all</button>
          </div>
        )}

        {/* Filter Panel */}
        {filterPanelOpen && (
          <Card className="border-0 shadow-sm bg-white animate-in fade-in-0 slide-in-from-top-2 duration-200">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[{ label: 'Block', value: filterBlock, set: setFilterBlock, opts: data?.filterOptions.blocks || [] },
                  { label: 'Status', value: filterStatus, set: setFilterStatus, opts: data?.filterOptions.statuses || [] },
                  { label: 'Urgency', value: filterUrgency, set: setFilterUrgency, opts: data?.filterOptions.urgencies || [] },
                  { label: 'Issue Type', value: filterIssueType, set: setFilterIssueType, opts: data?.filterOptions.issueTypes || [] },
                ].map((f) => (
                  <div key={f.label}>
                    <label className="text-[10px] font-semibold text-[#5A6B7F] uppercase tracking-wider mb-1.5 block">{f.label}</label>
                    <select value={f.value} onChange={(e) => f.set(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 outline-none">
                      <option value="">{`All ${f.label}s`}</option>
                      {f.opts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {error && (
          <Card className="border-red-200 bg-red-50"><CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" /><p className="text-red-700 text-sm">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchData} className="ml-auto border-red-200 text-red-700 hover:bg-red-100">Retry</Button>
          </CardContent></Card>
        )}

        {/* ===== KPI CARDS ===== */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard title="Total Complaints" value={data?.stats.totalComplaints ?? 0} icon={FileText} trend="+12%" trendLabel="from last month" color={C.blue} bgColor={C.bluePale} />
          <StatCard title="Critical Issues" value={data?.stats.criticalIssues ?? 0} icon={AlertTriangle} trend="-5%" trendLabel="from last week" color={C.red} bgColor={C.redBg} />
          <StatCard title="Resolved Today" value={data?.stats.resolvedToday ?? 0} icon={CheckCircle2} trend="+23%" trendLabel="efficiency" color={C.green} bgColor={C.greenBg} />
          <StatCard title="Resolution Rate" value={data?.stats.resolutionRate ?? 0} icon={Zap} color={C.amber} bgColor={C.amberBg} subtitle="Overall performance" />
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {[
            { label: 'Open', value: data?.stats.openIssues ?? 0, icon: Activity, color: C.red, bg: C.redBg },
            { label: 'In Progress', value: data?.stats.inProgress ?? 0, icon: Clock, color: C.amber, bg: C.amberBg },
            { label: 'Total Resolved', value: data?.stats.totalResolved ?? 0, icon: CheckCircle2, color: C.green, bg: C.greenBg },
          ].map((item) => (
            <Card key={item.label} className="border-0 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4 sm:p-5 flex items-center gap-3 sm:gap-4">
                <div className="flex items-center justify-center rounded-lg p-2 sm:p-2.5 shrink-0" style={{ backgroundColor: item.bg }}>
                  <item.icon className="h-4 w-4 sm:h-5 sm:w-5" style={{ color: item.color }} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] sm:text-xs font-semibold text-[#5A6B7F] uppercase tracking-wider">{item.label}</p>
                  <p className="text-lg sm:text-2xl font-extrabold text-[#1A2332] tabular-nums">
                    {loading ? <Skeleton className="h-6 w-10 inline-block" /> : <StatCounter target={item.value} />}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ===== CHARTS ROW ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
          {loading || !data ? <div className="lg:col-span-2"><ChartSkeleton /></div> : (
            <Card className="lg:col-span-2 border-0 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-semibold text-[#1A2332] flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-600" />Complaints by Block</CardTitle>
                <CardDescription className="text-[11px] mt-0.5">Distribution across administrative blocks</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ChartContainer config={BAR_CFG} className="h-[300px] w-full">
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
          {loading || !data ? <ChartSkeleton /> : (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-semibold text-[#1A2332] flex items-center gap-2"><Activity className="h-4 w-4 text-blue-600" />Status Breakdown</CardTitle>
                <CardDescription className="text-[11px] mt-0.5">Current status of all complaints</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ChartContainer config={{ Open: { label: 'Open', color: C.red }, 'In Progress': { label: 'In Progress', color: C.amber }, Resolved: { label: 'Resolved', color: C.green } }} className="h-[240px] w-full">
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

        {/* ===== TREND + RADAR + ISSUE TYPES ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
          {loading || !data ? <ChartSkeleton /> : (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-semibold text-[#1A2332] flex items-center gap-2"><Calendar className="h-4 w-4 text-blue-600" />Monthly Trend</CardTitle>
                <CardDescription className="text-[11px] mt-0.5">Complaint volume over time</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ChartContainer config={TREND_CFG} className="h-[260px] w-full">
                  <AreaChart data={data.monthlyTrend} margin={{ top: 10, right: 5, left: -15, bottom: 5 }}>
                    <defs>
                      <linearGradient id="gO" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.red} stopOpacity={0.2} /><stop offset="95%" stopColor={C.red} stopOpacity={0} /></linearGradient>
                      <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.green} stopOpacity={0.2} /><stop offset="95%" stopColor={C.green} stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8ECF0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#5A6B7F' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: '#5A6B7F' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area type="monotone" dataKey="open" stroke={C.red} fill="url(#gO)" strokeWidth={2} name="Open" />
                    <Area type="monotone" dataKey="resolved" stroke={C.green} fill="url(#gR)" strokeWidth={2} name="Resolved" />
                  </AreaChart>
                </ChartContainer>
                <div className="flex justify-center gap-3 mt-1">
                  <div className="flex items-center gap-1.5 text-[11px]"><div className="h-2.5 w-2.5 rounded-sm bg-red-500" /><span className="text-[#5A6B7F]">Open</span></div>
                  <div className="flex items-center gap-1.5 text-[11px]"><div className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /><span className="text-[#5A6B7F]">Resolved</span></div>
                </div>
              </CardContent>
            </Card>
          )}
          {loading || !data ? <ChartSkeleton /> : (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-semibold text-[#1A2332] flex items-center gap-2"><Target className="h-4 w-4 text-blue-600" />Block Comparison</CardTitle>
                <CardDescription className="text-[11px] mt-0.5">Open vs Resolved by block</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ChartContainer config={RADAR_CFG} className="h-[260px] w-full">
                  <RadarChart data={data.blockBreakdown} cx="50%" cy="50%" outerRadius="70%">
                    <PolarGrid stroke="#E8ECF0" />
                    <PolarAngleAxis dataKey="block" tick={{ fontSize: 9, fill: '#5A6B7F' }} />
                    <Radar name="Open" dataKey="open" stroke={C.red} fill={C.red} fillOpacity={0.15} strokeWidth={1.5} />
                    <Radar name="Resolved" dataKey="resolved" stroke={C.green} fill={C.green} fillOpacity={0.15} strokeWidth={1.5} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </RadarChart>
                </ChartContainer>
                <div className="flex justify-center gap-3 mt-1">
                  <div className="flex items-center gap-1.5 text-[11px]"><div className="h-2.5 w-2.5 rounded-sm bg-red-500" /><span className="text-[#5A6B7F]">Open</span></div>
                  <div className="flex items-center gap-1.5 text-[11px]"><div className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /><span className="text-[#5A6B7F]">Resolved</span></div>
                </div>
              </CardContent>
            </Card>
          )}
          {loading || !data ? <ChartSkeleton /> : (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-semibold text-[#1A2332] flex items-center gap-2"><Timer className="h-4 w-4 text-blue-600" />Performance Metrics</CardTitle>
                <CardDescription className="text-[11px] mt-0.5">Key operational indicators</CardDescription>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <MetricRow icon={<Timer className="h-4 w-4" />} label="Avg. Resolution Time" value={`${data.stats.avgResolutionDays} days`} color={C.blue} pct={76} />
                <MetricRow icon={<Users className="h-4 w-4" />} label="Blocks Covered" value="6 of 6" color={C.green} pct={100} />
                <MetricRow icon={<Target className="h-4 w-4" />} label="SLA Compliance" value="92%" color={C.amber} pct={92} />
                <MetricRow icon={<Activity className="h-4 w-4" />} label="First Response Rate" value="88%" color={C.purple} pct={88} />
              </CardContent>
            </Card>
          )}
        </div>

        {/* ===== ISSUE TYPES ===== */}
        {loading || !data ? <ChartSkeleton /> : (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-semibold text-[#1A2332] flex items-center gap-2"><TrendingUp className="h-4 w-4 text-blue-600" />Issue Type Distribution</CardTitle>
              <CardDescription className="text-[11px] mt-0.5">Breakdown of complaints by category</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {data.complaintsByIssueType.map((item) => {
                  const total = data.complaintsByIssueType.reduce((s, i) => s + i.count, 0);
                  const pct = Math.round((item.count / total) * 100);
                  return (
                    <div key={item.issueType} className="p-3.5 rounded-xl bg-white border border-gray-100 hover:shadow-md hover:border-blue-100 transition-all duration-200 cursor-default group">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-base">{ISSUE_ICONS[item.issueType] || '📋'}</span>
                          <span className="text-xs font-medium text-[#5A6B7F] group-hover:text-[#1A2332] transition-colors">{item.issueType}</span>
                        </div>
                        <span className="text-[11px] font-bold text-[#1A2332] bg-gray-50 px-1.5 py-0.5 rounded">{pct}%</span>
                      </div>
                      <p className="text-2xl font-extrabold tabular-nums" style={{ color: C.blue }}>{item.count}</p>
                      <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${C.blue}, ${C.blueLight})` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== TABLE ===== */}
        {loading || !data ? <TableSkeleton /> : (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold text-[#1A2332] flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600" />Latest Complaints
                    <span className="text-xs font-normal text-[#5A6B7F] ml-1">({data.pagination.total} total)</span>
                  </CardTitle>
                  <CardDescription className="text-[11px] mt-0.5">Most recently filed citizen grievances</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {data.pagination.totalPages > 1 && (
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                      <span className="text-xs text-[#5A6B7F] px-1">{page}/{data.pagination.totalPages}</span>
                      <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
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
                        {['#', 'ISSUE TYPE', 'BLOCK', 'STATUS', 'URGENCY', 'DATE', ''].map((h) => <TableHead key={h} className={`text-[10px] font-bold text-[#5A6B7F] uppercase tracking-wider h-10 ${h === '' ? 'w-10' : ''} ${h === 'DATE' ? 'text-right' : ''}`}>{h}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.latestComplaints.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-[#5A6B7F]">No complaints found matching your filters.</TableCell></TableRow>
                      ) : data.latestComplaints.map((c, i) => (
                        <TableRow key={c.id} className="hover:bg-blue-50/30 transition-colors border-b border-gray-50 cursor-pointer" onClick={() => setSelectedComplaint(c)}>
                          <TableCell className="py-2.5 text-xs text-[#5A6B7F] tabular-nums">{(page - 1) * 10 + i + 1}</TableCell>
                          <TableCell className="py-2.5"><div className="flex items-center gap-2"><span className="text-sm">{ISSUE_ICONS[c.issueType] || '📋'}</span><span className="font-medium text-sm text-[#1A2332]">{c.issueType}</span></div></TableCell>
                          <TableCell className="py-2.5"><span className="text-sm text-[#5A6B7F]">{c.block}</span></TableCell>
                          <TableCell className="py-2.5"><StatusBadge status={c.status} /></TableCell>
                          <TableCell className="py-2.5"><UrgencyBadge urgency={c.urgency} /></TableCell>
                          <TableCell className="py-2.5 text-right"><span className="text-xs text-[#5A6B7F] tabular-nums">{new Date(c.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span></TableCell>
                          <TableCell className="py-2.5"><Button variant="ghost" size="icon" className="h-7 w-7 text-[#5A6B7F] hover:text-blue-600 hover:bg-blue-50"><Eye className="h-3.5 w-3.5" /></Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* ===== FOOTER ===== */}
      <footer className="mt-auto" style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.blueDark} 100%)` }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-blue-200/70 text-[11px]"><Shield className="h-3.5 w-3.5" /><span>&copy; {new Date().getFullYear()} Government of West Bengal &mdash; District Administration</span></div>
            <div className="flex items-center gap-4 text-[11px] text-blue-300/60">
              <span className="hover:text-white cursor-pointer transition-colors">Privacy Policy</span>
              <span className="hover:text-white cursor-pointer transition-colors">Terms of Use</span>
              <span className="hover:text-white cursor-pointer transition-colors">Contact Support</span>
            </div>
          </div>
        </div>
      </footer>

      <ComplaintDetailDialog complaint={selectedComplaint} open={!!selectedComplaint} onOpenChange={(v) => { if (!v) setSelectedComplaint(null); }} />
      <NewComplaintDialog open={newComplaintOpen} onOpenChange={setNewComplaintOpen} onSuccess={fetchData} />
    </div>
  );
}

// ============================== HELPER: Stat Counter (lightweight for secondary cards) ==============================
function StatCounter({ target }: { target: number }) {
  const [val, setVal] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    if (target === ref.current) return;
    const start = ref.current;
    const t0 = performance.now();
    function step(now: number) {
      const p = Math.min((now - t0) / 600, 1);
      setVal(Math.round(start + (target - start) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
      else ref.current = target;
    }
    requestAnimationFrame(step);
  }, [target]);
  return <>{val}</>;
}

// ============================== Metric Row ==============================
function MetricRow({ icon, label, value, color, pct }: { icon: React.ReactNode; label: string; value: string; color: string; pct: number }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50/50 border border-gray-100">
      <div className="flex items-center justify-center rounded-lg w-9 h-9 shrink-0" style={{ backgroundColor: `${color}15` }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium text-[#5A6B7F]">{label}</span>
          <span className="text-xs font-bold text-[#1A2332]">{value}</span>
        </div>
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
      </div>
    </div>
  );
}
