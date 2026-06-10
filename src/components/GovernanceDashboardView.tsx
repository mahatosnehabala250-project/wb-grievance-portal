'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText, Activity, CheckCircle2, Timer, AlertTriangle, Flame, CalendarRange,
  RefreshCw, Search, MapPin, Star, Eye, Users, Building2, Home,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/lib/auth-store';
import { authHeaders, fmtDate, getSLAInfo } from '@/lib/helpers';
import { StatusBadge, UrgencyBadge } from '@/components/common';
import { ComplaintDetailDialog } from '@/components/ComplaintDetailDialog';
import type { Complaint } from '@/lib/types';

type GovLevel = 'KARYAKARTA' | 'GP_COORD' | 'BLOCK_COORD';

const ROLE_CONFIG: Record<GovLevel, {
  label: string; emoji: string; gradient: string; breakdownKey: 'village' | 'gpName'; breakdownLabel: string; breakdownIcon: React.ElementType;
}> = {
  KARYAKARTA:  { label: 'Karyakarta',        emoji: '🧑‍🌾', gradient: 'from-teal-600 to-emerald-600',  breakdownKey: 'village', breakdownLabel: 'Village',        breakdownIcon: MapPin },
  GP_COORD:    { label: 'GP Coordinator',    emoji: '🏘️',   gradient: 'from-cyan-600 to-teal-600',     breakdownKey: 'village', breakdownLabel: 'Village',        breakdownIcon: MapPin },
  BLOCK_COORD: { label: 'Block Coordinator', emoji: '🏢',   gradient: 'from-emerald-600 to-green-600', breakdownKey: 'gpName',  breakdownLabel: 'Gram Panchayat', breakdownIcon: Building2 },
};

