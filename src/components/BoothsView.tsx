'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, MapPin, Vote, ShieldAlert, UserPlus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
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

interface NewKaryakartaForm {
  name: string;
  username: string;
  password: string;
  whatsappPhone: string;
  telegramChatId: string;
  gp_code: string;
  gp_name: string;
  block: string;
}

const EMPTY_NEW_KARYAKARTA: NewKaryakartaForm = {
  name: '', username: '', password: '', whatsappPhone: '', telegramChatId: '', gp_code: '', gp_name: '', block: '',
};

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
  // ADMIN/STATE/DISTRICT/BLOCK base roles carry role_level 'OFFICER' but must still
  // be able to assign — gate on base role, not role_level alone (mirror the API).
  const privilegedBase = ['ADMIN', 'STATE', 'DISTRICT', 'BLOCK'].includes(user?.role || '');
  const canAssign = user?.role_level !== 'KARYAKARTA' && (privilegedBase || user?.role_level !== 'OFFICER');

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

  const [addKaryakartaOpen, setAddKaryakartaOpen] = useState(false);
  const [newKaryakarta, setNewKaryakarta] = useState<NewKaryakartaForm>({ ...EMPTY_NEW_KARYAKARTA });
  const [creatingKaryakarta, setCreatingKaryakarta] = useState(false);
  const [bulkAssigning, setBulkAssigning] = useState(false);

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

  // Karyakarta options for assignment — includes both KARYAKARTA and GP_COORD
  // users, since booths can be assigned to either. Exposed as a reusable
  // loader so it can be re-run after creating a new karyakarta inline.
  const loadKaryakartas = useCallback(async () => {
    try {
      const res = await fetch('/api/users?role=ALL', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        const list = (json.users || []).filter((u: Record<string, unknown>) => u.role_level === 'KARYAKARTA' || u.role_level === 'GP_COORD');
        setKaryakartas(list.map((u: Record<string, unknown>) => ({ id: u.id as string, name: u.name as string, role_level: u.role_level as string })));
      }
      // 403 or any other non-ok: silently fall back to plain text display
    } catch {
      // silent — falls back to plain text
    }
    setKaryakartasLoaded(true);
  }, []);

  // Only fetched for actors who may assign.
  useEffect(() => {
    if (!canAssign) return;
    loadKaryakartas();
  }, [canAssign, loadKaryakartas]);

  // `length >= 0` was always true, so this read as a guard while gating nothing.
  const showAssignSelect = canAssign && karyakartasLoaded;

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

  /**
   * Assign every booth in the selected gram panchayat at once.
   *
   * An AC carries roughly 300 booths across ~19 GPs, so booth-by-booth
   * assignment is why sangathan coverage has stayed at zero. The GP is the unit
   * karyakartas are actually organised by — about 15 booths each — so one action
   * per GP is what makes full coverage reachable at all.
   *
   * The server re-checks scope for every booth and skips ones already assigned
   * to someone else, so this cannot quietly displace deliberate assignments.
   */
  const handleBulkAssignGp = useCallback(async (karyakartaId: string) => {
    const gpBooth = booths.find((b) => b.gp_name === gpFilter && b.gp_code);
    if (!gpBooth?.gp_code) {
      toast.error('No code found for this gram panchayat');
      return;
    }
    setBulkAssigning(true);
    try {
      const res = await fetch('/api/booths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          gp_code: gpBooth.gp_code,
          karyakarta_user_id: karyakartaId === UNASSIGN ? null : karyakartaId,
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        const skipped = json?.skipped ? ` · ${json.skipped} already held by someone else` : '';
        toast.success(`${json?.assigned ?? 0} booths assigned${skipped}`);
        await fetchBooths(selectedAc);
      } else {
        toast.error(json?.error || 'Bulk assign failed');
      }
    } catch {
      toast.error('Network error');
    }
    setBulkAssigning(false);
  }, [booths, gpFilter, fetchBooths, selectedAc]);

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

  const openAddKaryakarta = useCallback(() => {
    // Prefill GP/block from the currently filtered GP if one is selected,
    // otherwise fall back to the first booth of the loaded list.
    const source = gpFilter !== ALL_GPS ? booths.find((b) => b.gp_name === gpFilter) : booths[0];
    setNewKaryakarta({
      ...EMPTY_NEW_KARYAKARTA,
      gp_code: source?.gp_code || '',
      gp_name: source?.gp_name || '',
      block: source?.block_name || '',
    });
    setAddKaryakartaOpen(true);
  }, [booths, gpFilter]);

  const handleAddKaryakarta = useCallback(async () => {
    if (!newKaryakarta.name.trim() || !newKaryakarta.username.trim() || !newKaryakarta.gp_code.trim()) {
      toast.error('Name, username and GP code are required');
      return;
    }
    if (newKaryakarta.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setCreatingKaryakarta(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          username: newKaryakarta.username,
          password: newKaryakarta.password,
          name: newKaryakarta.name,
          role: 'BLOCK',
          role_level: 'KARYAKARTA',
          gp_code: newKaryakarta.gp_code,
          gp_name: newKaryakarta.gp_name,
          block: newKaryakarta.block,
          district: 'Purulia',
          whatsappPhone: newKaryakarta.whatsappPhone,
          telegramChatId: newKaryakarta.telegramChatId,
        }),
      });
      if (res.status === 201) {
        toast.success('Karyakarta added');
        setAddKaryakartaOpen(false);
        setNewKaryakarta({ ...EMPTY_NEW_KARYAKARTA });
        loadKaryakartas();
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Failed to create worker');
      }
    } catch {
      toast.error('Network error');
    }
    setCreatingKaryakarta(false);
  }, [newKaryakarta, loadKaryakartas]);

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

        {canAssign && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs gap-1.5"
            onClick={openAddKaryakarta}
          >
            <UserPlus className="h-3.5 w-3.5" />Add Karyakarta
          </Button>
        )}
      </div>

      {/* Whole-GP assignment. Only offered once a GP is selected, because the GP
          is the unit this is meant to operate on — covering an AC one booth at a
          time is what has kept coverage at zero. */}
      {showAssignSelect && gpFilter !== ALL_GPS && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <div className="text-xs flex-1 min-w-0">
            <span className="font-semibold">{gpFilter}</span>
            <span className="text-muted-foreground">
              {' '}— {filteredBooths.length} booth
              {filteredBooths.filter((b) => !b.karyakarta_user_id).length > 0
                ? `, ${filteredBooths.filter((b) => !b.karyakarta_user_id).length} still unassigned`
                : ', all assigned'}
            </span>
          </div>
          <Select disabled={bulkAssigning} onValueChange={handleBulkAssignGp}>
            <SelectTrigger className="h-8 w-full sm:w-[240px] text-xs">
              <SelectValue placeholder={bulkAssigning ? 'Assigning…' : 'Assign the whole GP'} />
            </SelectTrigger>
            <SelectContent>
              {karyakartas.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.name}<span className="text-muted-foreground"> · {k.role_level === 'GP_COORD' ? 'GP Coordinator' : 'Worker'}</span>
                </SelectItem>
              ))}
              <SelectItem value={UNASSIGN}>Clear all</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

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
                                <SelectItem key={k.id} value={k.id}>
                                  {k.role_level === 'GP_COORD' ? `${k.name} (GP Coord)` : k.name}
                                </SelectItem>
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

      {/* Add Karyakarta Dialog */}
      <Dialog open={addKaryakartaOpen} onOpenChange={setAddKaryakartaOpen}>
        <DialogContent className="sm:max-w-md border-0 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Add Karyakarta</DialogTitle>
            <DialogDescription>Register a new worker without leaving the Booths screen.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Full Name</Label>
                <Input value={newKaryakarta.name} onChange={(e) => setNewKaryakarta((p) => ({ ...p, name: e.target.value }))} placeholder="Full name" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Username</Label>
                <Input value={newKaryakarta.username} onChange={(e) => setNewKaryakarta((p) => ({ ...p, username: e.target.value }))} placeholder="username" className="h-9 text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest">Password</Label>
              <Input value={newKaryakarta.password} onChange={(e) => setNewKaryakarta((p) => ({ ...p, password: e.target.value }))} placeholder="Min 8 characters" className="h-9 text-sm" type="password" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">WhatsApp Number</Label>
                <Input value={newKaryakarta.whatsappPhone} onChange={(e) => setNewKaryakarta((p) => ({ ...p, whatsappPhone: e.target.value }))} placeholder="919876543210" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Telegram Chat ID</Label>
                <Input value={newKaryakarta.telegramChatId} onChange={(e) => setNewKaryakarta((p) => ({ ...p, telegramChatId: e.target.value }))} placeholder="Get from @get_id_bot on Telegram" className="h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">GP Code (LGD)</Label>
                <Input value={newKaryakarta.gp_code} onChange={(e) => setNewKaryakarta((p) => ({ ...p, gp_code: e.target.value }))} placeholder="e.g. 111050" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">GP Name</Label>
                <Input value={newKaryakarta.gp_name} onChange={(e) => setNewKaryakarta((p) => ({ ...p, gp_name: e.target.value }))} placeholder="Gram Panchayat name" className="h-9 text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest">Block</Label>
              <Input value={newKaryakarta.block} onChange={(e) => setNewKaryakarta((p) => ({ ...p, block: e.target.value }))} placeholder="Block name" className="h-9 text-sm" />
            </div>
          </div>
          <DialogFooter className="gap-2 mt-3">
            <Button variant="outline" onClick={() => setAddKaryakartaOpen(false)} className="text-sm">Cancel</Button>
            <Button onClick={handleAddKaryakarta} disabled={creatingKaryakarta} className="text-sm text-white" style={{ backgroundColor: NAVY }}>
              {creatingKaryakarta ? 'Adding…' : 'Add Karyakarta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
