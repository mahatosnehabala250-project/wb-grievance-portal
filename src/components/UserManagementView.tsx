'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FileText, Users, Filter, X, Plus, AlertTriangle, CheckCircle2, MapPin, RefreshCw, MoreHorizontal, Building2, UserCog, KeyRound,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent,
} from '@/components/ui/chart';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell,
  AreaChart, Area, ResponsiveContainer, Legend,
} from 'recharts';
import { toast } from 'sonner';
import { useTheme } from 'next-themes';
import { useAuthStore } from '@/lib/auth-store';
import { motion, AnimatePresence } from 'framer-motion';
import type { Complaint, ActivityLogEntry, AssignableUser, AppUser, DashboardData, ViewType, AuditEntry } from '@/lib/types';
import { NAVY, NAVY_DARK, STATUS_MAP, URGENCY_MAP, URGENCY_BORDER_MAP, ROLE_MAP, ROLE_COLORS, CATEGORIES, CATEGORY_COLORS } from '@/lib/constants';
import { fmtDate, fmtDateTime, fmtStatus, fmtUrgency, fmtRole, safeGetLocalStorage, safeSetLocalStorage, authHeaders, getDaysOld, getSLAInfo, playNotificationSound } from '@/lib/helpers';
import { StatusBadge, UrgencyBadge, RoleBadge, StatCard, MiniStat, PieLabel, LoadingSkeleton, EmptyState } from '@/components/common';

const ROLE_LEVEL_LABELS: Record<string, string> = {
  MP: 'MP (Lok Sabha)',
  MLA: 'MLA (Assembly)',
  DISTRICT_ADMIN: 'District Officer',
  BLOCK_COORD: 'Block Officer',
  GP_COORD: 'GP Coordinator',
  KARYAKARTA: 'Karyakarta',
  OFFICER: 'Officer',
};

const EMPTY_CREATE_FORM = {
  username: '', password: '', role: 'BLOCK', name: '', block: '', district: '',
  whatsappPhone: '', telegramChatId: '', email: '',
  role_level: 'OFFICER', constituency: '', lok_sabha_constituency: '',
  gp_code: '', gp_name: '', assigned_villages: '',
};

/**
 * Geography options, served from the mapping tables by /api/geo/tree.
 *
 * These fields used to be free text checked only for non-emptiness. A typo
 * ("Bandwaan", or a stray space) creates an account whose scope filter matches
 * nothing, so that MLA opens a permanently empty dashboard and nobody is told.
 * Picking from the real tables makes that error unrepresentable, and the cascade
 * below fills the parent levels so AC, block and GP can never disagree.
 */
interface GeoAc { constituency: string; district: string; lok_sabha: string }
// block_norm, not block_name, is the join key: blocks come from
// constituency_block_mapping and GPs from polling_stations, and the two spell
// several blocks differently (Bandwan/Bundwan, Purulia I/Purulia-I).
interface GeoBlock { block_name: string; block_norm: string; constituency: string; district: string }
interface GeoGp { gp_code: string; gp_name: string; block_name: string; block_norm: string; constituency: string }
interface GeoTree {
  districts: string[];
  lokSabhas: string[];
  acs: GeoAc[];
  blocks: GeoBlock[];
  gps: GeoGp[];
}
const EMPTY_GEO: GeoTree = { districts: [], lokSabhas: [], acs: [], blocks: [], gps: [] };

