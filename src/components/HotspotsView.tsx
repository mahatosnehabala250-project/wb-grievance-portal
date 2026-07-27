'use client';

import { useState, useEffect, useCallback } from 'react';
import { Flame, Vote, MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import { NAVY } from '@/lib/constants';
import { EmptyState } from '@/components/common';

interface Hotspot {
  assembly_constituency: string | null;
  block: string | null;
  gp_name: string | null;
  gp_code: string | null;
  open: number;
  breached: number;
  total: number;
  topCategory: string | null;
}

interface BattlegroundBooth {
  ps: string;
  village: string | null;
  gp_name: string | null;
  block_name: string | null;
  bjp: number;
  aitc: number;
  margin: number;
  winner: string;
}

interface HotspotsMeta {
  scope?: string;
  totalOpen: number;
  gpCount: number;
}

const SHOW_TOP_N = 20;

function winnerBadgeClass(winner: string) {
  if (winner === 'BJP') {
    return 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800';
  }
  if (winner === 'AITC') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800';
  }
  return 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-900/40 dark:text-gray-400 dark:border-gray-700';
}

export function HotspotsView() {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [battlegroundBooths, setBattlegroundBooths] = useState<BattlegroundBooth[]>([]);
  const [meta, setMeta] = useState<HotspotsMeta>({ totalOpen: 0, gpCount: 0 });
  const [loading, setLoading] = useState(true);

  const fetchHotspots = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hotspots', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setHotspots(json.hotspots || []);
        setBattlegroundBooths(json.battlegroundBooths || []);
        setMeta(json.meta || { totalOpen: 0, gpCount: 0 });
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Failed to load hotspots');
      }
    } catch {
      toast.error('Network error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchHotspots(); }, [fetchHotspots]);

  const visibleHotspots = hotspots.slice(0, SHOW_TOP_N);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
          <Flame className="h-5 w-5" style={{ color: NAVY }} />
          Hotspots
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Where to focus · {meta.totalOpen} open complaints across {meta.gpCount} GPs
        </p>
      </div>

      {/* Priority GPs */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-foreground">🔥 Priority GPs — send a worker here</h3>
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider">GP</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider">Block</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider">AC</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider">Open</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider">Breached</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider">Top Issue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : visibleHotspots.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EmptyState message="No open complaints in your area — all caught up! ✅" icon={MapPin} />
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleHotspots.map((h, i) => (
                    <TableRow
                      key={`${h.gp_code}-${i}`}
                      className={`hover:bg-muted/30 ${h.breached > 0 ? 'bg-red-50/60 dark:bg-red-950/20' : ''}`}
                    >
                      <TableCell className="text-sm font-semibold">{h.gp_name || '—'}</TableCell>
                      <TableCell className="text-xs">{h.block || '—'}</TableCell>
                      <TableCell className="text-xs">{h.assembly_constituency || '—'}</TableCell>
                      <TableCell className="text-sm font-black tabular-nums">{h.open}</TableCell>
                      <TableCell>
                        {h.breached > 0 ? (
                          <Badge variant="outline" className="text-[11px] font-semibold px-2 py-0.5 bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                            {h.breached}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{h.topCategory || '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
        {!loading && hotspots.length > SHOW_TOP_N && (
          <p className="text-[11px] text-muted-foreground">Showing top {SHOW_TOP_N} of {hotspots.length} GPs</p>
        )}
      </div>

      {/* Battleground Booths */}
      {!loading && battlegroundBooths.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
            <Vote className="h-4 w-4" style={{ color: NAVY }} />
            2021 Battleground Booths (Balarampur) — closest margins
          </h3>
          <Card className="border-0 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">Booth</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">Village</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">GP</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">2021 Winner</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {battlegroundBooths.map((b, i) => (
                    <TableRow key={`${b.ps}-${i}`} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-bold">{b.ps}</TableCell>
                      <TableCell className="text-xs">{b.village || '—'}</TableCell>
                      <TableCell className="text-xs">{b.gp_name || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[11px] font-semibold px-2 py-0.5 ${winnerBadgeClass(b.winner)}`}>
                          {b.winner}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-semibold tabular-nums">{b.margin}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
          <p className="text-[11px] text-muted-foreground">
            2021 result data — booth-level election data available for Balarampur only right now.
          </p>
        </div>
      )}
    </div>
  );
}
