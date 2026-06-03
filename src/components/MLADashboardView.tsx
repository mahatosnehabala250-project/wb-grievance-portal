'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileText, Activity, CheckCircle2, Clock, AlertTriangle,
  Users, Star, TrendingUp, TrendingDown, Minus, RefreshCw,
  MapPin, Building2, Phone, MessageSquare, ChevronRight,
  Filter, Search, X, ExternalLink, Zap, Target, Award,
  BarChart3, CalendarRange, ArrowUpRight, CircleDot,
  ShieldAlert, BrainCircuit, CheckCircle, XCircle,
  Droplets, Road, HeartPulse, Zap as ZapIcon, BookOpen,
  Package, Home, Landmark, Scale, MoreHorizontal,
  Eye, Timer, BadgeCheck, Flame, Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, ResponsiveContainer, RadialBarChart, RadialBar,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { authHeaders, fmtDate } from '@/lib/helpers';
import { useAuthStore } from '@/lib/auth-store';
import { motion, AnimatePresence } from 'framer-motion';
import type { Complaint } from '@/lib/types';

/* ─── Types ──────────────────────────────────────────────── */
interface ConstStats {
  total: number;
  active: number;
  resolved: number;
  registered: number;
  in_progress: number;
  critical: number;
  resolution_rate: number;
  avg_rating: number | null;
  last_24h: number;
  last_7d: number;
  by_category: { category: string; total: number; resolved: number }[];
  by_block: { block: string; total: number; active: number }[];
  trend: { date: string; filed: number; resolved: number }[];
  top_officers: { name: string; score: number; resolved: number; active: number }[];
}

interface IntelAlert {
  id: string;
  alert_type: string;
  title: string;
  severity: number;
  summary: string;
  recommended_action: string;
  category: string | null;
  created_at: string;
}

/* ─── Category Config ─────────────────────────────────────── */
const CAT_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  WATER:       { icon: Droplets,  color: 'text-blue-500',    bg: 'bg-blue-500/10',    label: 'Paani' },
  ROAD:        { icon: MapPin,    color: 'text-amber-500',   bg: 'bg-amber-500/10',   label: 'Sadak' },
  HEALTH:      { icon: HeartPulse,color: 'text-red-500',     bg: 'bg-red-500/10',     label: 'Swasthya' },
  ELECTRICITY: { icon: ZapIcon,   color: 'text-yellow-500',  bg: 'bg-yellow-500/10',  label: 'Bijli' },
  EDUCATION:   { icon: BookOpen,  color: 'text-cyan-500',    bg: 'bg-cyan-500/10',    label: 'Shiksha' },
  RATION:      { icon: Package,   color: 'text-green-500',   bg: 'bg-green-500/10',   label: 'Rasan' },
  HOUSING:     { icon: Home,      color: 'text-violet-500',  bg: 'bg-violet-500/10',  label: 'Aawas' },
  PENSION:     { icon: Landmark,  color: 'text-pink-500',    bg: 'bg-pink-500/10',    label: 'Pension' },
  LAND:        { icon: MapPin,    color: 'text-orange-500',  bg: 'bg-orange-500/10',  label: 'Zameen' },
  LAW_ORDER:   { icon: Scale,     color: 'text-indigo-500',  bg: 'bg-indigo-500/10',  label: 'Kanoon' },
  SANITATION:  { icon: Droplets,  color: 'text-teal-500',    bg: 'bg-teal-500/10',    label: 'Safaai' },
  OTHER:       { icon: MoreHorizontal, color: 'text-gray-500', bg: 'bg-gray-500/10',  label: 'Anya' },
};

