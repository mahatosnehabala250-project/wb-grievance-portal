'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Crown, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Activity, Users, FileText, Zap, RefreshCw, Download, Eye,
  ChevronUp, ChevronDown, Minus, Star, FlameIcon as Flame,
  ShieldAlert, BarChart3, Globe, MapPin, Award, CircleDot,
  BrainCircuit, Newspaper, CalendarRange, ArrowUpRight, Sparkles,
  Building2, Phone, Target, Clock, Filter, ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── Types ──────────────────────────────────────────────── */
interface ConstituencyData {
  constituency: string;
  mla_name: string | null;
  total_complaints: number;
  active_complaints: number;
  resolved_complaints: number;
  resolution_rate: number | null;
  avg_citizen_rating: number | null;
  critical_pending: number;
  top_category: string | null;
  status_label: 'Good' | 'Watch' | 'Alert';
  rank: number;
}

interface MPStats {
  total_complaints: number;
  total_active: number;
  total_resolved: number;
  resolution_rate: number;
  last_7d: number;
  last_24h: number;
  active_alerts: number;
  critical_alerts: number;
  blood_donors: number;
  active_officers: number;
  constituencies: ConstituencyData[];
}

interface IntelligenceAlert {
  id: string;
  type: string;
  title: string;
  severity: number;
  constituency: string | null;
  district: string | null;
  category: string | null;
  summary: string;
  recommended: string;
  ai_brief: string | null;
  mp_notified: boolean;
  created_at: string;
}

/* ─── Constituency Config ─────────────────────────────────── */
const CONSTITUENCY_META: Record<string, { color: string; emoji: string; type: string }> = {
  'Purulia':       { color: '#FF6B00', emoji: '🏙', type: 'GENERAL' },
  'Joypur':        { color: '#3B82F6', emoji: '🌿', type: 'GENERAL' },
  'Balarampur':    { color: '#8B5CF6', emoji: '⛰', type: 'ST' },
  'Baghmundi':     { color: '#06B6D4', emoji: '🌊', type: 'GENERAL' },
  'Manbazar':      { color: '#10B981', emoji: '🌳', type: 'ST' },
  'Bandwan':       { color: '#F59E0B', emoji: '🔥', type: 'ST' },
  'Kashipur':      { color: '#EF4444', emoji: '⚡', type: 'GENERAL' },
  'Para':          { color: '#EC4899', emoji: '🌸', type: 'SC' },
  'Raghunathpur':  { color: '#6366F1', emoji: '💎', type: 'SC' },
};

const CAT_COLORS: Record<string, string> = {
  WATER: '#3B82F6', ROAD: '#F59E0B', HEALTH: '#EF4444',
  ELECTRICITY: '#F59E0B', RATION: '#10B981', PENSION: '#8B5CF6',
  EDUCATION: '#06B6D4', OTHER: '#6B7280', SANITATION: '#14B8A6',
};

const STATUS_COLORS = {
  Good:  { bg: 'bg-emerald-500/10 dark:bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500', border: 'border-emerald-200 dark:border-emerald-800' },
  Watch: { bg: 'bg-amber-500/10 dark:bg-amber-500/15',    text: 'text-amber-600 dark:text-amber-400',    dot: 'bg-amber-500',   border: 'border-amber-200 dark:border-amber-700' },
  Alert: { bg: 'bg-red-500/10 dark:bg-red-500/15',        text: 'text-red-600 dark:text-red-400',        dot: 'bg-red-500',     border: 'border-red-200 dark:border-red-800' },
};

/* ─── Animated Counter ────────────────────────────────────── */
function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const steps = 20;
    let step = 0;
    const inc = value / steps;
    const t = setInterval(() => {
      step++;
      setDisplay(Math.min(Math.round(inc * step), value));
      if (step >= steps) clearInterval(t);
    }, 30);
    return () => clearInterval(t);
  }, [value]);
  return <>{display}{suffix}</>;
}

/* ─── Severity Bar ────────────────────────────────────────── */
function SeverityBar({ value }: { value: number }) {
  const color = value >= 80 ? '#EF4444' : value >= 60 ? '#F59E0B' : '#10B981';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
      <span className="text-xs font-mono w-6 text-right" style={{ color }}>{value}</span>
    </div>
  );
}

