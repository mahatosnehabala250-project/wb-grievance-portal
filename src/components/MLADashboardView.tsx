'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Building2, Activity, CheckCircle2, AlertTriangle, Clock,
  Users, Star, TrendingUp, RefreshCw, Target, Award,
  MapPin, FileText, Search, X, Filter, Droplets,
  Navigation2, Heart, Zap, BookOpen, Package, Home,
  Landmark, Scale, MoreHorizontal, Timer, BrainCircuit,
  ShieldAlert, CircleDot, ChevronDown, ChevronUp,
  CalendarRange, BarChart3, Sparkles, BadgeCheck,
  ArrowUpRight, Flame, CheckCircle, AlertCircle, Repeat,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, RadialBarChart, RadialBar,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { authHeaders, fmtDate } from '@/lib/helpers';
import { SLA_DAYS } from '@/lib/sla';
import { useAuthStore } from '@/lib/auth-store';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── Types ──────────────────────────────────────────────── */
interface MLAStats {
  constituency: string; mla_name: string;
  total: number; active: number; resolved: number;
  registered: number; in_progress: number; assigned: number;
  critical: number; sla_breached: number;
  last_24h: number; last_7d: number; last_30d: number;
  resolution_rate: number; avg_rating: number | null;
  by_category: { category:string; total:number; resolved:number; active:number }[];
  by_block:    { block:string; total:number; active:number; resolved:number }[];
  trend:       { date:string; filed:number; resolved:number }[];
  officers:    { name:string; score:number; resolved:number; active:number; total:number }[];
  recent_complaints: Complaint[];
  recently_resolved: Complaint[];
  sla_breached_list: Complaint[];
  ageing: { key:string; label:string; count:number }[];
  speed:  { resolvedCount:number; medianDays:number|null; slowestTenthDays:number|null; oldestOpenDays:number };
  flow:   { windowDays:number; arrived:number; closed:number; net:number };
  stuck:  { block:string; open:number; oldestDays:number; overMonth:number }[];
  stale_list: (Complaint & { daysWaiting:number; assignedToId:string|null })[];
  repeatVillages: { village:string; block:string; total:number; open:number; topCategory:string; sameIssue:number }[];
}

interface Assignee { id:string; name:string; role:string; block:string|null }

interface Complaint {
  id: string; ticketNo: string; citizenName: string;
  issue: string; status: string; urgency: string; category: string;
  block: string; createdAt: string; updatedAt: string;
  assignedOfficerName: string | null; satisfactionRating: string | null;
}

/* ─── Config ─────────────────────────────────────────────── */
const CAT_CFG: Record<string,{ icon: React.ElementType; color: string; bg: string; label: string }> = {
  WATER:       { icon: Droplets,    color: '#3B82F6', bg: 'bg-blue-500/10',   label: 'Water'  },
  ROAD:        { icon: Navigation2, color: '#F59E0B', bg: 'bg-amber-500/10',  label: 'Roads'       },
  HEALTH:      { icon: Heart,       color: '#EF4444', bg: 'bg-red-500/10',    label: 'Health'    },
  ELECTRICITY: { icon: Zap,         color: '#EAB308', bg: 'bg-yellow-500/10', label: 'Electricity'       },
  EDUCATION:   { icon: BookOpen,    color: '#06B6D4', bg: 'bg-cyan-500/10',   label: 'Education'     },
  RATION:      { icon: Package,     color: '#10B981', bg: 'bg-emerald-500/10',label: 'Ration'       },
  HOUSING:     { icon: Home,        color: '#8B5CF6', bg: 'bg-violet-500/10', label: 'Housing'        },
  PENSION:     { icon: Landmark,    color: '#EC4899', bg: 'bg-pink-500/10',   label: 'Pension'     },
  LAND:        { icon: MapPin,      color: '#F97316', bg: 'bg-orange-500/10', label: 'Bhoomi'      },
  LAW_ORDER:   { icon: Scale,       color: '#6366F1', bg: 'bg-indigo-500/10', label: 'Kanoon'      },
  SANITATION:  { icon: Droplets,    color: '#14B8A6', bg: 'bg-teal-500/10',   label: 'Sanitation'       },
  OTHER:       { icon: MoreHorizontal,color:'#6B7280',bg: 'bg-gray-500/10',   label: 'Other'        },
};

const STATUS_CFG: Record<string,{ label:string; dot:string; text:string; bg:string }> = {
  REGISTERED:  { label:'Registered',  dot:'bg-blue-500',    text:'text-blue-600 dark:text-blue-400',    bg:'bg-blue-50 dark:bg-blue-950/40'    },
  ASSIGNED:    { label:'Assigned',    dot:'bg-violet-500',  text:'text-violet-600 dark:text-violet-400',bg:'bg-violet-50 dark:bg-violet-950/40'},
  IN_PROGRESS: { label:'In Progress', dot:'bg-amber-500',   text:'text-amber-600 dark:text-amber-400',  bg:'bg-amber-50 dark:bg-amber-950/40'  },
  RESOLVED:    { label:'Resolved',    dot:'bg-emerald-500', text:'text-emerald-600 dark:text-emerald-400',bg:'bg-emerald-50 dark:bg-emerald-950/40'},
  REJECTED:    { label:'Rejected',    dot:'bg-gray-400',    text:'text-gray-500',                        bg:'bg-gray-50 dark:bg-gray-900/40'    },
  CLOSED:      { label:'Closed',      dot:'bg-slate-400',   text:'text-slate-500',                       bg:'bg-slate-50 dark:bg-slate-900/40'  },
};