export function UserManagementView() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState('');
  // Roles this actor may create — comes from the server (rbac.ts), so the UI
  // automatically adapts: MP sees MLA & below, MLA sees coords & below, etc.
  const [creatableRoles, setCreatableRoles] = useState<string[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE_FORM });
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [geo, setGeo] = useState<GeoTree>(EMPTY_GEO);
  const [villages, setVillages] = useState<Array<{ code: string; name: string }>>([]);

  // Geography options are already scoped server-side to the caller's jurisdiction.
  useEffect(() => {
    fetch('/api/geo/tree', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setGeo({ ...EMPTY_GEO, ...j }); })
      .catch(() => {});
  }, []);

  // Villages belong to a GP, so they load only once one is chosen.
  useEffect(() => {
    if (!createForm.gp_code) { setVillages([]); return; }
    fetch(`/api/geo/tree?gp_code=${encodeURIComponent(createForm.gp_code)}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setVillages(j?.villages || []))
      .catch(() => setVillages([]));
  }, [createForm.gp_code]);

  // ── Cascade setters: choosing a child fills every parent level, so the saved
  // record can never describe a place that does not exist in the mapping.
  const pickAc = useCallback((constituency: string) => {
    const ac = geo.acs.find((a) => a.constituency === constituency);
    setCreateForm((p) => ({
      ...p,
      constituency,
      district: ac?.district || p.district,
      lok_sabha_constituency: ac?.lok_sabha || p.lok_sabha_constituency,
      block: '', gp_code: '', gp_name: '', assigned_villages: '',
    }));
  }, [geo.acs]);

  const pickBlock = useCallback((blockName: string) => {
    const b = geo.blocks.find((x) => x.block_name === blockName);
    setCreateForm((p) => ({
      ...p,
      block: blockName,
      constituency: p.constituency || b?.constituency || '',
      district: p.district || b?.district || '',
      gp_code: '', gp_name: '', assigned_villages: '',
    }));
  }, [geo.blocks]);

  const pickGp = useCallback((gpCode: string) => {
    const g = geo.gps.find((x) => x.gp_code === gpCode);
    // The GP list carries polling_stations spellings ("Bundwan"); store the
    // constituency_block_mapping spelling ("Bandwan") instead, since that is
    // what the block dropdown offers and what validateNewUserScope checks.
    const mapped = g ? geo.blocks.find((b) => b.block_norm === g.block_norm) : undefined;
    setCreateForm((p) => ({
      ...p,
      gp_code: gpCode,
      gp_name: g?.gp_name || '',
      block: mapped?.block_name || g?.block_name || p.block,
      constituency: p.constituency || mapped?.constituency || g?.constituency || '',
      assigned_villages: '',
    }));
  }, [geo.gps, geo.blocks]);

  // Options narrow to the parent already chosen; with none chosen, everything in
  // the caller's own jurisdiction is offered.
  const acOptions = useMemo(
    () => (createForm.district ? geo.acs.filter((a) => a.district === createForm.district) : geo.acs),
    [geo.acs, createForm.district]
  );
  const blockOptions = useMemo(
    () => (createForm.constituency ? geo.blocks.filter((b) => b.constituency === createForm.constituency) : geo.blocks),
    [geo.blocks, createForm.constituency]
  );
  const gpOptions = useMemo(() => {
    if (createForm.block) {
      const bn = geo.blocks.find((b) => b.block_name === createForm.block)?.block_norm;
      return bn ? geo.gps.filter((g) => g.block_norm === bn) : geo.gps;
    }
    if (createForm.constituency) return geo.gps.filter((g) => g.constituency === createForm.constituency);
    return geo.gps;
  }, [geo.gps, geo.blocks, createForm.block, createForm.constituency]);
  const [creating, setCreating] = useState(false);

  const [resetPwdUser, setResetPwdUser] = useState<AppUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  // Confirmation dialog for deactivate
  const [confirmUser, setConfirmUser] = useState<AppUser | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterRole && filterRole !== 'ALL' ? `?role=${filterRole}` : '?role=ALL';
      const res = await fetch(`/api/users${params}`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setUsers(json.users);
        if (json.meta?.creatableRoles) setCreatableRoles(json.meta.creatableRoles);
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Failed to load users');
      }
    } catch {
      toast.error('Network error');
    }
    setLoading(false);
  }, [filterRole]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleToggleActive = useCallback(async (u: AppUser) => {
    setConfirmUser(null);
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: u.id, isActive: !u.isActive }),
      });
      if (res.ok) {
        toast.success(u.isActive ? 'User deactivated' : 'User activated');
        fetchUsers();
      } else {
        toast.error('Failed to update user');
      }
    } catch {
      toast.error('Network error');
    }
  }, [fetchUsers]);

  const handleCreate = useCallback(async () => {
    const e: Record<string, string> = {};
    const lvl = createForm.role_level;
    if (!createForm.username.trim()) e.username = 'Required';
    if (!createForm.password.trim()) e.password = 'Required';
    else if (createForm.password.length < 8) e.password = 'Min 8 characters';
    if (!createForm.name.trim()) e.name = 'Required';
    // Geography requirements depend on designation (server re-validates)
    if (['OFFICER', 'BLOCK_COORD'].includes(lvl) && !createForm.block.trim()) e.block = 'Required';
    if (lvl === 'MP' && !createForm.lok_sabha_constituency.trim()) e.lok_sabha_constituency = 'Required';
    if (lvl === 'MLA' && !createForm.constituency.trim()) e.constituency = 'Required';
    if (lvl === 'DISTRICT_ADMIN' && !createForm.district.trim()) e.district = 'Required';
    if (lvl === 'GP_COORD' && !createForm.gp_code.trim()) e.gp_code = 'Required';
    if (lvl === 'KARYAKARTA' && !createForm.gp_code.trim() && !createForm.assigned_villages.trim()) e.gp_code = 'GP code or villages required';
    setCreateErrors(e);
    if (Object.keys(e).length) return;

    setCreating(true);
    try {
      const payload = {
        ...createForm,
        assigned_villages: createForm.assigned_villages
          ? createForm.assigned_villages.split(',').map(v => v.trim()).filter(Boolean)
          : [],
      };
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success('User created successfully');
        setCreateForm({ ...EMPTY_CREATE_FORM });
        setCreateErrors({});
        setCreateOpen(false);
        fetchUsers();
      } else {
        const json = await res.json();
        toast.error(json.error || 'Failed to create user');
      }
    } catch {
      toast.error('Network error');
    }
    setCreating(false);
  }, [createForm, fetchUsers]);

  const handleResetPassword = useCallback(async () => {
    if (!resetPwdUser || !newPassword.trim()) return;
    setResetting(true);
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: resetPwdUser.id, password: newPassword }),
      });
      if (res.ok) {
        toast.success('Password reset successfully');
        setResetPwdUser(null);
        setNewPassword('');
      } else {
        toast.error('Failed to reset password');
      }
    } catch {
      toast.error('Network error');
    }
    setResetting(false);
  }, [resetPwdUser, newPassword]);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = { ADMIN: 0, STATE: 0, DISTRICT: 0, BLOCK: 0 };
    users.forEach((u) => { if (counts[u.role] !== undefined) counts[u.role]++; });
    return counts;
  }, [users]);

  // User complaint counts
  const [userComplaintCounts, setUserComplaintCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    async function fetchCounts() {
      try {
        const res = await fetch('/api/complaints?limit=9999', { headers: authHeaders() });
        if (res.ok) {
          const json = await res.json();
          const counts: Record<string, number> = {};
          for (const c of json.complaints as Complaint[]) {
            const key = `${c.block}-${c.district}`;
            counts[key] = (counts[key] || 0) + 1;
          }
          setUserComplaintCounts(counts);
        }
      } catch {
        // silent
      }
    }
    fetchCounts();
  }, []);

  const getUserComplaintCount = useCallback((u: AppUser) => {
    const key = `${u.block}-${u.district || ''}`;
    return userComplaintCounts[key] || 0;
  }, [userComplaintCounts]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">User Management</h2>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <Users className="h-3.5 w-3.5" />{users.length} users registered
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="text-xs gap-1 text-white" style={{ backgroundColor: NAVY }}>
          <Plus className="h-3.5 w-3.5" /> Add User
        </Button>
      </div>

      {/* Role Counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(roleCounts).map(([role, count]) => (
          <Card key={role} className="border-0 shadow-sm">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: NAVY }}>
                <UserCog className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{fmtRole(role)}</p>
                <p className="text-lg font-black tabular-nums text-foreground">{count}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <Select value={filterRole || 'ALL'} onValueChange={(v) => setFilterRole(v === 'ALL' ? '' : v)}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Roles</SelectItem>
            <SelectItem value="ADMIN">Administrator</SelectItem>
            <SelectItem value="STATE">State Level</SelectItem>
            <SelectItem value="DISTRICT">District Level</SelectItem>
            <SelectItem value="BLOCK">Block Level</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Users Table */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Username</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Name</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Role</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Designation</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Block</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">District</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Complaints</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow><TableCell colSpan={9}><EmptyState message="No users found" /></TableCell></TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs font-bold">{u.username}</TableCell>
                    <TableCell className="text-sm font-medium">{u.name}</TableCell>
                    <TableCell><RoleBadge role={u.role} /></TableCell>
                    <TableCell className="text-xs">
                      {ROLE_LEVEL_LABELS[(u as unknown as Record<string, string>).role_level] || (u as unknown as Record<string, string>).role_level || '—'}
                      {(u as unknown as Record<string, string>).constituency && (
                        <span className="block text-[10px] text-muted-foreground">{(u as unknown as Record<string, string>).constituency}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{u.block}</TableCell>
                    <TableCell className="text-xs">{u.district || '—'}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="secondary" className="text-[10px] font-mono">{getUserComplaintCount(u)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${u.isActive ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                        <span className="text-xs font-medium">{u.isActive ? 'Active' : 'Inactive'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setResetPwdUser(u); setNewPassword(''); }}>
                            <KeyRound className="h-3.5 w-3.5 mr-2" />Reset Password
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setConfirmUser(u)}>
                            {u.isActive ? (
                              <><X className="h-3.5 w-3.5 mr-2 text-red-500" />Deactivate</>
                            ) : (
                              <><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-500" />Activate</>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)
          ) : users.map((u) => (
            <div key={u.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{u.name}</p>
                  <p className="text-[11px] font-mono text-muted-foreground">{u.username}</p>
                </div>
                <RoleBadge role={u.role} />
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{u.block}</span>
                {u.district && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{u.district}</span>}
                <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{getUserComplaintCount(u)}</span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1.5">
                  <div className={`h-2 w-2 rounded-full ${u.isActive ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                  <span className="text-[11px] font-medium">{u.isActive ? 'Active' : 'Inactive'}</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => { setResetPwdUser(u); setNewPassword(''); }}>
                    <KeyRound className="h-3 w-3 mr-1" />Reset Pwd
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setConfirmUser(u)}>
                    {u.isActive ? (
                      <><X className="h-3 w-3 mr-1 text-red-500" />Deactivate</>
                    ) : (
                      <><CheckCircle2 className="h-3 w-3 mr-1 text-emerald-500" />Activate</>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md border-0 shadow-2xl">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.15 }}>
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Create New User</DialogTitle>
            <DialogDescription>Add a new user to the system</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Username</Label>
                <Input value={createForm.username} onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value }))} placeholder="username" className="h-9 text-sm" />
                {createErrors.username && <p className="text-red-500 text-[11px]">{createErrors.username}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Password</Label>
                <Input value={createForm.password} onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))} placeholder="password" className="h-9 text-sm" type="password" />
                {createErrors.password && <p className="text-red-500 text-[11px]">{createErrors.password}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Full Name</Label>
                <Input value={createForm.name} onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))} placeholder="Full name" className="h-9 text-sm" />
                {createErrors.name && <p className="text-red-500 text-[11px]">{createErrors.name}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Designation</Label>
                <Select value={createForm.role_level} onValueChange={(v) => setCreateForm((p) => ({ ...p, role_level: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {creatableRoles.map(r => (
                      <SelectItem key={r} value={r}>{ROLE_LEVEL_LABELS[r] || r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Geography — fields appear based on designation; server enforces
                that everything stays inside the creator's own jurisdiction */}
            {createForm.role_level === 'MP' && (
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Lok Sabha Constituency</Label>
                <Select value={createForm.lok_sabha_constituency} onValueChange={(v) => setCreateForm((p) => ({ ...p, lok_sabha_constituency: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select parliamentary seat" /></SelectTrigger>
                  <SelectContent>
                    {geo.lokSabhas.map((ls) => <SelectItem key={ls} value={ls}>{ls}</SelectItem>)}
                  </SelectContent>
                </Select>
                {createErrors.lok_sabha_constituency && <p className="text-red-500 text-[11px]">{createErrors.lok_sabha_constituency}</p>}
              </div>
            )}
            {createForm.role_level === 'MLA' && (
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Assembly Constituency</Label>
                <Select value={createForm.constituency} onValueChange={pickAc}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select assembly constituency" /></SelectTrigger>
                  <SelectContent>
                    {acOptions.map((a) => (
                      <SelectItem key={a.constituency} value={a.constituency}>
                        {a.constituency}<span className="text-muted-foreground"> · {a.district}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {createErrors.constituency && <p className="text-red-500 text-[11px]">{createErrors.constituency}</p>}
              </div>
            )}
            {(createForm.role_level === 'GP_COORD' || createForm.role_level === 'KARYAKARTA') && (
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Gram Panchayat</Label>
                <Select value={createForm.gp_code} onValueChange={pickGp}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select gram panchayat" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {gpOptions.map((g) => (
                      <SelectItem key={g.gp_code} value={g.gp_code}>
                        {g.gp_name}<span className="text-muted-foreground"> · {g.block_name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {createForm.gp_code && (
                  <p className="text-[11px] text-muted-foreground">LGD code {createForm.gp_code}</p>
                )}
                {createErrors.gp_code && <p className="text-red-500 text-[11px]">{createErrors.gp_code}</p>}
              </div>
            )}
            {createForm.role_level === 'KARYAKARTA' && (
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">
                  Assigned Villages {createForm.gp_code ? `(${villages.length} in this gram panchayat)` : ''}
                </Label>
                {!createForm.gp_code ? (
                  <p className="text-[11px] text-muted-foreground">Select a gram panchayat first.</p>
                ) : (
                  <div className="max-h-32 overflow-y-auto rounded-md border p-2 space-y-1">
                    {villages.map((v) => {
                      const picked = createForm.assigned_villages
                        .split(',').map((s) => s.trim()).filter(Boolean);
                      const on = picked.includes(v.name);
                      return (
                        <label key={v.code} className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => {
                              const next = on ? picked.filter((n) => n !== v.name) : [...picked, v.name];
                              setCreateForm((p) => ({ ...p, assigned_villages: next.join(', ') }));
                            }}
                          />
                          {v.name}
                        </label>
                      );
                    })}
                    {villages.length === 0 && <p className="text-[11px] text-muted-foreground">No villages found in this gram panchayat.</p>}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Block</Label>
                <Select value={createForm.block} onValueChange={pickBlock}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select block" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {blockOptions.map((b) => (
                      <SelectItem key={`${b.block_name}|${b.constituency}`} value={b.block_name}>
                        {b.block_name}<span className="text-muted-foreground"> · {b.constituency}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {createErrors.block && <p className="text-red-500 text-[11px]">{createErrors.block}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">District</Label>
                <Select
                  value={createForm.district}
                  onValueChange={(v) => setCreateForm((p) => ({
                    ...p, district: v, constituency: '', block: '', gp_code: '', gp_name: '', assigned_villages: '',
                  }))}
                >
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select district" /></SelectTrigger>
                  <SelectContent>
                    {geo.districts.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
                {createErrors.district && <p className="text-red-500 text-[11px]">{createErrors.district}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">WhatsApp Number</Label>
                <Input value={createForm.whatsappPhone} onChange={(e) => setCreateForm((p) => ({ ...p, whatsappPhone: e.target.value }))} placeholder="919876543210" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Email (Optional)</Label>
                <Input value={createForm.email} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} placeholder="officer@gov.in" className="h-9 text-sm" type="email" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest">Telegram Chat ID (Optional)</Label>
              <Input value={createForm.telegramChatId} onChange={(e) => setCreateForm((p) => ({ ...p, telegramChatId: e.target.value }))} placeholder="Get from @get_id_bot on Telegram" className="h-9 text-sm" />
            </div>
          </div>
          <DialogFooter className="gap-2 mt-3">
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="text-sm">Cancel</Button>
            <Button onClick={handleCreate} disabled={creating} className="text-sm text-white" style={{ backgroundColor: NAVY }}>
              {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Create User'}
            </Button>
          </DialogFooter>
          </motion.div>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetPwdUser} onOpenChange={(v) => { if (!v) setResetPwdUser(null); }}>
        <DialogContent className="sm:max-w-sm border-0 shadow-2xl">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.15 }}>
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Reset Password</DialogTitle>
            <DialogDescription>Set new password for {resetPwdUser?.username}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest">New Password</Label>
              <Input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter new password" className="h-9 text-sm" />
            </div>
          </div>
          <DialogFooter className="gap-2 mt-3">
            <Button variant="outline" onClick={() => setResetPwdUser(null)} className="text-sm">Cancel</Button>
            <Button onClick={handleResetPassword} disabled={resetting || !newPassword.trim()} className="text-sm text-white" style={{ backgroundColor: NAVY }}>
              {resetting ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Reset'}
            </Button>
          </DialogFooter>
          </motion.div>
        </DialogContent>
      </Dialog>

      {/* Confirm Deactivate Dialog */}
      <Dialog open={!!confirmUser} onOpenChange={(v) => { if (!v) setConfirmUser(null); }}>
        <DialogContent className="sm:max-w-sm border-0 shadow-2xl">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.15 }}>
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {confirmUser?.isActive ? 'Deactivate' : 'Activate'} User
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to {confirmUser?.isActive ? 'deactivate' : 'activate'} <strong>{confirmUser?.name}</strong>?
              {confirmUser?.isActive && ' They will no longer be able to access the system.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 mt-3">
            <Button variant="outline" onClick={() => setConfirmUser(null)} className="text-sm">Cancel</Button>
            <Button
              onClick={() => confirmUser && handleToggleActive(confirmUser)}
              className="text-sm text-white"
              style={{ backgroundColor: confirmUser?.isActive ? '#DC2626' : '#16A34A' }}
            >
              {confirmUser?.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          </DialogFooter>
          </motion.div>
        </DialogContent>
      </Dialog>
    </div>
  );
}