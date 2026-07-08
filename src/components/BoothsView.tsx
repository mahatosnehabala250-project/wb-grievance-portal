'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, MapPin, Vote, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/auth-store';
import { NAVY } from '@/lib/constants';
import { authHeaders } from '@/lib/helpers';
import { EmptyState } from '@/components/common';

interface Booth {
  id: number;
  ac: string;
  ps_no: string;
  ps_name: string;
  village_raw: string | null;
  village_name: string | null;
  village_code: string | null;
  gp_code: string | null;
  gp_name: string | null;
  block_name: string | null;
  match_score: number | null;
  karyakarta_user_id: string | null;
  karyakarta_name: string | null;
}

interface KaryakartaOption {
  id: string;
  name: string;
  role_level: string;
}

const ALL_GPS = '__ALL_GPS__';
const UNASSIGN = '__UNASSIGN__';

function matchTier(score: number | null): { label: string; className: string } {
  const s = score ?? 0;
  if (s >= 0.6) return { label: 'OK', className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800' };
  if (s >= 0.4) return { label: 'Check', className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800' };
  return { label: 'Verify', className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800' };
}

export function BoothsView() {
  const user = useAuthStore((s) => s.user);
  const canAssign = user?.role_level !== 'KARYAKARTA' && user?.role_level !== 'OFFICER';

  const [booths, setBooths] = useState<Booth[]>([]);
  const [acs, setAcs] = useState<string[]>([]);
  const [selectedAc, setSelectedAc] = useState('');
  const [loading, setLoading] = useState(true);

  const [gpFilter, setGpFilter] = useState(ALL_GPS);
  const [search, setSearch] = useState('');
  const [weakOnly, setWeakOnly] = useState(false);

  const [karyakartas, setKaryakartas] = useState<KaryakartaOption[]>([]);
  const [karyakartasLoaded, setKaryakartasLoaded] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const fetchBooths = useCallback(async (ac: string) => {
    setLoading(true);
    try {
      const params = ac ? `?ac=${encodeURIComponent(ac)}` : '';
      const res = await fetch(`/api/booths${params}`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setBooths(json.booths || []);
        if (json.meta?.acs) {
          setAcs(json.meta.acs);
          if (!ac && json.meta.acs.length === 1) {
            setSelectedAc(json.meta.acs[0]);
          }
        }
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Failed to load booths');
      }
    } catch {
      toast.error('Network error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchBooths(selectedAc); }, [selectedAc, fetchBooths]);

  // Karyakarta options for assignment — only fetched once, only for actors who may assign.
  useEffect(() => {
    if (!canAssign) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/users?role=ALL', { headers: authHeaders() });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) {
            const list = (json.users || []).filter((u: Record<string, unknown>) => u.role_level === 'KARYAKARTA');
            setKaryakartas(list.map((u: Record<string, unknown>) => ({ id: u.id as string, name: u.name as string, role_level: u.role_level as string })));
          }
        }
        // 403 or any other non-ok: silently fall back to plain text display
      } catch {
        // silent — falls back to plain text
      }
      if (!cancelled) setKaryakartasLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [canAssign]);

  const showAssignSelect = canAssign && karyakartasLoaded && karyakartas.length >= 0;

  const gpOptions = useMemo(() => {
    const set = new Set<string>();
    booths.forEach((b) => { if (b.gp_name) set.add(b.gp_name); });
    return Array.from(set).sort();
  }, [booths]);

  const filteredBooths = useMemo(() => {
    const q = search.trim().toLowerCase();
    return booths.filter((b) => {
      if (gpFilter !== ALL_GPS && b.gp_name !== gpFilter) return false;
      if (weakOnly && (b.match_score ?? 0) >= 0.4) return false;
      if (q) {
        const hay = `${b.ps_no} ${b.ps_name} ${b.village_name || ''} ${b.village_raw || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [booths, gpFilter, search, weakOnly]);

  const stats = useMemo(() => {
    let strong = 0, medium = 0, weak = 0;
    booths.forEach((b) => {
      const s = b.match_score ?? 0;
      if (s >= 0.6) strong++;
      else if (s >= 0.4) medium++;
      else weak++;
    });
    return { total: booths.length, strong, medium, weak };
  }, [booths]);

  const handleAssign = useCallback(async (booth: Booth, karyakartaId: string) => {
    const newId = karyakartaId === UNASSIGN ? null : karyakartaId;
    const newName = newId ? (karyakartas.find((k) => k.id === newId)?.name || null) : null;
    const prev = booth;
    setUpdatingId(booth.id);
    // Optimistic update
    setBooths((prevBooths) => prevBooths.map((b) => (
      b.id === booth.id ? { ...b, karyakarta_user_id: newId, karyakarta_name: newName } : b
    )));
    try {
      const res = await fetch('/api/booths', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: booth.id, karyakarta_user_id: newId }),
      });
      if (res.ok) {
        toast.success(newId ? 'Karyakarta assigned' : 'Karyakarta unassigned');
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Failed to update assignment');
        // Revert
        setBooths((prevBooths) => prevBooths.map((b) => (b.id === prev.id ? prev : b)));
      }
    } catch {
      toast.error('Network error');
      setBooths((prevBooths) => prevBooths.map((b) => (b.id === prev.id ? prev : b)));
    }
    setUpdatingId(null);
  }, [karyakartas]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">Booth Directory</h2>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <Vote className="h-3.5 w-3.5" />
            {selectedAc || 'All Constituencies'} · {filteredBooths.length} of {booths.length} booths
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Select value={selectedAc || undefined} onValueChange={(v) => setSelectedAc(v)}>
          <SelectTrigger className="h-9 w-full sm:w-[180px] text-sm">
            <SelectValue placeholder="Select AC" />
          </SelectTrigger>
          <SelectContent>
            {acs.map((ac) => (
              <SelectItem key={ac} value={ac}>{ac}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={gpFilter} onValueChange={setGpFilter}>
          <SelectTrigger className="h-9 w-full sm:w-[180px] text-sm">
            <SelectValue placeholder="All GPs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_GPS}>All GPs</SelectItem>
            {gpOptions.map((gp) => (
              <SelectItem key={gp} value={gp}>{gp}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by PS no, booth name, village..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        <Button
          variant={weakOnly ? 'default' : 'outline'}
          size="sm"
          className={`h-9 text-xs gap-1.5 ${weakOnly ? 'text-white' : ''}`}
          style={weakOnly ? { backgroundColor: NAVY } : undefined}
          onClick={() => setWeakOnly((v) => !v)}
        >
          <ShieldAlert className="h-3.5 w-3.5" />Weak only
        </Button>
      </div>

      {/* Stats chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total</p>
            <p className="text-lg font-black tabular-nums text-foreground">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Strong</p>
            <p className="text-lg font-black tabular-nums text-emerald-600 dark:text-emerald-400">{stats.strong}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Medium</p>
            <p className="text-lg font-black tabular-nums text-amber-600 dark:text-amber-400">{stats.medium}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Weak</p>
            <p className="text-lg font-black tabular-nums text-red-600 dark:text-red-400">{stats.weak}</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">PS No</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Booth</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Village</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">GP</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Block</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Match</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Karyakarta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredBooths.length === 0 ? (
                <TableRow><TableCell colSpan={7}><EmptyState message="No booths match the current filters" icon={MapPin} /></TableCell></TableRow>
              ) : (
                filteredBooths.map((b) => {
                  const tier = matchTier(b.match_score);
                  return (
                    <TableRow key={b.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-bold">{b.ps_no}</TableCell>
                      <TableCell className="text-sm max-w-[220px] truncate" title={b.ps_name}>{b.ps_name}</TableCell>
                      <TableCell className="text-xs">
                        {b.village_name || '—'}
                        {b.village_raw && b.village_raw !== b.village_name && (
                          <span className="block text-[10px] text-muted-foreground">{b.village_raw}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{b.gp_name || '—'}</TableCell>
                      <TableCell className="text-xs">{b.block_name || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[11px] font-semibold px-2 py-0.5 ${tier.className}`}>
                          {tier.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs min-w-[160px]">
                        {!showAssignSelect ? (
                          <span>{b.karyakarta_name || '—'}</span>
                        ) : (
                          <Select
                            value={b.karyakarta_user_id || UNASSIGN}
                            onValueChange={(v) => handleAssign(b, v)}
                            disabled={updatingId === b.id}
                          >
                            <SelectTrigger className="h-8 w-full text-xs">
                              <SelectValue placeholder="Unassigned" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNASSIGN}>Unassign</SelectItem>
                              {karyakartas.map((k) => (
                                <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