const URG_CFG: Record<string,{ label:string; text:string; bg:string }> = {
  CRITICAL: { label:'Critical', text:'text-red-600',    bg:'bg-red-100 dark:bg-red-950/40'    },
  HIGH:     { label:'High',     text:'text-orange-600', bg:'bg-orange-50 dark:bg-orange-950/40'},
  MEDIUM:   { label:'Medium',   text:'text-yellow-600', bg:'bg-yellow-50 dark:bg-yellow-950/40'},
  LOW:      { label:'Low',      text:'text-sky-600',    bg:'bg-sky-50 dark:bg-sky-950/40'      },
};

// Constituency color theme
const CONST_THEME: Record<string,{ gradient: string; color: string; emoji: string }> = {
  Purulia:       { gradient:'from-orange-500 to-amber-500', color:'#FF6B00', emoji:'🏙' },
  Joypur:        { gradient:'from-blue-500 to-cyan-500',    color:'#3B82F6', emoji:'🌿' },
  Balarampur:    { gradient:'from-violet-500 to-purple-600',color:'#8B5CF6', emoji:'⛰' },
  Baghmundi:     { gradient:'from-cyan-500 to-teal-500',    color:'#06B6D4', emoji:'🌊' },
  Manbazar:      { gradient:'from-emerald-500 to-green-500',color:'#10B981', emoji:'🌳' },
  Bandwan:       { gradient:'from-amber-500 to-yellow-500', color:'#F59E0B', emoji:'🔥' },
  Kashipur:      { gradient:'from-red-500 to-rose-500',     color:'#EF4444', emoji:'⚡' },
  Para:          { gradient:'from-pink-500 to-rose-400',    color:'#EC4899', emoji:'🌸' },
  Raghunathpur:  { gradient:'from-indigo-500 to-violet-500',color:'#6366F1', emoji:'💎' },
};

/* ─── Mini Components ────────────────────────────────────── */
/**
 * Counts are printed, not animated.
 *
 * This used to tick up from zero over ~half a second. On a dashboard people
 * glance at rather than watch, that means the first thing an MLA sees is a
 * number that is simply wrong — the banner and the cards below it disagreed on
 * screen for as long as the animation ran, which reads as broken data. Nothing
 * is gained that is worth a wrong figure, however briefly.
 */
function AnimNum({ n, suffix='' }: { n:number; suffix?:string }) {
  return <>{n.toLocaleString('en-IN')}{suffix}</>;
}

/**
 * The backlog in one bar, oldest segment on the right.
 *
 * A count of open cases says nothing about whether an office is busy or
 * negligent — twenty-eight filed this week and twenty-eight sitting past a
 * month are different situations with the same number. The shape is the answer.
 */