export function GovernanceDashboardView() {
  const { user } = useAuthStore();
  const lvl = (user?.role_level as GovLevel) || 'BLOCK_COORD';
  const cfg = ROLE_CONFIG[lvl] || ROLE_CONFIG.BLOCK_COORD;

  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'home' | 'complaints' | 'breakdown'>('home');
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState<string>('ALL');
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [lastSync, setLastSync] = useState<Date>(new Date());

  const scopeLabel = useMemo(() => {
    if (lvl === 'KARYAKARTA') return (user?.assigned_villages || []).join(', ') || user?.gp_name || 'My Villages';
    if (lvl === 'GP_COORD') return user?.gp_name || 'My Gram Panchayat';
    return user?.block || 'My Block';
  }, [lvl, user]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetch('/api/complaints?limit=500', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setComplaints(json.complaints || []);
        setLastSync(new Date());
      }
    } catch { /* silent */ }
    setLoading(false); setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── KPIs (client-side from scoped complaints) ──
  const k = useMemo(() => {
    const total = complaints.length;
    let open = 0, inProgress = 0, resolved = 0, rejected = 0, critical = 0, slaBreached = 0;
    const ratings: number[] = [];
    const now = Date.now();
    const sevenDayAgo = now - 7 * 86400000;
    let last7 = 0;
    for (const c of complaints) {
      const s = c.status;
      if (s === 'OPEN' || s === 'REGISTERED') open++;
      else if (s === 'IN_PROGRESS' || s === 'ASSIGNED') inProgress++;
      else if (s === 'RESOLVED') resolved++;
      else if (s === 'REJECTED') rejected++;
      if (c.urgency === 'CRITICAL') critical++;
      if (c.satisfactionRating) ratings.push(c.satisfactionRating);
      if (new Date(c.createdAt).getTime() >= sevenDayAgo) last7++;
      const active = !['RESOLVED', 'REJECTED', 'CLOSED'].includes(s);
      if (active) {
        const sla = getSLAInfo(c.createdAt, s);
        if (sla.level === 'breached') slaBreached++;
      }
    }
    const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
    return { total, open, inProgress, resolved, rejected, critical, slaBreached, last7, avgRating };
  }, [complaints]);

  // ── Breakdown (village-wise / GP-wise) ──
  const breakdown = useMemo(() => {
    const map: Record<string, { total: number; active: number; resolved: number }> = {};
    for (const c of complaints) {
      const key = (c as any)[cfg.breakdownKey] || '—';
      if (!map[key]) map[key] = { total: 0, active: 0, resolved: 0 };
      map[key].total++;
      if (c.status === 'RESOLVED') map[key].resolved++;
      else if (!['REJECTED', 'CLOSED'].includes(c.status)) map[key].active++;
    }
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [complaints, cfg.breakdownKey]);

  const filtered = useMemo(() => complaints.filter(c => {
    const ms = !search ||
      c.ticketNo?.toLowerCase().includes(search.toLowerCase()) ||
      c.citizenName?.toLowerCase().includes(search.toLowerCase()) ||
      c.issue?.toLowerCase().includes(search.toLowerCase());
    return ms && (statusF === 'ALL' || c.status === statusF);
  }), [complaints, search, statusF]);

  const openDetail = (c: Complaint) => { setSelected(c); setDetailOpen(true); };

  const KPIS = [
    { l: 'Total',       v: k.total,      icon: FileText,      c: 'text-foreground',  bg: 'bg-muted/50' },
    { l: 'Active',      v: k.open + k.inProgress, icon: Activity, c: 'text-red-500', bg: 'bg-red-500/8' },
    { l: 'Resolved',    v: k.resolved,   icon: CheckCircle2,  c: 'text-emerald-500', bg: 'bg-emerald-500/8' },
    { l: 'In Progress', v: k.inProgress, icon: Timer,         c: 'text-amber-500',   bg: 'bg-amber-500/8' },
    { l: 'Critical',    v: k.critical,   icon: AlertTriangle, c: 'text-red-600',     bg: 'bg-red-600/8' },
    { l: 'SLA Breach',  v: k.slaBreached,icon: Flame,         c: 'text-orange-600',  bg: 'bg-orange-600/8' },
    { l: 'Last 7 Days', v: k.last7,      icon: CalendarRange, c: 'text-violet-500',  bg: 'bg-violet-500/8' },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* ── Header ── */}
      <div className="flex-shrink-0 border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className={`bg-gradient-to-r ${cfg.gradient} px-4 py-2`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">{cfg.emoji}</span>
              <div>
                <div className="font-bold text-white text-base leading-tight">{scopeLabel}</div>
                <div className="text-white/80 text-[11px]">{user?.name} · {cfg.label} Dashboard</div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-white/90 text-xs">
              <div className="text-center"><div className="font-bold text-lg leading-none">{k.total}</div><div className="text-[9px] uppercase opacity-80">Total</div></div>
              <div className="text-center"><div className="font-bold text-lg leading-none text-red-200">{k.open + k.inProgress}</div><div className="text-[9px] uppercase opacity-80">Active</div></div>
              <div className="text-center"><div className="font-bold text-lg leading-none text-emerald-200">{k.resolved}</div><div className="text-[9px] uppercase opacity-80">Resolved</div></div>
            </div>
          </div>
        </div>
        <div className="px-4 py-1.5 flex items-center justify-between gap-2">
          <div className="flex gap-0.5 bg-muted/50 rounded-lg p-0.5">
            {([
              { id: 'home', label: '🏠 Home' },
              { id: 'complaints', label: '📋 Complaints' },
              { id: 'breakdown', label: `📍 ${cfg.breakdownLabel}s` },
            ] as const).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${tab === t.id ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {k.slaBreached > 0 && <Badge variant="destructive" className="text-[10px] h-5 animate-pulse">⚠ {k.slaBreached} SLA</Badge>}
            <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="h-7 text-[11px] px-2">
              <RefreshCw className={`w-3 h-3 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              {lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading {scopeLabel} data...
            </div>
          ) : (
          <AnimatePresence mode="wait">

            {/* ══ HOME ══ */}
            {tab === 'home' && (
              <motion.div key="home" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                {(k.critical > 0 || k.slaBreached > 0) && (
                  <div className="flex gap-2 flex-wrap">
                    {k.critical > 0 && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 flex-1 min-w-0">
                        <Flame className="w-4 h-4 text-red-500 flex-shrink-0" />
                        <span className="text-sm font-semibold text-red-600 dark:text-red-400">{k.critical} Critical complaint{k.critical > 1 ? 's' : ''} need attention</span>
                      </div>
                    )}
                    {k.slaBreached > 0 && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex-1 min-w-0">
                        <Timer className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{k.slaBreached} past deadline — escalate</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  {KPIS.map((kp, i) => (
                    <motion.div key={kp.l} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}>
                      <Card className="border shadow-sm">
                        <CardContent className="p-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{kp.l}</span>
                            <kp.icon className={`w-3.5 h-3.5 ${kp.c}`} />
                          </div>
                          <div className={`text-xl font-black font-mono ${kp.c}`}>{kp.v}</div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>

                {/* Avg rating + quick breakdown preview */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Card className="border shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1"><Star className="w-4 h-4 text-amber-500" /><span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Avg Citizen Rating</span></div>
                      <div className="text-3xl font-black text-amber-500">{k.avgRating ? k.avgRating.toFixed(1) : '—'}<span className="text-base text-muted-foreground">/5</span></div>
                    </CardContent>
                  </Card>
                  <Card className="border shadow-sm md:col-span-2">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2"><cfg.breakdownIcon className="w-4 h-4 text-muted-foreground" /><span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Top {cfg.breakdownLabel}s</span></div>
                      <div className="space-y-1.5">
                        {breakdown.slice(0, 4).map(([name, st]) => (
                          <div key={name} className="flex items-center justify-between text-sm">
                            <span className="font-medium truncate">{name}</span>
                            <span className="text-[11px] text-muted-foreground">{st.total} total · {st.active} active · {st.resolved} resolved</span>
                          </div>
                        ))}
                        {breakdown.length === 0 && <span className="text-xs text-muted-foreground italic">No data</span>}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </motion.div>
            )}

            {/* ══ COMPLAINTS ══ */}
            {tab === 'complaints' && (
              <motion.div key="complaints" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Search ticket, name, issue..." value={search} onChange={e => setSearch(e.target.value)} className="h-8 pl-8 text-xs" />
                  </div>
                  <div className="flex gap-0.5 bg-muted/50 rounded-lg p-0.5">
                    {['ALL', 'REGISTERED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'].map(s => (
                      <button key={s} onClick={() => setStatusF(s)} className={`px-2 py-1 rounded text-[10px] font-medium ${statusF === s ? 'bg-background shadow text-foreground' : 'text-muted-foreground'}`}>{s === 'ALL' ? 'All' : s.replace('_', ' ')}</button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  {filtered.map(c => {
                    const sla = getSLAInfo(c.createdAt, c.status);
                    return (
                      <Card key={c.id} className="border shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => openDetail(c)}>
                        <CardContent className="p-3 flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-bold">{c.ticketNo}</span>
                              <StatusBadge status={c.status} />
                              <UrgencyBadge urgency={c.urgency} />
                              {sla.level === 'breached' && <Badge variant="destructive" className="text-[9px] h-4">SLA</Badge>}
                            </div>
                            <p className="text-sm font-medium truncate mt-1">{c.issue}</p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {c.citizenName || 'Anonymous'} · {c.village || '—'}{c.gpName ? `, ${c.gpName}` : ''} · {fmtDate(c.createdAt)}
                            </p>
                          </div>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0"><Eye className="h-4 w-4" /></Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {filtered.length === 0 && <div className="text-center py-12 text-sm text-muted-foreground">No complaints found</div>}
                </div>
              </motion.div>
            )}

            {/* ══ BREAKDOWN ══ */}
            {tab === 'breakdown' && (
              <motion.div key="breakdown" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2">
                <div className="flex items-center gap-2 mb-1 text-sm font-semibold"><cfg.breakdownIcon className="w-4 h-4" /> {cfg.breakdownLabel}-wise breakdown</div>
                {breakdown.map(([name, st]) => {
                  const pct = st.total ? Math.round((st.resolved / st.total) * 100) : 0;
                  return (
                    <Card key={name} className="border shadow-sm">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-semibold text-sm flex items-center gap-1.5"><cfg.breakdownIcon className="w-3.5 h-3.5 text-muted-foreground" />{name}</span>
                          <span className="text-[11px] text-muted-foreground">{st.total} total</span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px]">
                          <span className="text-red-500">{st.active} active</span>
                          <span className="text-emerald-500">{st.resolved} resolved</span>
                          <span className="ml-auto font-bold">{pct}% resolved</span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {breakdown.length === 0 && <div className="text-center py-12 text-sm text-muted-foreground">No data</div>}
              </motion.div>
            )}

          </AnimatePresence>
          )}
        </div>
      </ScrollArea>

      <ComplaintDetailDialog
        complaint={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={() => load(true)}
      />
    </div>
  );
}
