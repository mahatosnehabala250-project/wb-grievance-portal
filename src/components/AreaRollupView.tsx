'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Layers, RefreshCw, ChevronRight, AlertTriangle, Vote, Info,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';

/**
 * Where the pressure is, read the way a seat is actually organised:
 * block → gram panchayat → village.
 *
 * Everything is sorted by open complaints at every level, so the screen opens
 * on the problem rather than on the alphabet.
 */

interface VillageNode {
  name: string; total: number; open: number; resolved: number; critical: number;
  villageCode: string | null; booths: number;
}
interface GpNode {
  name: string; total: number; open: number; resolved: number; critical: number;
  villages: VillageNode[];
}
interface BlockNode {
  name: string; total: number; open: number; resolved: number; critical: number;
  gps: GpNode[];
}

/** One bar, shared by every level, so a row's weight reads the same everywhere. */
function Load({ open, of }: { open: number; of: number }) {
  const pct = of > 0 ? Math.round((open / of) * 100) : 0;
  return (
    <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden shrink-0" title={`${pct}% still open`}>
      <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Counts({ n }: { n: { total: number; open: number; critical: number } }) {
  return (
    <div className="flex items-center gap-2 shrink-0 tabular-nums">
      {n.critical > 0 && (
        <Badge className="text-[10px] border-0 bg-red-500/12 text-red-700 dark:text-red-400 gap-1">
          <AlertTriangle className="h-3 w-3" />{n.critical}
        </Badge>
      )}
      <Load open={n.open} of={n.total} />
      <span className="text-xs font-semibold w-14 text-right">
        {n.open}<span className="text-muted-foreground font-normal"> / {n.total}</span>
      </span>
    </div>
  );
}

export function AreaRollupView() {
  const [tree, setTree] = useState<BlockNode[]>([]);
  const [totals, setTotals] = useState<{ complaints: number; blocks: number; gps: number; villages: number } | null>(null);
  const [boothNote, setBoothNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [openBlocks, setOpenBlocks] = useState<Set<string>>(new Set());
  const [openGps, setOpenGps] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/complaints/rollup', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        const t: BlockNode[] = json.tree || [];
        setTree(t);
        setTotals(json.totals || null);
        setBoothNote(json.boothNote || '');
        // The heaviest block starts open — nobody should have to click to see
        // where the problem is.
        setOpenBlocks(new Set(t.slice(0, 1).map((b) => b.name)));
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Could not load the area rollup');
      }
    } catch { toast.error('Network error'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    apply(next);
  };

  /** Searching drills for you: matching places are shown and their parents opened. */
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return tree;
    const out: BlockNode[] = [];
    for (const b of tree) {
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
  }, [tree, q]);

  const searching = q.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            By Area
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Block, then gram panchayat, then village — heaviest first
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a GP or village…"
                 className="h-9 w-full sm:w-[220px] text-sm" />
          <Button variant="outline" size="sm" className="h-9" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {totals && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>{totals.complaints} complaints</span>
          <span>{totals.blocks} blocks</span>
          <span>{totals.gps} gram panchayats</span>
          <span>{totals.villages} villages</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span>
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <Layers className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm font-medium">{searching ? 'No place matches that' : 'No complaints to group yet'}</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((b) => {
            const bOpen = searching || openBlocks.has(b.name);
            return (
              <Card key={b.name}>
                <CardContent className="p-0">
                  <button type="button" onClick={() => toggle(openBlocks, b.name, setOpenBlocks)}
                          className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/40 transition-colors">
                    <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${bOpen ? 'rotate-90' : ''}`} />
                    <span className="font-semibold text-sm flex-1 text-left truncate">{b.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline">
                      {b.gps.length} GP
                    </span>
                    <Counts n={b} />
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
                          <Counts n={g} />
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
                                <Counts n={v} />
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
        </div>
      )}

      {boothNote && (
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" />{boothNote}
        </p>
      )}
    </div>
  );
}

export default AreaRollupView;
