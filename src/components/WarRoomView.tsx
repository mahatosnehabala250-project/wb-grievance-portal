'use client';

import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties, type ElementType, type ReactNode } from 'react';
import {
  Swords, Radio, Flame, Vote, Users, Clock, AlertTriangle, CheckCircle2, ShieldAlert, MapPin, Zap,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import { NAVY } from '@/lib/constants';
import { EmptyState } from '@/components/common';
import { useNav } from '@/lib/nav-context';

interface Kpis {
  open: number;
  breached: number;
  resolvedToday: number;
  total: number;
  slaAtRisk: number;
  avgOpenAgeDays: number;
}

interface TickerItem {
  ticketNo: string;
  issue: string;
  category: string;
  block: string | null;
  gp_name: string | null;
  urgency: string;
  status: string;
  ageHours: number;
}

interface HotspotGP {
  gp_name: string;
  block: string | null;
  assembly_constituency: string | null;
  open: number;
  breached: number;
  topCategory: string | null;
}

interface BlockHeat {
  block: string;
  open: number;
  breached: number;
}

interface KaryakartaActivity {
  karyakartaCount: number;
  assignedBooths: number;
  totalBooths: number;
}

interface BattlegroundBooth {
  ps: string;
  village: string | null;
  gp_name: string | null;
  winner: string;
  margin: number;
  bjp: number;
  aitc: number;
}

interface WarRoomMeta {
  scope?: string;
  constituency?: string;
}

interface CallListItem {
  ticketNo: string;
  citizenName: string | null;
  issue: string;
  block: string | null;
  gp_name: string | null;
  phone: string | null;
  ageDays: number;
}

interface AssignGP {
  gp_name: string;
  block: string | null;
  assembly_constituency: string | null;
  open: number;
  breached: number;
  coveredBooths: number;
  totalBooths: number;
}

interface BreachedUnassigned {
  count: number;
  topBlocks: { block: string; count: number }[];
}

interface WarRoomActions {
  callList: CallListItem[];
  assignGPs: AssignGP[];
  breachedUnassigned: BreachedUnassigned;
}

interface SinceYesterday {
  newComplaints: number;
  resolvedLast24h: number;
  newlyBreachedLast24h: number;
}

interface WarRoomData {
  kpis: Kpis;
  ticker: TickerItem[];
  hotspotGPs: HotspotGP[];
  blockHeat: BlockHeat[];
  karyakartaActivity: KaryakartaActivity;
  battleground: BattlegroundBooth[];
  actions?: WarRoomActions;
  sinceYesterday?: SinceYesterday;
  note?: string;
  meta: WarRoomMeta;
}

const EMPTY_KPIS: Kpis = { open: 0, breached: 0, resolvedToday: 0, total: 0, slaAtRisk: 0, avgOpenAgeDays: 0 };
const EMPTY_KARYAKARTA: KaryakartaActivity = { karyakartaCount: 0, assignedBooths: 0, totalBooths: 0 };
const EMPTY_ACTIONS: WarRoomActions = { callList: [], assignGPs: [], breachedUnassigned: { count: 0, topBlocks: [] } };
const EMPTY_SINCE_YESTERDAY: SinceYesterday = { newComplaints: 0, resolvedLast24h: 0, newlyBreachedLast24h: 0 };

const REFRESH_MS = 30_000;
const TOP_GPS = 8;
const TOP_TICKER = 20;
const TOP_BATTLEGROUND = 10;

function urgencyDotClass(urgency: string): string {
  if (urgency === 'CRITICAL' || urgency === 'HIGH') return 'bg-red-500';
  if (urgency === 'MEDIUM') return 'bg-amber-500';
  return 'bg-slate-500';
}

function fmtAge(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '—';
  if (hours < 1) return '<1h';
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

function winnerBadgeClass(winner: string): string {
  if (winner === 'BJP') return 'bg-orange-500/15 text-orange-300 border-orange-500/40';
  if (winner === 'AITC') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
  return 'bg-slate-500/15 text-slate-300 border-slate-500/40';
}

function heatStyle(open: number, max: number): CSSProperties {
  const ratio = max > 0 ? Math.min(1, open / max) : 0;
  return {
    backgroundColor: `rgba(220,38,38,${0.12 + ratio * 0.5})`,
    borderColor: `rgba(248,113,113,${0.25 + ratio * 0.45})`,
  };
}

function karyakartaCaption(k: KaryakartaActivity): string {
  if (k.karyakartaCount <= 1) {
    const label = k.karyakartaCount === 1 ? '১ কার্যকর্তা' : '০ কার্যকর্তা';
    return `${label} · ${k.assignedBooths}/${k.totalBooths} booth assigned — assign more in Booths`;
  }
  return `${k.karyakartaCount} karyakarta · ${k.assignedBooths}/${k.totalBooths} booths assigned`;
}

function KpiTile({ label, value, icon: Icon, color, sub, loading }: {
  label: string; value: string; icon: ElementType; color: string; sub?: string; loading: boolean;
}) {
  return (
    <Card className="border border-slate-800 bg-slate-900/70 shadow-none rounded-xl">
      <CardContent className="p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
          <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
        </div>
        {loading ? (
          <Skeleton className="h-7 sm:h-8 w-16 mt-1.5 bg-slate-800" />
        ) : (
          <p className="text-2xl sm:text-3xl font-black tabular-nums mt-0.5" style={{ color }}>{value}</p>
        )}
        {sub && !loading && (
          <p className="text-[10px] text-slate-500 mt-1 leading-snug">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ActionRow({ accent, button, children }: {
  accent: 'red' | 'amber' | 'slate'; button: ReactNode; children: ReactNode;
}) {
  const accentClass = accent === 'red'
    ? 'border-red-500/40 bg-red-500/10'
    : accent === 'amber'
      ? 'border-amber-500/30 bg-amber-500/5'
      : 'border-slate-800 bg-slate-900/50';
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${accentClass}`}>
      <p className="text-xs sm:text-sm text-slate-200 leading-snug min-w-0">{children}</p>
      <div className="shrink-0">{button}</div>
    </div>
  );
}

export function WarRoomView() {
  const nav = useNav();
  const [data, setData] = useState<WarRoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const hasLoadedRef = useRef(false);

  const fetchWarRoom = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const res = await fetch('/api/war-room', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setData(json);
        hasLoadedRef.current = true;
        setHasLoaded(true);
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Failed to load War Room');
      }
    } catch {
      toast.error('Network error');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchWarRoom();
    const poll = setInterval(fetchWarRoom, REFRESH_MS);
    return () => clearInterval(poll);
  }, [fetchWarRoom]);

  // Live clock — client-only (avoids SSR/hydration mismatch), ticks every second.
  useEffect(() => {
    setNow(new Date());
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  const kpis = data?.kpis || EMPTY_KPIS;
  const hotspotGPs = data?.hotspotGPs || [];
  const blockHeat = data?.blockHeat || [];
  const karyakarta = data?.karyakartaActivity || EMPTY_KARYAKARTA;
  const battleground = data?.battleground || [];
  const meta = data?.meta || {};
  const actions = data?.actions || EMPTY_ACTIONS;
  const sinceYesterday = data?.sinceYesterday || EMPTY_SINCE_YESTERDAY;

  const ticker = useMemo(
    () => [...(data?.ticker || [])].sort((a, b) => a.ageHours - b.ageHours).slice(0, TOP_TICKER),
    [data?.ticker],
  );
  const visibleGPs = useMemo(() => hotspotGPs.slice(0, TOP_GPS), [hotspotGPs]);
  const visibleBattleground = useMemo(
    () => [...battleground].sort((a, b) => Math.abs(a.margin) - Math.abs(b.margin)).slice(0, TOP_BATTLEGROUND),
    [battleground],
  );
  const maxBlockOpen = useMemo(() => blockHeat.reduce((m, b) => Math.max(m, b.open), 0), [blockHeat]);

  const assignGPActions = useMemo(() => actions.assignGPs.slice(0, 4), [actions.assignGPs]);
  const callListActions = useMemo(
    () => actions.callList.filter((c) => !!c.phone).slice(0, 5),
    [actions.callList],
  );
  const breachedUnassigned = actions.breachedUnassigned;
  const breachedBlocksSummary = useMemo(
    () => (breachedUnassigned.topBlocks || []).map((b) => `${b.block} (${b.count})`).join(', '),
    [breachedUnassigned.topBlocks],
  );
  const hasActions = breachedUnassigned.count > 0 || assignGPActions.length > 0 || callListActions.length > 0;

  const coveragePct = karyakarta.totalBooths > 0
    ? Math.round((karyakarta.assignedBooths / karyakarta.totalBooths) * 100)
    : 0;

  const initialLoading = loading && !hasLoaded;
  const clockStr = now ? now.toLocaleTimeString('en-IN', { hour12: false }) : '--:--:--';
  const dateStr = now ? now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-950 text-slate-100 shadow-xl overflow-hidden">
        <div className="p-3.5 sm:p-6 space-y-5">
          {/* Header */}
          <div
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl px-4 py-3.5 sm:px-6 sm:py-4"
            style={{ background: `linear-gradient(135deg, ${NAVY}, #030712)` }}
          >
            <div className="flex items-center gap-2.5">
              <Swords className="h-6 w-6 text-amber-400 shrink-0" />
              <div>
                <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2 flex-wrap">
                  War Room
                  <span className="text-xs sm:text-sm font-semibold text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-full px-2.5 py-0.5">
                    {meta.constituency || 'Purulia'}
                  </span>
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">Command center · auto-refreshes every 30s</p>
              </div>
            </div>
            <div className="flex items-center gap-3 sm:gap-5 self-start sm:self-auto">
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                <span className="text-[11px] font-bold uppercase tracking-widest text-red-400">Live</span>
              </div>
              <div className="text-right">
                <p className="text-xl sm:text-2xl font-black tabular-nums text-white leading-none">{clockStr}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{dateStr}</p>
              </div>
            </div>
          </div>

          {data?.note && (
            <p className="text-[11px] text-slate-400 italic px-1">{data.note}</p>
          )}

          {/* Today's Actions panel — the point of this screen: what to DO right now */}
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-3.5 sm:p-4 space-y-2.5">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-amber-400" />
              ⚡ আজকের কাজ / Today&apos;s Actions
            </h3>
            {initialLoading ? (
              <div className="space-y-1.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-lg bg-slate-800" />
                ))}
              </div>
            ) : !hasActions ? (
              <p className="text-xs sm:text-sm text-emerald-300 flex items-center gap-1.5 py-1">
                ✅ All clear — no urgent actions
              </p>
            ) : (
              <div className="space-y-1.5">
                {breachedUnassigned.count > 0 && (
                  <ActionRow
                    accent="red"
                    button={
                      <Button size="sm" variant="destructive" onClick={() => nav?.goTo('complaints')}>
                        Review
                      </Button>
                    }
                  >
                    🚨 <strong>{breachedUnassigned.count}</strong> breached complaints have no officer
                    {breachedBlocksSummary ? ` — ${breachedBlocksSummary}` : ''}
                  </ActionRow>
                )}
                {assignGPActions.map((g, i) => (
                  <ActionRow
                    key={`assign-${g.gp_name}-${i}`}
                    accent="amber"
                    button={
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
                        onClick={() => nav?.goTo('booths')}
                      >
                        Assign
                      </Button>
                    }
                  >
                    📍 <strong>{g.gp_name}</strong> ({g.block || '—'}): {g.open} open, {g.coveredBooths}/{g.totalBooths} booths covered — no karyakarta
                  </ActionRow>
                ))}
                {callListActions.map((c, i) => (
                  <ActionRow
                    key={`call-${c.ticketNo}-${i}`}
                    accent="slate"
                    button={
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="border-sky-500/40 text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
                      >
                        <a href={`tel:${c.phone}`}>Call</a>
                      </Button>
                    }
                  >
                    📞 {c.ticketNo} · {c.citizenName || 'Citizen'} · {c.issue} · {c.ageDays}d
                  </ActionRow>
                ))}
              </div>
            )}
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiTile label="Open" value={String(kpis.open)} icon={Radio} color="#7DD3FC" loading={initialLoading} />
            <KpiTile label="SLA Breached" value={String(kpis.breached)} icon={AlertTriangle} color="#F87171" loading={initialLoading} />
            <KpiTile label="At Risk" value={String(kpis.slaAtRisk)} icon={ShieldAlert} color="#FBBF24" loading={initialLoading} />
            <KpiTile label="Resolved Today" value={String(kpis.resolvedToday)} icon={CheckCircle2} color="#34D399" loading={initialLoading} />
            <KpiTile label="Avg Open Age" value={`${(kpis.avgOpenAgeDays ?? 0).toFixed(1)}d`} icon={Clock} color="#C4B5FD" loading={initialLoading} />
            <KpiTile
              label="Karyakarta Coverage"
              value={`${coveragePct}%`}
              icon={Users}
              color="#5EEAD4"
              sub={karyakartaCaption(karyakarta)}
              loading={initialLoading}
            />
          </div>

          {/* Since yesterday strip */}
          {!initialLoading && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 px-1">
              <span className="font-bold uppercase tracking-widest text-slate-600">Since yesterday</span>
              <span>🆕 {sinceYesterday.newComplaints} new</span>
              <span>✅ {sinceYesterday.resolvedLast24h} resolved</span>
              <span>⚠️ {sinceYesterday.newlyBreachedLast24h} newly breached</span>
            </div>
          )}

          {/* Middle: Priority GPs + Block Heat (left) / Live Feed (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
            {/* LEFT */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Flame className="h-4 w-4 text-orange-400" />
                Priority GPs — কোথায় কার্যকর্তা পাঠান
              </h3>
              <Card className="border border-slate-800 bg-slate-900/70 shadow-none rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-800 hover:bg-transparent">
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500 w-8">#</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">GP</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Block</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Open</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Breached</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Top Issue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {initialLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <TableRow key={i} className="border-slate-800">
                            {Array.from({ length: 6 }).map((_, j) => (
                              <TableCell key={j}><Skeleton className="h-5 w-full bg-slate-800" /></TableCell>
                            ))}
                          </TableRow>
                        ))
                      ) : visibleGPs.length === 0 ? (
                        <TableRow className="border-slate-800">
                          <TableCell colSpan={6}>
                            <EmptyState message="No open complaints in your area — all caught up!" icon={MapPin} />
                          </TableCell>
                        </TableRow>
                      ) : (
                        visibleGPs.map((g, i) => (
                          <TableRow key={`${g.gp_name}-${i}`} className="border-slate-800 hover:bg-slate-800/40">
                            <TableCell className="text-xs font-bold text-slate-500 tabular-nums">{i + 1}</TableCell>
                            <TableCell className="text-sm font-semibold text-slate-100">{g.gp_name || '—'}</TableCell>
                            <TableCell className="text-xs text-slate-400">{g.block || '—'}</TableCell>
                            <TableCell className="text-sm font-black tabular-nums text-sky-300">{g.open}</TableCell>
                            <TableCell>
                              {g.breached > 0 ? (
                                <Badge variant="outline" className="text-[11px] font-semibold px-2 py-0.5 bg-red-500/15 text-red-300 border-red-500/40">
                                  {g.breached}
                                </Badge>
                              ) : (
                                <span className="text-xs text-slate-600">0</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-slate-400">{g.topCategory || '—'}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Card>

              {/* Block Heat strip */}
              <div className="space-y-1.5">
                <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Block Heat</h4>
                {initialLoading ? (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-lg bg-slate-800" />
                    ))}
                  </div>
                ) : blockHeat.length === 0 ? (
                  <p className="text-xs text-slate-500">No block-level data yet.</p>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {blockHeat.map((b) => (
                      <div
                        key={b.block}
                        className="shrink-0 rounded-lg border px-3 py-1.5 min-w-[92px]"
                        style={heatStyle(b.open, maxBlockOpen)}
                      >
                        <p className="text-[10px] font-semibold text-slate-200 truncate max-w-[110px]">{b.block}</p>
                        <p className="text-sm font-black tabular-nums text-white">
                          {b.open}
                          {b.breached > 0 && <span className="text-[10px] font-bold text-red-300 ml-1">·{b.breached} SLA</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: Live Feed */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Radio className="h-4 w-4 text-sky-400" />
                Live Feed
              </h3>
              <Card className="border border-slate-800 bg-slate-900/70 shadow-none rounded-xl overflow-hidden">
                <CardContent className="p-0">
                  {initialLoading ? (
                    <div className="p-3 space-y-2">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full bg-slate-800" />
                      ))}
                    </div>
                  ) : ticker.length === 0 ? (
                    <EmptyState message="No live activity yet" icon={Radio} />
                  ) : (
                    <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-800">
                      {ticker.map((t, i) => (
                        <div
                          key={`${t.ticketNo}-${i}`}
                          className={`flex items-center gap-2 px-3 py-2 ${i === 0 ? 'border-t-2 border-sky-400 bg-sky-500/5' : ''}`}
                        >
                          <span className={`h-2 w-2 rounded-full shrink-0 ${urgencyDotClass(t.urgency)}`} />
                          <span className="text-[11px] font-mono font-bold text-slate-400 shrink-0">{t.ticketNo}</span>
                          <span className="text-xs text-slate-200 truncate flex-1 min-w-0" title={t.issue}>{t.issue}</span>
                          <span className="text-[10px] text-slate-500 shrink-0 hidden sm:inline">{t.block || '—'}</span>
                          <span className="text-[11px] font-bold tabular-nums text-slate-400 shrink-0">{fmtAge(t.ageHours)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Battleground band */}
          {visibleBattleground.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Vote className="h-4 w-4 text-amber-400" />
                Battleground Booths (Balarampur, 2021)
              </h3>
              <Card className="border border-slate-800 bg-slate-900/70 shadow-none rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-800 hover:bg-transparent">
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Booth</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Village</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">GP</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">2021 Winner</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Margin</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleBattleground.map((b, i) => (
                        <TableRow key={`${b.ps}-${i}`} className="border-slate-800 hover:bg-slate-800/40">
                          <TableCell className="font-mono text-xs font-bold text-slate-200">{b.ps}</TableCell>
                          <TableCell className="text-xs text-slate-400">{b.village || '—'}</TableCell>
                          <TableCell className="text-xs text-slate-400">{b.gp_name || '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[11px] font-semibold px-2 py-0.5 ${winnerBadgeClass(b.winner)}`}>
                              {b.winner}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-semibold tabular-nums text-slate-300">{b.margin}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
              <p className="text-[11px] text-slate-500 px-1">
                2021 result data — Balarampur booths only. Booth numbering may shift under 2026 SIR; treat as directional, not a precise crosswalk.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