const AGE_TONE: Record<string, string> = {
  '0-3':   '#10B981',
  '4-7':   '#84CC16',
  '8-15':  '#F59E0B',
  '16-30': '#F97316',
  '30+':   '#EF4444',
};
function BacklogBar({ bands }: { bands: { key:string; label:string; count:number }[] }) {
  const total = bands.reduce((s, b) => s + b.count, 0);
  if (!total) return <div className="text-xs text-muted-foreground">Nothing open right now.</div>;
  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden bg-muted">
        {bands.map(b => b.count > 0 && (
          <div key={b.key} title={`${b.label}: ${b.count}`}
               style={{ width: `${(b.count / total) * 100}%`, background: AGE_TONE[b.key] }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {bands.filter(b => b.count > 0).map(b => (
          <span key={b.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: AGE_TONE[b.key] }} />
            <span className="tabular-nums font-semibold text-foreground">{b.count}</span> {b.label.toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScoreDial({ score }: { score: number }) {
  const color = score>=75 ? '#10B981' : score>=50 ? '#F59E0B' : '#EF4444';
  return (
    <div className="relative w-20 h-20">
      <RadialBarChart width={80} height={80} cx={40} cy={40}
        innerRadius={28} outerRadius={36} startAngle={225} endAngle={-45}
        data={[{ value: score, fill: color }]} barSize={8}>
        <RadialBar background={{ fill: 'var(--muted)' }} dataKey="value" />
      </RadialBarChart>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold font-mono leading-none" style={{ color }}>{score}%</span>
        <span className="text-[9px] text-muted-foreground">resolved</span>
      </div>
    </div>
  );
}

/* ─── Main Component ──────────────────────────────────────── */
export function MLADashboardView() {
  const { user } = useAuthStore();
  const constituency = user?.constituency || '';
  const theme = CONST_THEME[constituency] || { gradient:'from-blue-500 to-violet-500', color:'#3B82F6', emoji:'🏛' };

  const [data, setData]   = useState<MLAStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab]     = useState<'home'|'complaints'|'blocks'|'officers'|'intel'>('home');
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState('ALL');
  const [catF, setCatF]   = useState('ALL');
  const [urgF, setUrgF]   = useState('ALL');
  const [lastSync, setLastSync] = useState(new Date());
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (silent=false) => {
    if (!constituency) return;
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const res = await fetch(
        `/api/mla/stats?constituency=${encodeURIComponent(constituency)}`,
        { headers: authHeaders() }
      );
      if (res.status === 403) {
        toast.error('Access denied — you can only view your own constituency');
        return;
      }
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
        setLastSync(new Date());
      }
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [constituency]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const iv = setInterval(() => load(true), 60000);
    return () => clearInterval(iv);
  }, [load]);

  // Who a case can be handed to. Loaded once; the endpoint already returns only
  // people inside the caller's jurisdiction.
  useEffect(() => {
    fetch('/api/users/list', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(j => setAssignees(j?.users || []))
      .catch(() => {});
  }, []);

  /**
   * Hand a complaint to someone, from the dashboard.
   *
   * The page could say a case had waited 119 days but offered no way to do
   * anything about it, so reading it changed nothing. Assigning also moves the
   * case to ASSIGNED — leaving it REGISTERED after naming an owner would let it
   * keep counting as untouched.
   */
  const assignTo = async (complaintId: string, userId: string) => {
    setBusyId(complaintId);
    try {
      const res = await fetch(`/api/complaints/${complaintId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ assignedToId: userId, status: 'ASSIGNED' }),
      });
      if (res.ok) {
        toast.success('Assigned');
        await load(true);
      } else {
        const j = await res.json().catch(() => null);
        toast.error(j?.error || 'Could not assign');
      }
    } catch { toast.error('Network error'); }
    finally { setBusyId(null); }
  };

  if (!constituency) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center p-8">
        <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <div className="font-semibold mb-1">Constituency not assigned</div>
        <div className="text-sm text-muted-foreground">Contact admin to set your constituency</div>
      </div>
    </div>
  );

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <motion.div animate={{ rotate:360 }} transition={{ duration:1.2, repeat:Infinity, ease:'linear' }}
          className="w-10 h-10 rounded-full border-2 border-t-transparent mx-auto mb-3"
          style={{ borderColor: theme.color, borderTopColor:'transparent' }} />
        <p className="text-sm text-muted-foreground">Loading {constituency} data...</p>
      </div>
    </div>
  );

  const d = data!;
  const complaints = d?.recent_complaints || [];

  // Filtered complaints
  const filtered = complaints.filter(c => {
    const ms = !search || c.ticketNo?.toLowerCase().includes(search.toLowerCase()) ||
      c.citizenName?.toLowerCase().includes(search.toLowerCase()) ||
      c.issue?.toLowerCase().includes(search.toLowerCase());
    return ms &&
      (statusF==='ALL' || c.status===statusF) &&
      (catF==='ALL' || c.category===catF) &&
      (urgF==='ALL' || c.urgency===urgF);
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">

      {/* ── Header ──────────────────────────────── */}
      <div className="flex-shrink-0 border-b bg-background/95 backdrop-blur sticky top-0 z-10">

        {/* Constituency banner */}
        <div className={`bg-gradient-to-r ${theme.gradient} px-4 py-2`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">{theme.emoji}</span>
              <div>
                <div className="font-bold text-white text-base leading-tight">{constituency} Constituency</div>
                <div className="text-white/80 text-[11px]">{user?.name} · MLA Dashboard</div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-white/90 text-xs">
              {d && (
                <>
                  <div className="text-center">
                    <div className="font-bold text-lg leading-none">{d.total}</div>
                    <div className="text-[9px] uppercase opacity-80">Total</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-lg leading-none text-red-200">{d.active}</div>
                    <div className="text-[9px] uppercase opacity-80">Active</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-lg leading-none text-emerald-200">{d.resolved}</div>
                    <div className="text-[9px] uppercase opacity-80">Resolved</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tabs + sync */}
        <div className="px-4 py-1.5 flex items-center justify-between gap-2">
          <div className="flex gap-0.5 bg-muted/50 rounded-lg p-0.5">
            {([
              { id:'home',       label:'🏠 Home'      },
              { id:'complaints', label:'📋 Complaints' },
              { id:'blocks',     label:'📍 Blocks'    },
              { id:'officers',   label:'👤 Officers'  },
              { id:'intel',      label:'🧠 Intel'     },
            ] as const).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                  tab===t.id ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {d?.sla_breached > 0 && (
              <Badge variant="destructive" className="text-[10px] h-5 animate-pulse">
                ⚠ {d.sla_breached} SLA breach
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={()=>load(true)} disabled={refreshing} className="h-7 text-[11px] px-2">
              <RefreshCw className={`w-3 h-3 mr-1 ${refreshing?'animate-spin':''}`} />
              {lastSync.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Content ─────────────────────────────── */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
        <AnimatePresence mode="wait">

        {/* ══ HOME TAB ════════════════════════════ */}
        {tab==='home' && d && (
          <motion.div key="home" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="space-y-4">

            {/* ── What needs a decision today ───────────
                This used to be seven equal tiles above two equally loud alert
                bars, so nothing was ranked and the eye had no entry point. The
                three figures below are the ones an MLA can act on; the rest of
                the counts moved to the line under them, where they belong.
                Three across from `sm` up: below that breakpoint they stacked
                into a column tall enough to push the backlog off the screen. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card className={`border shadow-none ${d.sla_breached > 0 ? 'border-amber-300 dark:border-amber-900' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{d.sla_breached}</span>
                    <span className="text-sm text-muted-foreground">of {d.active} open</span>
                  </div>
                  <div className="text-sm font-semibold mt-1">Past their deadline</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {d.active > 0 ? `${Math.round((d.sla_breached / d.active) * 100)}% of everything still open` : 'Nothing open'}
                  </div>
                </CardContent>
              </Card>

              <Card className={`border shadow-none ${d.critical > 0 ? 'border-red-300 dark:border-red-900' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-4xl font-bold tabular-nums ${d.critical > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {d.critical}
                    </span>
                    {d.critical === 0 && <span className="text-sm text-muted-foreground">all clear</span>}
                  </div>
                  <div className="text-sm font-semibold mt-1">Critical, still open</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {d.critical > 0 ? 'Highest urgency — these escalate first' : 'No critical case is waiting'}
                  </div>
                </CardContent>
              </Card>

              <Card className="border shadow-none">
                <CardContent className="p-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold tabular-nums">{d.speed?.oldestOpenDays ?? 0}</span>
                    <span className="text-sm text-muted-foreground">days</span>
                  </div>
                  <div className="text-sm font-semibold mt-1">Longest anyone has waited</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {d.speed?.medianDays != null
                      ? `Typical case closes in ${d.speed.medianDays} days`
                      : 'No case has closed yet'}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* The remaining counts, stated once rather than tiled */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span><span className="font-semibold text-foreground tabular-nums">{d.total}</span> total</span>
              <span><span className="font-semibold text-foreground tabular-nums">{d.resolved}</span> resolved</span>
              <span><span className="font-semibold text-foreground tabular-nums">{d.registered}</span> registered</span>
              <span><span className="font-semibold text-foreground tabular-nums">{d.in_progress}</span> in progress</span>
              <span><span className="font-semibold text-foreground tabular-nums">{d.last_7d}</span> filed this week</span>
            </div>

            {/* ── Backlog shape + whether the pile is growing ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="lg:col-span-2 border shadow-sm">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> How long the open cases have been waiting
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <BacklogBar bands={d.ageing || []} />
                </CardContent>
              </Card>

              <Card className="border shadow-sm">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" /> Keeping up?
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {d.flow ? (
                    <>
                      <div className={`text-3xl font-bold tabular-nums ${d.flow.net > 0 ? 'text-red-600 dark:text-red-400' : d.flow.net < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                        {d.flow.net > 0 ? '+' : ''}{d.flow.net}
                      </div>
                      <div className="text-sm font-semibold mt-0.5">
                        {d.flow.net > 0 ? 'The pile grew' : d.flow.net < 0 ? 'The pile shrank' : 'Holding level'}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {d.flow.arrived} came in, {d.flow.closed} closed — last {d.flow.windowDays} days
                      </div>
                    </>
                  ) : <div className="text-xs text-muted-foreground">No flow data</div>}
                </CardContent>
              </Card>
            </div>

            {/* Main 2-col layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* Trend chart */}
              <Card className="lg:col-span-2 border shadow-sm">
                <CardHeader className="pb-1 pt-3 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5" /> Complaint Trend
                    </CardTitle>
                    <div className="flex gap-2 text-[10px]">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{background:theme.color}} />Filed</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Resolved</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  {d.trend.length > 0 ? (
                    <ChartContainer className="h-[140px] w-full" config={{
                      filed:    { label:'Filed',    color: theme.color  },
                      resolved: { label:'Resolved', color: '#10B981' },
                    }}>
                      <AreaChart data={d.trend} margin={{top:4,right:4,bottom:0,left:-24}}>
                        <defs>
                          <linearGradient id="gMLA1" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={theme.color} stopOpacity={0.2}/>
                            <stop offset="95%" stopColor={theme.color} stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="gMLA2" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                        <XAxis dataKey="date" tick={{ fontSize:10 }} />
                        <YAxis tick={{ fontSize:10 }} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Area type="monotone" dataKey="filed" name="Filed" stroke={theme.color} strokeWidth={2} fill="url(#gMLA1)" />
                        <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#10B981" strokeWidth={2} fill="url(#gMLA2)" />
                      </AreaChart>
                    </ChartContainer>
                  ) : (
                    <div className="h-[140px] flex items-center justify-center text-xs text-muted-foreground">
                      Complaint history dikhne ke liye data chahiye
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Score + Rating */}
              <Card className="border shadow-sm">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5" /> Constituency Score
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 flex flex-col items-center gap-3">
                  <ScoreDial score={Math.round(d.resolution_rate)} />
                  <div className="w-full space-y-2">
                    {[
                      { l:'Resolved', v:d.resolved, t:d.total, c:'#10B981' },
                      { l:'Active',   v:d.active,   t:d.total, c:'#EF4444' },
                    ].map(m => (
                      <div key={m.l} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{m.l}</span>
                          <span className="font-mono">{m.v}/{m.t}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <motion.div className="h-full rounded-full"
                            style={{ background: m.c }}
                            initial={{width:0}}
                            animate={{width:`${(m.v/Math.max(m.t,1))*100}%`}}
                            transition={{duration:0.8}} />
                        </div>
                      </div>
                    ))}
                    {d.avg_rating && (
                      <div className="pt-2 border-t border-border/40 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Citizen Rating</span>
                        <div className="flex items-center gap-1">
                          {[1,2,3,4,5].map(n => (
                            <div key={n} className={`w-2.5 h-2.5 rounded-sm ${n<=Math.round(d.avg_rating!) ? 'bg-amber-400':'bg-muted'}`} />
                          ))}
                          <span className="text-xs font-mono ml-1 text-amber-500">{d.avg_rating}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ── Where it is stuck ──────────────────────
                Ranked by how long the oldest case has waited, not by volume.
                Three complaints untouched for six weeks need the MLA more than
                twenty filed yesterday, and a count sorted by size hides that. */}
            {d.stuck && d.stuck.length > 0 && (
              <Card className="border shadow-sm">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> Where it is stuck — longest wait first
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <div className="space-y-1.5">
                    {d.stuck.slice(0, 6).map(s => (
                      <div key={s.block} className="flex items-center gap-3 py-1">
                        <span className="text-[13px] flex-1 truncate">{s.block}</span>
                        {s.overMonth > 0 && (
                          <Badge className="text-[10px] border-0 bg-red-500/12 text-red-700 dark:text-red-400">
                            {s.overMonth} over a month
                          </Badge>
                        )}
                        <span className="text-[11px] text-muted-foreground tabular-nums w-16 text-right">
                          {s.open} open
                        </span>
                        <span className="text-[13px] font-semibold tabular-nums w-20 text-right">
                          {s.oldestDays}d
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    The right-hand figure is the age of that block&rsquo;s oldest complaint still open.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* ── Villages the same problem keeps returning to ──
                One complaint from a village is a job. Four about the same thing
                is something broken that keeps being patched — a different
                decision, and nothing else on this page separates the two. */}
            {d.repeatVillages && d.repeatVillages.length > 0 && (
              <Card className="border shadow-sm">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Repeat className="w-3.5 h-3.5" /> Same village, again — where a permanent fix is due
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <div className="space-y-1.5">
                    {d.repeatVillages.slice(0, 6).map(v => {
                      const cfg = CAT_CFG[v.topCategory] || CAT_CFG.OTHER;
                      return (
                        <div key={v.village + v.block} className="flex items-center gap-3 py-1">
                          <cfg.icon className="w-3.5 h-3.5 shrink-0" style={{ color: cfg.color }} />
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] truncate">{v.village}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{v.block}</div>
                          </div>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {v.sameIssue}× {cfg.label.toLowerCase()}
                          </span>
                          {v.open > 0 && (
                            <Badge className="text-[10px] border-0 bg-amber-500/12 text-amber-700 dark:text-amber-400 shrink-0">
                              {v.open} open
                            </Badge>
                          )}
                          <span className="text-[13px] font-semibold tabular-nums w-12 text-right shrink-0">{v.total}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    The right-hand figure is every complaint ever filed from that village.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* ── The waiting list, with a way to act on it ──
                Everything above this point describes the backlog; none of it
                changed anything. These are the actual cases behind those
                numbers, oldest and unowned first, each with the one action an
                MLA can take from here: give it to somebody. */}
            {d.stale_list && d.stale_list.length > 0 && (
              <Card className="border shadow-sm">
                <CardHeader className="pb-1 pt-3 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5" /> Waiting longest — hand these out first
                    </CardTitle>
                    <span className="text-[11px] text-muted-foreground">
                      {d.stale_list.filter(c => !c.assignedToId).length} with nobody assigned
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <div className="divide-y">
                    {d.stale_list.slice(0, 10).map(c => {
                      const cfg = CAT_CFG[c.category] || CAT_CFG.OTHER;
                      const urg = URG_CFG[c.urgency];
                      return (
                        <div key={c.id} className="flex items-center gap-3 py-2">
                          <cfg.icon className="w-3.5 h-3.5 shrink-0" style={{ color: cfg.color }} />
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] truncate">{c.issue || c.ticketNo}</div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {c.ticketNo} · {c.block}
                              {c.assignedOfficerName ? ` · with ${c.assignedOfficerName}` : ' · nobody assigned'}
                            </div>
                          </div>
                          {urg && c.urgency === 'CRITICAL' && (
                            <Badge className={`text-[10px] border-0 ${urg.bg} ${urg.text} shrink-0`}>Critical</Badge>
                          )}
                          <span className="text-[13px] font-semibold tabular-nums w-14 text-right shrink-0">
                            {c.daysWaiting}d
                          </span>
                          <Select disabled={busyId === c.id} onValueChange={(v) => assignTo(c.id, v)}>
                            <SelectTrigger className="h-7 w-[140px] text-xs shrink-0">
                              <SelectValue placeholder={busyId === c.id ? 'Assigning…' : 'Assign to…'} />
                            </SelectTrigger>
                            <SelectContent>
                              {assignees.map(u => (
                                <SelectItem key={u.id} value={u.id} className="text-xs">
                                  {u.name}{u.block && u.block !== 'ALL' ? ` · ${u.block}` : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                  {d.stale_list.length > 10 && (
                    <button type="button" onClick={() => setTab('complaints')}
                            className="text-[11px] text-muted-foreground hover:text-foreground mt-2">
                      {d.stale_list.length - 10} more waiting →
                    </button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Category + Recent Resolved */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Category breakdown */}
              <Card className="border shadow-sm">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5" /> Issue Types — {constituency}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-2.5">
                  {d.by_category.length > 0 ? d.by_category.slice(0,6).map((cat, i) => {
                    const cfg = CAT_CFG[cat.category] || CAT_CFG.OTHER;
                    const rate = Math.round((cat.resolved / Math.max(cat.total,1)) * 100);
                    return (
                      <motion.div key={cat.category}
                        initial={{opacity:0,x:-6}} animate={{opacity:1,x:0}} transition={{delay:i*0.05}}
                        className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-lg ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
                          <cfg.icon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-medium">{cfg.label}</span>
                            <span className="text-muted-foreground font-mono">{cat.resolved}/{cat.total}</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <motion.div className="h-full rounded-full"
                              style={{ background: cfg.color }}
                              initial={{width:0}} animate={{width:`${rate}%`}}
                              transition={{duration:0.7,delay:i*0.05}} />
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground w-7 text-right">{rate}%</span>
                      </motion.div>
                    );
                  }) : (
                    <div className="text-center py-6 text-sm text-muted-foreground">No complaints yet</div>
                  )}
                </CardContent>
              </Card>

              {/* Recently resolved — achievement */}
              <Card className="border shadow-sm">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <BadgeCheck className="w-3.5 h-3.5 text-emerald-500" /> Recently Resolved ✨
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  {d.recently_resolved.length > 0 ? (
                    <div className="space-y-2">
                      {d.recently_resolved.slice(0,4).map((c,i) => {
                        const cfg = CAT_CFG[c.category] || CAT_CFG.OTHER;
                        return (
                          <motion.div key={c.id}
                            initial={{opacity:0,x:6}} animate={{opacity:1,x:0}} transition={{delay:i*0.06}}
                            className="flex items-center gap-2.5 p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900">
                            <cfg.icon className="w-3.5 h-3.5 flex-shrink-0" style={{color:cfg.color}} />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium truncate">{c.issue}</div>
                              <div className="text-[10px] text-muted-foreground">{c.block} · {fmtDate(c.updatedAt)}</div>
                            </div>
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                          </motion.div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-sm text-muted-foreground">
                      Nothing resolved yet this week
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}

        {/* ══ COMPLAINTS TAB ═══════════════════════ */}
        {tab==='complaints' && d && (
          <motion.div key="comp" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="space-y-3">

            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center bg-muted/20 rounded-xl p-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input value={search} onChange={e=>setSearch(e.target.value)}
                  placeholder="Search ticket, name, issue..." className="pl-8 h-8 text-xs" />
                {search && <button onClick={()=>setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X className="w-3.5 h-3.5 text-muted-foreground" /></button>}
              </div>
              <Select value={statusF} onValueChange={setStatusF}>
                <SelectTrigger className="h-8 text-xs w-32"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Status</SelectItem>
                  {Object.entries(STATUS_CFG).map(([k,v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={catF} onValueChange={setCatF}>
                <SelectTrigger className="h-8 text-xs w-32"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Issues</SelectItem>
                  {Object.entries(CAT_CFG).map(([k,v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={urgF} onValueChange={setUrgF}>
                <SelectTrigger className="h-8 text-xs w-28"><SelectValue placeholder="Urgency" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Urgency</SelectItem>
                  {Object.entries(URG_CFG).map(([k,v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground ml-auto font-mono">{filtered.length} complaints</span>
            </div>

            {filtered.length > 0 ? (
              <Card className="border shadow-sm overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-b">
                      <TableHead className="text-[11px] w-[120px]">Ticket</TableHead>
                      <TableHead className="text-[11px]">Citizen</TableHead>
                      <TableHead className="text-[11px]">Issue</TableHead>
                      <TableHead className="text-[11px]">Block</TableHead>
                      <TableHead className="text-[11px]">Status</TableHead>
                      <TableHead className="text-[11px]">Urgency</TableHead>
                      <TableHead className="text-[11px]">Date</TableHead>
                      <TableHead className="text-[11px]">Officer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((c,i) => {
                      const st = STATUS_CFG[c.status] || STATUS_CFG.REGISTERED;
                      const urg = URG_CFG[c.urgency] || URG_CFG.MEDIUM;
                      const cat = CAT_CFG[c.category] || CAT_CFG.OTHER;
                      return (
                        <motion.tr key={c.id}
                          initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*0.02}}
                          className="hover:bg-muted/20 transition-colors border-b border-border/40 cursor-pointer">
                          <TableCell className="py-2 font-mono text-[11px] text-primary font-medium">{c.ticketNo}</TableCell>
                          <TableCell className="py-2 text-xs font-medium max-w-[90px] truncate">{c.citizenName}</TableCell>
                          <TableCell className="py-2">
                            <div className="flex items-center gap-1.5">
                              <cat.icon className="w-3 h-3 flex-shrink-0" style={{color:cat.color}} />
                              <span className="text-xs truncate max-w-[100px]">{c.issue}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-xs text-muted-foreground">{c.block}</TableCell>
                          <TableCell className="py-2">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${st.bg} ${st.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                              {st.label}
                            </span>
                          </TableCell>
                          <TableCell className="py-2">
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${urg.bg} ${urg.text}`}>
                              {urg.label}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                            {fmtDate(c.createdAt)}
                          </TableCell>
                          <TableCell className="py-2 text-xs text-muted-foreground max-w-[90px] truncate">
                            {c.assignedOfficerName || '—'}
                          </TableCell>
                        </motion.tr>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            ) : (
              <div className="flex flex-col items-center justify-center py-20">
                <FileText className="w-10 h-10 text-muted-foreground mb-3" />
                <div className="font-medium text-sm mb-1">
                  {d.total === 0 ? `No complaints in ${constituency} yet` : 'No results found'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {d.total > 0 ? 'Try changing filters' : 'Waiting for the first complaint to arrive over WhatsApp'}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ══ BLOCKS TAB ══════════════════════════ */}
        {tab==='blocks' && d && (
          <motion.div key="blk" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <MapPin className="w-4 h-4" style={{color:theme.color}} />
              Block-wise Status — {constituency}
            </h2>

            {d.by_block.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {d.by_block.map((blk, i) => {
                  const activeRate = (blk.active / Math.max(blk.total,1)) * 100;
                  const resolvedRate = (blk.resolved / Math.max(blk.total,1)) * 100;
                  return (
                    <motion.div key={blk.block}
                      initial={{opacity:0,scale:0.95}} animate={{opacity:1,scale:1}} transition={{delay:i*0.06}}>
                      <Card className="border shadow-sm overflow-hidden">
                        <div className={`h-0.5 w-full bg-gradient-to-r ${theme.gradient}`} />
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <div className="font-bold text-sm">{blk.block}</div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                {blk.total} complaints
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xl font-bold font-mono" style={{color:theme.color}}>
                                {Math.round(resolvedRate)}%
                              </div>
                              <div className="text-[9px] text-muted-foreground">resolved</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 mb-3">
                            <div className="text-center bg-muted/40 rounded-lg p-2">
                              <div className="text-base font-bold font-mono">{blk.total}</div>
                              <div className="text-[9px] text-muted-foreground">Total</div>
                            </div>
                            <div className="text-center bg-red-50 dark:bg-red-950/20 rounded-lg p-2">
                              <div className="text-base font-bold font-mono text-red-500">{blk.active}</div>
                              <div className="text-[9px] text-muted-foreground">Active</div>
                            </div>
                            <div className="text-center bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-2">
                              <div className="text-base font-bold font-mono text-emerald-500">{blk.resolved}</div>
                              <div className="text-[9px] text-muted-foreground">Done</div>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                              <span>Resolution progress</span>
                              <span>{Math.round(resolvedRate)}%</span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <motion.div className={`h-full rounded-full bg-gradient-to-r ${theme.gradient}`}
                                initial={{width:0}} animate={{width:`${resolvedRate}%`}}
                                transition={{duration:0.8,delay:i*0.06}} />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-16 text-muted-foreground">
                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <div className="text-sm">Block data appears once complaints arrive</div>
              </div>
            )}
          </motion.div>
        )}

        {/* ══ OFFICERS TAB ════════════════════════ */}
        {tab==='officers' && d && (
          <motion.div key="off" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-500" />
                Officer Performance — {constituency}
              </h2>
              <span className="text-xs text-muted-foreground">Score = Resolved / Total assigned</span>
            </div>

            {d.officers.length > 0 ? (
              <div className="space-y-2">
                {d.officers.map((off, i) => {
                  const medals = ['🥇','🥈','🥉'];
                  const scoreColor = off.score>=75 ? '#10B981' : off.score>=50 ? '#F59E0B' : '#EF4444';
                  return (
                    <motion.div key={off.name}
                      initial={{opacity:0,x:-10}} animate={{opacity:1,x:0}} transition={{delay:i*0.07}}
                      className="flex items-center gap-3 p-3.5 rounded-xl border bg-card hover:bg-muted/20 transition-colors">
                      <div className="text-lg w-8 text-center">
                        {i<3 ? medals[i] : <span className="text-xs text-muted-foreground font-mono">#{i+1}</span>}
                      </div>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                        style={{background:`linear-gradient(135deg,${theme.color},${theme.color}99)`}}>
                        {off.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm mb-1">{off.name}</div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <motion.div className="h-full rounded-full"
                              style={{background: scoreColor}}
                              initial={{width:0}} animate={{width:`${off.score}%`}}
                              transition={{duration:0.8,delay:i*0.07}} />
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-center flex-shrink-0">
                        <div>
                          <div className="text-base font-bold font-mono" style={{color:scoreColor}}>{off.score}%</div>
                          <div className="text-[9px] text-muted-foreground">Score</div>
                        </div>
                        <div>
                          <div className="text-base font-bold font-mono text-emerald-500">{off.resolved}</div>
                          <div className="text-[9px] text-muted-foreground">Done</div>
                        </div>
                        <div>
                          <div className="text-base font-bold font-mono text-red-500">{off.active}</div>
                          <div className="text-[9px] text-muted-foreground">Active</div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-16 text-muted-foreground">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <div className="text-sm">Officer data appears once complaints are assigned</div>
              </div>
            )}
          </motion.div>
        )}

        {/* ══ INTEL TAB ══════════════════════════ */}
        {tab==='intel' && d && (
          <motion.div key="intel" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 text-violet-500" />
              Intelligence — {constituency}
            </h2>

            {/* SLA Breached */}
            {d.sla_breached_list.length > 0 && (
              <Card className="border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 shadow-sm">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-2">
                    <Timer className="w-3.5 h-3.5" /> SLA Breached — Past Deadline
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-2">
                  {d.sla_breached_list.map((c, i) => (
                    <div key={c.id} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-primary text-[11px]">{c.ticketNo}</span>
                      <span className="text-muted-foreground truncate flex-1">{c.issue}</span>
                      <span className="text-amber-600 font-medium whitespace-nowrap">{fmtDate(c.createdAt)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Critical pending */}
            {d.critical > 0 && (
              <Card className="border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Flame className="w-4 h-4 text-red-500" />
                    <span className="font-semibold text-sm text-red-600 dark:text-red-400">
                      {d.critical} Critical Complaint{d.critical>1?'s':''} — Urgent Action Needed
                    </span>
                  </div>
                  {/* Read from SLA_DAYS rather than written out. This said
                      "6-hour SLA" long after the allowance became a day, so the
                      screen was contradicting the deadline it was measuring. */}
                  <p className="text-xs text-muted-foreground">
                    A critical complaint is due within {SLA_DAYS.CRITICAL === 1 ? 'a day' : `${SLA_DAYS.CRITICAL} days`}. Call the officer, or escalate to the DM.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* All clear */}
            {d.critical === 0 && d.sla_breached === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
                  style={{background:`${theme.color}15`}}>
                  <CheckCircle2 className="w-7 h-7" style={{color:theme.color}} />
                </div>
                <div className="font-semibold text-sm mb-1">All Clear — {constituency}</div>
                <div className="text-xs text-muted-foreground max-w-xs">
                  Koi critical complaint nahi, koi SLA breach nahi. AI engine har 6 ghante monitoring karta hai.
                </div>
              </div>
            )}

            {/* Stats summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { l:'Critical Active',  v:d.critical,     c:'text-red-500'    },
                { l:'SLA Breached',     v:d.sla_breached, c:'text-amber-500'  },
                { l:'Resolved (30d)',   v:d.last_30d,     c:'text-emerald-500'},
                { l:'New (7 days)',     v:d.last_7d,      c:'text-blue-500'   },
              ].map(k => (
                <Card key={k.l} className="border shadow-none">
                  <CardContent className="p-3 text-center">
                    <div className={`text-2xl font-bold font-mono ${k.c}`}>{k.v}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{k.l}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </motion.div>
        )}

        </AnimatePresence>
        </div>
      </ScrollArea>
    </div>
  );
}
