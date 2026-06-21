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
  Wrench, ClipboardList, User, Flag, Lock,
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
import { downloadVillagePrCard } from '@/lib/prCard';
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

interface Forecast {
  scope: { level: string; label: string; subAreaLabel: string; generatedAt: string };
  status: 'OK' | 'NOT_ENOUGH_DATA';
  confidence: 'LOW' | 'NOT-FORECASTABLE';
  weeksOfHistory: number;
  trajectory: 'RISING' | 'FLAT/STABILIZING' | 'COOLING' | null;
  level: number | null;
  momentum: number | null;
  dispersionVMR: number | null;
  history: Array<{ week: string; filed: number }>;
  volumeForecast: Array<{ weekAhead: number; point: number; lo: number; hi: number }>;
  areaSignals: Array<{ name: string; tier: 'USABLE' | 'WATCH'; sharePct: number; point: number | null; lo: number | null; hi: number | null }>;
  categorySignals: Array<{ category: string; tier: 'USABLE' | 'WATCH'; sharePct: number }>;
  slaRisk: { basis: string; counts: { breached: number; high: number; medium: number; low: number }; top: Array<{ ticketNo: string; category: string; urgency: string; ageDays: number; ratio: number; band: string }> };
  seasonal: { available: boolean; reason: string; watchlist: Array<{ category: string; district: string; note: string; confidence: string }> };
  caveats: string[];
  message: string;
}

interface FusionNode {
  name: string;
  political: { mla: string; party: string; reservation: string; lokSabha: string; constituency: string } | null;
  grievance: { total: number; active: number; resolved: number; resolutionRate: number; critical: number; slaBreached: number; risk: number };
  sentiment: { avgAnger: number | null; dominantEmotion: string | null; ratedAnger: number };
  schemeGrievance: { count: number; pct: number; byScheme: Array<{ scheme: string; count: number }> };
  recurrence: { repeatCount: number };
  topCauses: Array<{ rootCause: string; count: number }>;
  categoryMix: Array<{ category: string; count: number }>;
  priority: { score: number; grade: string; components: { risk: number; schemeLoad: number; concentration: number; recurrence: number; reservation: number } };
}
interface Fusion {
  scope: { level: string; label: string; subAreaLabel: string; generatedAt: string };
  nodeGrain: string;
  nodes: FusionNode[];
  external: Array<{ source: string; status: string; note: string }>;
  caveats: string[];
}

interface NetNode {
  name: string; level: string; total: number; active: number; resolved: number;
  unresolvedPct: number; avgAnger: number | null; children: NetNode[];
}
interface NetworkData {
  scope: { level: string; label: string; subAreaLabel: string; generatedAt: string };
  tree: NetNode[];
  weakestLinks: Array<{ name: string; level: string; total: number; unresolvedPct: number; avgAnger: number | null }>;
  coOccurrence: { edges: Array<{ a: string; b: string; sharedAreas: number }>; note: string };
  gaps: Array<{ feature: string; status: string; note: string }>;
  caveats: string[];
}

/* Level 10 — Autonomous Operations / Action Queue */
type OpActionType = 'ASSIGN_OFFICER' | 'ESCALATE' | 'CHASE_STATUS' | 'CLOSE_QUICKWIN' | 'REOPEN';
interface OpItem {
  id: string; complaintId: string; ticketNo: string;
  actionType: OpActionType; title: string; why: string[]; score: number;
  components: { urgency: number; age: number; anger: number };
  riskTier: 'INTERNAL' | 'CITIZEN_FACING'; area: string;
  execute: { method: 'PATCH' | 'POST'; route: string; body?: Record<string, unknown>; needs?: 'officer' | 'resolution' | 'confirm' };
  executable: boolean; reason?: string;
}
interface Operations {
  scope: { level: string; label: string; generatedAt: string };
  canWrite: boolean;
  items: OpItem[];
  officers: Array<{ id: string; name: string; area: string }>;
  stats: { proposed: number; actionedWindow: number; resolvedOfActioned: number; windowDays: number };
  disabledTypes: Array<{ type: string; reason: string }>;
  caveats: string[];
}
const ACTION_LABEL: Record<OpActionType, string> = {
  ASSIGN_OFFICER: 'Assign', ESCALATE: 'Escalate', CHASE_STATUS: 'Chase', CLOSE_QUICKWIN: 'Close', REOPEN: 'Reopen',
};

const RISK_COLORS: Record<string, { c: string; bg: string; bar: string }> = {
  LOW:      { c: 'text-emerald-500', bg: 'bg-emerald-500/10', bar: '#10B981' },
  GUARDED:  { c: 'text-lime-500',    bg: 'bg-lime-500/10',    bar: '#84CC16' },
  ELEVATED: { c: 'text-amber-500',   bg: 'bg-amber-500/10',   bar: '#F59E0B' },
  HIGH:     { c: 'text-orange-500',  bg: 'bg-orange-500/10',  bar: '#F97316' },
  SEVERE:   { c: 'text-red-500',     bg: 'bg-red-500/10',     bar: '#EF4444' },
};

