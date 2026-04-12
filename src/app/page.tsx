'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Shield, LayoutDashboard, FileText, Users, Bell, Sun, Moon, Menu,
  Search, Filter, X, Eye, Download, Plus, ArrowUpDown, ChevronLeft,
  ChevronRight, Clock, AlertTriangle, CheckCircle2, Activity, MapPin,
  LogOut, RefreshCw, MoreHorizontal, Phone, CalendarDays, Hash,
  Building2, UserCog, TrendingUp, ArrowUpRight, ArrowDownRight,
  CircleDot, Send, Trash2, KeyRound,
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

/* ═══════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════ */

interface Complaint {
  id: string;
  ticketNo: string;
  citizenName: string | null;
  phone: string | null;
  issue: string;
  category: string;
  block: string;
  district: string;
  urgency: string;
  status: string;
  description: string | null;
  resolution: string | null;
  assignedToId: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface AppUser {
  id: string;
  username: string;
  name: string;
  role: string;
  location: string;
  district: string | null;
  isActive: boolean;
  createdAt: string;
}

interface DashboardData {
  stats: {
    total: number; open: number; inProgress: number; resolved: number;
    rejected: number; critical: number; todayComplaints: number;
    todayResolved: number; resolutionRate: number;
  };
  byCategory: { category: string; count: number }[];
  byGroup: { name: string; count: number; open: number; inProgress: number; resolved: number; rejected: number }[];
  groupByField: string;
  monthlyTrend: { month: string; label: string; open: number; inProgress: number; resolved: number; total: number }[];
  byUrgency: { urgency: string; count: number }[];
  recent: Complaint[];
  criticalComplaints: Complaint[];
  userRole: string;
  userLocation: string;
}

type ViewType = 'dashboard' | 'complaints' | 'users';

/* ═══════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════ */

const NAVY = '#0A2463';
const NAVY_DARK = '#061539';

const STATUS_MAP: Record<string, { label: string; dotColor: string; bg: string; text: string; border: string }> = {
  OPEN: { label: 'Open', dotColor: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800' },
  IN_PROGRESS: { label: 'In Progress', dotColor: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800' },
  RESOLVED: { label: 'Resolved', dotColor: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800' },
  REJECTED: { label: 'Rejected', dotColor: 'bg-gray-400', bg: 'bg-gray-50 dark:bg-gray-900/40', text: 'text-gray-600 dark:text-gray-400', border: 'border-gray-200 dark:border-gray-700' },
};

const URGENCY_MAP: Record<string, { label: string; bg: string; text: string; border: string; icon: boolean }> = {
  CRITICAL: { label: 'Critical', bg: 'bg-red-600 dark:bg-red-700', text: 'text-white', border: 'border-red-700', icon: true },
  HIGH: { label: 'High', bg: 'bg-orange-50 dark:bg-orange-950/40', text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800', icon: true },
  MEDIUM: { label: 'Medium', bg: 'bg-yellow-50 dark:bg-yellow-950/40', text: 'text-yellow-700 dark:text-yellow-500', border: 'border-yellow-200 dark:border-yellow-800', icon: false },
  LOW: { label: 'Low', bg: 'bg-sky-50 dark:bg-sky-950/40', text: 'text-sky-700 dark:text-sky-400', border: 'border-sky-200 dark:border-sky-800', icon: false },
};

const ROLE_MAP: Record<string, string> = {
  ADMIN: 'Administrator', BLOCK: 'Block Level', DISTRICT: 'District Level', STATE: 'State Level',
};

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300',
  BLOCK: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  DISTRICT: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  STATE: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
};

const CATEGORIES = [
  'Water Supply', 'Road Damage', 'Electricity', 'Sanitation',
  'Healthcare', 'Education', 'Public Transport', 'Agriculture', 'Housing', 'Other',
];

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */

function fmtDate(s: string) {
  if (!s) return 'N/A';
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(s: string) {
  if (!s) return 'N/A';
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtStatus(status: string) {
  return STATUS_MAP[status]?.label || status;
}

function fmtUrgency(urgency: string) {
  return URGENCY_MAP[urgency]?.label || urgency;
}

function fmtRole(role: string) {
  return ROLE_MAP[role] || role;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('wb_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ═══════════════════════════════════════════════════════════════════
   ANIMATED COUNTER
   ═══════════════════════════════════════════════════════════════════ */

function useCountUp(target: number, duration = 700, delay = 0) {
  const [v, setV] = useState(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const start = prevRef.current;
    const startTime = performance.now() + delay;
    let raf: number;
    function tick(now: number) {
      const elapsed = now - startTime;
      if (elapsed < 0) { raf = requestAnimationFrame(tick); return; }
      const p = Math.min(elapsed / duration, 1);
      setV(Math.round(start + (target - start) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
      else prevRef.current = target;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, delay]);
  return v;
}

/* ═══════════════════════════════════════════════════════════════════
   SMALL COMPONENTS
   ═══════════════════════════════════════════════════════════════════ */

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] || STATUS_MAP.OPEN;
  return (
    <Badge variant="outline" className={`text-[11px] font-semibold px-2 py-0.5 gap-1 ${s.bg} ${s.text} ${s.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dotColor}`} />
      {s.label}
    </Badge>
  );
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const u = URGENCY_MAP[urgency] || URGENCY_MAP.MEDIUM;
  return (
    <Badge variant="outline" className={`text-[11px] font-semibold px-2 py-0.5 ${u.bg} ${u.text} ${u.border}`}>
      {u.icon && <AlertTriangle className="h-3 w-3 mr-0.5" />}
      {u.label}
    </Badge>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[role] || 'bg-gray-100 text-gray-600'}`}>
      {fmtRole(role)}
    </span>
  );
}

function StatCard({ title, value, icon: Icon, color, bgColor, delay = 0, suffix = '' }: {
  title: string; value: number; icon: React.ElementType; color: string; bgColor: string; delay?: number; suffix?: string;
}) {
  const display = useCountUp(value, 700, delay);
  return (
    <Card className="border-0 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden group relative">
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: `linear-gradient(90deg, ${color}, ${color}44)` }} />
      <CardContent className="p-5 pl-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5 flex-1 min-w-0">
            <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
            <p className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
              {display}{suffix}
            </p>
          </div>
          <div className="flex items-center justify-center rounded-xl p-3 group-hover:scale-110 transition-transform duration-300" style={{ backgroundColor: bgColor }}>
            <Icon className="h-5 w-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, icon: Icon, color, bgColor, delay }: {
  label: string; value: number; icon: React.ElementType; color: string; bgColor: string; delay: number;
}) {
  const display = useCountUp(value, 600, delay);
  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-all">
      <CardContent className="p-3 sm:p-4 flex items-center gap-3">
        <div className="flex items-center justify-center rounded-lg p-2 shrink-0" style={{ backgroundColor: bgColor }}>
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
          <p className="text-lg sm:text-xl font-black tabular-nums text-foreground">{display}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: {
  cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number;
}) {
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  return (
    <text x={cx + r * Math.cos(-midAngle * RADIAN)} y={cy + r * Math.sin(-midAngle * RADIAN)}
      fill="white" textAnchor="middle" dominantBaseline="central" className="text-[11px] font-bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[120px] rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Skeleton className="h-[300px] rounded-xl lg:col-span-2" />
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
    </div>
  );
}

function EmptyState({ message, icon: Icon }: { message: string; icon?: React.ElementType }) {
  const Ic = Icon || FileText;
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Ic className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LOGIN VIEW
   ═══════════════════════════════════════════════════════════════════ */

function LoginView() {
  const { login, isLoading, error, clearError } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await login(username, password);
    if (ok) {
      toast.success('Welcome!', { description: 'You have been logged in successfully.' });
    }
  }, [login, username, password]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${NAVY_DARK} 0%, ${NAVY} 40%, #1a3a7a 100%)` }}>
      {/* Decorative circles */}
      <div className="absolute top-[-120px] left-[-120px] h-[400px] w-[400px] rounded-full opacity-10" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.3), transparent)' }} />
      <div className="absolute bottom-[-80px] right-[-80px] h-[300px] w-[300px] rounded-full opacity-10" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.2), transparent)' }} />

      <div className="w-full max-w-md relative z-10">
        {/* Government branding header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-white/15 backdrop-blur-sm shadow-lg mb-4 border border-white/20">
            <Shield className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Government of West Bengal
          </h1>
          <p className="text-blue-200/80 text-sm mt-1.5 font-medium">
            AI Public Support System
          </p>
          <div className="h-0.5 w-24 bg-white/30 mx-auto mt-4 rounded-full" />
        </div>

        {/* Login Card */}
        <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-bold text-center">Sign In to Portal</CardTitle>
            <CardDescription className="text-center text-xs">
              Access the grievance management dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                  <button type="button" onClick={clearError} className="ml-auto shrink-0">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="username" className="text-xs font-semibold uppercase tracking-wider">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  className="h-11"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="h-11"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={isLoading || !username || !password}
                className="w-full h-11 text-sm font-semibold text-white transition-all duration-200 hover:shadow-lg"
                style={{ backgroundColor: NAVY }}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Authenticating...
                  </span>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>

            {/* Test accounts hint */}
            <div className="mt-6 pt-4 border-t">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 text-center">
                Demo Accounts
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { u: 'admin', p: 'admin123', r: 'ADMIN' },
                  { u: 'state_wb', p: 'state123', r: 'STATE' },
                  { u: 'district_nadia', p: 'nadia123', r: 'DISTRICT' },
                  { u: 'block_krishnanagar', p: 'krish123', r: 'BLOCK' },
                ].map((acc) => (
                  <button
                    key={acc.u}
                    type="button"
                    onClick={() => { setUsername(acc.u); setPassword(acc.p); }}
                    className="text-left p-2 rounded-lg border bg-muted/50 hover:bg-muted transition-colors group"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <code className="text-[10px] font-mono text-foreground group-hover:text-sky-700 transition-colors truncate">{acc.u}</code>
                      <RoleBadge role={acc.r} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-blue-200/50 text-[11px] mt-6">
          &copy; 2025 Government of West Bengal &mdash; All Rights Reserved
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DASHBOARD VIEW
   ═══════════════════════════════════════════════════════════════════ */

function DashboardView({ onNavigate }: { onNavigate: (id: string, complaint?: Complaint) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        toast.error('Failed to load dashboard data');
      }
    } catch {
      toast.error('Network error loading dashboard');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  if (loading && !data) return <LoadingSkeleton />;
  if (!data) return <EmptyState message="Unable to load dashboard data" />;

  const { stats, byCategory, byGroup, groupByField, monthlyTrend, byUrgency, recent, criticalComplaints } = data;
  const maxCatCount = Math.max(...byCategory.map((c) => c.count), 1);

  const statusPieData = [
    { name: 'Open', value: stats.open, fill: '#DC2626' },
    { name: 'In Progress', value: stats.inProgress, fill: '#D97706' },
    { name: 'Resolved', value: stats.resolved, fill: '#16A34A' },
    { name: 'Rejected', value: stats.rejected, fill: '#9CA3AF' },
  ].filter((d) => d.value > 0);

  const barChartConfig = {
    open: { label: 'Open', color: '#DC2626' },
    inProgress: { label: 'In Progress', color: '#D97706' },
    resolved: { label: 'Resolved', color: '#16A34A' },
  };

  const trendChartConfig = {
    open: { label: 'Open', color: '#DC2626' },
    inProgress: { label: 'In Progress', color: '#D97706' },
    resolved: { label: 'Resolved', color: '#16A34A' },
    total: { label: 'Total', color: NAVY },
  };

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Complaints" value={stats.total} icon={FileText} color={NAVY} bgColor="#E3F2FD" delay={0} />
        <StatCard title="Open" value={stats.open} icon={CircleDot} color="#DC2626" bgColor="#FEF2F2" delay={100} />
        <StatCard title="In Progress" value={stats.inProgress} icon={Clock} color="#D97706" bgColor="#FFFBEB" delay={200} />
        <StatCard title="Resolved" value={stats.resolved} icon={CheckCircle2} color="#16A34A" bgColor="#F0FDF4" delay={300} />
      </div>

      {/* Mini Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MiniStat label="Critical" value={stats.critical} icon={AlertTriangle} color="#DC2626" bgColor="#FEF2F2" delay={350} />
        <MiniStat label="Today's New" value={stats.todayComplaints} icon={TrendingUp} color={NAVY} bgColor="#E3F2FD" delay={400} />
        <MiniStat label="Resolution Rate" value={stats.resolutionRate} icon={Activity} color="#16A34A" bgColor="#F0FDF4" delay={450} suffix="%" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Bar Chart: Group complaints */}
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Complaints by {groupByField === 'district' ? 'District' : 'Block'}</CardTitle>
            <CardDescription className="text-xs">Status breakdown per location</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={barChartConfig} className="h-[280px] w-full">
              <BarChart data={byGroup} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="open" stackId="a" fill="#DC2626" radius={[0, 0, 0, 0]} />
                <Bar dataKey="inProgress" stackId="a" fill="#D97706" />
                <Bar dataKey="resolved" stackId="a" fill="#16A34A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Donut Chart: Status Breakdown */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {statusPieData.length > 0 ? (
              <ChartContainer config={{}} className="h-[260px] w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Pie
                    data={statusPieData}
                    cx="50%" cy="50%"
                    innerRadius={55} outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    labelLine={false}
                    label={PieLabel}
                  >
                    {statusPieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    iconSize={8}
                    formatter={(value: string) => <span className="text-xs">{value}</span>}
                  />
                </PieChart>
              </ChartContainer>
            ) : (
              <EmptyState message="No complaints yet" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monthly Trend + Category Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Area Chart: Monthly Trend */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Monthly Trend</CardTitle>
            <CardDescription className="text-xs">Last 6 months overview</CardDescription>
          </CardHeader>
          <CardContent>
            {monthlyTrend.length > 0 ? (
              <ChartContainer config={trendChartConfig} className="h-[250px] w-full">
                <AreaChart data={monthlyTrend} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="fillOpen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#DC2626" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="fillResolved" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16A34A" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="open" stroke="#DC2626" fill="url(#fillOpen)" strokeWidth={2} />
                  <Area type="monotone" dataKey="inProgress" stroke="#D97706" fill="transparent" strokeWidth={2} />
                  <Area type="monotone" dataKey="resolved" stroke="#16A34A" fill="url(#fillResolved)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            ) : (
              <EmptyState message="No trend data available" />
            )}
          </CardContent>
        </Card>

        {/* Category Breakdown */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Category Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {byCategory.length > 0 ? (
              <ScrollArea className="h-[250px] pr-2">
                <div className="space-y-3">
                  {byCategory.map((cat) => (
                    <div key={cat.category} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground">{cat.category}</span>
                        <span className="font-bold text-muted-foreground tabular-nums">{cat.count}</span>
                      </div>
                      <Progress value={(cat.count / maxCatCount) * 100} className="h-2" />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <EmptyState message="No category data" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Urgency Distribution + Recent Complaints */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Urgency Distribution */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Urgency Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {byUrgency.length > 0 ? (
              <div className="space-y-3">
                {byUrgency.map((u) => {
                  const total = byUrgency.reduce((s, x) => s + x.count, 0);
                  const pct = total > 0 ? Math.round((u.count / total) * 100) : 0;
                  const colorMap: Record<string, string> = { CRITICAL: '#DC2626', HIGH: '#EA580C', MEDIUM: '#D97706', LOW: '#0284C7' };
                  return (
                    <div key={u.urgency} className="flex items-center gap-3">
                      <UrgencyBadge urgency={u.urgency} />
                      <div className="flex-1">
                        <Progress value={pct} className="h-2" />
                      </div>
                      <span className="text-xs font-bold text-muted-foreground tabular-nums w-8 text-right">{u.count}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState message="No urgency data" />
            )}
          </CardContent>
        </Card>

        {/* Recent Complaints */}
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold">Recent Complaints</CardTitle>
              <CardDescription className="text-xs">Latest filed grievances</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="text-xs h-8 gap-1" onClick={() => onNavigate('complaints')}>
              View All <ArrowUpRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent>
            {recent.length > 0 ? (
              <div className="space-y-2">
                {recent.slice(0, 5).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onNavigate('complaints', c)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-muted-foreground">{c.ticketNo}</span>
                        <StatusBadge status={c.status} />
                        <UrgencyBadge urgency={c.urgency} />
                      </div>
                      <p className="text-sm font-medium text-foreground truncate mt-0.5">{c.issue}</p>
                      <p className="text-[11px] text-muted-foreground">{c.citizenName || 'Anonymous'} &middot; {c.block}, {c.district}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:block">{fmtDate(c.createdAt)}</span>
                    <Eye className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState message="No recent complaints" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Critical Complaints Alerts */}
      {criticalComplaints.length > 0 && (
        <Card className="border-0 shadow-sm border-l-4" style={{ borderLeftColor: '#DC2626' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-red-700 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Critical Complaints Alert ({criticalComplaints.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {criticalComplaints.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onNavigate('complaints', c)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors text-left"
                >
                  <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold">{c.ticketNo}</span>
                      <Badge variant="outline" className="text-[10px] bg-red-100 text-red-700 border-red-200">{c.category}</Badge>
                    </div>
                    <p className="text-sm font-medium truncate">{c.issue}</p>
                    <p className="text-[11px] text-muted-foreground">{c.block}, {c.district} &middot; {fmtDate(c.createdAt)}</p>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   COMPLAINT DETAIL DIALOG
   ═══════════════════════════════════════════════════════════════════ */

function ComplaintDetailDialog({ complaint: initialComplaint, open, onOpenChange, onUpdate }: {
  complaint: Complaint | null; open: boolean; onOpenChange: (v: boolean) => void;
  onUpdate?: (id: string, status: string, resolution?: string) => void;
}) {
  const [complaint, setComplaint] = useState<Complaint | null>(null);
  const [resolutionText, setResolutionText] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (open && initialComplaint) {
      setComplaint(initialComplaint);
      setResolutionText(initialComplaint.resolution || '');
      setNewStatus('');
    }
  }, [open, initialComplaint]);

  const handleStatusChange = useCallback(async (status: string) => {
    if (!complaint) return;
    setUpdating(true);
    try {
      const body: Record<string, string> = { status };
      if (status === 'RESOLVED' && resolutionText.trim()) {
        body.resolution = resolutionText.trim();
      }
      const res = await fetch(`/api/complaints/${complaint.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const json = await res.json();
        setComplaint(json.complaint);
        setNewStatus('');
        toast.success('Status updated', { description: `Complaint marked as ${fmtStatus(status)}` });
        onUpdate?.(complaint.id, status, body.resolution);
      } else {
        toast.error('Failed to update status');
      }
    } catch {
      toast.error('Network error');
    }
    setUpdating(false);
  }, [complaint, resolutionText, onUpdate]);

  const handleSaveResolution = useCallback(async () => {
    if (!complaint) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/complaints/${complaint.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ resolution: resolutionText.trim() }),
      });
      if (res.ok) {
        const json = await res.json();
        setComplaint(json.complaint);
        toast.success('Resolution saved');
      } else {
        toast.error('Failed to save resolution');
      }
    } catch {
      toast.error('Network error');
    }
    setUpdating(false);
  }, [complaint, resolutionText]);

  if (!complaint) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto border-0 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Hash className="h-4 w-4" style={{ color: NAVY }} />
            Complaint {complaint.ticketNo}
          </DialogTitle>
          <DialogDescription>Complete details of this citizen grievance</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          {/* Status & Urgency */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={complaint.status} />
            <UrgencyBadge urgency={complaint.urgency} />
            <Badge variant="outline" className="text-[11px]">{complaint.source}</Badge>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: 'Category', val: complaint.category },
              { label: 'Block', val: complaint.block },
              { label: 'District', val: complaint.district },
              { label: 'Filed On', val: fmtDateTime(complaint.createdAt) },
              { label: 'Updated', val: fmtDateTime(complaint.updatedAt) },
              { label: 'Phone', val: complaint.phone || 'N/A' },
            ].map((f) => (
              <div key={f.label} className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{f.label}</p>
                <p className="text-sm font-medium text-foreground">{f.val}</p>
              </div>
            ))}
          </div>

          {/* Citizen Info */}
          <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Citizen Information</p>
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: NAVY }}>
                {(complaint.citizenName || 'A').charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{complaint.citizenName || 'Anonymous'}</p>
                {complaint.phone && <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />{complaint.phone}</p>}
              </div>
            </div>
          </div>

          {/* Issue */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Issue</p>
            <p className="text-sm leading-relaxed p-3 rounded-xl bg-muted/50 border border-border/50 text-foreground">{complaint.issue}</p>
          </div>

          {/* Description */}
          {complaint.description && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Description</p>
              <p className="text-sm leading-relaxed p-3 rounded-xl bg-muted/50 border border-border/50 text-muted-foreground">{complaint.description}</p>
            </div>
          )}

          {/* Resolution */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Resolution</p>
            {complaint.resolution ? (
              <p className="text-sm leading-relaxed p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                {complaint.resolution}
              </p>
            ) : (
              <p className="text-sm p-3 rounded-xl bg-muted/30 border border-border/30 text-muted-foreground italic">No resolution recorded yet</p>
            )}
          </div>

          {/* Actions for authorized users */}
          <Separator />

          {/* Status Update */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Update Status</p>
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select new status..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
            {newStatus && (
              <Button
                size="sm"
                disabled={updating}
                onClick={() => handleStatusChange(newStatus)}
                className="w-full text-xs"
                style={{ backgroundColor: NAVY, color: 'white' }}
              >
                {updating ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                Apply: {fmtStatus(newStatus)}
              </Button>
            )}
          </div>

          {/* Resolution Text Input */}
          <div className="space-y-2">
            <Label className="text-[10px] font-bold uppercase tracking-widest">Resolution Notes</Label>
            <Textarea
              value={resolutionText}
              onChange={(e) => setResolutionText(e.target.value)}
              placeholder="Enter resolution details..."
              rows={3}
              className="text-sm"
            />
            <Button variant="outline" size="sm" disabled={updating} onClick={handleSaveResolution} className="text-xs w-full">
              <Send className="h-3 w-3 mr-1" />
              Save Resolution
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   NEW COMPLAINT DIALOG
   ═══════════════════════════════════════════════════════════════════ */

function NewComplaintDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const [form, setForm] = useState({ citizenName: '', phone: '', issue: '', category: '', block: '', district: '', urgency: 'MEDIUM', description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    const e: Record<string, string> = {};
    if (!form.issue.trim()) e.issue = 'Required';
    if (!form.category) e.category = 'Required';
    if (!form.block) e.block = 'Required';
    if (!form.district) e.district = 'Required';
    setErrors(e);
    if (Object.keys(e).length) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast.success('Complaint filed successfully');
        setForm({ citizenName: '', phone: '', issue: '', category: '', block: '', district: '', urgency: 'MEDIUM', description: '' });
        setErrors({});
        onOpenChange(false);
        onCreated();
      } else {
        const json = await res.json();
        toast.error(json.error || 'Failed to create complaint');
      }
    } catch {
      toast.error('Network error');
    }
    setSubmitting(false);
  }, [form, onOpenChange, onCreated]);

  const update = useCallback((key: string, val: string) => {
    setForm((prev) => ({ ...prev, [key]: val }));
    setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto border-0 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Plus className="h-5 w-5" style={{ color: NAVY }} />
            File New Complaint
          </DialogTitle>
          <DialogDescription>Submit a new citizen grievance</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest">Citizen Name</Label>
              <Input value={form.citizenName} onChange={(e) => update('citizenName', e.target.value)} placeholder="Full name" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest">Phone</Label>
              <Input value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="Mobile number" className="h-9 text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest">Issue *</Label>
            <Input value={form.issue} onChange={(e) => update('issue', e.target.value)} placeholder="Describe the issue" className={`h-9 text-sm ${errors.issue ? 'border-red-400' : ''}`} />
            {errors.issue && <p className="text-red-500 text-[11px]">{errors.issue}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest">Category *</Label>
              <Select value={form.category} onValueChange={(v) => update('category', v)}>
                <SelectTrigger className={`h-9 text-sm w-full ${errors.category ? 'border-red-400' : ''}`}>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.category && <p className="text-red-500 text-[11px]">{errors.category}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest">Urgency</Label>
              <Select value={form.urgency} onValueChange={(v) => update('urgency', v)}>
                <SelectTrigger className="h-9 text-sm w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest">Block *</Label>
              <Input value={form.block} onChange={(e) => update('block', e.target.value)} placeholder="Block name" className={`h-9 text-sm ${errors.block ? 'border-red-400' : ''}`} />
              {errors.block && <p className="text-red-500 text-[11px]">{errors.block}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest">District *</Label>
              <Input value={form.district} onChange={(e) => update('district', e.target.value)} placeholder="District name" className={`h-9 text-sm ${errors.district ? 'border-red-400' : ''}`} />
              {errors.district && <p className="text-red-500 text-[11px]">{errors.district}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest">Description</Label>
            <Textarea value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Additional details..." rows={3} className="text-sm" />
          </div>
        </div>
        <DialogFooter className="gap-2 mt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-sm">Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting} className="text-sm gap-1.5 min-w-[130px] text-white" style={{ backgroundColor: NAVY }}>
            {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            File Complaint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   COMPLAINTS VIEW
   ═══════════════════════════════════════════════════════════════════ */

function ComplaintsView({ initialComplaint }: { initialComplaint?: Complaint }) {
  const user = useAuthStore((s) => s.user);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 0 });

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterUrgency, setFilterUrgency] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBlock, setFilterBlock] = useState('');
  const [sortField, setSortField] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [newComplaintOpen, setNewComplaintOpen] = useState(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch complaints
  const fetchComplaints = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (filterStatus) params.set('status', filterStatus);
      if (filterUrgency) params.set('urgency', filterUrgency);
      if (filterCategory) params.set('category', filterCategory);
      if (filterBlock) params.set('block', filterBlock);
      params.set('page', String(page));
      params.set('limit', String(pagination.limit));

      const res = await fetch(`/api/complaints?${params.toString()}`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setComplaints(json.complaints);
        setPagination(json.pagination);
      } else {
        toast.error('Failed to load complaints');
      }
    } catch {
      toast.error('Network error');
    }
    setLoading(false);
  }, [debouncedSearch, filterStatus, filterUrgency, filterCategory, filterBlock, page, pagination.limit]);

  useEffect(() => { fetchComplaints(); }, [fetchComplaints]);

  // Open initial complaint if passed
  useEffect(() => {
    if (initialComplaint) {
      setSelectedComplaint(initialComplaint);
      setDetailOpen(true);
    }
  }, [initialComplaint]);

  const updateFilter = useCallback((setter: (v: string) => void, val: string) => {
    setter(val);
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch(''); setDebouncedSearch('');
    setFilterStatus(''); setFilterUrgency('');
    setFilterCategory(''); setFilterBlock('');
    setPage(1);
  }, []);

  const activeFilterCount = [debouncedSearch, filterStatus, filterUrgency, filterCategory, filterBlock].filter(Boolean).length;

  const handleSort = useCallback((field: string) => {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }, [sortField]);

  const handleStatusUpdate = useCallback(async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/complaints/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success('Status updated', { description: `Marked as ${fmtStatus(status)}` });
        fetchComplaints();
      } else {
        toast.error('Failed to update status');
      }
    } catch {
      toast.error('Network error');
    }
  }, [fetchComplaints]);

  const handleComplaintUpdate = useCallback(() => {
    fetchComplaints();
  }, [fetchComplaints]);

  const exportCSV = useCallback(() => {
    const h = ['Ticket #', 'Citizen', 'Phone', 'Issue', 'Category', 'Block', 'District', 'Urgency', 'Status', 'Source', 'Created'];
    const rows = complaints.map((c) => [c.ticketNo, c.citizenName || '', c.phone || '', c.issue, c.category, c.block, c.district, c.urgency, c.status, c.source, fmtDate(c.createdAt)]);
    const csv = [h, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wb-complaints-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('Export complete', { description: `${complaints.length} complaints exported` });
  }, [complaints]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">Complaints</h2>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <FileText className="h-3.5 w-3.5" />
            {pagination.total} total complaints
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={() => setNewComplaintOpen(true)} className="text-xs gap-1 text-white" style={{ backgroundColor: NAVY }}>
            <Plus className="h-3.5 w-3.5" /> New Complaint
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} className="text-xs gap-1">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Search + Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, ticket, issue, block..."
                value={search}
                onChange={(e) => updateFilter(setSearch, e.target.value)}
                className="pl-9 pr-8 h-9 text-sm"
              />
              {search && (
                <button onClick={() => updateFilter(setSearch, '')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Filter Count + Clear */}
            {activeFilterCount > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="text-xs gap-1 h-9">
                <X className="h-3 w-3" /> Clear ({activeFilterCount})
              </Button>
            )}
          </div>

          {/* Filter Row */}
          <div className="flex flex-wrap gap-2 mt-3">
            <Select value={filterStatus} onValueChange={(v) => updateFilter(setFilterStatus, v === '_all' ? '' : v)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Status</SelectItem>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterUrgency} onValueChange={(v) => updateFilter(setFilterUrgency, v === '_all' ? '' : v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="All Urgency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Urgency</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterCategory} onValueChange={(v) => updateFilter(setFilterCategory, v === '_all' ? '' : v)}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Categories</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            {user?.role !== 'BLOCK' && (
              <Select value={filterBlock} onValueChange={(v) => updateFilter(setFilterBlock, v === '_all' ? '' : v)}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="All Blocks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Blocks</SelectItem>
                  <SelectItem value="Krishnanagar">Krishnanagar</SelectItem>
                  <SelectItem value="Ranaghat">Ranaghat</SelectItem>
                  <SelectItem value="Kalyani">Kalyani</SelectItem>
                  <SelectItem value="Shantipur">Shantipur</SelectItem>
                  <SelectItem value="Chakdaha">Chakdaha</SelectItem>
                  <SelectItem value="Haringhata">Haringhata</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table (Desktop) */}
      {!loading && complaints.length === 0 ? (
        <EmptyState message="No complaints found matching your filters" />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className="border-0 shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-muted" onClick={() => handleSort('ticketNo')}>
                      <span className="flex items-center gap-1">Ticket # <ArrowUpDown className="h-3 w-3" /></span>
                    </TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">Citizen</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">Category</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">Block</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">Urgency</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-muted" onClick={() => handleSort('status')}>
                      <span className="flex items-center gap-1">Status <ArrowUpDown className="h-3 w-3" /></span>
                    </TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-muted" onClick={() => handleSort('createdAt')}>
                      <span className="flex items-center gap-1">Date <ArrowUpDown className="h-3 w-3" /></span>
                    </TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 8 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    complaints.map((c) => (
                      <TableRow key={c.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="font-mono text-xs font-bold">{c.ticketNo}</TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">{c.citizenName || 'Anonymous'}</p>
                            {c.phone && <p className="text-[10px] text-muted-foreground">{c.phone}</p>}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{c.category}</TableCell>
                        <TableCell className="text-xs">{c.block}</TableCell>
                        <TableCell><UrgencyBadge urgency={c.urgency} /></TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="cursor-pointer"><StatusBadge status={c.status} /></button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">Change Status</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleStatusUpdate(c.id, 'OPEN')}><CircleDot className="h-3.5 w-3.5 text-red-500 mr-2" />Open</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusUpdate(c.id, 'IN_PROGRESS')}><Clock className="h-3.5 w-3.5 text-amber-500 mr-2" />In Progress</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusUpdate(c.id, 'RESOLVED')}><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mr-2" />Resolved</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusUpdate(c.id, 'REJECTED')}><X className="h-3.5 w-3.5 text-gray-500 mr-2" />Rejected</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(c.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setSelectedComplaint(c); setDetailOpen(true); }}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </div>

          {/* Cards (Mobile) */}
          <div className="md:hidden space-y-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)
            ) : (
              complaints.map((c) => (
                <Card key={c.id} className="border-0 shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold">{c.ticketNo}</span>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={c.status} />
                        <UrgencyBadge urgency={c.urgency} />
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{c.issue}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {c.citizenName || 'Anonymous'} &middot; {c.block}, {c.district}
                      </p>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-border/50">
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />{fmtDate(c.createdAt)}
                      </span>
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => { setSelectedComplaint(c); setDetailOpen(true); }}>
                        <Eye className="h-3.5 w-3.5" /> Details
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {(page - 1) * pagination.limit + 1}&ndash;{Math.min(page * pagination.limit, pagination.total)} of {pagination.total}
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {Array.from({ length: Math.min(pagination.totalPages, 5) }, (_, i) => {
                  let p = i + 1;
                  if (pagination.totalPages > 5) {
                    if (page <= 3) p = i + 1;
                    else if (page >= pagination.totalPages - 2) p = pagination.totalPages - 4 + i;
                    else p = page - 2 + i;
                  }
                  return (
                    <Button key={p} variant={p === page ? 'default' : 'outline'} size="sm" className="h-8 w-8 p-0 text-xs" onClick={() => setPage(p)} style={p === page ? { backgroundColor: NAVY, color: 'white' } : {}}>
                      {p}
                    </Button>
                  );
                })}
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail Dialog */}
      <ComplaintDetailDialog
        complaint={selectedComplaint}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={handleComplaintUpdate}
      />

      {/* New Complaint Dialog */}
      <NewComplaintDialog
        open={newComplaintOpen}
        onOpenChange={setNewComplaintOpen}
        onCreated={fetchComplaints}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   USER MANAGEMENT VIEW (Admin Only)
   ═══════════════════════════════════════════════════════════════════ */

function UserManagementView() {
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
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow><TableCell colSpan={7}><EmptyState message="No users found" /></TableCell></TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs font-bold">{u.username}</TableCell>
                    <TableCell className="text-sm font-medium">{u.name}</TableCell>
                    <TableCell><RoleBadge role={u.role} /></TableCell>
                    <TableCell className="text-xs">{u.location}</TableCell>
                    <TableCell className="text-xs">{u.district || '—'}</TableCell>
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
                          <DropdownMenuItem onClick={() => handleToggleActive(u)}>
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
                  <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => handleToggleActive(u)}>
                    {u.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto border-0 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Plus className="h-5 w-5" style={{ color: NAVY }} />Create New User
            </DialogTitle>
            <DialogDescription>Add a new user to the system</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Username *</Label>
                <Input value={createForm.username} onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))} placeholder="username" className={`h-9 text-sm ${createErrors.username ? 'border-red-400' : ''}`} />
                {createErrors.username && <p className="text-red-500 text-[11px]">{createErrors.username}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Password *</Label>
                <Input type="password" value={createForm.password} onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))} placeholder="password" className={`h-9 text-sm ${createErrors.password ? 'border-red-400' : ''}`} />
                {createErrors.password && <p className="text-red-500 text-[11px]">{createErrors.password}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Full Name *</Label>
                <Input value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name" className={`h-9 text-sm ${createErrors.name ? 'border-red-400' : ''}`} />
                {createErrors.name && <p className="text-red-500 text-[11px]">{createErrors.name}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Role *</Label>
                <Select value={createForm.role} onValueChange={(v) => setCreateForm((f) => ({ ...f, role: v }))}>
                  <SelectTrigger className="h-9 text-sm w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">Administrator</SelectItem>
                    <SelectItem value="STATE">State Level</SelectItem>
                    <SelectItem value="DISTRICT">District Level</SelectItem>
                    <SelectItem value="BLOCK">Block Level</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">Location *</Label>
                <Input value={createForm.location} onChange={(e) => setCreateForm((f) => ({ ...f, location: e.target.value }))} placeholder="e.g. Krishnanagar" className={`h-9 text-sm ${createErrors.location ? 'border-red-400' : ''}`} />
                {createErrors.location && <p className="text-red-500 text-[11px]">{createErrors.location}</p>}
              </div>
              {(createForm.role === 'DISTRICT' || createForm.role === 'BLOCK') && (
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase tracking-widest">District</Label>
                  <Input value={createForm.district} onChange={(e) => setCreateForm((f) => ({ ...f, district: e.target.value }))} placeholder="e.g. Nadia" className="h-9 text-sm" />
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2 mt-3">
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="text-sm">Cancel</Button>
            <Button onClick={handleCreate} disabled={creating} className="text-sm gap-1.5 text-white" style={{ backgroundColor: NAVY }}>
              {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetPwdUser} onOpenChange={(v) => { if (!v) setResetPwdUser(null); }}>
        <DialogContent className="sm:max-w-sm border-0 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Reset Password</DialogTitle>
            <DialogDescription>Set a new password for {resetPwdUser?.name}</DialogDescription>
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
              {resetting ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : <KeyRound className="h-4 w-4 mr-1" />}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN PAGE (App Shell)
   ═══════════════════════════════════════════════════════════════════ */

export default function HomePage() {
  const { user, isLoading, checkAuth, logout } = useAuthStore();
  const { theme, setTheme } = useTheme();
  const [view, setView] = useState<ViewType>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState('');
  const [complaintForDetail, setComplaintForDetail] = useState<Complaint | undefined>();
  const [mounted, setMounted] = useState(false);

  // Check auth on mount
  useEffect(() => {
    checkAuth();
    setMounted(true);
  }, [checkAuth]);

  // Clock
  useEffect(() => {
    if (!mounted) return;
    const update = () => setCurrentTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    update();
    const i = setInterval(update, 1000);
    return () => clearInterval(i);
  }, [mounted]);

  const handleNavigate = useCallback((v: string, complaint?: Complaint) => {
    if (v === 'complaints') {
      setView('complaints');
      if (complaint) setComplaintForDetail(complaint);
    } else {
      setView(v as ViewType);
    }
    setSidebarOpen(false);
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    setView('dashboard');
  }, [logout]);

  // Loading / Not mounted
  if (!mounted || (isLoading && !user)) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F1F5F9' }}>
        <div className="text-center">
          <div className="h-12 w-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ backgroundColor: NAVY }}>
            <Shield className="h-6 w-6 text-white animate-pulse" />
          </div>
          <p className="text-sm text-muted-foreground">Loading portal...</p>
        </div>
      </div>
    );
  }

  // Not authenticated → Login
  if (!user) return <LoginView />;

  const isDark = theme === 'dark';

  const navItems: { id: ViewType; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'complaints', label: 'Complaints', icon: FileText },
  ];
  if (user.role === 'ADMIN') {
    navItems.push({ id: 'users', label: 'User Management', icon: Users });
  }

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-300 ${isDark ? 'dark' : ''}`} style={{ backgroundColor: isDark ? '#0F172A' : '#F1F5F9' }}>
      {/* ═══ HEADER ═══ */}
      <header className="sticky top-0 z-50 shadow-lg" style={{ background: `linear-gradient(135deg, ${NAVY_DARK} 0%, ${NAVY} 40%, #1a3a7a 100%)` }}>
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14 sm:h-16">
            {/* Left: Menu + Logo */}
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden flex items-center justify-center rounded-lg bg-white/15 p-2 text-white hover:bg-white/25 transition-colors"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex items-center justify-center rounded-lg bg-white/15 p-2 shadow-inner">
                <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-white font-bold text-sm sm:text-base leading-tight tracking-tight">WB AI Support System</h1>
                <p className="text-blue-200/60 text-[10px]">Government of West Bengal</p>
              </div>
              <h1 className="sm:hidden text-white font-bold text-xs leading-tight">WB AI Support</h1>
            </div>

            {/* Desktop Nav */}
            <nav className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    view === item.id ? 'bg-white/20 text-white shadow-sm' : 'text-blue-100 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              ))}
            </nav>

            {/* Right Actions */}
            <div className="flex items-center gap-1 sm:gap-1.5">
              {currentTime && (
                <span className="text-blue-200/50 text-[10px] font-mono hidden xl:block tabular-nums">{currentTime}</span>
              )}
              <Button variant="ghost" size="sm" onClick={() => setTheme(isDark ? 'light' : 'dark')} className="text-white/80 hover:bg-white/15 hover:text-white h-9 w-9 p-0">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="relative flex items-center justify-center rounded-lg bg-white/15 p-2 text-white hover:bg-white/25 transition-colors">
                    <Bell className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="text-xs">Notifications</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-xs text-muted-foreground justify-center py-6">No new notifications</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* User Info */}
              <div className="hidden sm:flex items-center gap-2 ml-1 pl-2 border-l border-white/20">
                <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold" style={{ backgroundColor: NAVY }}>
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="hidden md:block">
                  <p className="text-white text-xs font-semibold leading-tight">{user.name}</p>
                  <div className="flex items-center gap-1.5">
                    <RoleBadge role={user.role} />
                    {user.location && (
                      <span className="text-[9px] text-blue-200/60 flex items-center gap-0.5">
                        <MapPin className="h-2.5 w-2.5" />{user.location}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <Button variant="ghost" size="sm" onClick={handleLogout} className="text-white/80 hover:bg-white/15 hover:text-white h-9 w-9 p-0" title="Logout">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* ═══ MOBILE SIDEBAR ═══ */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0" style={{ backgroundColor: isDark ? '#1E293B' : 'white' }}>
          <SheetHeader className="p-4 pb-0">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <Shield className="h-5 w-5" style={{ color: NAVY }} />
              WB AI Support System
            </SheetTitle>
            <SheetDescription className="text-xs">Government of West Bengal</SheetDescription>
          </SheetHeader>
          <div className="px-4 py-2">
            <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
              <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold" style={{ backgroundColor: NAVY }}>
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{user.name}</p>
                <p className="text-[10px] text-muted-foreground">{fmtRole(user.role)} &middot; {user.location}</p>
              </div>
            </div>
          </div>
          <nav className="px-3 py-2 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  view === item.id
                    ? 'text-white shadow-sm'
                    : `${isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'}`
                }`}
                style={view === item.id ? { backgroundColor: NAVY } : {}}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </nav>
        </SheetContent>
      </Sheet>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 sm:px-6 py-5 sm:py-6">
        {view === 'dashboard' && <DashboardView onNavigate={handleNavigate} />}
        {view === 'complaints' && <ComplaintsView initialComplaint={complaintForDetail} />}
        {view === 'users' && user.role === 'ADMIN' && <UserManagementView />}
      </main>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t mt-auto" style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0' }}>
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              &copy; 2025 Government of West Bengal &mdash; AI Public Support System
            </p>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Building2 className="h-3 w-3" />District Administration Portal
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
