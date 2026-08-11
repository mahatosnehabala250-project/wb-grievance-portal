'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Layers, RefreshCw, ChevronRight, ChevronDown, AlertTriangle, Vote, Info,
  CheckCircle2, MapPin, Clock, UserPlus, UserX,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import { CATEGORY_LABELS, CATEGORY_COLORS } from '@/lib/constants';
import type { AssignableUser } from '@/lib/types';

/**
 * Where to send someone today.
 *
 * This screen used to be a three-level accordion of counts — block, gram
 * panchayat, village, each row a tiny amber bar and "n open of m". It was
 * accurate and it said nothing. Most of a well-run seat is quiet, so most of the
 * screen was grey rows reading "0 / 8", and the one village that actually needed
 * a person sat among them at the same visual weight.
 *
 * The order is now: what needs a decision, then what is fine, then the full
 * geography for anyone who came looking for a specific place. The bar is gone —
 * at one to four complaints a village it could only ever draw 0, 25, 50, 75 or
 * 100 percent, and a village with 1 open of 1 drew a fuller bar than one with 3
 * open of 30.
 */

interface Ticket {
  id: string; ticketNo: string; issue: string; category: string;
  urgency: string; ageDays: number; level: string; unowned: boolean;
}
interface Pressure {
  village: string; gp: string; block: string; villageCode: string | null;
  open: number; unowned: number; oldestDays: number; worstLevel: string;
  categories: { category: string; n: number }[];
  tickets: Ticket[]; moreTickets: number;
}
interface VillageNode {
  name: string; total: number; open: number; resolved: number; critical: number;
  unowned: number; oldestOpenDays: number | null;
  villageCode: string | null; booths: number;
}
interface GpNode {
  name: string; total: number; open: number; resolved: number; critical: number;
  unowned: number; oldestOpenDays: number | null; villages: VillageNode[];
}
interface BlockNode {
  name: string; total: number; open: number; resolved: number; critical: number;
  unowned: number; oldestOpenDays: number | null; gps: GpNode[];
}
interface Totals {
  complaints: number; blocks: number; gps: number; villages: number;
  open: number; openVillages: number; unowned: number;
  oldestOpenDays: number | null; oldestOpenPlace: string | null;
}
interface Coverage {
  acVillages: number; filedVillages: number;
  acGps: number; filedGps: number; silentGps: number; gpsWithWorker: number;
}
interface Payload {
  pressure: Pressure[]; pressureTruncated: number;
  sla: { breached: number; warning: number; ok: number };
  quiet: { villages: string[]; gps: number; resolved: number };
  coverage: Coverage | null;
  tree: BlockNode[]; totals: Totals; unmatchedGp: number; boothNote: string;
}

/** Severity is never carried by colour alone — every band also has its word. */
const BAND: Record<string, { rail: string; chip: string; dot: string; word: string }> = {
  breached: {
    rail: 'bg-red-500',
    chip: 'bg-red-500/12 text-red-700 dark:text-red-400',
    dot: 'bg-red-500', word: 'past deadline',
  },
  warning: {
    rail: 'bg-amber-500',
    chip: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500', word: 'at risk',
  },
  ok: {
    rail: 'bg-sky-500',
    chip: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
    dot: 'bg-sky-500', word: 'on time',
  },
};

const days = (n: number | null) =>
  n === null ? '—' : n < 1 ? `${Math.round(n * 24)}h` : `${n % 1 === 0 ? n : n.toFixed(1)}d`;

/** One tile of the decision header. A figure nobody can act on is not a tile. */
function Tile({ n, label, tone, onClick }: {
  n: string; label: React.ReactNode; tone: string; onClick?: () => void;
}) {
  const inner = (
    <>
      <div className={`text-3xl sm:text-4xl font-black tabular-nums leading-none ${tone}`}>{n}</div>
      <div className="text-[11px] text-muted-foreground mt-1.5 leading-tight">{label}</div>
    </>
  );
  return (
    <Card className={onClick ? 'transition-colors hover:bg-muted/40' : undefined}>
      <CardContent className="p-4">
        {onClick
          ? <button type="button" onClick={onClick} className="w-full text-left">{inner}</button>
          : inner}
      </CardContent>
    </Card>
  );
}

