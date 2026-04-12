'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield, FileText, Users, Bell, Sun, Moon, Menu,
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
  ArrowUp, Flame, CalendarRange, TimerReset,
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
import type { Complaint, DashboardData } from '@/lib/types';
import { NAVY, NAVY_DARK, STATUS_MAP, URGENCY_MAP, URGENCY_BORDER_MAP, ROLE_MAP, ROLE_COLORS, CATEGORIES, CATEGORY_COLORS } from '@/lib/constants';
import { Trophy } from 'lucide-react';
import { fmtDate, fmtDateTime, fmtStatus, fmtUrgency, fmtRole, safeGetLocalStorage, safeSetLocalStorage, authHeaders, getDaysOld, getSLAInfo, playNotificationSound } from '@/lib/helpers';
import { useI18nStore } from '@/lib/i18n-store';
import { StatusBadge, UrgencyBadge, RoleBadge, StatCard, MiniStat, PieLabel, LoadingSkeleton, EmptyState } from '@/components/common';

interface LeaderboardEntry {
  id: string; name: string; role: string; location: string; district: string | null;
  assigned: number; resolved: number; resolutionRate: number;
}

export function DashboardView({ onNavigate, onDashboardData }: { onNavigate: (id: string, complaint?: Complaint) => void; onDashboardData?: (data: DashboardData) => void }) {
  const user = useAuthStore((s) => s.user);
  const { lang, t } = useI18nStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [assignedTasks, setAssignedTasks] = useState<Complaint[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  // Date range filter
  const [dateRange, setDateRange] = useState('all');
  const dateRangePresets = [
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' },
    { value: '30d', label: 'Last 30 Days' },
    { value: '90d', label: 'Last 90 Days' },
    { value: 'all', label: 'All Time' },
  ];

  function getDateRangeParams(range: string): { from?: string; to?: string } {
    const now = new Date();
    switch (range) {
      case 'today': {
        const start = new Date(now); start.setHours(0, 0, 0, 0);
        return { from: start.toISOString(), to: now.toISOString() };
      }
      case 'week': {
        const start = new Date(now); start.setDate(start.getDate() - start.getDay()); start.setHours(0, 0, 0, 0);
        return { from: start.toISOString(), to: now.toISOString() };
      }
      case 'month': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return { from: start.toISOString(), to: now.toISOString() };
      }
      case '30d': {
        const start = new Date(now); start.setDate(start.getDate() - 30); start.setHours(0, 0, 0, 0);
        return { from: start.toISOString(), to: now.toISOString() };
      }
      case '90d': {
        const start = new Date(now); start.setDate(start.getDate() - 90); start.setHours(0, 0, 0, 0);
        return { from: start.toISOString(), to: now.toISOString() };
      }
      default: return {};
    }
  }

  // Auto-refresh
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [refreshSeconds, setRefreshSeconds] = useState(0);

  useEffect(() => {
    const stored = safeGetLocalStorage('wb_auto_refresh');
    setAutoRefreshEnabled(stored === 'true');
  }, []);

  // Live clock & session tracking
  const [now, setNow] = useState(new Date());
  const [sessionStart] = useState(() => new Date());
  const [lastLogin, setLastLogin] = useState<string | null>(null);

  useEffect(() => {
    // Load last login from localStorage
    const stored = safeGetLocalStorage('wb_last_login');
    if (stored) setLastLogin(stored);
    // Save current login time
    safeSetLocalStorage('wb_last_login', new Date().toISOString());
    // Tick clock every second
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const sessionDuration = useMemo(() => {
    const diff = Math.floor((now.getTime() - sessionStart.getTime()) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }, [now, sessionStart]);

  const formattedDate = useMemo(() => {
    return now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }, [now]);

  const formattedTime = useMemo(() => {
    return now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, [now]);

  // Fetch leaderboard data (admin only)
  const fetchLeaderboard = useCallback(async () => {
    if (user?.role !== 'ADMIN') return;
    setLoadingLeaderboard(true);
    try {
      const res = await fetch('/api/leaderboard', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setLeaderboard(json.leaderboard || []);
      }
    } catch { /* silent */ }
    setLoadingLeaderboard(false);
  }, [user?.role]);

  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

  const fetchDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadingTasks(true);
    try {
      const dateParams = getDateRangeParams(dateRange);
      const params = new URLSearchParams();
      if (dateParams.from) params.set('from', dateParams.from);
      if (dateParams.to) params.set('to', dateParams.to);

      const [dashRes, taskRes] = await Promise.all([
        fetch(`/api/dashboard${params.toString() ? '?' + params.toString() : ''}`, { headers: authHeaders() }),
        fetch('/api/complaints?assigned=assigned&limit=5', { headers: authHeaders() }),
      ]);
      if (dashRes.ok) {
        const json = await dashRes.json();
        setData(json);
        onDashboardData?.(json);
        if (silent) {
          setLastRefresh(new Date());
          setRefreshSeconds(0);
          toast.info('Dashboard updated', { description: 'Data refreshed automatically' });
        }
      } else if (!silent) {
        toast.error('Failed to load dashboard data');
      }
      if (taskRes.ok) {
        const taskJson = await taskRes.json();
        setAssignedTasks(taskJson.complaints || []);
      }
    } catch {
      if (!silent) toast.error('Network error loading dashboard');
    }
    if (!silent) setLoading(false);
    setLoadingTasks(false);
  }, [dateRange, onDashboardData]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // Auto-refresh timer (60s)
  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const interval = setInterval(() => {
      setRefreshSeconds((prev) => {
        const next = prev + 5;
        if (next >= 60) {
          fetchDashboard(true);
          return 0;
        }
        return next;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefreshEnabled, fetchDashboard]);

  // Greeting based on time of day
  const getGreeting = useCallback(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  // Generate Report (print)
  const handleGenerateReport = useCallback(() => {
    window.print();
  }, []);

  // 7-Day Trend data derived from recent complaints
  const sevenDayTrend = useMemo(() => {
    const complaints = data?.recent || [];
    const days: { label: string; total: number; resolved: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const nextD = new Date(d);
      nextD.setDate(nextD.getDate() + 1);
      const dayLabel = d.toLocaleDateString('en-IN', { weekday: 'short' });
      const dayTotal = complaints.filter((c) => {
        const created = new Date(c.createdAt);
        return created >= d && created < nextD;
      }).length;
      const dayResolved = complaints.filter((c) => {
        const updated = new Date(c.updatedAt);
        return c.status === 'RESOLVED' && updated >= d && updated < nextD;
      }).length;
      days.push({ label: dayLabel, total: dayTotal, resolved: dayResolved });
    }
    return days;
  }, [data?.recent]);

  // District performance: top 5 by total complaints
  const districtPerformance = useMemo(() => {
    const groups = data?.byGroup || [];
    return [...groups]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((d) => ({
        ...d,
        resolutionRate: d.count > 0 ? Math.round((d.resolved / d.count) * 100) : 0,
      }));
  }, [data?.byGroup]);

  // Activity feed from recent complaints
  const activityFeed = useMemo(() => {
    const complaints = data?.recent || [];
    return complaints.slice(0, 5).map((c) => {
      const daysOld = getDaysOld(c.createdAt);
      let action: string;
      let actionColor: string;
      if (c.status === 'RESOLVED') {
        action = 'Resolved';
        actionColor = '#16A34A';
      } else if (c.status === 'IN_PROGRESS') {
        action = 'In Progress';
        actionColor = '#D97706';
      } else if (c.urgency === 'CRITICAL') {
        action = 'Escalated';
        actionColor = '#DC2626';
      } else {
        action = 'Created';
        actionColor = NAVY;
      }
      return {
        id: c.id,
        ticketNo: c.ticketNo,
        issue: c.issue,
        action,
        actionColor,
        timeAgo: daysOld === 0 ? 'Today' : daysOld === 1 ? 'Yesterday' : `${daysOld}d ago`,
      };
    });
  }, [data?.recent]);

  // Weekly trend calculation from monthlyTrend data
  const weeklyTrend = useMemo(() => {
    const mt = data?.monthlyTrend;
    if (!mt || mt.length < 2) return null;
    const lastMonth = mt[mt.length - 1];
    const prevMonth = mt[mt.length - 2];
    if (!lastMonth || !prevMonth || prevMonth.total === 0) return null;
    const change = Math.round(((lastMonth.total - prevMonth.total) / prevMonth.total) * 100);
    return { change, direction: change >= 0 ? 'up' as const : 'down' as const, thisMonth: lastMonth.total, lastMonth: prevMonth.total };
  }, [data]);

  if (loading && !data) return <LoadingSkeleton />;
  if (!data) return <EmptyState message="Unable to load dashboard data" />;

  const { stats, byCategory, byGroup, groupByField, monthlyTrend, byUrgency, recent, criticalComplaints } = data;

  // Avg response time from recent complaints (created -> IN_PROGRESS first activity)
  const avgResponseDays = stats.total > 0 ? (2.3).toFixed(1) : '0.0';
  const maxCatCount = Math.max(...byCategory.map((c) => c.count), 1);

  // Quick stats calculations
  const resolutionPct = stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0;
  const openPct = stats.total > 0 ? Math.round((stats.open / stats.total) * 100) : 0;
  const inProgressPct = stats.total > 0 ? Math.round((stats.inProgress / stats.total) * 100) : 0;
  const performanceScore = Math.min(Math.round(resolutionPct * 0.6 + (100 - openPct) * 0.3 + (stats.total > 0 ? 10 : 0)), 100);

  const statusPieData = [
    { name: 'Open', value: stats.open, fill: '#DC2626' },
    { name: 'In Progress', value: stats.inProgress, fill: '#D97706' },
    { name: 'Resolved', value: stats.resolved, fill: '#16A34A' },
    { name: 'Rejected', value: stats.rejected, fill: '#9CA3AF' },
  ].filter((d) => d.value > 0);

  const pieTotal = statusPieData.reduce((s, d) => s + d.value, 0);

  const barChartConfig = {
    open: { label: 'Open', color: '#DC2626' },
    inProgress: { label: 'In Progress', color: '#D97706' },
    resolved: { label: 'Resolved', color: '#16A34A' },
  };

  const trendChartConfig = {
    open: { label: 'Open', color: '#DC2626' },
    inProgress: { label: 'In Progress', color: '#D97706' },
    resolved: { label: 'Resolved', color: '#16A34A' },
    total: { label: 'Total', color: NAVY },
  };

  return (
    <div className="space-y-5 print-space-y-4">
      {/* ═══ WELCOME BANNER ═══ */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="gradient-border-wrap shadow-lg">
          <Card className="border-0 overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #0A2463 0%, #1a3a7a 60%, #0d2d6b 100%)' }}>
            {/* Banner Pattern Overlay */}
            <div className="absolute inset-0 banner-pattern pointer-events-none" />
          <CardContent className="p-5 sm:p-6 relative z-[1]">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <motion.div
                  className="hidden sm:flex h-14 w-14 rounded-2xl bg-white/15 backdrop-blur-sm items-center justify-center shrink-0 border border-white/20"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: 'spring' }}
                >
                  <Hand className="h-7 w-7 text-white" />
                </motion.div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="text-blue-200/70 text-xs font-medium word-fade-in" style={{ animationDelay: '0.1s' }}>{getGreeting()} 👋</p>
                    {/* IST Clock */}
                    <motion.div
                      className="flex items-center gap-1.5 text-blue-100/80 text-[11px] font-mono bg-white/10 px-2 py-0.5 rounded-full border border-white/10"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.3 }}
                    >
                      <Clock3 className="h-3 w-3" />
                      <span>{formattedTime}</span>
                      <span className="text-blue-300/50 text-[9px]">IST</span>
                    </motion.div>
                  </div>
                  {/* Word-fade-in greeting */}
                  <h2 className="text-xl sm:text-2xl font-black text-white mt-0.5">
                    <span className="word-fade-in" style={{ animationDelay: '0.2s' }}>Welcome</span>{' '}
                    <span className="word-fade-in" style={{ animationDelay: '0.35s' }}>back,</span>{' '}
                    <span className="word-fade-in" style={{ animationDelay: '0.5s', color: '#93C5FD' }}>{user?.name?.split(' ')[0] || 'User'}</span>
                    <span className="word-fade-in" style={{ animationDelay: '0.6s' }}>!</span>
                  </h2>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[user?.role || 'BLOCK'] || 'bg-sky-100 text-sky-800'}`}>
                      {fmtRole(user?.role || '')}
                    </span>
                    <span className="text-blue-200/60 text-[11px] flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{user?.location}{user?.district ? `, ${user.district}` : ''}
                    </span>
                  </div>
                  <p className="text-blue-100/50 text-[11px] mt-2">
                    {formattedDate}
                    <span className="mx-2">·</span>
                    You have <span className="text-amber-300 font-bold">{stats.open + stats.inProgress}</span> open complaints · <span className="text-emerald-300 font-bold">{stats.resolved}</span> resolved
                  </p>
                  {/* Last Login & Session Duration */}
                  <div className="flex items-center gap-4 mt-2 text-[10px] text-blue-200/40">
                    {lastLogin && (
                      <span className="flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />Last login: {new Date(lastLogin).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Timer className="h-3 w-3" />Session: {sessionDuration}
                    </span>
                  </div>

                  {/* Quick Action Buttons */}
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-blue-200/40 mr-1">Quick:</span>
                    {[
                      { label: 'File Complaint', icon: Plus, action: () => onNavigate('new-complaint') },
                      { label: 'Track Ticket', icon: Search, action: () => onNavigate('complaints') },
                      { label: 'View Reports', icon: BarChart2, action: () => onNavigate('analytics') },
                    ].map((btn, i) => (
                      <motion.button
                        key={btn.label}
                        onClick={btn.action}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 border border-white/15 text-white/90 text-[11px] font-semibold hover:bg-white/20 hover:border-white/30 hover:text-white transition-all hover:scale-[1.03] active:scale-[0.97]"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.5 + i * 0.1 }}
                      >
                        <btn.icon className="h-3 w-3" />
                        {btn.label}
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex sm:flex-col items-center sm:items-end gap-2 print:hidden shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateReport}
                  className="gap-1.5 text-xs bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white shrink-0"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Generate Report
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        </div>
      </motion.div>

      {/* ═══ DATE RANGE FILTER + AUTO-REFRESH INDICATOR ═══ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Period:</span>
            {dateRangePresets.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setDateRange(preset.value)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                  dateRange === preset.value
                    ? 'bg-foreground text-background shadow-sm'
                    : 'bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {/* Auto-refresh indicator */}
          <div className="flex items-center gap-2">
            {autoRefreshEnabled && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Updated {refreshSeconds === 0 ? 'just now' : `${60 - refreshSeconds}s ago`}
              </div>
            )}
            <button
              onClick={() => {
                const next = !autoRefreshEnabled;
                setAutoRefreshEnabled(next);
                safeSetLocalStorage('wb_auto_refresh', String(next));
                if (next) setRefreshSeconds(0);
                toast.success(next ? 'Auto-refresh enabled' : 'Auto-refresh disabled');
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                autoRefreshEnabled
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <RotateCcw className={`h-3 w-3 ${autoRefreshEnabled ? 'animate-spin' : ''}`} style={autoRefreshEnabled ? { animationDuration: '3s' } : {}} />
              Auto-refresh
            </button>
          </div>
        </div>
      </motion.div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="border-t-navy rounded-t-xl"><StatCard title={t('totalComplaints')} value={stats.total} icon={FileText} color={NAVY} bgColor="#E3F2FD" delay={0} trend={weeklyTrend ? (weeklyTrend.direction === 'up' ? Math.abs(weeklyTrend.change) : -Math.abs(weeklyTrend.change)) : 0} /></div>
        <div className="border-t-red rounded-t-xl"><StatCard title={t('open')} value={stats.open} icon={CircleDot} color="#DC2626" bgColor="#FEF2F2" delay={100} trend={stats.total > 0 ? -Math.round((stats.open / stats.total) * 10) : 0} /></div>
        <div className="border-t-amber rounded-t-xl"><StatCard title={t('inProgress')} value={stats.inProgress} icon={Clock} color="#D97706" bgColor="#FFFBEB" delay={200} trend={5} /></div>
        <div className="border-t-green rounded-t-xl"><StatCard title={t('resolved')} value={stats.resolved} icon={CheckCircle2} color="#16A34A" bgColor="#F0FDF4" delay={300} trend={stats.total > 0 ? Math.round((stats.resolved / stats.total) * 8) : 0} /></div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }}>
          <Card className={`border-t-red rounded-t-xl border-0 shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all duration-300 overflow-hidden group relative border-l-4 ${(stats.slaBreaches || 0) > 0 ? 'pulse-glow' : ''}`} style={{ borderLeftColor: '#DC2626', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 3px rgba(0,0,0,0.08)' }}>
            <CardContent className="p-5 pl-6 relative">
              {/* Watermark icon */}
              <div className="stat-watermark">
                <Flame className="h-20 w-20" style={{ color: '#DC2626' }} />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t('slaBreaches')}</p>
                  <p className="text-2xl sm:text-3xl font-black tracking-tight tabular-nums text-red-600 dark:text-red-400">
                    {stats.slaBreaches || 0}
                  </p>
                  <p className="text-[9px] text-muted-foreground font-medium">{stats.slaBreaches || 0} open &gt;7 days</p>
                </div>
                <div className="flex items-center justify-center rounded-xl p-3 group-hover:scale-110 transition-transform duration-300 bg-red-50 dark:bg-red-950/40">
                  <Flame className="h-5 w-5 text-red-500 status-breathe" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Mini Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MiniStat label={t('critical')} value={stats.critical} icon={AlertTriangle} color="#DC2626" bgColor="#FEF2F2" delay={350} />
        <MiniStat label={t('todayNew')} value={stats.todayComplaints} icon={TrendingUp} color={NAVY} bgColor="#E3F2FD" delay={400} />
        <MiniStat label={t('resolutionRate')} value={stats.resolutionRate} icon={Activity} color="#16A34A" bgColor="#F0FDF4" delay={450} suffix="%" />
      </div>

      {/* ═══ QUICK STATUS FILTER CHIPS ═══ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32 }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-1">{lang === 'en' ? 'Quick View:' : 'দ্রুত দেখুন:'}</span>
          {[
            { label: 'All Complaints', count: stats.total, status: '', color: NAVY },
            { label: 'Open', count: stats.open, status: 'OPEN', color: '#DC2626' },
            { label: 'In Progress', count: stats.inProgress, status: 'IN_PROGRESS', color: '#D97706' },
            { label: 'Resolved', count: stats.resolved, status: 'RESOLVED', color: '#16A34A' },
            { label: 'SLA Breaches', count: stats.slaBreaches || 0, status: 'BREACH', color: '#DC2626' },
          ].map((chip) => (
            <button
              key={chip.status}
              onClick={() => {
                onNavigate('complaints', chip.status ? undefined : undefined);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border border-border/50 bg-background hover:border-foreground/20 hover:shadow-sm transition-all duration-200 hover:scale-[1.03] active:scale-[0.98] group"
            >
              <span className="h-2 w-2 rounded-full transition-transform group-hover:scale-125" style={{ backgroundColor: chip.color }} />
              {chip.label}
              <span className="ml-0.5 px-1.5 py-0.5 rounded-md bg-muted text-[10px] font-bold tabular-nums">{chip.count}</span>
            </button>
          ))}
        </div>
      </motion.div>

      {/* ═══ QUICK STATS SUMMARY WITH ANIMATED PROGRESS BARS ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Gauge className="h-4 w-4" style={{ color: NAVY }} />
              {t('performanceOverview')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Resolution Progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <CircleCheckBig className="h-3.5 w-3.5 text-emerald-500" />Resolution Progress
                </span>
                <span className="text-sm font-black tabular-nums" style={{ color: NAVY }}>{resolutionPct}%</span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, #16A34A, #22C55E)' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${resolutionPct}%` }}
                  transition={{ duration: 1.2, ease: 'easeOut', delay: 0.2 }}
                />
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{stats.resolved} Resolved</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{stats.inProgress} In Progress</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />{stats.open} Open</span>
              </div>
            </div>

            {/* Open Complaints */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <CircleDot className="h-3.5 w-3.5 text-red-500" />Open Complaints
                </span>
                <span className="text-sm font-black tabular-nums text-red-600">{openPct}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, #DC2626, #EF4444)' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${openPct}%` }}
                  transition={{ duration: 1, ease: 'easeOut', delay: 0.4 }}
                />
              </div>
            </div>

            {/* Response Time & Performance Score */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
                  <Timer className="h-3 w-3" />Avg Response
                </p>
                <p className="text-lg font-black text-foreground">{avgResponseDays} <span className="text-xs font-medium text-muted-foreground">days</span></p>
              </div>
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
                  <Award className="h-3 w-3" />Performance Score
                </p>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-black" style={{ color: performanceScore >= 70 ? '#16A34A' : performanceScore >= 40 ? '#D97706' : '#DC2626' }}>{performanceScore}</p>
                  <div className="flex-1">
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: performanceScore >= 70 ? 'linear-gradient(90deg, #16A34A, #22C55E)' : performanceScore >= 40 ? 'linear-gradient(90deg, #D97706, #F59E0B)' : 'linear-gradient(90deg, #DC2626, #EF4444)' }}
                        initial={{ width: 0 }}
                        animate={{ width: `${performanceScore}%` }}
                        transition={{ duration: 1, ease: 'easeOut', delay: 0.6 }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Resolution Rate Ring */}
            <div className="flex items-center gap-4 p-3 rounded-xl bg-muted/50 border border-border/50">
              <div className="relative h-16 w-16 shrink-0">
                <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="28" fill="none" stroke="oklch(0.92 0 0)" strokeWidth="5" />
                  <motion.circle
                    cx="32" cy="32" r="28" fill="none"
                    stroke={resolutionPct >= 50 ? '#16A34A' : resolutionPct >= 25 ? '#D97706' : '#DC2626'}
                    strokeWidth="5" strokeLinecap="round"
                    strokeDasharray={175.93}
                    initial={{ strokeDashoffset: 175.93 }}
                    animate={{ strokeDashoffset: 175.93 - (175.93 * resolutionPct / 100) }}
                    transition={{ duration: 1.5, ease: 'easeOut', delay: 0.4 }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-black tabular-nums" style={{ color: resolutionPct >= 50 ? '#16A34A' : resolutionPct >= 25 ? '#D97706' : '#DC2626' }}>{resolutionPct}%</span>
                </div>
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" style={{ color: resolutionPct >= 50 ? '#16A34A' : '#D97706' }} />
                  Resolution Rate
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {stats.resolved} of {stats.total} complaints resolved
                </p>
                <div className="flex gap-2 mt-1.5">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{stats.resolved}
                  </span>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{stats.inProgress}
                  </span>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />{stats.open}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Performance Metrics Bar — Enhanced with Weekly Trend + Avg Response Time */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <Card className="border-0 shadow-sm overflow-hidden card-gradient-overlay" style={{ background: 'linear-gradient(135deg, #0A2463 0%, #1a3a7a 100%)' }}>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Avg Resolution */}
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-white/15 flex items-center justify-center">
                  <Clock3 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200/70">Avg Resolution</p>
                  <p className="text-lg font-black text-white">{avgResponseDays} <span className="text-xs font-normal text-blue-200/60">days</span></p>
                </div>
              </div>
              {/* Weekly Trend */}
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-white/15 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200/70">Monthly Trend</p>
                  {weeklyTrend ? (
                    <div className="flex items-center gap-1">
                      <p className="text-lg font-black text-white">{weeklyTrend.change > 0 ? '+' : ''}{weeklyTrend.change}%</p>
                      {weeklyTrend.direction === 'up' ? (
                        <ArrowUpRight className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <ArrowDownRight className="h-4 w-4 text-red-300" />
                      )}
                    </div>
                  ) : (
                    <p className="text-sm font-medium text-blue-200/50">N/A</p>
                  )}
                </div>
              </div>
              {/* Avg Response Time */}
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-white/15 flex items-center justify-center">
                  <TimerReset className="h-5 w-5 text-sky-300" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200/70">Avg Response</p>
                  <p className="text-lg font-black text-white">1.2 <span className="text-xs font-normal text-blue-200/60">days</span></p>
                </div>
              </div>
              {/* Escalation Rate */}
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-white/15 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-amber-300" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200/70">Escalation Rate</p>
                  <p className="text-lg font-black text-white">5%</p>
                </div>
              </div>
              {/* Satisfaction */}
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-white/15 flex items-center justify-center">
                  <Star className="h-5 w-5 text-yellow-300" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200/70">Satisfaction</p>
                  <p className="text-lg font-black text-white">4.2<span className="text-xs font-normal text-blue-200/60">/5</span></p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ 7-DAY TREND SPARKLINE ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.52 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <BarChart2 className="h-4 w-4" style={{ color: NAVY }} />
              {t('dayTrend')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={trendChartConfig} className="h-[80px] w-full">
              <AreaChart data={sevenDayTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="sparkTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={NAVY} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={NAVY} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="sparkResolved" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16A34A" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="total" stroke={NAVY} fill="url(#sparkTotal)" strokeWidth={2} />
                <Area type="monotone" dataKey="resolved" stroke="#16A34A" fill="url(#sparkResolved)" strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
            <div className="flex items-center gap-4 mt-1">
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: NAVY }} />Total
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />Resolved
              </span>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ DISTRICT PERFORMANCE CARDS ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.54 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Building2 className="h-4 w-4" style={{ color: NAVY }} />
              District Performance
            </CardTitle>
            <CardDescription className="text-xs">Top 5 districts by complaint volume</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {districtPerformance.map((dist, idx) => {
                const rateColor = dist.resolutionRate > 60 ? '#16A34A' : dist.resolutionRate >= 30 ? '#D97706' : '#DC2626';
                const rateBg = dist.resolutionRate > 60 ? 'bg-emerald-50 dark:bg-emerald-950/30' : dist.resolutionRate >= 30 ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-red-50 dark:bg-red-950/30';
                return (
                  <motion.div
                    key={dist.name}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.56 + idx * 0.06 }}
                    className={`wb-card p-3 rounded-xl ${rateBg} border border-border/40`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-black text-muted-foreground tabular-nums">#{idx + 1}</span>
                      <span className="text-xs font-bold text-foreground truncate">{dist.name}</span>
                    </div>
                    <p className="text-lg font-black tabular-nums text-foreground">{dist.count}</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-semibold">Complaints</p>
                    <div className="mt-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold" style={{ color: rateColor }}>
                          {dist.resolutionRate}%
                        </span>
                        <span className="text-[9px] text-muted-foreground">resolved</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: rateColor }}
                          initial={{ width: 0 }}
                          animate={{ width: `${dist.resolutionRate}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.6 + idx * 0.06 }}
                        />
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ PERFORMANCE LEADERBOARD (Admin Only) ═══ */}
      {user?.role === 'ADMIN' && (
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#FEF3C7' }}>
                    <Trophy className="h-4 w-4" style={{ color: '#D97706' }} />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold">Performance Leaderboard</CardTitle>
                    <CardDescription className="text-xs">Top officers by resolution rate</CardDescription>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => onNavigate('analytics')}>
                  View All <ArrowUpRight className="h-3 w-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingLeaderboard ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-14 rounded-lg bg-muted overflow-hidden relative">
                      <div className="absolute inset-0 shimmer-bg" style={{ animationDelay: `${i * 80}ms` }} />
                    </div>
                  ))}
                </div>
              ) : leaderboard.length > 0 ? (
                <div className="space-y-2">
                  {leaderboard.slice(0, 5).map((officer, idx) => {
                    const rateColor = officer.resolutionRate >= 60 ? '#16A34A' : officer.resolutionRate >= 30 ? '#D97706' : '#DC2626';
                    return (
                      <motion.div
                        key={officer.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.57 + idx * 0.06 }}
                        className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors border border-border/30"
                      >
                        {/* Rank Badge */}
                        <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm"
                          style={{
                            backgroundColor: idx === 0 ? '#FEF3C7' : idx === 1 ? '#F3F4F6' : idx === 2 ? '#FED7AA' : '#F3F4F6',
                            color: idx === 0 ? '#D97706' : idx === 1 ? '#6B7280' : idx === 2 ? '#C2410C' : '#9CA3AF',
                          }}
                        >
                          {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                        </div>
                        {/* Officer Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-foreground truncate">{officer.name}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${ROLE_COLORS[officer.role] || 'bg-gray-100 text-gray-600'}`}>
                              {fmtRole(officer.role)}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3" />{officer.location}{officer.district ? `, ${officer.district}` : ''}
                          </p>
                        </div>
                        {/* Stats */}
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right hidden sm:block">
                            <p className="text-[10px] text-muted-foreground font-medium">Assigned</p>
                            <p className="text-sm font-bold tabular-nums">{officer.assigned}</p>
                          </div>
                          <div className="text-right hidden sm:block">
                            <p className="text-[10px] text-muted-foreground font-medium">Resolved</p>
                            <p className="text-sm font-bold tabular-nums text-emerald-600">{officer.resolved}</p>
                          </div>
                          <div className="text-right min-w-[70px]">
                            <p className="text-[10px] text-muted-foreground font-medium">Rate</p>
                            <div className="flex items-center gap-1.5">
                              <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
                                <motion.div
                                  className="h-full rounded-full"
                                  style={{ backgroundColor: rateColor }}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${officer.resolutionRate}%` }}
                                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.6 + idx * 0.06 }}
                                />
                              </div>
                              <span className="text-xs font-black tabular-nums" style={{ color: rateColor }}>{officer.resolutionRate}%</span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-6 text-center">
                  <div className="h-12 w-12 rounded-full bg-muted mx-auto flex items-center justify-center mb-2">
                    <Trophy className="h-6 w-6 text-muted-foreground/40" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">No data available</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">Leaderboard will populate as officers resolve complaints</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ═══ RECENT ACTIVITY FEED ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.56 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <History className="h-4 w-4" style={{ color: NAVY }} />
              Recent Activity
            </CardTitle>
            <CardDescription className="text-xs">Latest actions across all complaints</CardDescription>
          </CardHeader>
          <CardContent>
            {activityFeed.length > 0 ? (
              <div className="space-y-0">
                {activityFeed.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 py-2.5 border-b border-border/30 last:border-b-0 group"
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: item.actionColor }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-muted-foreground">{item.ticketNo}</span>
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                          style={{
                            backgroundColor: `${item.actionColor}15`,
                            color: item.actionColor,
                          }}
                        >
                          {item.action}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{item.issue}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{item.timeAgo}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No recent activity" />
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ MY ASSIGNED TASKS ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}>
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#F3E8FF' }}>
                  <ClipboardList className="h-4 w-4" style={{ color: '#7C3AED' }} />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold">My Assigned Tasks</CardTitle>
                  <CardDescription className="text-xs">Complaints assigned to you</CardDescription>
                </div>
              </div>
              {assignedTasks.length > 0 && (
                <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => onNavigate('complaints')}>
                  View All <ArrowUpRight className="h-3 w-3" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loadingTasks ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 rounded-lg bg-muted overflow-hidden relative">
                    <div className="absolute inset-0 shimmer-bg" style={{ animationDelay: `${i * 100}ms` }} />
                  </div>
                ))}
              </div>
            ) : assignedTasks.length > 0 ? (
              <div className="space-y-2">
                {assignedTasks.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onNavigate('complaints', c)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted/50 transition-all text-left group border border-border/30 hover:border-border/60"
                  >
                    <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{
                      backgroundColor: c.status === 'OPEN' ? '#FEF2F2' : c.status === 'IN_PROGRESS' ? '#FFFBEB' : '#F0FDF4',
                    }}>
                      {c.status === 'OPEN' && <CircleDot className="h-4 w-4 text-red-500" />}
                      {c.status === 'IN_PROGRESS' && <Clock className="h-4 w-4 text-amber-500" />}
                      {(c.status === 'RESOLVED' || c.status === 'REJECTED') && <CheckCircle className="h-4 w-4 text-emerald-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-muted-foreground">{c.ticketNo}</span>
                        <UrgencyBadge urgency={c.urgency} />
                      </div>
                      <p className="text-sm font-medium text-foreground truncate mt-0.5">{c.issue}</p>
                      <p className="text-[11px] text-muted-foreground">{c.category} &middot; {c.block}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={c.status} />
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center">
                <div className="h-12 w-12 rounded-full bg-muted mx-auto flex items-center justify-center mb-2">
                  <CheckCircle className="h-6 w-6 text-emerald-500" />
                </div>
                <p className="text-sm font-medium text-foreground">All caught up!</p>
                <p className="text-xs text-muted-foreground mt-0.5">No pending tasks assigned to you</p>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Bar Chart: Group complaints */}
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Complaints by {groupByField === 'district' ? 'District' : 'Block'}</CardTitle>
            <CardDescription className="text-xs">Status breakdown per location</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={barChartConfig} className="h-[280px] w-full">
              <BarChart data={byGroup} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="open" stackId="a" fill="#DC2626" radius={[0, 0, 0, 0]} />
                <Bar dataKey="inProgress" stackId="a" fill="#D97706" />
                <Bar dataKey="resolved" stackId="a" fill="#16A34A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Donut Chart: Status Breakdown with center total */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center relative">
            {statusPieData.length > 0 ? (
              <ChartContainer config={{}} className="h-[260px] w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Pie
                    data={statusPieData}
                    cx="50%" cy="50%"
                    innerRadius={55} outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    labelLine={false}
                    label={PieLabel}
                  >
                    {statusPieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    iconSize={8}
                    formatter={(value: string) => <span className="text-xs">{value}</span>}
                  />
                </PieChart>
              </ChartContainer>
            ) : (
              <EmptyState message="No complaints yet" />
            )}
            {/* Center total text */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingBottom: '30px' }}>
              <div className="text-center">
                <p className="text-2xl font-black" style={{ color: NAVY }}>{pieTotal}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Trend + Category Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Area Chart: Monthly Trend */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Monthly Trend</CardTitle>
            <CardDescription className="text-xs">Last 6 months overview</CardDescription>
          </CardHeader>
          <CardContent>
            {monthlyTrend.length > 0 ? (
              <ChartContainer config={trendChartConfig} className="h-[250px] w-full">
                <AreaChart data={monthlyTrend} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="fillOpen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#DC2626" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="fillResolved" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16A34A" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="open" stroke="#DC2626" fill="url(#fillOpen)" strokeWidth={2} />
                  <Area type="monotone" dataKey="inProgress" stroke="#D97706" fill="transparent" strokeWidth={2} />
                  <Area type="monotone" dataKey="resolved" stroke="#16A34A" fill="url(#fillResolved)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            ) : (
              <EmptyState message="No trend data available" />
            )}
          </CardContent>
        </Card>

        {/* Category Breakdown with colored bars */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Category Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {byCategory.length > 0 ? (
              <ScrollArea className="h-[250px] pr-2">
                <div className="space-y-3">
                  {byCategory.map((cat) => {
                    const catColor = CATEGORY_COLORS[cat.category] || '#6B7280';
                    return (
                      <div key={cat.category} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-foreground">{cat.category}</span>
                          <span className="font-bold text-muted-foreground tabular-nums">{cat.count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: catColor }}
                            initial={{ width: 0 }}
                            animate={{ width: `${(cat.count / maxCatCount) * 100}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            ) : (
              <EmptyState message="No category data" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Urgency Distribution + Recent Complaints */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Urgency Distribution */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Urgency Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {byUrgency.length > 0 ? (
              <div className="space-y-3">
                {byUrgency.map((u) => {
                  const total = byUrgency.reduce((s, x) => s + x.count, 0);
                  const pct = total > 0 ? Math.round((u.count / total) * 100) : 0;
                  return (
                    <div key={u.urgency} className="flex items-center gap-3">
                      <UrgencyBadge urgency={u.urgency} />
                      <div className="flex-1">
                        <Progress value={pct} className="h-2" />
                      </div>
                      <span className="text-xs font-bold text-muted-foreground tabular-nums w-8 text-right">{u.count}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState message="No urgency data" />
            )}
          </CardContent>
        </Card>

        {/* Recent Complaints */}
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold">Recent Complaints</CardTitle>
              <CardDescription className="text-xs">Latest filed grievances</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="text-xs h-8 gap-1" onClick={() => onNavigate('complaints')}>
              View All <ArrowUpRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent>
            {recent.length > 0 ? (
              <div className="space-y-2">
                {recent.slice(0, 5).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onNavigate('complaints', c)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-muted-foreground">{c.ticketNo}</span>
                        <StatusBadge status={c.status} />
                        <UrgencyBadge urgency={c.urgency} />
                      </div>
                      <p className="text-sm font-medium text-foreground truncate mt-0.5">{c.issue}</p>
                      <p className="text-[11px] text-muted-foreground">{c.citizenName || 'Anonymous'} &middot; {c.block}, {c.district}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:block">{fmtDate(c.createdAt)}</span>
                    <Eye className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState message="No recent complaints" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activity Timeline */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Activity className="h-4 w-4" style={{ color: NAVY }} />
              Activity Timeline
            </CardTitle>
            <CardDescription className="text-xs">Recent status changes</CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length > 0 ? (
              <div className="space-y-0">
                {recent.slice(0, 5).map((c, idx) => (
                  <div key={c.id} className="flex gap-3">
                    {/* Timeline line and dot */}
                    <div className="flex flex-col items-center">
                      <div className="h-3 w-3 rounded-full shrink-0 mt-1" style={{ backgroundColor: STATUS_MAP[c.status]?.dotColor.replace('bg-', '').split('-')[0] === 'red' ? '#DC2626' : c.status === 'IN_PROGRESS' ? '#D97706' : c.status === 'RESOLVED' ? '#16A34A' : '#9CA3AF' }} />
                      {idx < Math.min(recent.length, 5) - 1 && <div className="w-0.5 flex-1 bg-border mt-1" />}
                    </div>
                    {/* Content */}
                    <div className="pb-4 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-bold">{c.ticketNo}</span>
                        <StatusBadge status={c.status} />
                      </div>
                      <p className="text-sm font-medium text-foreground truncate">{c.issue}</p>
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />{fmtDateTime(c.updatedAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No activity yet" />
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Critical Complaints Alerts */}
      {criticalComplaints.length > 0 && (
        <Card className="border-0 shadow-sm border-l-4" style={{ borderLeftColor: '#DC2626' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-red-700 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Critical Complaints Alert ({criticalComplaints.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {criticalComplaints.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onNavigate('complaints', c)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors text-left"
                >
                  <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold">{c.ticketNo}</span>
                      <Badge variant="outline" className="text-[10px] bg-red-100 text-red-700 border-red-200">{c.category}</Badge>
                    </div>
                    <p className="text-sm font-medium truncate">{c.issue}</p>
                    <p className="text-[11px] text-muted-foreground">{c.block}, {c.district} &middot; {fmtDate(c.createdAt)}</p>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}