'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Crown, Building2, Activity, CheckCircle2, AlertTriangle, Users, RefreshCw, TrendingUp, Star, Newspaper, BrainCircuit, Target, Award, MapPin, FileText, ChevronRight, Zap, Droplets, Heart, Package, BarChart3, CalendarRange,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── Types ──────────────────────────────────── */
interface MLAConstData {
  constituency: string;
  mla_name: string | null;
  constituency_type?: string | null;
  total: number;
  active: number;
  resolved: number;
  resolution_rate: number | null;
  avg_rating: number | null;
  critical_count: number;
  top_category: string | null;
}

interface TrendPoint { month: string; filed: number; resolved: number }

interface DashStats {
  lok_sabha?: string;
  total_complaints: number;
  total_active: number;
  total_resolved: number;
  resolution_rate: number;
  critical_alerts: number;
  last_7d: number;
  last_24h: number;
  /** Still returned by the API; no longer surfaced — blood-donor matching is a
   *  separate product and its workflows are switched off (3 donors total). */
  blood_donors: number;
  active_officers: number;
  active_alerts: number;
  constituencies: MLAConstData[];
  trend?: TrendPoint[];
}

interface DrillDownData {
  constituency: string;
  total: number;
  active: number;
  resolved: number;
  critical: number;
  sla_breached: number;
  resolution_rate: number;
  avg_rating: number | null;
  by_category: Array<{ category: string; total: number; resolved: number; active: number }>;
  by_block: Array<{ block: string; total: number; active: number; resolved: number }>;
  officers: Array<{ name: string; resolved: number; active: number; total: number; score: number }>;
  recent_complaints: Array<{ id: string; ticketNo: string; issue: string; status: string; urgency: string; village: string | null }>;
}

/* ─── Static Config (visual palette only — data comes from API) ── */
const PALETTE = [
  { color: '#FF6B00', gradient: 'from-orange-500 to-amber-500',  emoji: '🏙' },
  { color: '#3B82F6', gradient: 'from-blue-500 to-cyan-500',     emoji: '🌿' },
  { color: '#8B5CF6', gradient: 'from-violet-500 to-purple-600', emoji: '⛰' },
  { color: '#06B6D4', gradient: 'from-cyan-500 to-teal-500',     emoji: '🌊' },
  { color: '#10B981', gradient: 'from-emerald-500 to-green-500', emoji: '🌳' },
  { color: '#F59E0B', gradient: 'from-amber-500 to-yellow-500',  emoji: '🔥' },
  { color: '#EF4444', gradient: 'from-red-500 to-rose-500',      emoji: '⚡' },
  { color: '#EC4899', gradient: 'from-pink-500 to-rose-400',     emoji: '🌸' },
  { color: '#6366F1', gradient: 'from-indigo-500 to-violet-500', emoji: '💎' },
];

/** Stable palette pick per constituency name */
function metaFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const CAT_ICONS: Record<string, React.ElementType> = {
  WATER: Droplets, ROAD: MapPin, HEALTH: Heart,
  ELECTRICITY: Zap, RATION: Package, OTHER: FileText,
};

const CAT_COLORS: Record<string, string> = {
  WATER: '#3B82F6', ROAD: '#F59E0B', HEALTH: '#EF4444',
  ELECTRICITY: '#F59E0B', RATION: '#10B981', OTHER: '#6B7280',
};

/* ─── Helper Components ──────────────────────── */
function AnimNum({ n, suffix = '' }: { n: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let step = 0;
    const t = setInterval(() => {
      step++;
      setVal(Math.min(Math.round((n / 20) * step), n));
      if (step >= 20) clearInterval(t);
    }, 30);
    return () => clearInterval(t);
  }, [n]);
  return <>{val}{suffix}</>;
}

function ZoneLabel({ rate }: { rate: number | null }) {
  if (rate === null) return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">
      No Data
    </span>
  );
  if (rate >= 75) return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
      ✓ Good
    </span>
  );
  if (rate >= 40) return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
      ⚠ Watch
    </span>
  );
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400">
      🔴 Alert
    </span>
  );
}

