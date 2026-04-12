'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Shield, LayoutDashboard, FileText, Users, Bell, Sun, Moon, Menu,
  Search, Filter, X, Eye, Download, Plus, ArrowUpDown, ChevronLeft,
  ChevronRight, Clock, AlertTriangle, CheckCircle2, Activity, MapPin,
  LogOut, RefreshCw, MoreHorizontal, Phone, CalendarDays, Hash,
  Building2, UserCog, TrendingUp, ArrowUpRight, ArrowDownRight,
  CircleDot, Send, Trash2, KeyRound,
  RotateCcw, Zap, Star, Clock3, CheckCircle, XCircle, ChevronDown,
  ArrowLeft, MessageSquare, ShieldCheck, Globe, BarChart2,
  Printer, UserCircle, Hand, Gauge, Timer, Award, BadgeCheck, PlayCircle, Ban, CircleCheckBig,
  Settings, CircleHelp, Monitor, Mail, Volume2, LayoutGrid, Keyboard,
  UserCheck, GitCompareArrows, CalendarClock, History, Tag, ClipboardList,
  AlertCircle, Info, CheckCircle2 as CheckCircleFill, Sparkles, Megaphone,
  ArrowUp, Flame, CalendarRange, TimerReset,
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

export function UserManagementView() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', password: '', role: 'BLOCK', name: '', location: '', district: '' });
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
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
      } else {
        toast.error('Failed to load users');
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
    if (!createForm.username.trim()) e.username = 'Required';
    if (!createForm.password.trim()) e.password = 'Required';
    if (!createForm.name.trim()) e.name = 'Required';
    if (!createForm.location.trim()) e.location = 'Required';
    setCreateErrors(e);
    if (Object.keys(e).length) return;

    setCreating(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(createForm),
      });
      if (res.ok) {
        toast.success('User created successfully');
        setCreateForm({ username: '', password: '', role: 'BLOCK', name: '', location: '', district: '' });
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
    const key = `${u.location}-${u.district || ''}`;
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
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Location</TableHead>
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
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow><TableCell colSpan={8}><EmptyState message="No users found" /></TableCell></TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs font-bold">{u.username}</TableCell>
                    <TableCell className="text-sm font-medium">{u.name}</TableCell>
                    <TableCell><RoleBadge role={u.role} /></TableCell>
                    <TableCell className="text-xs">{u.location}</TableCell>
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
                <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{u.location}</span>
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
                <Label className="text-[10px] font-bold uppercase tracking-widest">Role</Label>
                <Select value={createForm.role} onValueChange={(v) => setCreateForm((p) => ({ ...p, role: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BLOCK">Block Level</SelectItem>
                    <SelectItem value="DISTRICT">District Level</SelectItem>
                    <SelectItem value="STATE">State Level</SelectItem>
                    <SelectItem value="ADMIN">Administrator</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Location</Label>
                <Input value={createForm.location} onChange={(e) => setCreateForm((p) => ({ ...p, location: e.target.value }))} placeholder="Block/Mandal" className="h-9 text-sm" />
                {createErrors.location && <p className="text-red-500 text-[11px]">{createErrors.location}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">District</Label>
                <Input value={createForm.district} onChange={(e) => setCreateForm((p) => ({ ...p, district: e.target.value }))} placeholder="District name" className="h-9 text-sm" />
              </div>
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