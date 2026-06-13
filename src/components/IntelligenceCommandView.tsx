'use client';

/**
 * IntelligenceCommandView — role-adaptive "war room" intelligence brief.
 *
 * One component, every role: Karyakarta sees village-level ground intel,
 * GP coordinator sees GP intel, Block → GP breakdown, MLA → blocks,
 * MP → constituencies, District → blocks. The API (/api/intelligence/brief)
 * decides scope server-side from the JWT — this view just renders whatever
 * jurisdiction the server allows.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  BrainCircuit, RefreshCw, AlertTriangle, TrendingUp, TrendingDown,
  Target, Flame, ShieldAlert, Award, Star, Zap, Clock, CheckCircle2,
  Activity, Users, MapPin, Radar as RadarIcon, Trophy, Megaphone,
  Crosshair, Gauge as GaugeIcon, ArrowUpRight, ArrowDownRight, Minus,
  Footprints, Copy, ChevronDown, ChevronRight,
  Network, Layers, Frown, Building, Sparkles,
  Send, Lightbulb, Bot,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── Types (mirror of /api/intelligence/brief payload) ─── */
interface Brief {
  scope: { level: string; label: string; subAreaLabel: string; generatedAt: string };
  riskIndex: { score: number; grade: string; drivers: string[] };
  kpis: {
    total: number; active: number; resolved: number; critical: number; slaBreached: number;
    resolutionRate: number; avgResolutionDays: number | null; avgRating: number | null;
    ratedCount: number; filed7: number; filedPrev7: number; momentumPct: number; resolved14: number;
  };
  trend: Array<{ week: string; filed: number; resolved: number }>;
  categoryShare: Array<{ category: string; count: number; active: number; resolved: number }>;
  categorySurges: Array<{ category: string; current: number; previous: number; pctChange: number }>;
  hotspots: Array<{ name: string; total: number; active: number; critical: number; slaBreached: number; resolved: number; risk: number }>;
  sentiment: { distribution: Record<string, number>; avg: number | null; recentAvg: number | null; direction: string };
  officers: Array<{ name: string; total: number; resolved: number; active: number; score: number }>;
  benchmark: { label: string; peers: Array<{ name: string; total: number; resolved: number; resolutionRate: number; isSelf: boolean }>; percentile: number | null } | null;
  warnings: Array<{ severity: string; title: string; detail: string }>;
  wins: Array<{ ticketNo: string; issue: string; village: string; category: string; rating: number | null; resolvedAt: string }>;
  quickWins: Array<{ ticketNo: string; issue: string; village: string; category: string; daysOld: number }>;
}

interface WapasVillage {
  village: string;
  count: number;
  avgRating: number | null;
  items: Array<{
    ticketNo: string; citizenName: string; issue: string; category: string;
    resolution: string; rating: number | null; resolvedAt: string | null;
  }>;
}

interface NlpInsights {
  enabled: boolean;
  coverage: { total: number; enriched: number };
  clusters: Array<{ rootCause: string; key: string; count: number; villages: string[]; tickets: string[]; avgAnger: number }>;
  angerHotspots: Array<{ name: string; avgAnger: number; peakAnger: number; count: number }>;
  entityWatch: Array<{ type: string; name: string; count: number }>;
  emotionMix: Array<{ emotion: string; count: number }>;
  severityFlags: Array<{ flag: string; count: number }>;
}

const RISK_COLORS: Record<string, { c: string; bg: string; bar: string }> = {
  LOW:      { c: 'text-emerald-500', bg: 'bg-emerald-500/10', bar: '#10B981' },
  GUARDED:  { c: 'text-lime-500',    bg: 'bg-lime-500/10',    bar: '#84CC16' },
  ELEVATED: { c: 'text-amber-500',   bg: 'bg-amber-500/10',   bar: '#F59E0B' },
  HIGH:     { c: 'text-orange-500',  bg: 'bg-orange-500/10',  bar: '#F97316' },
  SEVERE:   { c: 'text-red-500',     bg: 'bg-red-500/10',     bar: '#EF4444' },
};