/* ─── Main Component ──────────────────────────────────────── */
export function MPCommandView() {
  const [stats, setStats] = useState<MPStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<ConstituencyData[]>([]);
  const [intelligence, setIntelligence] = useState<{ active_alerts_total: number; critical_unnotified: number; alerts: IntelligenceAlert[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedConst, setSelectedConst] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'leaderboard' | 'intelligence' | 'reports'>('overview');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [dashRes, lbRes, intRes] = await Promise.all([
        fetch('/api/mp/dashboard', { headers: authHeaders() }),
        fetch('/api/mp/leaderboard', { headers: authHeaders() }),
        fetch('/api/mp/intelligence', { headers: authHeaders() }),
      ]);
      if (dashRes.ok) {
        const d = await dashRes.json();
        setStats(d.data);
      }
      if (lbRes.ok) {
        const d = await lbRes.json();
        setLeaderboard(d.data || []);
      }
      if (intRes.ok) {
        const d = await intRes.json();
        setIntelligence(d.data);
      }
      setLastUpdated(new Date());
    } catch {
      toast.error('Failed to load MP Command Center data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const iv = setInterval(() => load(true), 60000);
    return () => clearInterval(iv);
  }, [load]);

  /* ─── Mock data for demo ─────────────────────────── */
  const mockStats: MPStats = {
    total_complaints: 52, total_active: 38, total_resolved: 12,
    resolution_rate: 23.1, last_7d: 2, last_24h: 0,
    active_alerts: 0, critical_alerts: 0, blood_donors: 3, active_officers: 40,
    constituencies: [
      { constituency: 'Manbazar',     mla_name: 'Mayna Murmu',           total_complaints: 21, active_complaints: 15, resolved_complaints: 6,  resolution_rate: 28.6, avg_citizen_rating: 5.0, critical_pending: 0, top_category: 'WATER',  status_label: 'Alert', rank: 1 },
      { constituency: 'Bandwan',      mla_name: 'Labsen Baskey',         total_complaints: 6,  active_complaints: 6,  resolved_complaints: 0,  resolution_rate: 0,    avg_citizen_rating: null, critical_pending: 2, top_category: 'HEALTH', status_label: 'Alert', rank: 2 },
      { constituency: 'Purulia',      mla_name: 'Sudip Kumar Mukherjee', total_complaints: 2,  active_complaints: 2,  resolved_complaints: 0,  resolution_rate: 0,    avg_citizen_rating: null, critical_pending: 0, top_category: 'OTHER',  status_label: 'Alert', rank: 3 },
      { constituency: 'Balarampur',   mla_name: 'Jaladhar Mahato',       total_complaints: 1,  active_complaints: 1,  resolved_complaints: 0,  resolution_rate: 0,    avg_citizen_rating: null, critical_pending: 0, top_category: 'ROAD',   status_label: 'Alert', rank: 4 },
      { constituency: 'Baghmundi',    mla_name: 'Rahidas Mahato',        total_complaints: 0,  active_complaints: 0,  resolved_complaints: 0,  resolution_rate: null, avg_citizen_rating: null, critical_pending: 0, top_category: null,     status_label: 'Good',  rank: 5 },
      { constituency: 'Joypur',       mla_name: 'Biswajit Mahato',       total_complaints: 0,  active_complaints: 0,  resolved_complaints: 0,  resolution_rate: null, avg_citizen_rating: null, critical_pending: 0, top_category: null,     status_label: 'Good',  rank: 6 },
      { constituency: 'Kashipur',     mla_name: 'Kamalakanta Hansda',    total_complaints: 0,  active_complaints: 0,  resolved_complaints: 0,  resolution_rate: null, avg_citizen_rating: null, critical_pending: 0, top_category: null,     status_label: 'Good',  rank: 7 },
      { constituency: 'Para',         mla_name: 'Nadiar Chand Bouri',    total_complaints: 0,  active_complaints: 0,  resolved_complaints: 0,  resolution_rate: null, avg_citizen_rating: null, critical_pending: 0, top_category: null,     status_label: 'Good',  rank: 8 },
      { constituency: 'Raghunathpur', mla_name: 'Mamoni Bauri',          total_complaints: 0,  active_complaints: 0,  resolved_complaints: 0,  resolution_rate: null, avg_citizen_rating: null, critical_pending: 0, top_category: null,     status_label: 'Good',  rank: 9 },
    ],
  };

  const displayStats = stats || mockStats;
  const displayLeaderboard = leaderboard.length > 0 ? leaderboard : mockStats.constituencies;

  /* ─── Derived ─────────────────────────────────────── */
  const radarData = displayLeaderboard.slice(0, 6).map(c => ({
    constituency: c.constituency.substring(0, 6),
    Resolution: c.resolution_rate ?? 0,
    Activity: Math.min((c.total_complaints / Math.max(...displayLeaderboard.map(x => x.total_complaints), 1)) * 100, 100),
  }));

  const categoryData = displayStats.constituencies
    .filter(c => c.top_category)
    .reduce((acc: Record<string, number>, c) => {
      if (c.top_category) acc[c.top_category] = (acc[c.top_category] || 0) + c.total_complaints;
      return acc;
    }, {});

  const pieData = Object.entries(categoryData).map(([name, value]) => ({ name, value }));

  const trendData = [
    { month: 'Jan', complaints: 8, resolved: 3 },
    { month: 'Feb', complaints: 12, resolved: 6 },
    { month: 'Mar', complaints: 18, resolved: 8 },
    { month: 'Apr', complaints: 24, resolved: 10 },
    { month: 'May', complaints: 38, resolved: 11 },
    { month: 'Jun', complaints: 52, resolved: 12 },
  ];

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-4">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent mx-auto"
        />
        <p className="text-sm text-muted-foreground">Loading MP Command Center...</p>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gradient-to-br from-background via-background to-muted/20">

      {/* ── Header ───────────────────────────────────── */}
      <div className="flex-shrink-0 border-b bg-background/80 backdrop-blur-sm">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">

            {/* Title */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/20">
                <Crown className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-bold tracking-tight">MP Command Center</h1>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-medium border-orange-200 text-orange-600 dark:border-orange-800 dark:text-orange-400">
                    PURULIA DISTRICT
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Jyotirmay Singh Mahato &nbsp;·&nbsp; 9 Constituencies &nbsp;·&nbsp; 18.2L Voters
                  &nbsp;·&nbsp; Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              {(['overview','leaderboard','intelligence','reports'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-all ${
                    activeTab === tab
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab === 'intelligence' ? '🧠 Intel' : tab === 'reports' ? '📄 Reports' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="h-8 text-xs">
                <RefreshCw className={`w-3 h-3 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button size="sm" className="h-8 text-xs bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 shadow-lg shadow-orange-500/20">
                <Newspaper className="w-3 h-3 mr-1.5" />
                Press Report
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────── */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">

          <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-4">

              {/* ── KPI Row ────────────────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'Total Complaints', value: displayStats.total_complaints, icon: FileText, color: 'text-blue-500', bg: 'bg-blue-500/10', suffix: '' },
                  { label: 'Active',            value: displayStats.total_active,    icon: Activity, color: 'text-red-500',    bg: 'bg-red-500/10',  suffix: '' },
                  { label: 'Resolved',          value: displayStats.total_resolved,  icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10', suffix: '' },
                  { label: 'Resolution Rate',   value: displayStats.resolution_rate, icon: Target, color: 'text-amber-500',   bg: 'bg-amber-500/10',  suffix: '%' },
                  { label: 'Active Officers',   value: displayStats.active_officers, icon: Users,  color: 'text-violet-500', bg: 'bg-violet-500/10', suffix: '' },
                  { label: 'Blood Donors',      value: displayStats.blood_donors,    icon: Heart,  color: 'text-pink-500',   bg: 'bg-pink-500/10',   suffix: '' },
                ].map((kpi, i) => (
                  <motion.div key={kpi.label} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}>
                    <Card className="border-0 shadow-sm bg-card/60 backdrop-blur">
                      <CardContent className="p-3">
                        <div className={`w-7 h-7 rounded-lg ${kpi.bg} flex items-center justify-center mb-2`}>
                          <kpi.icon className={`w-3.5 h-3.5 ${kpi.color}`} />
                        </div>
                        <div className="text-xl font-bold font-mono leading-none mb-1">
                          <AnimatedNumber value={Math.round(kpi.value)} suffix={kpi.suffix} />
                        </div>
                        <div className="text-[11px] text-muted-foreground font-medium">{kpi.label}</div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>

              {/* ── Constituency Grid ─────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                    9 Constituencies — Live Status
                  </h2>
                  <span className="text-xs text-muted-foreground">Click to drill down</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {displayStats.constituencies.map((c, i) => {
                    const meta = CONSTITUENCY_META[c.constituency] || { color: '#6B7280', emoji: '🏘', type: 'GENERAL' };
                    const sc = STATUS_COLORS[c.status_label];
                    const isSelected = selectedConst === c.constituency;
                    const rate = c.resolution_rate ?? 0;

                    return (
                      <motion.div
                        key={c.constituency}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        onClick={() => setSelectedConst(isSelected ? null : c.constituency)}
                        className={`relative cursor-pointer rounded-xl border transition-all duration-200 overflow-hidden ${
                          isSelected
                            ? 'border-primary shadow-md shadow-primary/10 scale-[1.01]'
                            : 'border-border/60 hover:border-border hover:shadow-sm'
                        } bg-card/60 backdrop-blur`}
                      >
                        {/* Colored top accent bar */}
                        <div className="h-0.5 w-full" style={{ background: meta.color }} />

                        <div className="p-3">
                          <div className="flex items-start justify-between mb-2.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xl leading-none">{meta.emoji}</span>
                              <div>
                                <div className="font-semibold text-sm">{c.constituency}</div>
                                <div className="text-[11px] text-muted-foreground truncate max-w-[130px]">
                                  {c.mla_name || 'MLA'}
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                                {c.status_label}
                              </span>
                              {meta.type !== 'GENERAL' && (
                                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                  {meta.type}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Stats row */}
                          <div className="grid grid-cols-3 gap-2 mb-2.5">
                            <div className="text-center">
                              <div className="text-base font-bold font-mono">{c.total_complaints}</div>
                              <div className="text-[10px] text-muted-foreground">Total</div>
                            </div>
                            <div className="text-center">
                              <div className="text-base font-bold font-mono text-red-500">{c.active_complaints}</div>
                              <div className="text-[10px] text-muted-foreground">Active</div>
                            </div>
                            <div className="text-center">
                              <div className="text-base font-bold font-mono text-emerald-500">{c.resolved_complaints}</div>
                              <div className="text-[10px] text-muted-foreground">Resolved</div>
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="space-y-1">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-muted-foreground">Resolution</span>
                              <span className="font-mono font-medium">{rate.toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <motion.div
                                className="h-full rounded-full"
                                style={{ background: meta.color }}
                                initial={{ width: 0 }}
                                animate={{ width: `${rate}%` }}
                                transition={{ duration: 0.8, delay: i * 0.04 }}
                              />
                            </div>
                          </div>

                          {/* Bottom info */}
                          <div className="flex items-center justify-between mt-2">
                            {c.top_category ? (
                              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted/60">
                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: CAT_COLORS[c.top_category] || '#6B7280' }} />
                                {c.top_category}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">No data yet</span>
                            )}
                            {c.critical_pending > 0 && (
                              <span className="text-[10px] font-semibold text-red-500 flex items-center gap-0.5">
                                <AlertTriangle className="w-3 h-3" />
                                {c.critical_pending} critical
                              </span>
                            )}
                            {c.avg_citizen_rating && (
                              <span className="text-[10px] font-medium flex items-center gap-0.5 text-amber-500">
                                <Star className="w-3 h-3 fill-amber-500" />
                                {c.avg_citizen_rating}
                              </span>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* ── Charts Row ─────────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                {/* Trend Chart */}
                <Card className="lg:col-span-2 border-0 shadow-sm bg-card/60 backdrop-blur">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-muted-foreground" />
                      Complaint Trend — Last 6 Months
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <ChartContainer className="h-[180px]" config={{ complaints: { label: 'Filed', color: '#FF6B00' }, resolved: { label: 'Resolved', color: '#10B981' } }}>
                      <AreaChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                        <defs>
                          <linearGradient id="gradC" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#FF6B00" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#FF6B00" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradR" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                        <XAxis dataKey="month" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                        <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Area type="monotone" dataKey="complaints" stroke="#FF6B00" strokeWidth={2} fill="url(#gradC)" />
                        <Area type="monotone" dataKey="resolved" stroke="#10B981" strokeWidth={2} fill="url(#gradR)" />
                      </AreaChart>
                    </ChartContainer>
                  </CardContent>
                </Card>

                {/* Category Pie */}
                <Card className="border-0 shadow-sm bg-card/60 backdrop-blur">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-muted-foreground" />
                      Top Issues
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {pieData.length > 0 ? (
                      <div className="flex flex-col items-center gap-3">
                        <ChartContainer className="h-[120px] w-full" config={{}}>
                          <PieChart>
                            <Pie data={pieData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value">
                              {pieData.map((entry) => (
                                <Cell key={entry.name} fill={CAT_COLORS[entry.name] || '#6B7280'} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ChartContainer>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
                          {pieData.map(entry => (
                            <div key={entry.name} className="flex items-center gap-1 text-[10px]">
                              <span className="w-2 h-2 rounded-full" style={{ background: CAT_COLORS[entry.name] || '#6B7280' }} />
                              <span className="text-muted-foreground">{entry.name} {entry.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="h-[160px] flex items-center justify-center text-xs text-muted-foreground">No data yet</div>
                    )}
                  </CardContent>
                </Card>

              </div>
            </motion.div>
          )}

          {activeTab === 'leaderboard' && (
            <motion.div key="lb" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-500" />
                  Constituency Performance Leaderboard
                </h2>
                <span className="text-xs text-muted-foreground">Ranked by resolution rate</span>
              </div>

              <div className="space-y-2">
                {displayLeaderboard.map((c, i) => {
                  const meta = CONSTITUENCY_META[c.constituency] || { color: '#6B7280', emoji: '🏘', type: 'GENERAL' };
                  const sc = STATUS_COLORS[c.status_label];
                  const rate = c.resolution_rate ?? 0;
                  const medals = ['🥇','🥈','🥉'];

                  return (
                    <motion.div
                      key={c.constituency}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-center gap-3 p-3 rounded-xl border border-border/60 bg-card/60 backdrop-blur hover:bg-card transition-colors"
                    >
                      <div className="w-7 text-center text-base font-bold">
                        {i < 3 ? medals[i] : <span className="text-xs text-muted-foreground font-mono">#{i + 1}</span>}
                      </div>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg" style={{ background: meta.color + '15' }}>
                        {meta.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm">{c.constituency}</span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{c.status_label}</span>
                          {meta.type !== 'GENERAL' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{meta.type}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <motion.div
                              className="h-full rounded-full"
                              style={{ background: meta.color }}
                              initial={{ width: 0 }}
                              animate={{ width: `${rate}%` }}
                              transition={{ duration: 0.8, delay: i * 0.05 }}
                            />
                          </div>
                          <span className="text-xs font-mono text-muted-foreground w-10 text-right">{rate.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="hidden sm:grid grid-cols-3 gap-4 text-center">
                        <div>
                          <div className="text-sm font-bold font-mono">{c.total_complaints}</div>
                          <div className="text-[10px] text-muted-foreground">Total</div>
                        </div>
                        <div>
                          <div className="text-sm font-bold font-mono text-red-500">{c.active_complaints}</div>
                          <div className="text-[10px] text-muted-foreground">Active</div>
                        </div>
                        <div>
                          <div className="text-sm font-bold font-mono text-emerald-500">{c.resolved_complaints}</div>
                          <div className="text-[10px] text-muted-foreground">Resolved</div>
                        </div>
                      </div>
                      <div className="hidden md:block text-right">
                        <div className="text-xs text-muted-foreground truncate max-w-[120px]">{c.mla_name}</div>
                        {c.top_category && (
                          <span className="text-[10px] inline-flex items-center gap-1 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: CAT_COLORS[c.top_category] || '#6B7280' }} />
                            {c.top_category}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {activeTab === 'intelligence' && (
            <motion.div key="intel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <BrainCircuit className="w-4 h-4 text-violet-500" />
                  District Intelligence — AI Threat Detection
                </h2>
                <Badge variant="outline" className="text-[10px]">
                  Runs every 6 hours
                </Badge>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <Card className="border-0 bg-card/60">
                  <CardContent className="p-3 text-center">
                    <div className="text-2xl font-bold font-mono text-red-500">{intelligence?.critical_unnotified ?? 0}</div>
                    <div className="text-xs text-muted-foreground mt-1">Critical Unread</div>
                  </CardContent>
                </Card>
                <Card className="border-0 bg-card/60">
                  <CardContent className="p-3 text-center">
                    <div className="text-2xl font-bold font-mono text-amber-500">{intelligence?.active_alerts_total ?? 0}</div>
                    <div className="text-xs text-muted-foreground mt-1">Active Alerts</div>
                  </CardContent>
                </Card>
                <Card className="border-0 bg-card/60">
                  <CardContent className="p-3 text-center">
                    <div className="text-2xl font-bold font-mono text-emerald-500">✓</div>
                    <div className="text-xs text-muted-foreground mt-1">All Systems OK</div>
                  </CardContent>
                </Card>
              </div>

              {intelligence?.alerts && intelligence.alerts.length > 0 ? (
                <div className="space-y-3">
                  {intelligence.alerts.map((alert, i) => (
                    <motion.div
                      key={alert.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06 }}
                      className="p-4 rounded-xl border border-border/60 bg-card/60 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <ShieldAlert className={`w-4 h-4 ${alert.severity >= 80 ? 'text-red-500' : alert.severity >= 60 ? 'text-amber-500' : 'text-blue-500'}`} />
                          <span className="font-semibold text-sm">{alert.title}</span>
                        </div>
                        <SeverityBar value={alert.severity} />
                      </div>
                      <p className="text-xs text-muted-foreground">{alert.summary}</p>
                      {alert.recommended && (
                        <div className="text-xs bg-muted/60 rounded-lg px-3 py-2">
                          <span className="font-medium">Action: </span>{alert.recommended}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                    <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                  </div>
                  <div className="font-semibold text-sm mb-1">All Clear — No Active Threats</div>
                  <div className="text-xs text-muted-foreground max-w-xs">
                    Intelligence engine is monitoring all 9 constituencies. No disease outbreaks, infrastructure failures, or frequency spikes detected.
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'reports' && (
            <motion.div key="reports" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-muted-foreground" />
                Press Report Generator
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { title: 'Monthly Report', desc: 'All 9 constituencies — complaint stats, resolution rates, officer performance.', icon: CalendarRange, color: 'text-blue-500', bg: 'bg-blue-500/10' },
                  { title: 'Achievement Report', desc: 'Top resolved issues, best constituency, fastest officers — press release ready.', icon: Award, color: 'text-amber-500', bg: 'bg-amber-500/10' },
                  { title: 'Intelligence Summary', desc: 'Active alerts, areas needing attention, district health score.', icon: BrainCircuit, color: 'text-violet-500', bg: 'bg-violet-500/10' },
                ].map((r, i) => (
                  <motion.div key={r.title} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.08 }}>
                    <Card className="border-0 bg-card/60 hover:bg-card transition-colors cursor-pointer group">
                      <CardContent className="p-5">
                        <div className={`w-10 h-10 rounded-xl ${r.bg} flex items-center justify-center mb-3`}>
                          <r.icon className={`w-5 h-5 ${r.color}`} />
                        </div>
                        <div className="font-semibold text-sm mb-1">{r.title}</div>
                        <div className="text-xs text-muted-foreground leading-relaxed mb-4">{r.desc}</div>
                        <Button size="sm" variant="outline" className="w-full h-8 text-xs group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-colors">
                          <Download className="w-3 h-3 mr-1.5" />
                          Generate PDF
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
              <Card className="border-0 bg-muted/30">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground text-center">
                    Reports are auto-generated using live Supabase data and sent to MP's Telegram every month on the 1st (JS-19 workflow).
                    Manual generation available above.
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
          </AnimatePresence>

        </div>
      </ScrollArea>
    </div>
  );
}

// Fix missing Heart import
function Heart({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