export function AreaRollupView() {
  const [d, setD] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openBlocks, setOpenBlocks] = useState<Set<string>>(new Set());
  const [openGps, setOpenGps] = useState<Set<string>>(new Set());
  const [showDirectory, setShowDirectory] = useState(false);
  const [showQuiet, setShowQuiet] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [assignees, setAssignees] = useState<AssignableUser[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const hasLoaded = useRef(false);

  const load = useCallback(async () => {
    // Only the first load blanks the screen. A manual refresh used to throw away
    // the tree, the scroll position and every expanded row before the new data
    // arrived, which made a working refresh feel like a crash.
    if (hasLoaded.current) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetch('/api/complaints/rollup', { headers: authHeaders() });
      if (res.ok) {
        const json: Payload = await res.json();
        setD(json);
        hasLoaded.current = true;
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Could not load the area rollup');
      }
    } catch { toast.error('Network error'); }
    setLoading(false); setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Who a case can be handed to. The endpoint already returns only people inside
  // the caller's jurisdiction.
  useEffect(() => {
    fetch('/api/users/list', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.users) setAssignees(j.users); })
      .catch(() => {});
  }, []);

  const assign = async (complaintId: string, userId: string) => {
    setBusyId(complaintId);
    try {
      const res = await fetch(`/api/complaints/${complaintId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ assignedToId: userId, status: 'ASSIGNED' }),
      });
      if (res.ok) { toast.success('Assigned'); await load(); }
      else {
        const j = await res.json().catch(() => null);
        toast.error(j?.error || 'Could not assign');
      }
    } catch { toast.error('Network error'); }
    finally { setBusyId(null); }
  };

  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    apply(next);
  };

  const term = q.trim().toLowerCase();
  const searching = term.length > 0;

  /** Searching drills for you: matching places are shown and their parents opened. */
  const filteredTree = useMemo(() => {
    if (!d) return [];
    if (!term) return d.tree;
    const out: BlockNode[] = [];
    for (const b of d.tree) {
      const gps: GpNode[] = [];
      for (const g of b.gps) {
        const villages = g.villages.filter((v) => v.name.toLowerCase().includes(term));
        if (g.name.toLowerCase().includes(term) || villages.length) {
          gps.push({ ...g, villages: villages.length ? villages : g.villages });
        }
      }
      if (b.name.toLowerCase().includes(term) || gps.length) {
        out.push({ ...b, gps: gps.length ? gps : b.gps });
      }
    }
    return out;
  }, [d, term]);

  const pressure = useMemo(() => {
    if (!d) return [];
    return d.pressure.filter((p) =>
      (!levelFilter || p.worstLevel === levelFilter) &&
      (!term || p.village.toLowerCase().includes(term) || p.gp.toLowerCase().includes(term)
        || p.block.toLowerCase().includes(term)));
  }, [d, levelFilter, term]);

  const quietMatches = useMemo(() => {
    if (!d) return [];
    return term ? d.quiet.villages.filter((v) => v.toLowerCase().includes(term)) : d.quiet.villages;
  }, [d, term]);

  const scrollToPressure = () => {
    document.getElementById('pressure-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h2 className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          By Area
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Where to send someone today</p>
      </div>
      <div className="flex items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a village or GP…"
               className="h-9 w-full sm:w-[220px] text-sm" />
        <Button variant="outline" size="sm" className="h-9" onClick={load} disabled={loading || refreshing}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>
    </div>
  );

  if (loading) return (
    <div className="space-y-4">
      {header}
      <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span>
      </div>
    </div>
  );

  if (!d) return (
    <div className="space-y-4">
      {header}
      <Card><CardContent className="p-8 text-center">
        <AlertTriangle className="h-8 w-8 mx-auto text-red-500 mb-2" />
        <p className="text-sm font-semibold">Could not load the area breakdown</p>
        <p className="text-xs text-muted-foreground mt-1">Nothing has changed in your records.</p>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs mt-4" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </Button>
      </CardContent></Card>
    </div>
  );

  const t = d.totals;
  const oldestBand = t.oldestOpenDays === null ? 'ok' : (d.pressure[0]?.worstLevel ?? 'ok');
  const nothingOpen = t.open === 0;

  return (
    <div className="space-y-4">
      {header}

      {/* ── What needs a decision ─────────────────────────────── */}
      {nothingOpen ? (
        <Card className="border-0" style={{ background: 'rgba(16,185,129,0.08)' }}>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            <p className="text-sm font-semibold">
              All {t.complaints} resolved. Nothing waiting anywhere in the seat.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Tile n={String(t.open)} tone="text-amber-600"
                  label={<>open — in {t.openVillages} of {t.villages} villages</>} />
            <Tile n={String(t.unowned)} tone={t.unowned > 0 ? 'text-red-600' : 'text-emerald-600'}
                  label="nobody assigned"
                  onClick={t.unowned > 0 ? scrollToPressure : undefined} />
            <Tile n={days(t.oldestOpenDays)}
                  tone={oldestBand === 'breached' ? 'text-red-600' : oldestBand === 'warning' ? 'text-amber-600' : 'text-foreground'}
                  label={<>longest wait{t.oldestOpenPlace ? ` · ${t.oldestOpenPlace}` : ''}</>}
                  onClick={scrollToPressure} />
          </div>

          {/* Counts, never a bar. One late case out of six is the whole story;
              painted as a sixth of a bar it reads as mild. */}
          <div className="flex flex-wrap gap-2">
            {(['breached', 'warning', 'ok'] as const).map((k) => {
              const n = d.sla[k];
              const active = levelFilter === k;
              return (
                <button key={k} type="button" disabled={n === 0}
                        onClick={() => setLevelFilter(active ? null : k)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold flex items-center gap-1.5 transition-all
                                    ${BAND[k].chip} ${n === 0 ? 'opacity-40 cursor-default' : 'hover:brightness-95'}
                                    ${active ? 'ring-1 ring-current' : ''}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${BAND[k].dot}`} />
                  {n} {BAND[k].word}
                </button>
              );
            })}
          </div>

          {/* ── The pressure list ──────────────────────────────── */}
          <div id="pressure-list" className="scroll-mt-4">
            <div className="mb-2">
              <h3 className="text-sm font-bold">Where to send someone</h3>
              <p className="text-[10px] text-muted-foreground">
                Past deadline first, then nobody assigned, then longest waiting.
              </p>
            </div>

            {pressure.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
                {levelFilter ? `Nothing ${BAND[levelFilter].word} right now.` : 'No place matches that.'}
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {pressure.map((p) => {
                  const band = BAND[p.worstLevel] ?? BAND.ok;
                  const firstUnowned = p.tickets.find((x) => x.unowned);
                  return (
                    <Card key={`${p.block}/${p.gp}/${p.village}`} className="relative overflow-hidden">
                      <div className={`absolute inset-y-0 left-0 w-[3px] ${band.rail}`} />
                      <CardContent className="p-3 pl-4">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-base font-semibold truncate">{p.village}</span>
                              {p.unowned > 0 && (
                                <Badge className="text-[10px] border-0 bg-amber-500/12 text-amber-700 dark:text-amber-400 gap-1">
                                  <UserX className="h-3 w-3" />
                                  {p.unowned} nobody assigned
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {p.gp} · {p.block}
                            </p>
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {p.categories.map(({ category, n }) => {
                                const c = CATEGORY_COLORS[category] || '#64748B';
                                return (
                                  <span key={category}
                                        className="text-[10px] font-medium rounded px-1.5 py-0.5"
                                        style={{ background: `${c}1F`, color: c }}>
                                    {CATEGORY_LABELS[category] || category}{n > 1 ? ` ×${n}` : ''}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-2xl font-black tabular-nums leading-none">{p.open}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">open</div>
                            <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1 justify-end">
                              <Clock className="h-3 w-3" />{days(p.oldestDays)} waiting
                            </div>
                          </div>
                        </div>

                        <div className="mt-2.5 space-y-1 border-t pt-2">
                          {p.tickets.map((tk) => (
                            <div key={tk.id} className="flex items-center gap-2 text-[11px]">
                              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${(BAND[tk.level] ?? BAND.ok).dot}`}
                                    title={(BAND[tk.level] ?? BAND.ok).word} />
                              <span className="font-mono text-[10px] text-muted-foreground shrink-0">{tk.ticketNo}</span>
                              <span className="truncate flex-1">{tk.issue}</span>
                              <span className="text-muted-foreground tabular-nums shrink-0">{days(tk.ageDays)}</span>
                            </div>
                          ))}
                          {p.moreTickets > 0 && (
                            <p className="text-[10px] text-muted-foreground pl-3.5">
                              +{p.moreTickets} more here
                            </p>
                          )}
                        </div>

                        {/* The one action that closes the real gap. The repo's own
                            history says cases sat for months not because closing is
                            slow but because nobody had been given them. */}
                        {firstUnowned && (
                          <div className="mt-2.5 flex items-center gap-2">
                            <UserPlus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <Select disabled={busyId === firstUnowned.id}
                                    onValueChange={(v) => assign(firstUnowned.id, v)}>
                              <SelectTrigger className="h-8 text-xs w-full sm:w-[260px]">
                                <SelectValue placeholder={
                                  busyId === firstUnowned.id ? 'Assigning…' : `Give ${firstUnowned.ticketNo} to…`
                                } />
                              </SelectTrigger>
                              <SelectContent>
                                {assignees.map((u) => (
                                  <SelectItem key={u.id} value={u.id} className="text-xs">
                                    {u.name}{u.block ? ` · ${u.block}` : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
                {d.pressureTruncated > 0 && !searching && !levelFilter && (
                  <p className="text-[11px] text-muted-foreground pl-1">
                    {d.pressureTruncated} more villages have open cases — use the directory below.
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── What is already fine ──────────────────────────────── */}
      {d.quiet.villages.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <button type="button" onClick={() => setShowQuiet((s) => !s)}
                    className="w-full flex items-center gap-2 text-left">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="text-[13px] font-medium flex-1">
                {d.quiet.villages.length} villages across {d.quiet.gps} GPs are fully resolved
                <span className="text-muted-foreground font-normal"> · {d.quiet.resolved} closed</span>
              </span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showQuiet || searching ? 'rotate-180' : ''}`} />
            </button>
            {(showQuiet || searching) && (
              <div className="flex flex-wrap gap-1 mt-2.5">
                {quietMatches.length === 0
                  ? <span className="text-[11px] text-muted-foreground">No settled village matches that.</span>
                  : quietMatches.map((v) => (
                      <span key={v} className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{v}</span>
                    ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── The parts of the seat this office has never heard from ── */}
      {d.coverage && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 mt-px" />
            <span>
              <span className="font-medium text-foreground">{d.coverage.filedVillages} of {d.coverage.acVillages}</span>
              {' '}villages in this constituency have ever reached this office
              {d.coverage.silentGps > 0 && <> — <span className="font-medium text-foreground">{d.coverage.silentGps}</span> gram panchayat{d.coverage.silentGps === 1 ? '' : 's'} never have</>}.
            </span>
          </p>
          {/* Stated plainly because it is the honest limit on everything above:
              a case can only be handed to someone who exists. */}
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <UserX className="h-3.5 w-3.5 shrink-0 mt-px" />
            <span>
              <span className="font-medium text-foreground">{d.coverage.gpsWithWorker} of {d.coverage.acGps}</span>
              {' '}gram panchayat{d.coverage.acGps === 1 ? '' : 's'}
              {' '}{d.coverage.gpsWithWorker === 1 ? 'has' : 'have'} a named worker on the ground.
            </span>
          </p>
        </div>
      )}

      {/* ── The full geography, for anyone looking for one place ── */}
      <div>
        <button type="button" onClick={() => setShowDirectory((s) => !s)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showDirectory || searching ? 'rotate-90' : ''}`} />
          Full directory — {t.blocks} blocks, {t.gps} gram panchayats, {t.villages} villages
        </button>

        {(showDirectory || searching) && (
          <div className="space-y-2 mt-2">
            {filteredTree.length === 0 ? (
              <Card><CardContent className="p-6 text-center">
                <Layers className="h-7 w-7 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm font-medium">No place matches that</p>
              </CardContent></Card>
            ) : filteredTree.map((b) => {
              const bOpen = searching || openBlocks.has(b.name);
              return (
                <Card key={b.name}>
                  <CardContent className="p-0">
                    <button type="button" onClick={() => toggle(openBlocks, b.name, setOpenBlocks)}
                            className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/40 transition-colors">
                      <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${bOpen ? 'rotate-90' : ''}`} />
                      <span className="font-semibold text-sm flex-1 text-left truncate">{b.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline">{b.gps.length} GP</span>
                      <Row n={b} />
                    </button>

                    {bOpen && b.gps.map((g) => {
                      const gKey = `${b.name}/${g.name}`;
                      const gOpen = searching || openGps.has(gKey);
                      return (
                        <div key={gKey} className="border-t">
                          <button type="button" onClick={() => toggle(openGps, gKey, setOpenGps)}
                                  className="w-full flex items-center gap-2 pl-8 pr-3 py-2 hover:bg-muted/40 transition-colors">
                            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${gOpen ? 'rotate-90' : ''}`} />
                            <span className="text-[13px] flex-1 text-left truncate">{g.name}</span>
                            <Row n={g} />
                          </button>

                          {gOpen && (
                            <div className="bg-muted/20">
                              {g.villages.map((v) => (
                                <div key={`${gKey}/${v.name}`}
                                     className="flex items-center gap-2 pl-[52px] pr-3 py-1.5 border-t border-border/40">
                                  <span className="text-[12px] flex-1 truncate">{v.name}</span>
                                  {v.booths > 0 && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0"
                                          title="Polling stations serving this village — not complaints per booth">
                                      <Vote className="h-3 w-3" />{v.booths}
                                    </span>
                                  )}
                                  <Row n={v} />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}

            <div className="space-y-1 pt-1">
              {d.boothNote && (
                <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-px" />{d.boothNote}
                </p>
              )}
              {d.unmatchedGp > 0 && (
                <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                  {d.unmatchedGp} complaint{d.unmatchedGp === 1 ? ' is' : 's are'} not matched to a gram panchayat.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A directory row's right-hand side. Settled places say so in words instead of
 * drawing a zero-width bar — "8 resolved" is a result, "0 / 8" was noise.
 */
function Row({ n }: { n: { open: number; total: number; resolved: number; unowned: number; oldestOpenDays: number | null } }) {
  if (n.open === 0) {
    return (
      <span className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1 tabular-nums">
        <CheckCircle2 className="h-3 w-3 text-emerald-600" />{n.resolved} resolved
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 shrink-0 tabular-nums">
      {n.unowned > 0 && (
        <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-amber-500/12 text-amber-700 dark:text-amber-400">
          {n.unowned} unassigned
        </span>
      )}
      {n.oldestOpenDays !== null && (
        <span className="text-[10px] text-muted-foreground">{days(n.oldestOpenDays)}</span>
      )}
      <span className="text-xs font-semibold w-16 text-right">
        {n.open}<span className="text-muted-foreground font-normal"> open</span>
      </span>
    </span>
  );
}

export default AreaRollupView;