const CAT_COLORS: Record<string, string> = {
  WATER: '#3B82F6', ROAD: '#F59E0B', HEALTH: '#EF4444', ELECTRICITY: '#EAB308',
  RATION: '#10B981', EDUCATION: '#8B5CF6', OTHER: '#6B7280',
};
const catColor = (c: string) => CAT_COLORS[c] || '#6B7280';

const SEV_STYLE: Record<string, string> = {
  CRITICAL: 'border-red-500/40 bg-red-500/5',
  HIGH: 'border-orange-500/40 bg-orange-500/5',
  MEDIUM: 'border-amber-500/40 bg-amber-500/5',
};

const LEVEL_TITLES: Record<string, string> = {
  KARYAKARTA: 'Ground Intelligence',
  GP_COORD: 'Panchayat Intelligence',
  BLOCK_COORD: 'Block Intelligence',
  MLA: 'Constituency Intelligence',
  MP: 'Parliamentary Intelligence',
  DISTRICT_ADMIN: 'District Intelligence',
};

/* ─── Risk gauge (SVG arc) ─── */
function RiskGauge({ score, grade }: { score: number; grade: string }) {
  const style = RISK_COLORS[grade] || RISK_COLORS.ELEVATED;
  const angle = -90 + (score / 100) * 180;
  const arc = (from: number, to: number, color: string, opacity = 1) => {
    const r = 70, cx = 90, cy = 90;
    const a1 = ((from - 90) * Math.PI) / 180, a2 = ((to - 90) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    return <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`} stroke={color} strokeWidth="14" fill="none" strokeLinecap="round" opacity={opacity} />;
  };
  return (
    <div className="relative flex flex-col items-center">
      <svg width="180" height="105" viewBox="0 0 180 105">
        {arc(-90, -54, '#10B981', 0.25)}
        {arc(-54, -18, '#84CC16', 0.25)}
        {arc(-18, 18, '#F59E0B', 0.25)}
        {arc(18, 54, '#F97316', 0.25)}
        {arc(54, 90, '#EF4444', 0.25)}
        {arc(-90, Math.min(90, -90 + (score / 100) * 180), style.bar)}
        <g transform={`rotate(${angle} 90 90)`}>
          <line x1="90" y1="90" x2="90" y2="30" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="90" cy="90" r="5" fill="currentColor" />
        </g>
      </svg>
      <div className="absolute bottom-0 text-center">
        <div className={`text-2xl font-black font-mono ${style.c}`}>{score}</div>
      </div>
    </div>
  );
}

function Momentum({ pct }: { pct: number }) {
  if (pct > 10) return <span className="flex items-center gap-0.5 text-red-500 text-[10px] font-semibold"><ArrowUpRight className="w-3 h-3" />+{pct}%</span>;
  if (pct < -10) return <span className="flex items-center gap-0.5 text-emerald-500 text-[10px] font-semibold"><ArrowDownRight className="w-3 h-3" />{pct}%</span>;
  return <span className="flex items-center gap-0.5 text-muted-foreground text-[10px] font-semibold"><Minus className="w-3 h-3" />{pct}%</span>;
}

/* ─── Main ─── */
export function IntelligenceCommandView() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [wapas, setWapas] = useState<WapasVillage[] | null>(null);
  const [wapasLoading, setWapasLoading] = useState(false);
  const [openVillage, setOpenVillage] = useState<string | null>(null);
  const [nlp, setNlp] = useState<NlpInsights | null>(null);
  const [nlpLoading, setNlpLoading] = useState(false);
  const [advQ, setAdvQ] = useState('');
  const [advAnswer, setAdvAnswer] = useState<string | null>(null);
  const [advLoading, setAdvLoading] = useState(false);
  const [advError, setAdvError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const res = await fetch('/api/intelligence/brief', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setBrief(json.data || null);
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error || 'Failed to load intelligence');
      }
    } catch {
      toast.error('Failed to load intelligence');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* "Wapas Jao" — closed-loop visit briefs (loaded on demand) */
  const loadWapas = useCallback(async () => {
    setWapasLoading(true);
    try {
      const res = await fetch('/api/intelligence/wapas-jao', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setWapas(json.data?.villages || []);
      } else {
        toast.error('Failed to load visit briefs');
      }
    } catch {
      toast.error('Failed to load visit briefs');
    } finally {
      setWapasLoading(false);
    }
  }, []);

  /* AI Chief-of-Staff — ask a scoped question, get an evidence-cited answer */
  const askAdvisor = useCallback(async (q: string) => {
    const question = q.trim();
    if (!question) return;
    setAdvLoading(true); setAdvError(null); setAdvAnswer(null);
    try {
      const res = await fetch('/api/intelligence/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ question }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.answer) {
        setAdvAnswer(json.data.answer);
      } else {
        setAdvError(json?.error || 'Advisor could not answer');
      }
    } catch {
      setAdvError('Network error');
    } finally {
      setAdvLoading(false);
    }
  }, []);

  /* NLP Brain — root-cause clusters, anger hotspots, entity watch (on demand) */
  const loadNlp = useCallback(async () => {
    setNlpLoading(true);
    try {
      const res = await fetch('/api/intelligence/nlp-insights', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setNlp(json.data || null);
      } else {
        toast.error('Failed to load NLP insights');
      }
    } catch {
      toast.error('Failed to load NLP insights');
    } finally {
      setNlpLoading(false);
    }
  }, []);

  const copyVillageBrief = useCallback((v: WapasVillage) => {
    const lines = [
      `📍 ${v.village} — Visit Brief (${v.count} resolved${v.avgRating ? `, avg rating ${v.avgRating}/5` : ''})`,
      '',
      ...v.items.map(it =>
        `• ${it.citizenName} — ${it.issue}${it.rating ? ` (rated ${it.rating}★)` : ''} [${it.ticketNo}]`
      ),
      '',
      'Generated by JanSunwai Intelligence',
    ];
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => toast.success(`${v.village} brief copied — WhatsApp pe paste karo`))
      .catch(() => toast.error('Copy failed'));
  }, []);

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-3">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
          className="w-10 h-10 rounded-full border-2 border-violet-500 border-t-transparent mx-auto" />
        <p className="text-sm text-muted-foreground font-medium">Compiling intelligence brief…</p>
      </div>
    </div>
  );

  if (!brief) return (
    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
      No intelligence data available for your jurisdiction.
    </div>
  );

  const { riskIndex, kpis, scope } = brief;
  const riskStyle = RISK_COLORS[riskIndex.grade] || RISK_COLORS.ELEVATED;
  const title = LEVEL_TITLES[scope.level] || 'Intelligence Command';
  const pieData = brief.categoryShare.slice(0, 6).map(c => ({ name: c.category, value: c.count }));

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* ── Classified-style header ── */}
      <div className="flex-shrink-0 border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow shadow-violet-500/30">
              <BrainCircuit className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm">{title}</span>
                <Badge className="text-[9px] h-4 px-1.5 bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400 border-0 uppercase">
                  {scope.label}
                </Badge>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground tracking-widest">
                  RESTRICTED · EYES ONLY
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground font-mono">
                BRIEF GENERATED {new Date(scope.generatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} IST
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="h-7 text-xs px-2.5">
            <RefreshCw className={`w-3 h-3 mr-1 ${refreshing ? 'animate-spin' : ''}`} /> Re-run
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">

          {/* ── AI Chief-of-Staff — ask anything about your jurisdiction ── */}
          <Card className="border shadow-sm bg-gradient-to-br from-indigo-500/5 to-violet-500/5 border-indigo-500/20">
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                <Bot className="w-3.5 h-3.5 text-indigo-500" /> AI Chief-of-Staff
                <span className="text-[9px] normal-case font-normal">(apne ilake ke baare mein kuch bhi poochho — Bengali/Hindi/English)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <Input
                  value={advQ}
                  onChange={(e) => setAdvQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !advLoading) askAdvisor(advQ); }}
                  placeholder="e.g. is hafte mujhe kahan daura karna chahiye?"
                  className="h-9 text-sm"
                  disabled={advLoading}
                />
                <Button size="sm" className="h-9 px-3 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => askAdvisor(advQ)} disabled={advLoading || !advQ.trim()}>
                  {advLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </Button>
              </div>

              {/* Suggested questions */}
              {!advAnswer && !advLoading && (
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Is hafte kahan daura karun aur kyun?',
                    'Kaunsa officer sabse peeche hai?',
                    'Sabse urgent 3 cheezein kya hain?',
                    'Mera area peers se kaisa hai?',
                  ].map((q) => (
                    <button key={q} onClick={() => { setAdvQ(q); askAdvisor(q); }}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-muted hover:bg-indigo-500/10 text-muted-foreground hover:text-indigo-600 transition-colors">
                      <Lightbulb className="w-2.5 h-2.5" /> {q}
                    </button>
                  ))}
                </div>
              )}

              {advLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Aapke data pe soch raha hoon…
                </div>
              )}

              {advError && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5 text-[11px] text-amber-700 dark:text-amber-400">
                  {advError === 'Advisor not configured — set DEEPSEEK_API_KEY'
                    ? 'AI Chief-of-Staff abhi OFF hai. Admin ko Vercel mein DEEPSEEK_API_KEY set karna hoga.'
                    : advError}
                </div>
              )}

              {advAnswer && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-indigo-500/20 bg-background/60 p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Bot className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Advisor</span>
                  </div>
                  <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{advAnswer}</div>
                  <button onClick={() => { setAdvAnswer(null); setAdvQ(''); }} className="mt-2 text-[10px] text-muted-foreground hover:text-foreground">↻ Naya sawaal</button>
                </motion.div>
              )}
            </CardContent>
          </Card>

          {/* ── Row 1: Risk gauge + KPIs + warnings ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Political Risk Index */}
            <Card className={`border shadow-sm ${riskStyle.bg}`}>
              <CardHeader className="pb-0 pt-3 px-4">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                  <GaugeIcon className="w-3.5 h-3.5" /> Political Risk Index
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 flex flex-col items-center">
                <RiskGauge score={riskIndex.score} grade={riskIndex.grade} />
                <Badge className={`mt-1 text-[10px] font-bold ${riskStyle.c} ${riskStyle.bg} border-0`}>
                  {riskIndex.grade}
                </Badge>
                {riskIndex.drivers.length > 0 && (
                  <div className="mt-2 w-full space-y-1">
                    {riskIndex.drivers.slice(0, 3).map((d, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                        <Crosshair className="w-3 h-3 mt-0.5 flex-shrink-0 text-red-400" />
                        <span>{d}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* KPI grid */}
            <Card className="border shadow-sm">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                  <Activity className="w-3.5 h-3.5" /> Situation Report
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Total', val: kpis.total, c: 'text-blue-500' },
                    { label: 'Active', val: kpis.active, c: 'text-red-500' },
                    { label: 'Resolved', val: kpis.resolved, c: 'text-emerald-500' },
                    { label: 'Critical', val: kpis.critical, c: 'text-rose-500' },
                    { label: 'SLA Breach', val: kpis.slaBreached, c: 'text-orange-500' },
                    { label: 'Res. Rate', val: `${kpis.resolutionRate}%`, c: 'text-violet-500' },
                  ].map(k => (
                    <div key={k.label} className="bg-muted/40 rounded-lg p-2 text-center">
                      <div className={`text-lg font-bold font-mono ${k.c}`}>{k.val}</div>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wide">{k.label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="flex items-center justify-between bg-muted/30 rounded-lg px-2 py-1.5">
                    <span className="text-muted-foreground flex items-center gap-1"><Zap className="w-3 h-3" />7-day intake</span>
                    <span className="font-mono font-semibold flex items-center gap-1">{kpis.filed7} <Momentum pct={kpis.momentumPct} /></span>
                  </div>
                  <div className="flex items-center justify-between bg-muted/30 rounded-lg px-2 py-1.5">
                    <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />Avg resolve</span>
                    <span className="font-mono font-semibold">{kpis.avgResolutionDays !== null ? `${kpis.avgResolutionDays}d` : '—'}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Early warnings */}
            <Card className="border shadow-sm">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                  <ShieldAlert className="w-3.5 h-3.5 text-red-500" /> Early Warnings
                  {brief.warnings.length > 0 && (
                    <Badge className="text-[9px] h-4 px-1.5 bg-red-500/10 text-red-500 border-0">{brief.warnings.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-1.5 max-h-[230px] overflow-y-auto">
                {brief.warnings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 mb-1" />
                    <span className="text-xs text-muted-foreground">No active threat signals</span>
                  </div>
                ) : brief.warnings.map((w, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                    className={`rounded-lg border p-2 ${SEV_STYLE[w.severity] || SEV_STYLE.MEDIUM}`}>
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className={`w-3 h-3 flex-shrink-0 ${w.severity === 'CRITICAL' ? 'text-red-500' : w.severity === 'HIGH' ? 'text-orange-500' : 'text-amber-500'}`} />
                      <span className="text-[11px] font-semibold">{w.title}</span>
                      <Badge variant="outline" className="text-[8px] h-3.5 px-1 ml-auto">{w.severity}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 pl-4.5">{w.detail}</p>
                  </motion.div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* ── Row 2: Trend + Category pie + surges ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2 border shadow-sm">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                  <TrendingUp className="w-3.5 h-3.5" /> 12-Week Operational Tempo
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <ChartContainer className="h-[160px] w-full" config={{
                  filed: { label: 'Filed', color: '#8B5CF6' },
                  resolved: { label: 'Resolved', color: '#10B981' },
                }}>
                  <AreaChart data={brief.trend} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                    <defs>
                      <linearGradient id="gFiled" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="gRes" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                    <XAxis dataKey="week" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area type="monotone" dataKey="filed" name="Filed" stroke="#8B5CF6" strokeWidth={2} fill="url(#gFiled)" />
                    <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#10B981" strokeWidth={2} fill="url(#gRes)" />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card className="border shadow-sm">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                  <RadarIcon className="w-3.5 h-3.5" /> Issue Composition
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                {pieData.length > 0 ? (
                  <>
                    <ChartContainer className="h-[110px] w-full" config={{}}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={30} outerRadius={48} paddingAngle={3} dataKey="value">
                          {pieData.map(e => <Cell key={e.name} fill={catColor(e.name)} />)}
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                      </PieChart>
                    </ChartContainer>
                    <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1">
                      {pieData.map(e => (
                        <div key={e.name} className="flex items-center gap-1 text-[10px]">
                          <span className="w-2 h-2 rounded-full" style={{ background: catColor(e.name) }} />
                          <span className="text-muted-foreground">{e.name} ({e.value})</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="h-[140px] flex items-center justify-center text-xs text-muted-foreground">No data</div>
                )}
                {brief.categorySurges.length > 0 && (
                  <div className="mt-2 pt-2 border-t space-y-1">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-red-500 flex items-center gap-1">
                      <Flame className="w-3 h-3" /> Surging This Week
                    </div>
                    {brief.categorySurges.slice(0, 3).map(s => (
                      <div key={s.category} className="flex items-center justify-between text-[10px]">
                        <span>{s.category}</span>
                        <span className="font-mono text-red-500 font-semibold">+{s.pctChange}% ({s.previous}→{s.current})</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Row 3: Hotspots + Benchmark ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border shadow-sm">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                  <MapPin className="w-3.5 h-3.5 text-red-500" /> Hotspot Matrix — by {scope.subAreaLabel}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-1.5">
                {brief.hotspots.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">No sub-area data</div>
                ) : brief.hotspots.map((h, i) => (
                  <div key={h.name} className="flex items-center gap-2">
                    <span className="w-4 text-[10px] font-mono text-muted-foreground">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] font-medium truncate">{h.name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {h.active} active · {h.critical > 0 && <span className="text-red-500">{h.critical} crit · </span>}risk {h.risk}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: h.risk >= 60 ? '#EF4444' : h.risk >= 35 ? '#F59E0B' : '#10B981' }}
                          initial={{ width: 0 }} animate={{ width: `${h.risk}%` }} transition={{ duration: 0.6, delay: i * 0.04 }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border shadow-sm">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                  <Trophy className="w-3.5 h-3.5 text-amber-500" /> Peer Benchmark
                  {brief.benchmark?.percentile !== null && brief.benchmark?.percentile !== undefined && (
                    <Badge className="text-[9px] h-4 px-1.5 bg-amber-500/10 text-amber-600 border-0">
                      Better than {brief.benchmark.percentile}% of peers
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                {!brief.benchmark || brief.benchmark.peers.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">No peer data</div>
                ) : (
                  <ChartContainer className="h-[180px] w-full" config={{ resolutionRate: { label: 'Resolution %', color: '#8B5CF6' } }}>
                    <BarChart data={brief.benchmark.peers} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 9 }} />
                      <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 9 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="resolutionRate" name="Resolution %" radius={[0, 4, 4, 0]}>
                        {brief.benchmark.peers.map(p => (
                          <Cell key={p.name} fill={p.isSelf ? '#8B5CF6' : '#CBD5E1'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                )}
                {brief.benchmark && (
                  <p className="text-[9px] text-muted-foreground mt-1">{brief.benchmark.label} — aggregate counts only · <span className="text-violet-500 font-semibold">purple = you</span></p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Row 4: Sentiment + Officers ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border shadow-sm">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                  <Star className="w-3.5 h-3.5 text-amber-500" /> Citizen Sentiment
                  {brief.sentiment.direction === 'improving' && <Badge className="text-[9px] h-4 px-1.5 bg-emerald-500/10 text-emerald-600 border-0">▲ Improving</Badge>}
                  {brief.sentiment.direction === 'declining' && <Badge className="text-[9px] h-4 px-1.5 bg-red-500/10 text-red-500 border-0">▼ Declining</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="flex items-center gap-4">
                  <div className="text-center flex-shrink-0">
                    <div className="text-3xl font-black font-mono text-amber-500">{brief.sentiment.avg ?? '—'}</div>
                    <div className="text-[9px] text-muted-foreground uppercase">avg / 5 · {kpis.ratedCount} rated</div>
                  </div>
                  <div className="flex-1 space-y-1">
                    {[5, 4, 3, 2, 1].map(r => {
                      const count = brief.sentiment.distribution[String(r)] || 0;
                      const max = Math.max(1, ...Object.values(brief.sentiment.distribution));
                      return (
                        <div key={r} className="flex items-center gap-2">
                          <span className="text-[10px] font-mono w-3">{r}★</span>
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-amber-400" style={{ width: `${(count / max) * 100}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-muted-foreground w-4">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border shadow-sm">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                  <Users className="w-3.5 h-3.5" /> Officer Watch
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-1.5">
                {brief.officers.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">No assigned officers in scope</div>
                ) : brief.officers.map((o, i) => (
                  <div key={o.name} className="flex items-center gap-2">
                    <span className="text-sm w-5 text-center">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-[10px] font-mono text-muted-foreground">#{i + 1}</span>}</span>
                    <span className="text-[11px] font-medium flex-1 truncate">{o.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{o.resolved}/{o.total}</span>
                    <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${o.score >= 70 ? 'bg-emerald-500' : o.score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${o.score}%` }} />
                    </div>
                    <span className="text-[10px] font-mono w-8 text-right">{o.score}%</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* ── Row 5: PR wins + Quick wins ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border shadow-sm border-emerald-500/20">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                  <Megaphone className="w-3.5 h-3.5 text-emerald-500" /> PR Ammunition — Showcase These
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-1.5">
                {brief.wins.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">No recent resolved wins — resolve & rate complaints to build PR material</div>
                ) : brief.wins.map(w => (
                  <div key={w.ticketNo} className="flex items-center gap-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15 p-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium truncate">{w.issue}</div>
                      <div className="text-[9px] text-muted-foreground font-mono">{w.ticketNo} · {w.village || w.category}</div>
                    </div>
                    {w.rating && (
                      <span className="text-[10px] font-semibold text-amber-500 flex items-center gap-0.5 flex-shrink-0">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />{w.rating}
                      </span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border shadow-sm border-blue-500/20">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                  <Target className="w-3.5 h-3.5 text-blue-500" /> Quick Wins — Close These First
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-1.5">
                {brief.quickWins.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">No aging easy complaints — good discipline</div>
                ) : brief.quickWins.map(q => (
                  <div key={q.ticketNo} className="flex items-center gap-2 rounded-lg bg-blue-500/5 border border-blue-500/15 p-2">
                    <Clock className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium truncate">{q.issue}</div>
                      <div className="text-[9px] text-muted-foreground font-mono">{q.ticketNo} · {q.village || q.category}</div>
                    </div>
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 flex-shrink-0 text-red-500 border-red-500/30">
                      {q.daysOld}d old
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* ── Row 5.5: NLP Brain — root-cause clusters, anger hotspots, entity watch ── */}
          <Card className="border shadow-sm border-fuchsia-500/20">
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-semibold flex items-center justify-between text-muted-foreground uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-fuchsia-500" /> NLP Brain — AI Text Intelligence
                  <span className="text-[9px] normal-case font-normal">(complaint ke text se: asli wajah, gussa, baar-baar aane wale naam)</span>
                </span>
                {!nlp && (
                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={loadNlp} disabled={nlpLoading}>
                    {nlpLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Analyze'}
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            {nlp && (
              <CardContent className="px-4 pb-3 space-y-3">
                {nlp.coverage.enriched === 0 ? (
                  <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                    Abhi tak koi complaint analyze nahi hui ({nlp.coverage.total} in scope). n8n JS-22 (NLP Brain enrichment) har 30 min chalta hai — thodi der mein data aayega. Turant chahiye to n8n mein JS-22 "Execute" karo.
                  </div>
                ) : (
                  <>
                    {/* Coverage */}
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>AI-analyzed: <span className="font-mono font-semibold text-foreground">{nlp.coverage.enriched}/{nlp.coverage.total}</span></span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-fuchsia-500" style={{ width: `${nlp.coverage.total ? (nlp.coverage.enriched / nlp.coverage.total) * 100 : 0}%` }} />
                      </div>
                    </div>

                    {/* Root-cause clusters — THE killer feature */}
                    {nlp.clusters.length > 0 && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-600 dark:text-fuchsia-400 flex items-center gap-1 mb-1.5">
                          <Layers className="w-3 h-3" /> Root-Cause Clusters — ek fix, kayi resolution
                        </div>
                        <div className="space-y-1.5">
                          {nlp.clusters.map(c => (
                            <div key={c.key} className="rounded-lg border border-fuchsia-500/15 bg-fuchsia-500/5 p-2">
                              <div className="flex items-center gap-2">
                                <Network className="w-3.5 h-3.5 text-fuchsia-500 flex-shrink-0" />
                                <span className="text-[11px] font-semibold flex-1">{c.rootCause}</span>
                                <Badge className="text-[9px] h-4 px-1.5 bg-fuchsia-500/15 text-fuchsia-600 border-0">{c.count} complaints</Badge>
                                {c.avgAnger >= 60 && (
                                  <span className="text-[9px] text-red-500 font-semibold flex items-center gap-0.5"><Frown className="w-3 h-3" />{c.avgAnger}</span>
                                )}
                              </div>
                              <div className="text-[9px] text-muted-foreground mt-0.5 pl-5">
                                {c.villages.length > 0 && <span>{c.villages.join(', ')} · </span>}
                                <span className="font-mono">{c.tickets.slice(0, 3).join(', ')}{c.count > 3 ? '…' : ''}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Anger hotspots */}
                      {nlp.angerHotspots.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-1.5">
                            <Frown className="w-3 h-3 text-red-500" /> Anger Hotspots
                          </div>
                          <div className="space-y-1">
                            {nlp.angerHotspots.map(h => (
                              <div key={h.name} className="flex items-center gap-2">
                                <span className="text-[11px] flex-1 truncate">{h.name}</span>
                                <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${h.avgAnger}%`, background: h.avgAnger >= 60 ? '#EF4444' : h.avgAnger >= 35 ? '#F59E0B' : '#10B981' }} />
                                </div>
                                <span className="text-[10px] font-mono w-6 text-right">{h.avgAnger}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Entity watch */}
                      {nlp.entityWatch.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-1.5">
                            <Building className="w-3 h-3" /> Entity Watch — baar-baar aane wale
                          </div>
                          <div className="space-y-1">
                            {nlp.entityWatch.map(e => (
                              <div key={`${e.type}-${e.name}`} className="flex items-center gap-2 text-[11px]">
                                <Badge variant="outline" className="text-[8px] h-3.5 px-1 flex-shrink-0">{e.type}</Badge>
                                <span className="flex-1 truncate">{e.name}</span>
                                <span className="font-mono text-muted-foreground">{e.count}×</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Emotion mix + severity flags */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {nlp.emotionMix.map(e => (
                        <span key={e.emotion} className="text-[9px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{e.emotion} ({e.count})</span>
                      ))}
                      {nlp.severityFlags.map(f => (
                        <span key={f.flag} className="text-[9px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 font-medium">⚑ {f.flag.replace('_', ' ')} ({f.count})</span>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            )}
          </Card>

          {/* ── Row 6: "Wapas Jao" — closed-loop visit briefs ── */}
          <Card className="border shadow-sm border-violet-500/20">
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-semibold flex items-center justify-between text-muted-foreground uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Footprints className="w-3.5 h-3.5 text-violet-500" /> Wapas Jao — Village Visit Briefs
                  <span className="text-[9px] normal-case font-normal">(kis gaon mein kiska kaam hua — naam ke saath)</span>
                </span>
                {!wapas && (
                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={loadWapas} disabled={wapasLoading}>
                    {wapasLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Load briefs'}
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            {wapas && (
              <CardContent className="px-4 pb-3 space-y-1.5">
                {wapas.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">Abhi koi resolved complaint nahi — resolve karo, phir wapas jao 💪</div>
                ) : wapas.map(v => {
                  const isOpen = openVillage === v.village;
                  return (
                    <div key={v.village} className="rounded-lg border border-violet-500/15 bg-violet-500/5 overflow-hidden">
                      <div
                        className="flex items-center gap-2 p-2 cursor-pointer hover:bg-violet-500/10 transition-colors"
                        onClick={() => setOpenVillage(isOpen ? null : v.village)}
                      >
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                        <MapPin className="w-3.5 h-3.5 text-violet-500" />
                        <span className="text-[12px] font-semibold flex-1">{v.village}</span>
                        {v.avgRating && (
                          <span className="text-[10px] font-medium text-amber-500 flex items-center gap-0.5">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />{v.avgRating}
                          </span>
                        )}
                        <Badge className="text-[9px] h-4 px-1.5 bg-emerald-500/10 text-emerald-600 border-0">{v.count} resolved</Badge>
                        <Button
                          variant="ghost" size="sm" className="h-6 px-1.5"
                          onClick={(e) => { e.stopPropagation(); copyVillageBrief(v); }}
                          title="Copy visit brief"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                      <AnimatePresence>
                        {isOpen && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="px-3 pb-2 space-y-1 border-t border-violet-500/10 pt-2">
                              {v.items.map(it => (
                                <div key={it.ticketNo} className="flex items-center gap-2 text-[11px]">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                                  <span className="font-semibold flex-shrink-0">{it.citizenName}</span>
                                  <span className="truncate flex-1 text-muted-foreground">{it.issue}</span>
                                  {it.rating && (
                                    <span className="text-[10px] text-amber-500 flex items-center gap-0.5 flex-shrink-0">
                                      <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />{it.rating}
                                    </span>
                                  )}
                                  <span className="text-[9px] font-mono text-muted-foreground flex-shrink-0">{it.ticketNo}</span>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </CardContent>
            )}
          </Card>

          <p className="text-center text-[9px] text-muted-foreground font-mono pb-2">
            JANSUNWAI INTELLIGENCE ENGINE · SCOPE-LOCKED TO {scope.label.toUpperCase()} · AGGREGATE PEER DATA ONLY
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