// Anger (0-100) → colour + a grade that maps into RISK_COLORS so RiskGauge can be reused.
const angerColor = (n: number) => (n >= 60 ? '#EF4444' : n >= 35 ? '#F59E0B' : '#10B981');
const angerGrade = (n: number) => (n >= 60 ? 'SEVERE' : n >= 35 ? 'ELEVATED' : 'LOW');
// Fusion priority grade (TOP/HIGH/WATCH/OK) → a RISK_COLORS grade.
const gradeToRisk = (g: string) => (g === 'TOP' ? 'SEVERE' : g === 'HIGH' ? 'HIGH' : g === 'WATCH' ? 'GUARDED' : 'LOW');
const gradeBar = (g: string) => RISK_COLORS[gradeToRisk(g)]?.bar || '#10B981';
const EMO_COLOR: Record<string, string> = { angry: '#EF4444', frustrated: '#F97316', concerned: '#F59E0B', anxious: '#EAB308', neutral: '#94A3B8' };
const ENTITY_BUCKET: Record<string, { label: string; color: string }> = {
  infrastructure: { label: 'ढाँचा', color: '#3B82F6' },
  schemes: { label: 'योजना', color: '#8B5CF6' },
  officers: { label: 'अफ़सर', color: '#F59E0B' },
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

/* Recursive org-chain node row (Network Intelligence) */
function NetTreeNode({ node, depth }: { node: NetNode; depth: number }) {
  const uColor = node.unresolvedPct >= 60 ? '#EF4444' : node.unresolvedPct >= 35 ? '#F59E0B' : '#10B981';
  return (
    <div>
      <div className="flex items-center gap-2 py-0.5" style={{ paddingLeft: depth * 14 }}>
        {depth > 0 && <span className="text-muted-foreground/40 text-[10px]">└</span>}
        <span className="text-[11px] font-medium truncate flex-1" style={{ maxWidth: 160 }}>{node.name}</span>
        <span className="text-[8px] text-muted-foreground uppercase">{node.level}</span>
        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${node.unresolvedPct}%`, background: uColor }} />
        </div>
        <span className="text-[9px] font-mono text-muted-foreground w-16 text-right">{node.total}c · {node.unresolvedPct}% open</span>
        {node.avgAnger !== null && node.avgAnger >= 60 && <span className="text-[9px] text-red-500">😡{node.avgAnger}</span>}
      </div>
      {node.children.map((ch) => <NetTreeNode key={node.name + '>' + ch.name} node={ch} depth={depth + 1} />)}
    </div>
  );
}

/* ─── Main ─── */
export function IntelligenceCommandView({ room }: { room?: string } = {}) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [wapas, setWapas] = useState<WapasVillage[] | null>(null);
  const [wapasLoading, setWapasLoading] = useState(false);
  const [openVillage, setOpenVillage] = useState<string | null>(null);
  const [nlp, setNlp] = useState<NlpInsights | null>(null);
  const [nlpLoading, setNlpLoading] = useState(false);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [fusion, setFusion] = useState<Fusion | null>(null);
  const [fusionLoading, setFusionLoading] = useState(false);
  const [openNode, setOpenNode] = useState<string | null>(null);
  const [brainExpand, setBrainExpand] = useState(false);
  const [openCluster, setOpenCluster] = useState<string | null>(null);
  const [network, setNetwork] = useState<NetworkData | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [operations, setOperations] = useState<Operations | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [officerSel, setOfficerSel] = useState<Record<string, string>>({});
  const [resoSel, setResoSel] = useState<Record<string, string>>({});
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

  /* Forecast / Early-Warning — predictive engine (on demand) */
  const loadForecast = useCallback(async () => {
    setForecastLoading(true);
    try {
      const res = await fetch('/api/intelligence/forecast', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setForecast(json.data || null);
      } else {
        toast.error('Failed to load forecast');
      }
    } catch {
      toast.error('Failed to load forecast');
    } finally {
      setForecastLoading(false);
    }
  }, []);

  /* Network Intelligence — org/escalation tree + weakest links (on demand) */
  const loadNetwork = useCallback(async () => {
    setNetworkLoading(true);
    try {
      const res = await fetch('/api/intelligence/network', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setNetwork(json.data || null);
      } else {
        toast.error('Failed to load network');
      }
    } catch {
      toast.error('Failed to load network');
    } finally {
      setNetworkLoading(false);
    }
  }, []);

  /* Data Fusion / Entity 360 — ranked fused node profiles (on demand) */
  const loadFusion = useCallback(async () => {
    setFusionLoading(true);
    try {
      const res = await fetch('/api/intelligence/fusion', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setFusion(json.data || null);
      } else {
        toast.error('Failed to load fusion');
      }
    } catch {
      toast.error('Failed to load fusion');
    } finally {
      setFusionLoading(false);
    }
  }, []);

  /* Level 10 — Autonomous Operations / Action Queue (on demand) */
  const loadOperations = useCallback(async () => {
    setOperationsLoading(true);
    try {
      const res = await fetch('/api/intelligence/operations', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setOperations(json.data || null);
      } else {
        toast.error('Failed to load operations');
      }
    } catch {
      toast.error('Failed to load operations');
    } finally {
      setOperationsLoading(false);
    }
  }, []);

  /* Approve one queue item → fire the EXISTING audited route, then refresh. */
  const runAction = useCallback(async (it: OpItem) => {
    let body: Record<string, unknown> | undefined = it.execute.body;
    if (it.execute.needs === 'officer') {
      const oid = officerSel[it.id];
      if (!oid) { toast.error('Pehle ek officer chuno'); return; }
      body = { assignedToId: oid };
    } else if (it.execute.needs === 'resolution') {
      const r = (resoSel[it.id] || '').trim();
      if (!r) { toast.error('Resolution note likho'); return; }
      if (!window.confirm('Yeh ticket RESOLVED mark hoga aur citizen ko notification (WB-03) jayega. Confirm?')) return;
      body = { status: 'RESOLVED', resolution: r };
    } else if (it.execute.needs === 'confirm' || it.riskTier === 'CITIZEN_FACING') {
      if (!window.confirm(`Confirm: ${it.title}?`)) return;
    }
    setActingId(it.id);
    try {
      const res = await fetch(it.execute.route, {
        method: it.execute.method,
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) {
        toast.success(`${ACTION_LABEL[it.actionType]} done — ${it.ticketNo}`);
        await loadOperations();
      } else {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || 'Action failed');
      }
    } catch {
      toast.error('Action failed');
    } finally {
      setActingId(null);
    }
  }, [officerSel, resoSel, loadOperations]);

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

  /* Hyperlocal PR factory — per-village "humne ye kiya" achievement card (image).
     AGGREGATE only (counts + categories), NO citizen names (public broadcast). */
  const makeVillagePr = useCallback((v: WapasVillage) => {
    const CAT_LABEL: Record<string, string> = {
      WATER: 'Paani', ROAD: 'Sadak', HEALTH: 'Swasthya', ELECTRICITY: 'Bijli', RATION: 'Ration',
      EDUCATION: 'Shiksha', PENSION: 'Pension', SANITATION: 'Safai', HOUSING: 'Awas', LAND: 'Zameen', OTHER: 'Anya',
    };
    const counts: Record<string, number> = {};
    for (const it of v.items) { const c = (it.category || 'OTHER').toUpperCase(); counts[c] = (counts[c] || 0) + 1; }
    const categories = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ label: CAT_LABEL[c] || c, n }));
    downloadVillagePrCard({ orgName: 'JanSunwai WB', village: v.village, count: v.count, avgRating: v.avgRating, categories, accent: '#BA7517' })
      .catch(() => toast.error('PR card banane mein dikkat'));
  }, []);

  // Room gating (driven by CommandCenter). No room / 'all' → show everything
  // (backward-compatible). Entering a lazy room auto-loads its data.
  const show = (k: string) => !room || room === 'all' || room === k;
  useEffect(() => {
    if (room === 'forecast' && !forecast && !forecastLoading) loadForecast();
    else if (room === 'entity360' && !fusion && !fusionLoading) loadFusion();
    else if (room === 'network' && !network && !networkLoading) loadNetwork();
    else if (room === 'actions' && !operations && !operationsLoading) loadOperations();
    else if (room === 'brain' && !nlp && !nlpLoading) loadNlp();
    else if (room === 'field' && !wapas && !wapasLoading) loadWapas();
  }, [room, forecast, forecastLoading, fusion, fusionLoading, network, networkLoading, operations, operationsLoading, nlp, nlpLoading, wapas, wapasLoading, loadForecast, loadFusion, loadNetwork, loadOperations, loadNlp, loadWapas]);

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

          <div className={`space-y-4 ${show('overview') ? '' : 'hidden'}`}>
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
          </div>

          {/* ── Forecast / Early-Warning (Level 6 — honest, range-only) ── */}
          <Card className={`border shadow-sm border-cyan-500/20 ${show('forecast') ? '' : 'hidden'}`}>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-semibold flex items-center justify-between text-muted-foreground uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-cyan-500" /> Forecast / Early-Warning
                  <span className="text-[9px] normal-case font-normal">(agle 4 hafte ka rujhan + SLA-breach risk queue)</span>
                </span>
                {!forecast && (
                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={loadForecast} disabled={forecastLoading}>
                    {forecastLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Project'}
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            {forecast && (
              <CardContent className="px-4 pb-3 space-y-3">
                {forecast.status === 'NOT_ENOUGH_DATA' ? (
                  <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground space-y-2">
                    <div className="font-medium text-foreground">{forecast.message}</div>
                    <ul className="list-disc pl-4 space-y-0.5 text-[10px]">
                      {forecast.caveats.slice(0, 3).map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                ) : (
                  <>
                    {/* Honesty banner + trajectory */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="text-[9px] h-5 px-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0">
                        Confidence: LOW — early-signal trend, NOT a statistical forecast
                      </Badge>
                      {forecast.trajectory && (
                        <Badge className={`text-[9px] h-5 px-2 border-0 ${forecast.trajectory === 'RISING' ? 'bg-red-500/10 text-red-500' : forecast.trajectory === 'COOLING' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                          {forecast.trajectory === 'RISING' ? '▲ Rising' : forecast.trajectory === 'COOLING' ? '▼ Cooling' : '➝ Flat / stabilizing'}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground font-mono">~{forecast.level}/week now · {forecast.weeksOfHistory}w history</span>
                    </div>

                    {/* History + projected band chart */}
                    <ChartContainer className="h-[150px] w-full" config={{
                      filed: { label: 'Filed', color: '#8B5CF6' },
                      hi: { label: 'Upper', color: '#06B6D4' },
                      point: { label: 'Projected', color: '#06B6D4' },
                    }}>
                      <AreaChart
                        data={[
                          ...forecast.history.map(h => ({ week: h.week, filed: h.filed })),
                          ...forecast.volumeForecast.map(f => ({ week: `+${f.weekAhead}`, point: f.point, lo: f.lo, hi: f.hi })),
                        ]}
                        margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                        <defs>
                          <linearGradient id="gFcHist" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.25} /><stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} /></linearGradient>
                          <linearGradient id="gFcBand" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#06B6D4" stopOpacity={0.22} /><stop offset="95%" stopColor="#06B6D4" stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                        <XAxis dataKey="week" tick={{ fontSize: 8 }} />
                        <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        {/* projected uncertainty band (hi as filled area, lo erases the bottom) */}
                        <Area type="monotone" dataKey="hi" name="Upper" stroke="none" fill="url(#gFcBand)" />
                        <Area type="monotone" dataKey="lo" name="Lower" stroke="none" fill="hsl(var(--background))" fillOpacity={1} />
                        <Area type="monotone" dataKey="point" name="Projected" stroke="#06B6D4" strokeWidth={2} strokeDasharray="4 3" fill="none" />
                        <Area type="monotone" dataKey="filed" name="Filed" stroke="#8B5CF6" strokeWidth={2} fill="url(#gFcHist)" />
                      </AreaChart>
                    </ChartContainer>
                    <div className="text-[9px] text-muted-foreground -mt-1">
                      Next 4 weeks (range, never a point): {forecast.volumeForecast.map(f => `+${f.weekAhead}w ${f.lo}–${f.hi}`).join(' · ')}
                    </div>

                    {/* SLA-breach risk queue */}
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                        <ShieldAlert className="w-3 h-3 text-orange-500" /> SLA-Breach Risk Queue
                        <span className="text-[8px] normal-case font-normal">(deterministic age-gauge, not a probability)</span>
                      </div>
                      <div className="flex gap-1.5 mb-1.5">
                        {([['BREACHED', forecast.slaRisk.counts.breached, 'bg-red-500/15 text-red-600'], ['HIGH', forecast.slaRisk.counts.high, 'bg-orange-500/15 text-orange-600'], ['MEDIUM', forecast.slaRisk.counts.medium, 'bg-amber-500/15 text-amber-600'], ['LOW', forecast.slaRisk.counts.low, 'bg-muted text-muted-foreground']] as const).map(([l, v, cls]) => (
                          <span key={l} className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${cls}`}>{l} {v}</span>
                        ))}
                      </div>
                      <div className="space-y-1">
                        {forecast.slaRisk.top.slice(0, 6).map(r => (
                          <div key={r.ticketNo} className="flex items-center gap-2 text-[11px]">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.band === 'BREACHED' ? 'bg-red-500' : r.band === 'HIGH' ? 'bg-orange-500' : r.band === 'MEDIUM' ? 'bg-amber-500' : 'bg-muted-foreground'}`} />
                            <span className="font-mono text-[9px] text-muted-foreground flex-shrink-0">{r.ticketNo}</span>
                            <span className="truncate flex-1">{r.category}</span>
                            <span className="text-[9px] text-muted-foreground flex-shrink-0">{r.ageDays}d · {Math.round(r.ratio * 100)}% of SLA</span>
                          </div>
                        ))}
                        {forecast.slaRisk.top.length === 0 && <div className="text-[10px] text-muted-foreground italic">No open complaints in scope</div>}
                      </div>
                    </div>

                    {/* Area / category watch + seasonal watchlist */}
                    {(forecast.areaSignals.length > 0 || forecast.categorySignals.length > 0) && (
                      <div className="flex flex-wrap gap-1.5">
                        {forecast.areaSignals.map(a => (
                          <span key={a.name} className={`text-[9px] px-2 py-0.5 rounded-full ${a.tier === 'USABLE' ? 'bg-cyan-500/10 text-cyan-600' : 'bg-muted text-muted-foreground'}`}>
                            {a.name}: {a.tier === 'USABLE' ? `~${a.lo}–${a.hi}/wk` : 'WATCH (too few for a number)'}
                          </span>
                        ))}
                        {forecast.categorySignals.filter(c => c.tier === 'USABLE').map(c => (
                          <span key={c.category} className="text-[9px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600">{c.category} {c.sharePct}%</span>
                        ))}
                      </div>
                    )}
                    {forecast.seasonal.watchlist.length > 0 && (
                      <div className="rounded-lg bg-muted/30 p-2">
                        <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Seasonal watchlist (hypotheses — no numbers)</div>
                        {forecast.seasonal.watchlist.map((s, i) => (
                          <div key={i} className="text-[10px] text-muted-foreground">• {s.category} in {s.district} — {s.note}</div>
                        ))}
                      </div>
                    )}

                    {/* Always-visible caveats */}
                    <details className="text-[10px] text-muted-foreground">
                      <summary className="cursor-pointer font-semibold">⚠ Why these are estimates, not forecasts ({forecast.caveats.length})</summary>
                      <ul className="list-disc pl-4 space-y-0.5 mt-1">
                        {forecast.caveats.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </details>
                  </>
                )}
              </CardContent>
            )}
          </Card>

          {/* ── Kahan Dhyan Dein (area priority fusion) ── */}
          <Card className={`border shadow-sm border-indigo-500/20 ${show('entity360') ? '' : 'hidden'}`}>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-semibold flex items-center justify-between text-foreground tracking-tight">
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-[13px] font-bold"><Target className="w-4 h-4 text-indigo-500" /> Area Fusion — Entity 360</span>
                  <span className="text-[10px] font-normal text-muted-foreground">har ilake ka fused profile: grievance + anger + scheme-failure + political, priority-ranked</span>
                </span>
                {!fusion && (
                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={loadFusion} disabled={fusionLoading}>
                    {fusionLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Fuse'}
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            {fusion && (
              <CardContent className="px-4 pb-3 space-y-2.5">
                {fusion.nodes.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground italic py-2">No areas in scope yet.</div>
                ) : (() => {
                  const PC = [
                    { key: 'risk', label: 'gussa', color: '#EF4444' },
                    { key: 'schemeLoad', label: 'yojana-fail', color: '#8B5CF6' },
                    { key: 'concentration', label: 'ghanapan', color: '#3B82F6' },
                    { key: 'recurrence', label: 'baar-baar', color: '#F59E0B' },
                    { key: 'reservation', label: 'reserved', color: '#94A3B8' },
                  ] as const;
                  const top = fusion.nodes[0];
                  const reasonOf = (nd: FusionNode) => {
                    const c = nd.priority.components;
                    const pairs: [string, number][] = [['risk', c.risk], ['schemeLoad', c.schemeLoad], ['concentration', c.concentration], ['recurrence', c.recurrence], ['reservation', c.reservation]];
                    const dom = pairs.sort((a, b) => b[1] - a[1])[0][0];
                    const anger = nd.sentiment.avgAnger ?? 0;
                    if (dom === 'schemeLoad') return `${nd.schemeGrievance.pct}% shikayatein yojana-fail ki`;
                    if (dom === 'concentration') return 'shikayatein yahin ghani — ek hi jagah dabav';
                    if (dom === 'recurrence') return 'baar-baar wahi shikayat laut rahi';
                    if (dom === 'reservation') return 'reserved seat — extra dhyan';
                    return `${nd.grievance.active} active shikayat + gussa ${anger}`;
                  };
                  const StackedBar = (comps: FusionNode['priority']['components']) => {
                    const tot = PC.reduce((s, p) => s + (comps[p.key] || 0), 0) || 1;
                    return (
                      <div className="flex h-2.5 rounded-full overflow-hidden">
                        {PC.map(p => { const v = comps[p.key] || 0; return v ? <div key={p.key} title={`${p.label} ${Math.round(v)}`} style={{ width: `${(v / tot) * 100}%`, background: p.color }} /> : null; })}
                      </div>
                    );
                  };
                  return (
                  <>
                    <div className="text-[10px] text-muted-foreground">{fusion.nodeGrain === 'block' ? 'Block-wise' : fusion.nodeGrain === 'village' ? 'Gaon-wise' : fusion.nodeGrain} · priority-ranked</div>

                    {/* HERO — #1 priority area */}
                    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl p-3"
                      style={{ borderLeft: `4px solid ${gradeBar(top.priority.grade)}`, background: `linear-gradient(135deg, ${gradeBar(top.priority.grade)}1a, transparent)` }}>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Aaj sabse zyada dhyan yahan</div>
                          <div className="flex items-center gap-2">
                            <span className="text-[20px] font-black text-foreground leading-tight truncate">{top.name}</span>
                            <Badge className="text-[8px] h-4 px-1.5 border-0 flex-shrink-0" style={{ background: gradeBar(top.priority.grade) + '22', color: gradeBar(top.priority.grade) }}>{top.priority.grade}</Badge>
                          </div>
                          <div className="text-[12px] text-muted-foreground mt-0.5">{reasonOf(top)}</div>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-600">{top.grievance.active} active</span>
                            {top.sentiment.avgAnger !== null && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: angerColor(top.sentiment.avgAnger) + '1a', color: angerColor(top.sentiment.avgAnger) }}>gussa {top.sentiment.avgAnger}</span>}
                            {top.schemeGrievance.pct > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-600">{top.schemeGrievance.pct}% yojana-fail</span>}
                            {top.political && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{top.political.mla} · {top.political.party}</span>}
                          </div>
                          <Button size="sm" className="h-7 mt-2 text-[11px] px-2.5"
                            onClick={() => { const t = `📍 DHYAN: ${top.name} (${top.priority.grade})\n${reasonOf(top)}\nActive ${top.grievance.active} · Critical ${top.grievance.critical} · Resolve ${top.grievance.resolutionRate}%${top.political ? `\nMLA ${top.political.mla} (${top.political.party})` : ''}\n— JanSunwai`; navigator.clipboard.writeText(t).then(() => toast.success('Area brief copied — staff ko bhejo')).catch(() => toast.error('Copy fail')); }}>
                            <MapPin className="w-3.5 h-3.5 mr-1" /> Is ilake mein daura karo
                          </Button>
                        </div>
                        <div className="shrink-0 hidden sm:block" style={{ transform: 'scale(0.72)', transformOrigin: 'right center' }}>
                          <RiskGauge score={top.priority.score} grade={gradeToRisk(top.priority.grade)} />
                        </div>
                      </div>
                      <div className="mt-2">{StackedBar(top.priority.components)}</div>
                    </motion.div>

                    {/* LEADERBOARD — rest of the areas, stats always visible */}
                    {fusion.nodes.length > 1 && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-bold text-indigo-500 flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> Ilakon ki priority</div>
                        {fusion.nodes.slice(1).map((nd, idx) => {
                          const isOpen = openNode === nd.name;
                          const col = gradeBar(nd.priority.grade);
                          const anger = nd.sentiment.avgAnger;
                          return (
                            <div key={nd.name} className="rounded-lg border overflow-hidden" style={{ borderColor: col + '30' }}>
                              <div className="flex items-center gap-2 p-2 cursor-pointer hover:bg-muted/40" onClick={() => setOpenNode(isOpen ? null : nd.name)}>
                                <span className="text-[10px] font-mono text-muted-foreground w-4 flex-shrink-0">{idx + 2}</span>
                                <span className="text-[13px] font-bold truncate flex-shrink-0" style={{ maxWidth: '32%' }}>{nd.name}</span>
                                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden min-w-[20px]">
                                  <div className="h-full rounded-full" style={{ width: `${nd.priority.score}%`, background: col }} />
                                </div>
                                <span className="text-[9px] text-orange-600 font-semibold flex-shrink-0">{nd.grievance.active}</span>
                                {anger !== null && <span className="text-[9px] flex items-center gap-0.5 font-semibold flex-shrink-0" style={{ color: angerColor(anger) }}><Frown className="w-2.5 h-2.5" />{anger}</span>}
                                {nd.schemeGrievance.pct > 0 && <span className="text-[9px] text-violet-600 flex-shrink-0">{nd.schemeGrievance.pct}%</span>}
                                {nd.political?.reservation && nd.political.reservation !== 'GENERAL' && <Badge variant="outline" className="text-[7px] h-3 px-1 flex-shrink-0">{nd.political.reservation}</Badge>}
                                <span className="text-[12px] font-mono font-black flex-shrink-0" style={{ color: col }}>{nd.priority.score}</span>
                                {isOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
                              </div>
                              <AnimatePresence>
                                {isOpen && (
                                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                                    <div className="px-3 pb-2.5 pt-1.5 space-y-2 border-t" style={{ borderColor: col + '20' }}>
                                      {nd.political && (
                                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-wrap"><Building className="w-3 h-3" /><span className="font-medium text-foreground">{nd.political.mla}</span><Badge variant="outline" className="text-[8px] h-3.5 px-1">{nd.political.party}</Badge><span>· {nd.political.constituency} · {nd.political.lokSabha} LS</span></div>
                                      )}
                                      <div className="grid grid-cols-4 gap-1.5 text-center">
                                        {([['Active', nd.grievance.active, 'text-orange-500'], ['Critical', nd.grievance.critical, 'text-rose-500'], ['Risk', nd.grievance.risk, 'text-red-500']] as [string, number, string][]).map(k => (
                                          <div key={k[0]} className="bg-muted/40 rounded p-1"><div className={`text-base font-bold font-mono ${k[2]}`}>{k[1]}</div><div className="text-[8px] text-muted-foreground uppercase">{k[0]}</div></div>
                                        ))}
                                        <div className="bg-muted/40 rounded p-1 flex flex-col items-center justify-center">
                                          <svg width="24" height="24" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="rgba(16,185,129,0.15)" strokeWidth="5" /><circle cx="18" cy="18" r="15" fill="none" stroke="#10B981" strokeWidth="5" strokeLinecap="round" strokeDasharray={2 * Math.PI * 15} strokeDashoffset={2 * Math.PI * 15 * (1 - nd.grievance.resolutionRate / 100)} transform="rotate(-90 18 18)" /></svg>
                                          <div className="text-[8px] text-muted-foreground uppercase mt-0.5">{nd.grievance.resolutionRate}% hal</div>
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-[9px] text-muted-foreground mb-0.5">Score kis cheez se bana</div>
                                        {StackedBar(nd.priority.components)}
                                        <div className="flex flex-wrap gap-x-2 mt-0.5">{PC.map(p => (nd.priority.components[p.key] > 0) ? <span key={p.key} className="text-[8px]" style={{ color: p.color }}>● {p.label}</span> : null)}</div>
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        {nd.topCauses.length > 0 && (
                                          <div><div className="text-[9px] font-semibold text-muted-foreground mb-1">Top wajah</div><div className="space-y-1">{nd.topCauses.slice(0, 4).map(tc => { const mx = nd.topCauses[0].count || 1; return (<div key={tc.rootCause}><div className="flex justify-between text-[9px] gap-1"><span className="truncate">{tc.rootCause}</span><span className="font-mono text-muted-foreground flex-shrink-0">{tc.count}</span></div><div className="h-1 rounded-full bg-muted overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(tc.count / mx) * 100}%` }} /></div></div>); })}</div></div>
                                        )}
                                        {nd.schemeGrievance.count > 0 && (
                                          <div><div className="text-[9px] font-semibold text-violet-600 mb-1">{nd.schemeGrievance.pct}% yojana-fail</div><div className="flex flex-wrap gap-1">{nd.schemeGrievance.byScheme.map(s => <span key={s.scheme} className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-600">{s.scheme} ×{s.count}</span>)}</div></div>
                                        )}
                                      </div>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* External — forward roadmap, not a confession */}
                    <div className="rounded-lg border border-dashed border-muted-foreground/20 p-2">
                      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1"><Network className="w-3 h-3" /> Aage aur gehraai (roadmap)</div>
                      <div className="flex flex-wrap gap-1">{fusion.external.map(e => <span key={e.source} className="text-[9px] px-1.5 py-0.5 rounded-full border border-dashed border-muted-foreground/30 text-muted-foreground/70" title={e.note}>○ {e.source}</span>)}</div>
                      <div className="text-[8px] text-muted-foreground/60 mt-1">Kabhi andaaza nahi — sirf jab asli data juड़ega (census / election / news).</div>
                    </div>

                    {/* Trust footer */}
                    <details className="text-[10px] text-muted-foreground">
                      <summary className="cursor-pointer font-medium flex items-center gap-1"><Lock className="w-3 h-3" /> ⓘ Yeh score kya hai</summary>
                      <div className="mt-1 pl-1"><div className="mb-1">Aggregate-only · koi vyaktigat profiling nahi · DPDP/ECI-safe.</div><ul className="list-disc pl-4 space-y-0.5">{fusion.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
                    </details>
                  </>
                  );
                })()}
              </CardContent>
            )}
          </Card>

          {/* ── Network Intelligence (Level 8) — org chain + weakest links ── */}
          <Card className={`border shadow-sm border-teal-500/20 ${show('network') ? '' : 'hidden'}`}>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-semibold flex items-center justify-between text-muted-foreground uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Network className="w-3.5 h-3.5 text-teal-500" /> Network Intelligence
                  <span className="text-[9px] normal-case font-normal">(org chain ka flow + kahan complaints atak rahe hain)</span>
                </span>
                {!network && (
                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={loadNetwork} disabled={networkLoading}>
                    {networkLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Map'}
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            {network && (
              <CardContent className="px-4 pb-3 space-y-3">
                {/* Weakest links */}
                {network.weakestLinks.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-1 flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" /> Weakest Links — chain mein yahan backlog atka hai
                    </div>
                    <div className="space-y-1">
                      {network.weakestLinks.map((w) => (
                        <div key={w.level + w.name} className="flex items-center gap-2 text-[11px] rounded-lg bg-red-500/5 border border-red-500/15 p-1.5">
                          <span className="font-semibold flex-1 truncate">{w.name}</span>
                          <Badge variant="outline" className="text-[8px] h-3.5 px-1">{w.level}</Badge>
                          <span className="text-[10px] text-red-500 font-mono">{w.unresolvedPct}% open</span>
                          <span className="text-[9px] text-muted-foreground">{w.total} complaints</span>
                          {w.avgAnger !== null && <span className="text-[9px] text-red-500">😡{w.avgAnger}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Org/escalation tree */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                    <Building className="w-3 h-3" /> Escalation Chain (load → unresolved%)
                  </div>
                  <div className="rounded-lg bg-muted/20 p-2 max-h-[280px] overflow-y-auto">
                    {network.tree.length > 0 ? network.tree.map((n) => <NetTreeNode key={n.name} node={n} depth={0} />) : (
                      <div className="text-[10px] text-muted-foreground italic">No complaints in scope.</div>
                    )}
                  </div>
                </div>

                {/* Issue co-occurrence (thin, caveated) */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                    <Layers className="w-3 h-3" /> Issue Links (co-location)
                  </div>
                  {network.coOccurrence.edges.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {network.coOccurrence.edges.map((e) => (
                        <span key={e.a + e.b} className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-600">{e.a} ↔ {e.b} <span className="text-muted-foreground">×{e.sharedAreas}</span></span>
                      ))}
                    </div>
                  ) : null}
                  <div className="text-[9px] text-muted-foreground mt-0.5">{network.coOccurrence.note}</div>
                </div>

                {/* Honest gaps */}
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Not available yet (honest)</div>
                  {network.gaps.map((g) => (
                    <div key={g.feature} className="text-[10px] text-muted-foreground/80">○ <span className="font-medium">{g.feature}</span> — {g.note}</div>
                  ))}
                </div>

                <details className="text-[10px] text-muted-foreground">
                  <summary className="cursor-pointer font-semibold">⚠ What is real here ({network.caveats.length})</summary>
                  <ul className="list-disc pl-4 space-y-0.5 mt-1">{network.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </details>
              </CardContent>
            )}
          </Card>

          {/* ── Autonomous Operations / Action Queue (Level 10) — propose → one-tap approve ── */}
          <Card className={`border shadow-sm border-amber-500/30 ${show('actions') ? '' : 'hidden'}`}>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-semibold flex items-center justify-between text-muted-foreground uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500" /> Autonomous Operations
                  <span className="text-[9px] normal-case font-normal">(today kya karna hai — ek tap pe approve)</span>
                </span>
                {!operations && (
                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={loadOperations} disabled={operationsLoading}>
                    {operationsLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Run'}
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            {operations && (
              <CardContent className="px-4 pb-3 space-y-3">
                {/* Stats — honest correlation, never causation */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground gap-2">
                  <span>Proposed <b className="text-foreground">{operations.stats.proposed}</b></span>
                  <span className="flex-1 text-right">
                    Pichhle {operations.stats.windowDays}d: aapne <b className="text-foreground">{operations.stats.actionedWindow}</b> action liye
                    {operations.stats.actionedWindow > 0 && <> · <b className="text-emerald-500">{operations.stats.resolvedOfActioned}</b> ab resolved</>}
                  </span>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={loadOperations} disabled={operationsLoading}>
                    <RefreshCw className={`w-3 h-3 ${operationsLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>

                {!operations.canWrite && (
                  <div className="text-[10px] rounded-lg bg-muted/30 p-2 text-muted-foreground">
                    Read-only role — yeh queue <b>advisory</b> hai (koi approve button nahi).
                  </div>
                )}

                {/* Action items — each bound to a real ticket + real execute route */}
                {operations.items.length > 0 ? (
                  <div className="space-y-1.5">
                    {operations.items.map((it) => {
                      const tierBg = it.riskTier === 'CITIZEN_FACING' ? 'bg-rose-500/5 border-rose-500/20' : 'bg-amber-500/5 border-amber-500/15';
                      return (
                        <div key={it.id} className={`rounded-lg border p-2 ${tierBg}`}>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[8px] h-3.5 px-1 shrink-0">{it.actionType.replace('_', ' ')}</Badge>
                            <span className="text-[11px] font-semibold flex-1 truncate">{it.title}</span>
                            {it.riskTier === 'CITIZEN_FACING' && <Badge variant="outline" className="text-[7px] h-3 px-1 text-rose-500 border-rose-500/30">citizen</Badge>}
                            <span className="text-[9px] font-mono text-muted-foreground">{it.score}</span>
                          </div>
                          <div className="text-[9px] text-muted-foreground mt-0.5 truncate">{it.area} · {it.why.join(' · ')}</div>
                          {it.executable ? (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              {it.execute.needs === 'officer' && (
                                <select
                                  className="text-[10px] h-6 rounded border bg-background px-1 flex-1 min-w-0"
                                  value={officerSel[it.id] || ''}
                                  onChange={(e) => setOfficerSel((s) => ({ ...s, [it.id]: e.target.value }))}
                                >
                                  <option value="">Officer chuno…</option>
                                  {operations.officers.map((o) => <option key={o.id} value={o.id}>{o.name}{o.area ? ` (${o.area})` : ''}</option>)}
                                </select>
                              )}
                              {it.execute.needs === 'resolution' && (
                                <Input
                                  className="h-6 text-[10px] flex-1 min-w-0"
                                  placeholder="Resolution note…"
                                  value={resoSel[it.id] || ''}
                                  onChange={(e) => setResoSel((s) => ({ ...s, [it.id]: e.target.value }))}
                                />
                              )}
                              <Button size="sm" className="h-6 text-[10px] px-2 shrink-0" disabled={actingId === it.id} onClick={() => runAction(it)}>
                                {actingId === it.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <><CheckCircle2 className="w-3 h-3 mr-1" />{ACTION_LABEL[it.actionType]}</>}
                              </Button>
                            </div>
                          ) : (
                            <div className="text-[9px] text-muted-foreground/70 italic mt-1">{it.reason || 'Not executable'}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground italic">
                    Abhi koi pending action nahi — sab clear hai (ya aapke scope mein kaam kam hai). Yeh honest hai, padding nahi.
                  </div>
                )}

                {/* Honest gaps — never fake buttons */}
                <div className="rounded-lg bg-muted/30 p-2">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Abhi nahi (honest)</div>
                  {operations.disabledTypes.map((d) => (
                    <div key={d.type} className="text-[10px] text-muted-foreground/80">○ <span className="font-medium">{d.type.replace('_', ' ')}</span> — {d.reason}</div>
                  ))}
                </div>

                <details className="text-[10px] text-muted-foreground">
                  <summary className="cursor-pointer font-semibold">⚠ Yeh queue kaise kaam karti hai ({operations.caveats.length})</summary>
                  <ul className="list-disc pl-4 space-y-0.5 mt-1">{operations.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </details>
              </CardContent>
            )}
          </Card>

          {/* ── Logon ki Asli Shikayat (AI text intelligence) ── */}
          <Card className={`border shadow-sm border-fuchsia-500/20 ${show('brain') ? '' : 'hidden'}`}>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-semibold flex items-center justify-between text-foreground tracking-tight">
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-[13px] font-bold"><Sparkles className="w-4 h-4 text-fuchsia-500" /> NLP Brain — AI Text Intelligence</span>
                  <span className="text-[10px] font-normal text-muted-foreground">complaint ke text se: asli wajah, gussa, baar-baar aane wale naam</span>
                </span>
                {!nlp ? (
                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={loadNlp} disabled={nlpLoading}>
                    {nlpLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Analyze'}
                  </Button>
                ) : nlp.coverage.enriched > 0 && (
                  <span className="flex items-center gap-1.5 flex-shrink-0">
                    <svg width="30" height="30" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(217,70,239,0.15)" strokeWidth="4" />
                      <circle cx="18" cy="18" r="15" fill="none" stroke="#d946ef" strokeWidth="4" strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 15} strokeDashoffset={2 * Math.PI * 15 * (1 - (nlp.coverage.total ? nlp.coverage.enriched / nlp.coverage.total : 0))} transform="rotate(-90 18 18)" />
                    </svg>
                    <span className="text-[9px] text-muted-foreground leading-tight">{Math.round((nlp.coverage.total ? nlp.coverage.enriched / nlp.coverage.total : 0) * 100)}%<br />AI-padhi</span>
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            {nlp && (
              <CardContent className="px-4 pb-3 space-y-3">
                {nlp.coverage.enriched === 0 ? (
                  <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                    Abhi tak koi complaint analyze nahi hui ({nlp.coverage.total} in scope). n8n JS-22 (NLP Brain enrichment) har 30 min chalta hai — thodi der mein data aayega.
                  </div>
                ) : (() => {
                  const cl0 = nlp.clusters[0];
                  const maxC = cl0?.count || 1;
                  const shownClusters = brainExpand ? nlp.clusters : nlp.clusters.slice(0, 6);
                  return (
                  <>
                    {/* HERO takeaway band — biggest root cause */}
                    {cl0 && (
                      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl p-3 flex items-center gap-3"
                        style={{ borderLeft: `4px solid ${angerColor(cl0.avgAnger)}`, background: `linear-gradient(135deg, ${angerColor(cl0.avgAnger)}1a, transparent)` }}>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sabse badi musibat</div>
                          <div className="text-[19px] leading-tight font-black text-foreground">{cl0.rootCause}</div>
                          <div className="text-[12px] text-muted-foreground mt-0.5">{cl0.count} shikayatein · {cl0.villages.length}+ gaon · gussa <span style={{ color: angerColor(cl0.avgAnger), fontWeight: 700 }}>{cl0.avgAnger}/100</span></div>
                          <Button size="sm" className="h-7 mt-2 text-[11px] px-2.5"
                            onClick={() => { const t = `🛠 WORK-ORDER — ${cl0.rootCause}\n${cl0.count} shikayatein · ${cl0.villages.join(', ')}${cl0.count > cl0.villages.length ? ' +aur' : ''}\nTickets: ${cl0.tickets.join(', ')}\n\nEk hi fix se ${cl0.count} shikayatein address hongi.\n— JanSunwai`; navigator.clipboard.writeText(t).then(() => toast.success('Work-order copied — staff ko WhatsApp karo')).catch(() => toast.error('Copy fail')); }}>
                            <Wrench className="w-3.5 h-3.5 mr-1" /> Yeh theek karwao
                          </Button>
                        </div>
                        <div className="shrink-0 hidden sm:block" style={{ transform: 'scale(0.78)', transformOrigin: 'right center' }}>
                          <RiskGauge score={cl0.avgAnger} grade={angerGrade(cl0.avgAnger)} />
                        </div>
                      </motion.div>
                    )}

                    {/* RANKED root-cause clusters — ek fix, kayi hal */}
                    {nlp.clusters.length > 0 && (
                      <div>
                        <div className="text-[11px] font-bold flex items-center gap-1 mb-1.5 text-fuchsia-600 dark:text-fuchsia-400">
                          <Layers className="w-3.5 h-3.5" /> Ek kaam, kayi shikayat hal
                        </div>
                        <div className="space-y-1.5">
                          {shownClusters.map((c, i) => {
                            const w = Math.max(8, Math.round((c.count / maxC) * 100));
                            const col = angerColor(c.avgAnger);
                            const isOpen = openCluster === c.key;
                            return (
                              <motion.div key={c.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                                className="rounded-lg border p-2 cursor-pointer" style={{ borderColor: col + '40', background: col + '0f' }}
                                onClick={() => setOpenCluster(isOpen ? null : c.key)}>
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px] font-bold flex-1 leading-tight">{c.rootCause}</span>
                                  {i === 0 && <Badge className="text-[8px] h-4 px-1.5 border-0" style={{ background: col + '22', color: col }}>BADA MAUKA</Badge>}
                                  <span className="text-[22px] font-black font-mono leading-none" style={{ color: col }}>{c.count}</span>
                                </div>
                                <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
                                  <motion.div initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ delay: i * 0.04 + 0.1, duration: 0.5 }} className="h-full rounded-full" style={{ background: col }} />
                                </div>
                                <div className="flex items-center gap-1 mt-1 flex-wrap">
                                  {c.villages.slice(0, 4).map(v => <span key={v} className="text-[9px] px-1.5 py-0.5 rounded-full bg-background/60 border text-muted-foreground">{v}</span>)}
                                  {c.count > 4 && <span className="text-[9px] text-muted-foreground">+{c.count - 4} aur</span>}
                                  <span className="ml-auto text-[10px] flex items-center gap-0.5 font-semibold" style={{ color: col }}><Frown className="w-3 h-3" />{c.avgAnger}</span>
                                </div>
                                {isOpen && c.tickets.length > 0 && (
                                  <div className="mt-1.5 pt-1.5 border-t text-[9px] font-mono text-muted-foreground break-all">{c.tickets.join(', ')}</div>
                                )}
                              </motion.div>
                            );
                          })}
                        </div>
                        {nlp.clusters.length > 6 && (
                          <button onClick={() => setBrainExpand(v => !v)} className="text-[10px] text-fuchsia-600 dark:text-fuchsia-400 font-semibold mt-1.5">
                            {brainExpand ? '− kam dikhao' : `+ aur ${nlp.clusters.length - 6} dikhao`}
                          </button>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Anger heat strip */}
                      {nlp.angerHotspots.length > 0 && (
                        <div>
                          <div className="text-[11px] font-bold flex items-center gap-1 mb-1.5 text-red-500"><Flame className="w-3.5 h-3.5" /> Gussa sabse zyada kahan</div>
                          <div className="space-y-1">
                            {nlp.angerHotspots.map((h, i) => {
                              const col = angerColor(h.avgAnger);
                              return (
                                <div key={h.name} className="flex items-center gap-2 rounded px-1.5 py-1" style={{ background: col + '0d', borderLeft: h.avgAnger >= 60 ? `2px solid ${col}` : '2px solid transparent' }}>
                                  {i === 0 ? <Flame className="w-3 h-3 text-red-500 flex-shrink-0" /> : <span className="w-3 flex-shrink-0" />}
                                  <span className="text-[11px] flex-1 truncate">{h.name}</span>
                                  <div className="relative w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${h.avgAnger}%`, background: col }} />
                                    {h.peakAnger > h.avgAnger && <div className="absolute top-[-1px] w-px h-2.5 bg-foreground/60" style={{ left: `${Math.min(99, h.peakAnger)}%` }} />}
                                  </div>
                                  <span className="text-[11px] font-mono font-bold w-6 text-right" style={{ color: col }}>{h.avgAnger}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Entity chip cloud — 3 buckets */}
                      {nlp.entityWatch.length > 0 && (
                        <div>
                          <div className="text-[11px] font-bold flex items-center gap-1 mb-1.5 text-muted-foreground"><Building className="w-3.5 h-3.5" /> Baar-baar aane wale naam</div>
                          <div className="space-y-2">
                            {(['infrastructure', 'schemes', 'officers'] as const).map(grp => {
                              const items = nlp.entityWatch.filter(e => e.type === grp);
                              if (!items.length) return null;
                              const bk = ENTITY_BUCKET[grp];
                              const Icon = grp === 'infrastructure' ? Wrench : grp === 'schemes' ? ClipboardList : User;
                              const maxN = Math.max(...items.map(e => e.count));
                              return (
                                <div key={grp}>
                                  <div className="text-[9px] font-semibold uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: bk.color }}><Icon className="w-3 h-3" />{bk.label}</div>
                                  <div className="flex flex-wrap gap-1">
                                    {items.map(e => <span key={e.name} className="rounded-full font-medium" style={{ background: bk.color + '18', color: bk.color, fontSize: 9 + Math.round((e.count / maxN) * 3), padding: '2px 8px', border: grp === 'officers' ? `1px solid ${bk.color}55` : 'none' }}>{e.name} ×{e.count}</span>)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Mood meter ribbon */}
                    <div className="pt-2 border-t">
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Ilake ka mahaul</div>
                      {(() => { const tot = nlp.emotionMix.reduce((s, e) => s + e.count, 0) || 1; return (
                        <div className="flex h-3 rounded-full overflow-hidden mb-1.5">
                          {nlp.emotionMix.map(e => { const pct = (e.count / tot) * 100; return <div key={e.emotion} title={`${e.emotion} ${e.count}`} style={{ width: `${pct}%`, background: EMO_COLOR[e.emotion] || '#94A3B8' }} className="flex items-center justify-center">{pct > 12 && <span className="text-[8px] text-white/90 font-semibold">{Math.round(pct)}%</span>}</div>; })}
                        </div>
                      ); })()}
                      <div className="flex flex-wrap gap-1">
                        {nlp.severityFlags.filter(f => f.count > 0).map((f, i) => <span key={f.flag} className="rounded-full bg-red-500/10 text-red-600 dark:text-red-400 font-semibold flex items-center gap-0.5" style={{ fontSize: i === 0 ? 11 : 9, padding: '2px 8px' }}><Flag className="w-3 h-3" />{f.flag.replace(/_/g, ' ')} {f.count}</span>)}
                      </div>
                    </div>

                    {/* Trust footer */}
                    <details className="text-[10px] text-muted-foreground">
                      <summary className="cursor-pointer font-medium flex items-center gap-1"><Lock className="w-3 h-3" /> ⓘ Yeh kaise bana</summary>
                      <div className="mt-1 pl-4 space-y-0.5">
                        <div>AI ne <span className="font-mono text-foreground">{nlp.coverage.enriched}/{nlp.coverage.total}</span> shikayat ka text padha.</div>
                        <div>Aggregate-only · koi vyaktigat profiling nahi · DPDP/ECI-safe.</div>
                      </div>
                    </details>
                  </>
                  );
                })()}
              </CardContent>
            )}
          </Card>

          {/* ── Row 6: "Wapas Jao" — closed-loop visit briefs ── */}
          <Card className={`border shadow-sm border-violet-500/20 ${show('field') ? '' : 'hidden'}`}>
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
                        <Button
                          variant="ghost" size="sm" className="h-6 px-1.5"
                          onClick={(e) => { e.stopPropagation(); makeVillagePr(v); }}
                          title="PR card — shareable achievement image"
                        >
                          <Megaphone className="w-3 h-3" />
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