/* ─── Main Component ─────────────────────────── */
export function MPCommandView() {
  const [stats, setStats] = useState<DashStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'overview' | 'leaderboard' | 'intel' | 'reports'>('overview');
  const [selectedConst, setSelectedConst] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillDownData | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [lastSync, setLastSync] = useState(new Date());

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch('/api/mp/dashboard', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setStats(json.data || null);
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error || 'Failed to load MP data');
      }
      setLastSync(new Date());
    } catch {
      toast.error('Failed to load MP data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Drill-down: fetch full constituency detail when a card is selected */
  const openDrillDown = useCallback(async (constituency: string) => {
    setSelectedConst(constituency);
    setDrill(null);
    setDrillLoading(true);
    try {
      const res = await fetch(
        `/api/mla/stats?constituency=${encodeURIComponent(constituency)}`,
        { headers: authHeaders() }
      );
      if (res.ok) {
        const json = await res.json();
        setDrill(json.data || null);
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error || 'Drill-down failed');
      }
    } catch {
      toast.error('Drill-down failed');
    } finally {
      setDrillLoading(false);
    }
  }, []);

  /* Safe derived values */
  const s: DashStats = stats ?? {
    total_complaints: 0, total_active: 0, total_resolved: 0,
    resolution_rate: 0, critical_alerts: 0, last_7d: 0, last_24h: 0,
    blood_donors: 0, active_officers: 0, active_alerts: 0, constituencies: [],
  };
  /* Constituency cards come straight from the seat-scoped API */
  const constData: MLAConstData[] = stats?.constituencies || [];
  const seatName = stats?.lok_sabha || '';
  const trendData = (stats?.trend || []).map(t => ({ m: t.month, f: t.filed, r: t.resolved }));

  /* Pie data from constituencies */
  const catMap: Record<string, number> = {};
  constData.forEach(c => {
    if (c.top_category && c.total > 0) {
      catMap[c.top_category] = (catMap[c.top_category] || 0) + c.total;
    }
  });
  const pieData = Object.entries(catMap).map(([name, value]) => ({ name, value }));

  /* Leaderboard sorted */
  const ranked = [...constData].sort((a, b) => {
    const ra = a.resolution_rate ?? -1;
    const rb = b.resolution_rate ?? -1;
    return rb - ra;
  });

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
          className="w-10 h-10 rounded-full border-2 border-orange-500 border-t-transparent mx-auto"
        />
        <p className="text-sm text-muted-foreground font-medium">
          Loading MP Command Center...
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">

      {/* ── Top Header ──────────────────────────── */}
      <div className="flex-shrink-0 border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">

          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow shadow-orange-500/30">
              <Crown className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm">MP Command Center</span>
                {seatName && (
                  <Badge className="text-[9px] h-4 px-1.5 bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400 border-0 uppercase">
                    {seatName}
                  </Badge>
                )}
                <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  LIVE
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {constData.length} Assembly Constituenc{constData.length === 1 ? 'y' : 'ies'} ·{' '}
                {lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-0.5 bg-muted/60 rounded-lg p-1">
            {([
              { id: 'overview',    label: '📊 Overview'  },
              { id: 'leaderboard', label: '🏆 Rankings'  },
              { id: 'intel',       label: '🧠 Intel'     },
              { id: 'reports',     label: '📄 Reports'   },
            ] as const).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                  tab === t.id
                    ? 'bg-background shadow text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={() => load(true)}
            disabled={refreshing} className="h-7 text-xs px-2.5">
            <RefreshCw className={`w-3 h-3 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            Sync
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
        <AnimatePresence mode="wait">

        {/* ══ OVERVIEW ══════════════════════════════ */}
        {tab === 'overview' && (
          <motion.div key="ov"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} className="space-y-4">

            {/* District KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              {[
                { label: 'Total',       val: s.total_complaints, icon: FileText,     c: 'text-blue-500',    bg: 'bg-blue-500/8'    },
                { label: 'Active',      val: s.total_active,     icon: Activity,     c: 'text-red-500',     bg: 'bg-red-500/8'     },
                { label: 'Resolved',    val: s.total_resolved,   icon: CheckCircle2, c: 'text-emerald-500', bg: 'bg-emerald-500/8' },
                { label: 'Rate',        val: s.resolution_rate,  icon: Target,       c: 'text-amber-500',   bg: 'bg-amber-500/8',  suffix: '%' },
                { label: 'Officers',    val: s.active_officers,  icon: Users,        c: 'text-violet-500',  bg: 'bg-violet-500/8'  },
              ].map((k, i) => (
                <motion.div key={k.label}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.04 }}>
                  <Card className="border shadow-sm">
                    <CardContent className="p-3">
                      <div className={`w-6 h-6 rounded-md ${k.bg} flex items-center justify-center mb-2`}>
                        <k.icon className={`w-3 h-3 ${k.c}`} />
                      </div>
                      <div className={`text-xl font-bold font-mono ${k.c}`}>
                        <AnimNum n={Math.round(k.val || 0)} suffix={(k as any).suffix || ''} />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{k.label}</div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>

            {/* ── MLA Constituency Boxes (dynamic, seat-scoped) ─────────── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  {constData.length} Constituenc{constData.length === 1 ? 'y' : 'ies'} — Live Status
                  <span className="text-xs text-muted-foreground font-normal">(Click for details)</span>
                </h2>
                <span className="text-[10px] text-muted-foreground">
                  {constData.filter(c => c.total > 0).length} / {constData.length} active
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {constData.map((c, i) => {
                  const pal = metaFor(c.constituency);
                  const meta = { ...pal, type: c.constituency_type || 'GENERAL', mla: c.mla_name || '' };
                  const rate = c.resolution_rate ?? 0;
                  const isSelected = selectedConst === c.constituency;
                  const CatIcon = c.top_category ? (CAT_ICONS[c.top_category] || FileText) : FileText;

                  return (
                    <motion.div
                      key={c.constituency}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => isSelected ? setSelectedConst(null) : openDrillDown(c.constituency)}
                      className={`relative rounded-xl border cursor-pointer overflow-hidden transition-all duration-200 ${
                        isSelected
                          ? 'ring-2 shadow-lg scale-[1.01]'
                          : 'hover:shadow-md hover:scale-[1.005]'
                      } bg-card`}
                      style={isSelected ? ({ '--tw-ring-color': meta.color } as React.CSSProperties) : undefined}
                    >
                      {/* Top gradient bar */}
                      <div className={`h-1 w-full bg-gradient-to-r ${meta.gradient}`} />

                      <div className="p-3.5">
                        {/* Header row */}
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-9 h-9 rounded-xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center text-lg shadow-sm flex-shrink-0`}
                            >
                              {meta.emoji}
                            </div>
                            <div>
                              <div className="font-bold text-sm leading-tight">{c.constituency}</div>
                              <div className="text-[11px] text-muted-foreground truncate max-w-[140px] leading-tight mt-0.5">
                                {c.mla_name}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <ZoneLabel rate={c.resolution_rate} />
                            {meta.type !== 'GENERAL' && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                                {meta.type}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Stats grid */}
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          <div className="bg-muted/40 rounded-lg p-2 text-center">
                            <div className="text-base font-bold font-mono">{c.total}</div>
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Total</div>
                          </div>
                          <div className="bg-red-50 dark:bg-red-950/20 rounded-lg p-2 text-center">
                            <div className="text-base font-bold font-mono text-red-500">{c.active}</div>
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Active</div>
                          </div>
                          <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-2 text-center">
                            <div className="text-base font-bold font-mono text-emerald-500">{c.resolved}</div>
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Done</div>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-1 mb-2">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-muted-foreground">Resolution</span>
                            <span className="font-mono font-semibold">{rate.toFixed(0)}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <motion.div
                              className={`h-full rounded-full bg-gradient-to-r ${meta.gradient}`}
                              initial={{ width: 0 }}
                              animate={{ width: `${rate}%` }}
                              transition={{ duration: 0.8, delay: i * 0.05 }}
                            />
                          </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between mt-1">
                          {c.top_category ? (
                            <div className="flex items-center gap-1 text-[10px]">
                              <CatIcon className="w-3 h-3" style={{ color: CAT_COLORS[c.top_category] || '#6B7280' }} />
                              <span className="text-muted-foreground">{c.top_category}</span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">No complaints yet</span>
                          )}
                          <div className="flex items-center gap-2">
                            {c.critical_count > 0 && (
                              <span className="text-[10px] font-semibold text-red-500 flex items-center gap-0.5">
                                <AlertTriangle className="w-3 h-3" />
                                {c.critical_count}
                              </span>
                            )}
                            {c.avg_rating && (
                              <span className="text-[10px] font-medium text-amber-500 flex items-center gap-0.5">
                                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                                {c.avg_rating}
                              </span>
                            )}
                            <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                          </div>
                        </div>

                        {/* Expanded drill-down (live data from /api/mla/stats) */}
                        <AnimatePresence>
                          {isSelected && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
                                <div className="flex justify-between items-center">
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Constituency Drill-Down
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-3 text-[10px] text-muted-foreground">
                                    <span>MLA: <span className="font-medium text-foreground">{c.mla_name || '—'}</span></span>
                                    <span>Type: <span className="font-medium text-foreground">{meta.type}</span></span>
                                  </div>
                                </div>

                                {drillLoading && (
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                                    <RefreshCw className="w-3 h-3 animate-spin" /> Loading details…
                                  </div>
                                )}

                                {!drillLoading && drill && drill.constituency === c.constituency && (
                                  <div className="space-y-3">
                                    {/* SLA + rating strip */}
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                      <div className="bg-muted/40 rounded-lg p-1.5">
                                        <div className="text-sm font-bold font-mono text-red-500">{drill.sla_breached}</div>
                                        <div className="text-[9px] text-muted-foreground">SLA Breach</div>
                                      </div>
                                      <div className="bg-muted/40 rounded-lg p-1.5">
                                        <div className="text-sm font-bold font-mono text-amber-500">{drill.critical}</div>
                                        <div className="text-[9px] text-muted-foreground">Critical</div>
                                      </div>
                                      <div className="bg-muted/40 rounded-lg p-1.5">
                                        <div className="text-sm font-bold font-mono">{drill.avg_rating ?? '—'}</div>
                                        <div className="text-[9px] text-muted-foreground">Avg Rating</div>
                                      </div>
                                    </div>

                                    {/* Block breakdown */}
                                    {drill.by_block?.length > 0 && (
                                      <div>
                                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Blocks</div>
                                        <div className="space-y-1">
                                          {drill.by_block.slice(0, 5).map(b => (
                                            <div key={b.block} className="flex items-center justify-between text-[11px]">
                                              <span className="truncate max-w-[120px]">{b.block}</span>
                                              <span className="font-mono text-muted-foreground">
                                                {b.resolved}/{b.total} resolved
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* Officers */}
                                    {drill.officers?.length > 0 && (
                                      <div>
                                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Top Officers</div>
                                        <div className="space-y-1">
                                          {drill.officers.slice(0, 3).map(o => (
                                            <div key={o.name} className="flex items-center justify-between text-[11px]">
                                              <span className="truncate max-w-[120px]">{o.name}</span>
                                              <span className="font-mono text-muted-foreground">{o.score}% · {o.total} cases</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* Recent complaints */}
                                    {drill.recent_complaints?.length > 0 && (
                                      <div>
                                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Recent</div>
                                        <div className="space-y-1">
                                          {drill.recent_complaints.slice(0, 4).map(rc => (
                                            <div key={rc.id} className="flex items-center gap-2 text-[11px]">
                                              <span className="font-mono text-[9px] text-muted-foreground flex-shrink-0">{rc.ticketNo}</span>
                                              <span className="truncate flex-1">{rc.issue}</span>
                                              <Badge variant="outline" className="text-[8px] h-3.5 px-1 flex-shrink-0">{rc.status}</Badge>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="lg:col-span-2 border shadow-sm">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                    <TrendingUp className="w-3.5 h-3.5" /> Complaint Trend (6 months)
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <ChartContainer className="h-[150px] w-full" config={{
                    f: { label: 'Filed', color: '#FF6B00' },
                    r: { label: 'Resolved', color: '#10B981' },
                  }}>
                    <AreaChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                      <defs>
                        <linearGradient id="gF2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#FF6B00" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#FF6B00" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="gR2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                      <XAxis dataKey="m" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="f" name="Filed" stroke="#FF6B00" strokeWidth={2} fill="url(#gF2)" />
                      <Area type="monotone" dataKey="r" name="Resolved" stroke="#10B981" strokeWidth={2} fill="url(#gR2)" />
                    </AreaChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card className="border shadow-sm">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                    <BarChart3 className="w-3.5 h-3.5" /> Top Issues
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  {pieData.length > 0 ? (
                    <div className="space-y-3">
                      <ChartContainer className="h-[90px] w-full" config={{}}>
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" innerRadius={28} outerRadius={42} paddingAngle={3} dataKey="value">
                            {pieData.map(entry => (
                              <Cell key={entry.name} fill={CAT_COLORS[entry.name] || '#6B7280'} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ChartContainer>
                      <div className="flex flex-wrap gap-x-2 gap-y-1">
                        {pieData.map(e => (
                          <div key={e.name} className="flex items-center gap-1 text-[10px]">
                            <span className="w-2 h-2 rounded-full" style={{ background: CAT_COLORS[e.name] || '#6B7280' }} />
                            <span className="text-muted-foreground">{e.name} ({e.value})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="h-[130px] flex items-center justify-center text-xs text-muted-foreground">
                      No category data yet
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}

        {/* ══ LEADERBOARD ══════════════════════════ */}
        {tab === 'leaderboard' && (
          <motion.div key="lb"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} className="space-y-3">

            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-500" />
              Constituency Rankings — Resolution Rate
            </h2>

            {ranked.map((c, i) => {
              const pal = metaFor(c.constituency);
              const meta = { ...pal, type: c.constituency_type || '', mla: c.mla_name || '' };
              const rate = c.resolution_rate ?? 0;
              const medals = ['🥇', '🥈', '🥉'];

              return (
                <motion.div key={c.constituency}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-muted/20 transition-colors"
                >
                  <div className="w-8 text-center text-lg font-bold flex-shrink-0">
                    {i < 3 ? medals[i] : <span className="text-xs font-mono text-muted-foreground">#{i+1}</span>}
                  </div>
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${meta.gradient} flex items-center justify-center text-base flex-shrink-0`}>
                    {meta.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm">{c.constituency}</span>
                      <ZoneLabel rate={c.resolution_rate} />
                      {meta.type && meta.type !== 'GENERAL' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{meta.type}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <motion.div
                          className={`h-full rounded-full bg-gradient-to-r ${meta.gradient}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${rate}%` }}
                          transition={{ duration: 0.7, delay: i * 0.06 }}
                        />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground w-9 text-right">{rate.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="hidden sm:grid grid-cols-3 gap-3 text-center flex-shrink-0">
                    <div>
                      <div className="text-sm font-bold font-mono">{c.total}</div>
                      <div className="text-[9px] text-muted-foreground">Total</div>
                    </div>
                    <div>
                      <div className="text-sm font-bold font-mono text-red-500">{c.active}</div>
                      <div className="text-[9px] text-muted-foreground">Active</div>
                    </div>
                    <div>
                      <div className="text-sm font-bold font-mono text-emerald-500">{c.resolved}</div>
                      <div className="text-[9px] text-muted-foreground">Done</div>
                    </div>
                  </div>
                  <div className="hidden md:block text-right flex-shrink-0">
                    <div className="text-[11px] text-muted-foreground max-w-[110px] truncate">{c.mla_name}</div>
                    {c.top_category && (
                      <div className="flex items-center gap-1 justify-end mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: CAT_COLORS[c.top_category] || '#6B7280' }} />
                        <span className="text-[10px] text-muted-foreground">{c.top_category}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* ══ INTEL ════════════════════════════════ */}
        {tab === 'intel' && (
          <motion.div key="intel"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} className="space-y-4">

            <h2 className="text-sm font-semibold flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 text-violet-500" />
              AI Intelligence — District Level
            </h2>

            <div className="grid grid-cols-3 gap-3">
              <Card className="border"><CardContent className="p-3 text-center">
                <div className="text-2xl font-bold font-mono text-red-500">{s.critical_alerts || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">Critical Active</div>
              </CardContent></Card>
              <Card className="border"><CardContent className="p-3 text-center">
                <div className="text-2xl font-bold font-mono text-amber-500">{s.active_alerts || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">Intel Alerts</div>
              </CardContent></Card>
              <Card className="border"><CardContent className="p-3 text-center">
                <div className="text-2xl font-bold font-mono text-emerald-500">
                  {constData.filter(c => c.total > 0 && (c.resolution_rate ?? 0) >= 75).length}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Good Zones</div>
              </CardContent></Card>
            </div>

            {/* Constituency health summary */}
            <Card className="border">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Constituency Health Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {constData.map(c => {
                  const meta = metaFor(c.constituency);
                  const rate = c.resolution_rate ?? 0;
                  return (
                    <div key={c.constituency} className="flex items-center gap-3">
                      <span className="text-sm w-6 text-center">{meta.emoji}</span>
                      <span className="text-xs font-medium w-24 flex-shrink-0">{c.constituency}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${meta.gradient} transition-all`}
                          style={{ width: `${rate}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono w-10 text-right text-muted-foreground">
                        {c.total > 0 ? `${rate.toFixed(0)}%` : 'N/A'}
                      </span>
                      {c.critical_count > 0 && (
                        <span className="text-[10px] text-red-500 font-semibold flex items-center gap-0.5 w-12">
                          <AlertTriangle className="w-3 h-3" />{c.critical_count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <div className="flex flex-col items-center justify-center py-8 text-center bg-muted/20 rounded-xl border">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" />
              <div className="font-semibold text-sm">Intelligence Engine Active</div>
              <div className="text-xs text-muted-foreground mt-1 max-w-xs">
                Monitoring all constituencies under your seat every 6 hours. JS-09 will send alerts to your Telegram if threats are detected.
              </div>
            </div>
          </motion.div>
        )}

        {/* ══ REPORTS ══════════════════════════════ */}
        {tab === 'reports' && (
          <motion.div key="rp"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} className="space-y-4">

            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-muted-foreground" />
              Press Report Generator
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { title: 'Monthly Report',    desc: 'All constituencies under your seat — complaint stats, resolution rates, officer performance.', icon: CalendarRange, color: 'text-blue-500',   bg: 'bg-blue-500/10'   },
                { title: 'Achievement Report', desc: 'Top resolved issues, best constituency, fastest officers — press release ready.', icon: Award,          color: 'text-amber-500', bg: 'bg-amber-500/10'  },
                { title: 'District Summary',   desc: 'Purulia district health score, active alerts, intelligence summary.',            icon: BarChart3,      color: 'text-violet-500',bg: 'bg-violet-500/10' },
              ].map((r, i) => (
                <motion.div key={r.title}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.08 }}>
                  <Card className="border hover:shadow-md transition-shadow cursor-pointer group">
                    <CardContent className="p-4">
                      <div className={`w-9 h-9 rounded-xl ${r.bg} flex items-center justify-center mb-3`}>
                        <r.icon className={`w-4.5 h-4.5 ${r.color}`} />
                      </div>
                      <div className="font-semibold text-sm mb-1">{r.title}</div>
                      <div className="text-xs text-muted-foreground leading-relaxed mb-3">{r.desc}</div>
                      <Button size="sm" variant="outline" className="w-full h-7 text-xs">
                        Generate PDF
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>

            <Card className="border bg-muted/20">
              <CardContent className="p-4 text-center text-xs text-muted-foreground">
                JS-19 workflow auto-sends monthly PDF to MP Telegram on 1st of each month.
                JS-20 sends MLA score cards. Manual generation coming soon.
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