const STATUS_CONFIG = {
  REGISTERED:  { label: 'Registered',  color: 'text-blue-600 dark:text-blue-400',    bg: 'bg-blue-50 dark:bg-blue-950/40',    dot: 'bg-blue-500' },
  OPEN:        { label: 'Open',        color: 'text-red-600 dark:text-red-400',      bg: 'bg-red-50 dark:bg-red-950/40',      dot: 'bg-red-500' },
  ASSIGNED:    { label: 'Assigned',    color: 'text-violet-600 dark:text-violet-400',bg: 'bg-violet-50 dark:bg-violet-950/40',dot: 'bg-violet-500' },
  IN_PROGRESS: { label: 'In Progress', color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-50 dark:bg-amber-950/40',  dot: 'bg-amber-500' },
  RESOLVED:    { label: 'Resolved',    color: 'text-emerald-600 dark:text-emerald-400',bg:'bg-emerald-50 dark:bg-emerald-950/40',dot:'bg-emerald-500'},
  REJECTED:    { label: 'Rejected',    color: 'text-gray-600 dark:text-gray-400',    bg: 'bg-gray-50 dark:bg-gray-900/40',    dot: 'bg-gray-400' },
  CLOSED:      { label: 'Closed',      color: 'text-slate-600 dark:text-slate-400',  bg: 'bg-slate-50 dark:bg-slate-900/40',  dot: 'bg-slate-400' },
};

const URGENCY_CONFIG = {
  CRITICAL: { label: 'Critical', color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-950/40' },
  HIGH:     { label: 'High',     color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/40' },
  MEDIUM:   { label: 'Medium',   color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-950/40' },
  LOW:      { label: 'Low',      color: 'text-sky-600', bg: 'bg-sky-50 dark:bg-sky-950/40' },
};

/* ─── Animated Number ────────────────────────────────────── */
function AnimNum({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [d, setD] = useState(0);
  useEffect(() => {
    let step = 0;
    const steps = 24;
    const inc = value / steps;
    const t = setInterval(() => {
      step++;
      setD(Math.min(Math.round(inc * step), value));
      if (step >= steps) clearInterval(t);
    }, 28);
    return () => clearInterval(t);
  }, [value]);
  return <>{d}{suffix}</>;
}

/* ─── Radial Score ───────────────────────────────────────── */
function RadialScore({ value, size = 80 }: { value: number; size?: number }) {
  const color = value >= 75 ? '#10B981' : value >= 50 ? '#F59E0B' : '#EF4444';
  const data = [{ value, fill: color }];
  return (
    <div style={{ width: size, height: size }} className="relative">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart cx="50%" cy="50%" innerRadius="65%" outerRadius="90%"
          startAngle={225} endAngle={-45} data={data} barSize={8}>
          <RadialBar background={{ fill: 'currentColor' }} className="text-muted/30" dataKey="value" />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center flex-col">
        <span className="text-base font-bold font-mono leading-none" style={{ color }}>{value}%</span>
        <span className="text-[8px] text-muted-foreground mt-0.5">Rate</span>
      </div>
    </div>
  );
}

/* ─── Main Component ──────────────────────────────────────── */
export function MLADashboardView() {
  const { user } = useAuthStore();
  const constituency = user?.constituency || 'Unknown';
  const mlaName = user?.name || 'MLA';

  const [stats, setStats] = useState<ConstStats | null>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [alerts, setAlerts] = useState<IntelAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'complaints' | 'officers' | 'intelligence'>('overview');
  const [searchQ, setSearchQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [catFilter, setCatFilter] = useState('ALL');
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [statsRes, compRes, alertRes] = await Promise.all([
        fetch(`/api/mla/stats?constituency=${encodeURIComponent(constituency)}`, { headers: authHeaders() }),
        fetch(`/api/complaints?constituency=${encodeURIComponent(constituency)}&limit=100`, { headers: authHeaders() }),
        fetch(`/api/intelligence?constituency=${encodeURIComponent(constituency)}`, { headers: authHeaders() }),
      ]);

      if (statsRes.ok) {
        const d = await statsRes.json();
        setStats(d.data);
      }
      if (compRes.ok) {
        const d = await compRes.json();
        setComplaints(d.data || d.complaints || []);
      }
      if (alertRes.ok) {
        const d = await alertRes.json();
        setAlerts(d.data?.alerts || d.alerts || []);
      }
      setLastUpdated(new Date());
    } catch {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [constituency]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const iv = setInterval(() => load(true), 60000);
    return () => clearInterval(iv);
  }, [load]);

  /* ─── Mock / Fallback Stats ──────────────────────────── */
  const mockStats: ConstStats = {
    total: 21, active: 15, resolved: 6, registered: 10, in_progress: 5,
    critical: 0, resolution_rate: 28.6, avg_rating: 5.0,
    last_24h: 0, last_7d: 2,
    by_category: [
      { category: 'WATER', total: 8, resolved: 3 },
      { category: 'ROAD', total: 5, resolved: 2 },
      { category: 'HEALTH', total: 4, resolved: 1 },
      { category: 'OTHER', total: 4, resolved: 0 },
    ],
    by_block: [
      { block: 'Manbazar I', total: 12, active: 9 },
      { block: 'Puncha', total: 6, active: 4 },
      { block: 'Hura', total: 3, active: 2 },
    ],
    trend: [
      { date: 'Jan', filed: 2, resolved: 1 },
      { date: 'Feb', filed: 3, resolved: 1 },
      { date: 'Mar', filed: 5, resolved: 2 },
      { date: 'Apr', filed: 6, resolved: 1 },
      { date: 'May', filed: 8, resolved: 1 },
      { date: 'Jun', filed: 21, resolved: 6 },
    ],
    top_officers: [
      { name: 'Ramen Das', score: 82, resolved: 12, active: 3 },
      { name: 'Mita Roy', score: 71, resolved: 8, active: 5 },
      { name: 'Bikash Mahato', score: 64, resolved: 6, active: 7 },
    ],
  };

  const s = stats || mockStats;

  /* ─── Filtered complaints ────────────────────────────── */
  const filtered = complaints.filter(c => {
    const matchSearch = !searchQ || 
      c.ticketNo?.toLowerCase().includes(searchQ.toLowerCase()) ||
      c.citizenName?.toLowerCase().includes(searchQ.toLowerCase()) ||
      c.issue?.toLowerCase().includes(searchQ.toLowerCase());
    const matchStatus = statusFilter === 'ALL' || c.status === statusFilter;
    const matchCat = catFilter === 'ALL' || c.category === catFilter;
    return matchSearch && matchStatus && matchCat;
  });

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-4">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent mx-auto"
        />
        <p className="text-sm text-muted-foreground">Loading {constituency} data...</p>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gradient-to-br from-background via-background to-muted/20">

      {/* ── Header ───────────────────────────────────── */}
      <div className="flex-shrink-0 border-b bg-background/80 backdrop-blur-sm">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Building2 className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-base font-bold">{constituency} Constituency</h1>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-medium">
                    {mlaName}
                  </Badge>
                  {s.critical > 0 && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 animate-pulse">
                      {s.critical} Critical
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  MLA Dashboard &nbsp;·&nbsp; {s.by_block.length} Blocks
                  &nbsp;·&nbsp; Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              {([
                { id: 'overview',     label: '📊 Overview' },
                { id: 'complaints',   label: '📋 Complaints' },
                { id: 'officers',     label: '👤 Officers' },
                { id: 'intelligence', label: '🧠 Intel' },
              ] as const).map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}>
                  {tab.label}
                </button>
              ))}
            </div>

            <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="h-8 text-xs">
              <RefreshCw className={`w-3 h-3 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────── */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
        <AnimatePresence mode="wait">

        {/* ══ OVERVIEW TAB ══════════════════════════════ */}
        {activeTab === 'overview' && (
          <motion.div key="ov" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

            {/* KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {[
                { label: 'Total',       value: s.total,           color: 'text-foreground',     icon: FileText,     bg: 'bg-muted/60' },
                { label: 'Active',      value: s.active,          color: 'text-red-500',        icon: Activity,     bg: 'bg-red-500/8' },
                { label: 'Resolved',    value: s.resolved,        color: 'text-emerald-500',    icon: CheckCircle2, bg: 'bg-emerald-500/8' },
                { label: 'Registered',  value: s.registered,      color: 'text-blue-500',       icon: CircleDot,    bg: 'bg-blue-500/8' },
                { label: 'In Progress', value: s.in_progress,     color: 'text-amber-500',      icon: Timer,        bg: 'bg-amber-500/8' },
                { label: 'Critical',    value: s.critical,        color: 'text-red-600',        icon: AlertTriangle,bg: 'bg-red-600/8' },
                { label: 'Last 7 Days', value: s.last_7d,         color: 'text-violet-500',     icon: CalendarRange,bg: 'bg-violet-500/8' },
              ].map((k, i) => (
                <motion.div key={k.label} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}>
                  <Card className={`border-0 shadow-sm ${k.bg} backdrop-blur`}>
                    <CardContent className="p-3">
                      <k.icon className={`w-3.5 h-3.5 ${k.color} mb-2`} />
                      <div className={`text-2xl font-bold font-mono leading-none mb-1 ${k.color}`}>
                        <AnimNum value={k.value} />
                      </div>
                      <div className="text-[10px] text-muted-foreground font-medium leading-tight">{k.label}</div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>

            {/* Main grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* Resolution Score + Trend */}
              <Card className="lg:col-span-2 border-0 shadow-sm bg-card/60 backdrop-blur">
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-muted-foreground" />
                      Complaint Trend
                    </CardTitle>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                        <span className="text-muted-foreground">Filed</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="text-muted-foreground">Resolved</span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <ChartContainer className="h-[160px]" config={{ filed: { label: 'Filed', color: '#3B82F6' }, resolved: { label: 'Resolved', color: '#10B981' } }}>
                    <AreaChart data={s.trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="gF" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="filed" stroke="#3B82F6" strokeWidth={2} fill="url(#gF)" />
                      <Area type="monotone" dataKey="resolved" stroke="#10B981" strokeWidth={2} fill="url(#gR)" />
                    </AreaChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              {/* Resolution Score */}
              <Card className="border-0 shadow-sm bg-card/60 backdrop-blur">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Target className="w-4 h-4 text-muted-foreground" />
                    Performance
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 flex flex-col items-center gap-4">
                  <RadialScore value={Math.round(s.resolution_rate)} size={100} />
                  <div className="w-full space-y-2">
                    {[
                      { label: 'Resolved', value: s.resolved, total: s.total, color: '#10B981' },
                      { label: 'Active', value: s.active, total: s.total, color: '#EF4444' },
                    ].map(m => (
                      <div key={m.label} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{m.label}</span>
                          <span className="font-mono">{m.value}/{m.total}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ background: m.color }}
                            initial={{ width: 0 }}
                            animate={{ width: `${(m.value / Math.max(m.total, 1)) * 100}%` }}
                            transition={{ duration: 0.8 }}
                          />
                        </div>
                      </div>
                    ))}
                    {s.avg_rating && (
                      <div className="flex items-center justify-between pt-1 border-t border-border/50">
                        <span className="text-xs text-muted-foreground">Citizen Rating</span>
                        <div className="flex items-center gap-1">
                          {[1,2,3,4,5].map(n => (
                            <div key={n} className={`w-2.5 h-2.5 rounded-sm ${n <= Math.round(s.avg_rating!) ? 'bg-amber-400' : 'bg-muted'}`} />
                          ))}
                          <span className="text-xs font-mono ml-1">{s.avg_rating}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Category + Block breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Category breakdown */}
              <Card className="border-0 shadow-sm bg-card/60 backdrop-blur">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-muted-foreground" />
                    Issue Categories
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2.5">
                  {s.by_category.map((cat, i) => {
                    const cfg = CAT_CONFIG[cat.category] || CAT_CONFIG.OTHER;
                    const rate = Math.round((cat.resolved / Math.max(cat.total, 1)) * 100);
                    return (
                      <motion.div key={cat.category} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                        className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-lg ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
                          <cfg.icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-medium">{cfg.label}</span>
                            <span className="text-muted-foreground font-mono">{cat.resolved}/{cat.total}</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <motion.div
                              className="h-full rounded-full"
                              style={{ background: cfg.color.replace('text-', '').replace('-500', '') === 'blue' ? '#3B82F6' : 
                                cfg.color.includes('amber') ? '#F59E0B' :
                                cfg.color.includes('red') ? '#EF4444' :
                                cfg.color.includes('emerald') || cfg.color.includes('green') ? '#10B981' :
                                cfg.color.includes('cyan') ? '#06B6D4' : '#8B5CF6' }}
                              initial={{ width: 0 }}
                              animate={{ width: `${rate}%` }}
                              transition={{ duration: 0.7, delay: i * 0.05 }}
                            />
                          </div>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground w-8 text-right">{rate}%</span>
                      </motion.div>
                    );
                  })}
                </CardContent>
              </Card>

              {/* Block breakdown */}
              <Card className="border-0 shadow-sm bg-card/60 backdrop-blur">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    Block-wise Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2.5">
                  {s.by_block.map((blk, i) => {
                    const activeRate = (blk.active / Math.max(blk.total, 1)) * 100;
                    return (
                      <motion.div key={blk.block} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                        className="p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-semibold">{blk.block}</span>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-red-500 font-mono">{blk.active} active</span>
                            <span className="text-muted-foreground">/ {blk.total} total</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-red-500 to-amber-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${activeRate}%` }}
                            transition={{ duration: 0.7, delay: i * 0.05 }}
                          />
                        </div>
                        <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                          <span>{Math.round(activeRate)}% active</span>
                          <span>{blk.total - blk.active} resolved</span>
                        </div>
                      </motion.div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}

        {/* ══ COMPLAINTS TAB ════════════════════════════ */}
        {activeTab === 'complaints' && (
          <motion.div key="comp" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">

            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input value={searchQ} onChange={e => setSearchQ(e.target.value)}
                  placeholder="Search ticket, name, issue..." className="pl-8 h-8 text-xs" />
                {searchQ && <button onClick={() => setSearchQ('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X className="w-3.5 h-3.5 text-muted-foreground" /></button>}
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 text-xs w-32"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Status</SelectItem>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger className="h-8 text-xs w-32"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Categories</SelectItem>
                  {Object.entries(CAT_CONFIG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground ml-auto">{filtered.length} complaints</span>
            </div>

            {/* Table */}
            {filtered.length > 0 ? (
              <Card className="border-0 shadow-sm bg-card/60 backdrop-blur overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs w-[130px]">Ticket</TableHead>
                      <TableHead className="text-xs">Citizen</TableHead>
                      <TableHead className="text-xs">Issue</TableHead>
                      <TableHead className="text-xs">Block</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Urgency</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs">Officer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.slice(0, 50).map((c, i) => {
                      const st = STATUS_CONFIG[c.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.REGISTERED;
                      const urg = URGENCY_CONFIG[c.urgency as keyof typeof URGENCY_CONFIG] || URGENCY_CONFIG.MEDIUM;
                      const cat = CAT_CONFIG[c.category as keyof typeof CAT_CONFIG] || CAT_CONFIG.OTHER;
                      return (
                        <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                          className="hover:bg-muted/30 transition-colors cursor-pointer border-b border-border/40">
                          <TableCell className="py-2.5 font-mono text-[11px] text-primary">{c.ticketNo}</TableCell>
                          <TableCell className="py-2.5 text-xs font-medium max-w-[100px] truncate">{c.citizenName}</TableCell>
                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-1.5">
                              <cat.icon className={`w-3 h-3 ${cat.color} flex-shrink-0`} />
                              <span className="text-xs truncate max-w-[120px]">{c.issue}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-xs text-muted-foreground">{c.block}</TableCell>
                          <TableCell className="py-2.5">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                              {st.label}
                            </span>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${urg.bg} ${urg.color}`}>
                              {urg.label}
                            </span>
                          </TableCell>
                          <TableCell className="py-2.5 text-[11px] text-muted-foreground">{fmtDate(c.createdAt)}</TableCell>
                          <TableCell className="py-2.5 text-xs text-muted-foreground truncate max-w-[100px]">
                            {c.assignedOfficerName || '—'}
                          </TableCell>
                        </motion.tr>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                  <FileText className="w-6 h-6 text-muted-foreground" />
                </div>
                <div className="font-medium text-sm mb-1">
                  {complaints.length === 0 ? 'No complaints yet' : 'No results'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {complaints.length === 0 ? `${constituency} mein abhi koi complaint nahi aayi` : 'Try changing your filters'}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ══ OFFICERS TAB ══════════════════════════════ */}
        {activeTab === 'officers' && (
          <motion.div key="off" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-500" />
                Officer Performance — {constituency}
              </h2>
              <span className="text-xs text-muted-foreground">Score = 40% resolution + 30% rating + 30% SLA</span>
            </div>

            {s.top_officers.length > 0 ? (
              <div className="space-y-2">
                {s.top_officers.map((off, i) => {
                  const medals = ['🥇', '🥈', '🥉'];
                  const scoreColor = off.score >= 75 ? 'text-emerald-500' : off.score >= 50 ? 'text-amber-500' : 'text-red-500';
                  return (
                    <motion.div key={off.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}
                      className="flex items-center gap-3 p-3 rounded-xl border border-border/60 bg-card/60 backdrop-blur">
                      <div className="text-xl w-8 text-center">{i < 3 ? medals[i] : <span className="text-xs text-muted-foreground">#{i+1}</span>}</div>
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                        {off.name.charAt(0)}
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-sm">{off.name}</div>
                        <div className="flex items-center gap-3 mt-1">
                          <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                            <motion.div
                              className="h-full rounded-full"
                              style={{ background: off.score >= 75 ? '#10B981' : off.score >= 50 ? '#F59E0B' : '#EF4444' }}
                              initial={{ width: 0 }}
                              animate={{ width: `${off.score}%` }}
                              transition={{ duration: 0.8, delay: i * 0.08 }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <div className={`text-lg font-bold font-mono ${scoreColor}`}>{off.score}</div>
                          <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Score</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold font-mono text-emerald-500">{off.resolved}</div>
                          <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Resolved</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold font-mono text-red-500">{off.active}</div>
                          <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Active</div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-20 text-muted-foreground text-sm">
                No officer data available yet
              </div>
            )}
          </motion.div>
        )}

        {/* ══ INTELLIGENCE TAB ══════════════════════════ */}
        {activeTab === 'intelligence' && (
          <motion.div key="intel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-violet-500" />
                AI Intelligence — {constituency}
              </h2>
              <Badge variant="outline" className="text-[10px]">Runs every 6h</Badge>
            </div>

            {alerts.length > 0 ? (
              <div className="space-y-3">
                {alerts.map((alert, i) => {
                  const sevColor = alert.severity >= 80 ? 'text-red-500' : alert.severity >= 60 ? 'text-amber-500' : 'text-blue-500';
                  const sevBg = alert.severity >= 80 ? 'bg-red-500/8 border-red-200 dark:border-red-900' : alert.severity >= 60 ? 'bg-amber-500/8 border-amber-200 dark:border-amber-900' : 'bg-blue-500/8 border-blue-200 dark:border-blue-900';
                  return (
                    <motion.div key={alert.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                      className={`p-4 rounded-xl border ${sevBg} space-y-2`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <ShieldAlert className={`w-4 h-4 ${sevColor} flex-shrink-0`} />
                          <span className="font-semibold text-sm">{alert.title}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono font-bold ${sevColor}`}>{alert.severity}/100</span>
                          <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${alert.severity}%`, background: alert.severity >= 80 ? '#EF4444' : alert.severity >= 60 ? '#F59E0B' : '#3B82F6' }} />
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{alert.summary}</p>
                      {alert.recommended_action && (
                        <div className="text-xs bg-background/60 rounded-lg px-3 py-2 border border-border/40">
                          <span className="font-medium text-foreground">Recommended: </span>
                          <span className="text-muted-foreground">{alert.recommended_action}</span>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                  <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                </div>
                <div className="font-semibold text-sm mb-1">All Clear — {constituency}</div>
                <div className="text-xs text-muted-foreground max-w-xs">
                  No active threats detected. Intelligence engine monitoring all blocks every 6 hours.
                </div>
              </div>
            )}
          </motion.div>
        )}

        </AnimatePresence>
        </div>
      </ScrollArea>
    </div>
  );
}
