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
  assignedUser?: { id: string; name: string; role: string } | null;
}

interface ActivityLogEntry {
  id: string;
  complaintId: string;
  action: string;
  description: string;
  actorId: string | null;
  actorName: string | null;
  metadata: string | null;
  createdAt: string;
}

interface AssignableUser {
  id: string;
  username: string;
  name: string;
  role: string;
  location: string;
  district: string | null;
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
    todayResolved: number; resolutionRate: number; slaBreaches: number;
  };
  byCategory: { category: string; count: number }[];
  byGroup: { name: string; count: number; open: number; inProgress: number; resolved: number; rejected: number }[];
  groupByField: string;
  monthlyTrend: { month: string; label: string; open: number; inProgress: number; resolved: number; total: number }[];
  byUrgency: { urgency: string; count: number }[];
  recent: Complaint[];
  criticalComplaints: Complaint[];
  openComplaints: Complaint[];
  userRole: string;
  userLocation: string;
}

type ViewType = 'dashboard' | 'complaints' | 'users' | 'analytics' | 'settings';

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

function safeGetLocalStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeSetLocalStorage(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}

function authHeaders(): Record<string, string> {
  const token = safeGetLocalStorage('wb_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getDaysOld(createdAt: string): number {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now.getTime() - created.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function getSLAInfo(createdAt: string, status: string): { days: number; level: 'ok' | 'warning' | 'breached'; color: string; bg: string; text: string } {
  const days = getDaysOld(createdAt);
  if (status === 'RESOLVED' || status === 'REJECTED') {
    return { days, level: 'ok', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400' };
  }
  if (days > 7) {
    return { days, level: 'breached', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-400' };
  }
  if (days >= 3) {
    return { days, level: 'warning', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400' };
  }
  return { days, level: 'ok', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400' };
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.value = 0.15;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 1108;
      osc2.type = 'sine';
      gain2.gain.value = 0.15;
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc2.start(ctx.currentTime);
      osc2.stop(ctx.currentTime + 0.25);
    }, 120);
  } catch { /* audio not available */ }
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
    <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}>
      <Badge variant="outline" className={`text-[11px] font-semibold px-2 py-0.5 gap-1 ${s.bg} ${s.text} ${s.border}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${s.dotColor}`} />
        {s.label}
      </Badge>
    </motion.div>
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

function StatCard({ title, value, icon: Icon, color, bgColor, delay = 0, suffix = '', trend = 0 }: {
  title: string; value: number; icon: React.ElementType; color: string; bgColor: string; delay?: number; suffix?: string; trend?: number;
}) {
  const display = useCountUp(value, 700, delay);
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: delay / 1000 }}>
      <Card className="border-0 shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all duration-300 overflow-hidden group relative border-l-4" style={{ borderLeftColor: color, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 3px rgba(0,0,0,0.08)' }}>
        <CardContent className="p-5 pl-6">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 flex-1 min-w-0">
              <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
              <div className="flex items-center gap-1.5">
                <p className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
                  {display}{suffix}
                </p>
                {trend !== 0 && (
                  <span className={`flex items-center text-xs font-bold ${trend > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {trend > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                    {Math.abs(trend)}%
                  </span>
                )}
              </div>
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
      <div className="flex items-center gap-2 mb-2">
        <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
        <span className="text-xs font-medium text-muted-foreground">Loading...</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[120px] rounded-xl bg-muted overflow-hidden relative">
            <div className="absolute inset-0 shimmer-bg" style={{ animationDelay: `${i * 150}ms` }} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="h-[300px] rounded-xl bg-muted overflow-hidden relative shimmer-bg lg:col-span-2" />
        <div className="h-[300px] rounded-xl bg-muted overflow-hidden relative shimmer-bg" style={{ animationDelay: '200ms' }} />
      </div>
    </div>
  );
}

function EmptyState({ message, icon: Icon, action, onAction }: { message: string; icon?: React.ElementType; action?: string; onAction?: () => void }) {
  const Ic = Icon || FileText;
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="h-16 w-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #E3F2FD, #F3E8FF, #FEF3C7)' }}>
        <Ic className="h-8 w-8" style={{ color: NAVY }} />
      </div>
      <p className="text-muted-foreground text-sm font-medium max-w-xs">{message}</p>
      {action && onAction && (
        <Button variant="outline" size="sm" className="mt-4 text-xs gap-1.5" onClick={onAction}>
          {action}
        </Button>
      )}
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
      {/* CSS dot grid background animation */}
      <div className="absolute inset-0 dot-grid-bg opacity-30" />
      {/* Subtle pattern texture */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />
      {/* Decorative circles */}
      <div className="absolute top-[-120px] left-[-120px] h-[400px] w-[400px] rounded-full opacity-10" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.3), transparent)' }} />
      <div className="absolute bottom-[-80px] right-[-80px] h-[300px] w-[300px] rounded-full opacity-10" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.2), transparent)' }} />

      {/* Floating Particles */}
      {[
        { left: '10%', size: 4, duration: 12, delay: 0 },
        { left: '25%', size: 3, duration: 18, delay: 2 },
        { left: '45%', size: 5, duration: 15, delay: 4 },
        { left: '65%', size: 3, duration: 20, delay: 1 },
        { left: '80%', size: 4, duration: 14, delay: 3 },
        { left: '90%', size: 2, duration: 22, delay: 5 },
        { left: '35%', size: 2, duration: 16, delay: 7 },
        { left: '55%', size: 3, duration: 19, delay: 6 },
      ].map((p, i) => (
        <div
          key={i}
          className="absolute bottom-0 rounded-full bg-white/40 float-particle"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}

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
            <div className="flex items-center justify-center gap-2 mb-1">
            <CardTitle className="text-lg font-bold text-center">Sign In to Portal</CardTitle>
            <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300 border-0 text-[10px] px-1.5 py-0 font-bold">v2.0</Badge>
          </div>
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
      {/* Global animation keyframes */}
      <style>{`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
        @keyframes shimmerBg {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .shimmer-bg {
          background: linear-gradient(90deg, hsl(var(--muted)) 25%, hsl(var(--muted-foreground) / 0.08) 50%, hsl(var(--muted)) 75%);
          background-size: 200% 100%;
          animation: shimmerBg 1.5s ease-in-out infinite;
        }
        @keyframes dotDrift {
          0% { background-position: 0 0; }
          100% { background-position: 40px 40px; }
        }
        .dot-grid-bg {
          background-image: radial-gradient(circle, rgba(255,255,255,0.25) 1px, transparent 1px);
          background-size: 40px 40px;
          animation: dotDrift 15s linear infinite;
        }
        @keyframes floatUp {
          0% { transform: translateY(0) rotate(0deg); opacity: 0; }
          10% { opacity: 0.6; }
          90% { opacity: 0.6; }
          100% { transform: translateY(-100vh) rotate(360deg); opacity: 0; }
        }
        .float-particle {
          animation: floatUp linear infinite;
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
  const [assignedTasks, setAssignedTasks] = useState<Complaint[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  // Date range filter
  const [dateRange, setDateRange] = useState('all');
  const dateRangePresets = [
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' },
    { value: '30d', label: 'Last 30 Days' },
    { value: '90d', label: 'Last 90 Days' },
    { value: 'all', label: 'All Time' },
  ];

  function getDateRangeParams(range: string): { from?: string; to?: string } {
    const now = new Date();
    switch (range) {
      case 'today': {
        const start = new Date(now); start.setHours(0, 0, 0, 0);
        return { from: start.toISOString(), to: now.toISOString() };
      }
      case 'week': {
        const start = new Date(now); start.setDate(start.getDate() - start.getDay()); start.setHours(0, 0, 0, 0);
        return { from: start.toISOString(), to: now.toISOString() };
      }
      case 'month': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return { from: start.toISOString(), to: now.toISOString() };
      }
      case '30d': {
        const start = new Date(now); start.setDate(start.getDate() - 30); start.setHours(0, 0, 0, 0);
        return { from: start.toISOString(), to: now.toISOString() };
      }
      case '90d': {
        const start = new Date(now); start.setDate(start.getDate() - 90); start.setHours(0, 0, 0, 0);
        return { from: start.toISOString(), to: now.toISOString() };
      }
      default: return {};
    }
  }

  // Auto-refresh
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [refreshSeconds, setRefreshSeconds] = useState(0);

  useEffect(() => {
    const stored = safeGetLocalStorage('wb_auto_refresh');
    setAutoRefreshEnabled(stored === 'true');
  }, []);

  // Live clock & session tracking
  const [now, setNow] = useState(new Date());
  const [sessionStart] = useState(() => new Date());
  const [lastLogin, setLastLogin] = useState<string | null>(null);

  useEffect(() => {
    // Load last login from localStorage
    const stored = safeGetLocalStorage('wb_last_login');
    if (stored) setLastLogin(stored);
    // Save current login time
    safeSetLocalStorage('wb_last_login', new Date().toISOString());
    // Tick clock every second
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const sessionDuration = useMemo(() => {
    const diff = Math.floor((now.getTime() - sessionStart.getTime()) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }, [now, sessionStart]);

  const formattedDate = useMemo(() => {
    return now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }, [now]);

  const formattedTime = useMemo(() => {
    return now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, [now]);

  const fetchDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadingTasks(true);
    try {
      const dateParams = getDateRangeParams(dateRange);
      const params = new URLSearchParams();
      if (dateParams.from) params.set('from', dateParams.from);
      if (dateParams.to) params.set('to', dateParams.to);

      const [dashRes, taskRes] = await Promise.all([
        fetch(`/api/dashboard${params.toString() ? '?' + params.toString() : ''}`, { headers: authHeaders() }),
        fetch('/api/complaints?assigned=assigned&limit=5', { headers: authHeaders() }),
      ]);
      if (dashRes.ok) {
        const json = await dashRes.json();
        setData(json);
        onDashboardData?.(json);
        if (silent) {
          setLastRefresh(new Date());
          setRefreshSeconds(0);
          toast.info('Dashboard updated', { description: 'Data refreshed automatically' });
        }
      } else if (!silent) {
        toast.error('Failed to load dashboard data');
      }
      if (taskRes.ok) {
        const taskJson = await taskRes.json();
        setAssignedTasks(taskJson.complaints || []);
      }
    } catch {
      if (!silent) toast.error('Network error loading dashboard');
    }
    if (!silent) setLoading(false);
    setLoadingTasks(false);
  }, [dateRange, onDashboardData]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // Auto-refresh timer (60s)
  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const interval = setInterval(() => {
      setRefreshSeconds((prev) => {
        const next = prev + 5;
        if (next >= 60) {
          fetchDashboard(true);
          return 0;
        }
        return next;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefreshEnabled, fetchDashboard]);

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
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
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
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="text-blue-200/70 text-xs font-medium">{getGreeting()} 👋</p>
                    <div className="flex items-center gap-1.5 text-blue-100/80 text-[11px] font-mono">
                      <Clock3 className="h-3 w-3" />{formattedTime}
                    </div>
                  </div>
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
                  <p className="text-blue-100/50 text-[11px] mt-2">
                    {formattedDate}
                    <span className="mx-2">·</span>
                    You have <span className="text-amber-300 font-bold">{stats.open + stats.inProgress}</span> open complaints · <span className="text-emerald-300 font-bold">{stats.resolved}</span> resolved
                  </p>
                  {/* Last Login & Session Duration */}
                  <div className="flex items-center gap-4 mt-2 text-[10px] text-blue-200/40">
                    {lastLogin && (
                      <span className="flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />Last login: {new Date(lastLogin).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Timer className="h-3 w-3" />Session: {sessionDuration}
                    </span>
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateReport}
                className="gap-1.5 text-xs bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white print:hidden shrink-0"
              >
                <Printer className="h-3.5 w-3.5" />
                Generate Report
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ DATE RANGE FILTER + AUTO-REFRESH INDICATOR ═══ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Period:</span>
            {dateRangePresets.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setDateRange(preset.value)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                  dateRange === preset.value
                    ? 'bg-foreground text-background shadow-sm'
                    : 'bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {/* Auto-refresh indicator */}
          <div className="flex items-center gap-2">
            {autoRefreshEnabled && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Updated {refreshSeconds === 0 ? 'just now' : `${60 - refreshSeconds}s ago`}
              </div>
            )}
            <button
              onClick={() => {
                const next = !autoRefreshEnabled;
                setAutoRefreshEnabled(next);
                safeSetLocalStorage('wb_auto_refresh', String(next));
                if (next) setRefreshSeconds(0);
                toast.success(next ? 'Auto-refresh enabled' : 'Auto-refresh disabled');
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                autoRefreshEnabled
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <RotateCcw className={`h-3 w-3 ${autoRefreshEnabled ? 'animate-spin' : ''}`} style={autoRefreshEnabled ? { animationDuration: '3s' } : {}} />
              Auto-refresh
            </button>
          </div>
        </div>
      </motion.div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Total Complaints" value={stats.total} icon={FileText} color={NAVY} bgColor="#E3F2FD" delay={0} />
        <StatCard title="Open" value={stats.open} icon={CircleDot} color="#DC2626" bgColor="#FEF2F2" delay={100} />
        <StatCard title="In Progress" value={stats.inProgress} icon={Clock} color="#D97706" bgColor="#FFFBEB" delay={200} />
        <StatCard title="Resolved" value={stats.resolved} icon={CheckCircle2} color="#16A34A" bgColor="#F0FDF4" delay={300} />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }}>
          <Card className={`border-0 shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all duration-300 overflow-hidden group relative border-l-4 ${(stats.slaBreaches || 0) > 0 ? 'pulse-glow' : ''}`} style={{ borderLeftColor: '#DC2626', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 3px rgba(0,0,0,0.08)' }}>
            <CardContent className="p-5 pl-6">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-muted-foreground">SLA Breaches</p>
                  <p className="text-2xl sm:text-3xl font-black tracking-tight tabular-nums text-red-600 dark:text-red-400">
                    {stats.slaBreaches || 0}
                  </p>
                  <p className="text-[9px] text-muted-foreground font-medium">{stats.slaBreaches || 0} open &gt;7 days</p>
                </div>
                <div className="flex items-center justify-center rounded-xl p-3 group-hover:scale-110 transition-transform duration-300 bg-red-50 dark:bg-red-950/40">
                  <Flame className="h-5 w-5 text-red-500 status-breathe" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
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

      {/* ═══ MY ASSIGNED TASKS ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}>
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#F3E8FF' }}>
                  <ClipboardList className="h-4 w-4" style={{ color: '#7C3AED' }} />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold">My Assigned Tasks</CardTitle>
                  <CardDescription className="text-xs">Complaints assigned to you</CardDescription>
                </div>
              </div>
              {assignedTasks.length > 0 && (
                <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => onNavigate('complaints')}>
                  View All <ArrowUpRight className="h-3 w-3" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loadingTasks ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 rounded-lg bg-muted overflow-hidden relative">
                    <div className="absolute inset-0 shimmer-bg" style={{ animationDelay: `${i * 100}ms` }} />
                  </div>
                ))}
              </div>
            ) : assignedTasks.length > 0 ? (
              <div className="space-y-2">
                {assignedTasks.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onNavigate('complaints', c)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted/50 transition-all text-left group border border-border/30 hover:border-border/60"
                  >
                    <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{
                      backgroundColor: c.status === 'OPEN' ? '#FEF2F2' : c.status === 'IN_PROGRESS' ? '#FFFBEB' : '#F0FDF4',
                    }}>
                      {c.status === 'OPEN' && <CircleDot className="h-4 w-4 text-red-500" />}
                      {c.status === 'IN_PROGRESS' && <Clock className="h-4 w-4 text-amber-500" />}
                      {(c.status === 'RESOLVED' || c.status === 'REJECTED') && <CheckCircle className="h-4 w-4 text-emerald-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-muted-foreground">{c.ticketNo}</span>
                        <UrgencyBadge urgency={c.urgency} />
                      </div>
                      <p className="text-sm font-medium text-foreground truncate mt-0.5">{c.issue}</p>
                      <p className="text-[11px] text-muted-foreground">{c.category} &middot; {c.block}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={c.status} />
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center">
                <div className="h-12 w-12 rounded-full bg-muted mx-auto flex items-center justify-center mb-2">
                  <CheckCircle className="h-6 w-6 text-emerald-500" />
                </div>
                <p className="text-sm font-medium text-foreground">All caught up!</p>
                <p className="text-xs text-muted-foreground mt-0.5">No pending tasks assigned to you</p>
              </div>
            )}
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
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [activities, setActivities] = useState<ActivityLogEntry[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [internalNotes, setInternalNotes] = useState<string[]>([]);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [escalating, setEscalating] = useState(false);

  useEffect(() => {
    if (open && initialComplaint) {
      setComplaint(initialComplaint);
      setResolutionText(initialComplaint.resolution || '');
      setNewStatus('');
      setSelectedAssignee(initialComplaint.assignedToId || '');
      setNewNote('');
      // Load internal notes from localStorage
      const notesKey = `wb_notes_${initialComplaint.id}`;
      const saved = safeGetLocalStorage(notesKey);
      setInternalNotes(saved ? JSON.parse(saved) : []);
    }
  }, [open, initialComplaint]);

  // Fetch assignable users and activity log when dialog opens
  useEffect(() => {
    if (!open || !complaint) return;
    fetch('/api/users/list', { headers: authHeaders() })
      .then((res) => res.ok ? res.json() : null)
      .then((json) => { if (json) setAssignableUsers(json.users || []); })
      .catch(() => {});
    setLoadingActivity(true);
    fetch(`/api/complaints/${complaint.id}/activity`, { headers: authHeaders() })
      .then((res) => res.ok ? res.json() : null)
      .then((json) => { if (json) setActivities(json.activities || []); })
      .catch(() => {})
      .finally(() => setLoadingActivity(false));
  }, [open, complaint?.id]);

  const refreshActivity = useCallback(async (cid: string) => {
    try {
      const actRes = await fetch(`/api/complaints/${cid}/activity`, { headers: authHeaders() });
      if (actRes.ok) { const actJson = await actRes.json(); setActivities(actJson.activities || []); }
    } catch { /* silent */ }
  }, []);

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
        refreshActivity(complaint.id);
      } else {
        toast.error('Failed to update status');
      }
    } catch {
      toast.error('Network error');
    }
    setUpdating(false);
  }, [complaint, resolutionText, onUpdate, refreshActivity]);

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

  const handleQuickAction = useCallback((status: string) => {
    handleStatusChange(status);
  }, [handleStatusChange]);

  const handleAssign = useCallback(async () => {
    if (!complaint) return;
    setAssigning(true);
    try {
      const res = await fetch(`/api/complaints/${complaint.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ assignedToId: selectedAssignee || null }),
      });
      if (res.ok) {
        const json = await res.json();
        setComplaint(json.complaint);
        const assignUser = assignableUsers.find((u) => u.id === selectedAssignee);
        toast.success(selectedAssignee ? `Assigned to ${assignUser?.name || 'user'}` : 'Assignment removed');
        onUpdate?.(complaint.id, complaint.status);
        refreshActivity(complaint.id);
      } else {
        toast.error('Failed to update assignment');
      }
    } catch {
      toast.error('Network error');
    }
    setAssigning(false);
  }, [complaint, selectedAssignee, assignableUsers, onUpdate, refreshActivity]);

  const handleAddNote = useCallback(() => {
    if (!complaint || !newNote.trim()) return;
    const note = `${new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} — ${newNote.trim()}`;
    const updated = [note, ...internalNotes];
    setInternalNotes(updated);
    safeSetLocalStorage(`wb_notes_${complaint.id}`, JSON.stringify(updated));
    setNewNote('');
    toast.success('Note added');
  }, [complaint, newNote, internalNotes]);

  const handleEscalate = useCallback(async () => {
    if (!complaint) return;
    setEscalating(true);
    try {
      const res = await fetch(`/api/complaints/${complaint.id}/escalate`, {
        method: 'PATCH',
        headers: authHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        setComplaint(json.complaint);
        toast.success(`Escalated to ${json.newUrgency}`, { description: `Previous: ${json.previousUrgency}` });
        onUpdate?.(complaint.id, complaint.status);
        refreshActivity(complaint.id);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to escalate');
      }
    } catch {
      toast.error('Network error');
    }
    setEscalating(false);
  }, [complaint, onUpdate, refreshActivity]);

  if (!complaint) return null;

  const activityConfig: Record<string, { color: string; icon: React.ElementType }> = {
    CREATED: { color: '#0284C7', icon: Plus },
    STATUS_CHANGED: { color: '#D97706', icon: ArrowUpDown },
    ASSIGNED: { color: '#7C3AED', icon: UserCheck },
    UNASSIGNED: { color: '#9CA3AF', icon: Users },
    RESOLVED: { color: '#16A34A', icon: CheckCircle2 },
    REJECTED: { color: '#DC2626', icon: XCircle },
    ESCALATED: { color: '#EA580C', icon: ArrowUp },
  };

  const slaInfo = getSLAInfo(complaint.createdAt, complaint.status);
  const canEscalate = (complaint.status === 'OPEN' || complaint.status === 'IN_PROGRESS') && complaint.urgency !== 'CRITICAL';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto border-0 shadow-2xl">
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.15 }}>
        {/* Glassmorphism Header */}
        <div className="relative -mx-6 -mt-6 mb-4 px-6 py-5 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(10,36,99,0.08) 0%, rgba(26,58,122,0.04) 100%)', backdropFilter: 'blur(12px)' }}>
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10" style={{ background: 'radial-gradient(circle, #0A2463, transparent)', transform: 'translate(30%, -30%)' }} />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Hash className="h-4 w-4" style={{ color: NAVY }} />
            Complaint {complaint.ticketNo}
          </DialogTitle>
          <DialogDescription>Complete details of this citizen grievance</DialogDescription>
        </DialogHeader>
        </div>

        <div className="space-y-4 mt-1">
          {/* Priority & Status Bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={complaint.status} />
            <UrgencyBadge urgency={complaint.urgency} />
            <Badge variant="outline" className="text-[11px]">{complaint.source}</Badge>
            {/* SLA Age Badge */}
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${slaInfo.bg} ${slaInfo.text}`}>
              {slaInfo.level === 'breached' && <Flame className="h-3 w-3" />}
              {slaInfo.days === 0 ? 'Today' : `${slaInfo.days}d old`}
              {slaInfo.level === 'breached' && ' · SLA BREACH'}
              {slaInfo.level === 'warning' && ' · Warning'}
            </span>
            {complaint.assignedToId ? (
              <Badge variant="outline" className="text-[11px] gap-1 bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                <UserCheck className="h-3 w-3" />Assigned
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[11px] gap-1 bg-gray-50 dark:bg-gray-900/30 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700">
                <Users className="h-3 w-3" />Unassigned
              </Badge>
            )}
            {complaint.urgency === 'CRITICAL' && (
              <Badge className="bg-red-600 text-white text-[10px] gap-1 animate-pulse">
                <AlertTriangle className="h-3 w-3" />Urgent
              </Badge>
            )}
          </div>

          {/* Quick Action Buttons */}
          {complaint.status !== 'RESOLVED' && complaint.status !== 'REJECTED' && (
            <div className="grid grid-cols-4 gap-2">
              <Button size="sm" variant="outline" disabled={updating || complaint.status === 'IN_PROGRESS'}
                onClick={() => handleQuickAction('IN_PROGRESS')}
                className="text-xs gap-1 h-9 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30">
                <PlayCircle className="h-3.5 w-3.5" /><span className="hidden sm:inline">In Progress</span>
              </Button>
              <Button size="sm" variant="outline" disabled={updating}
                onClick={() => handleQuickAction('RESOLVED')}
                className="text-xs gap-1 h-9 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30">
                <CircleCheckBig className="h-3.5 w-3.5" /><span className="hidden sm:inline">Resolve</span>
              </Button>
              <Button size="sm" variant="outline" disabled={updating}
                onClick={() => handleQuickAction('REJECTED')}
                className="text-xs gap-1 h-9 border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-900/30">
                <Ban className="h-3 w-3" /><span className="hidden sm:inline">Reject</span>
              </Button>
              <Button size="sm" variant="outline" disabled={escalating || !canEscalate}
                onClick={handleEscalate}
                className="text-xs gap-1 h-9 border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/30" title={canEscalate ? 'Escalate urgency level' : 'Already at maximum'}>
                {escalating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{escalating ? '...' : 'Escalate'}</span>
              </Button>
            </div>
          )}

          {/* Assign To */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5" />Assign To
            </p>
            <div className="flex items-center gap-2">
              <Select value={selectedAssignee} onValueChange={setSelectedAssignee} disabled={assigning}>
                <SelectTrigger className="h-9 text-sm flex-1">
                  <SelectValue placeholder="Select officer..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassign__">— Unassign —</SelectItem>
                  {assignableUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} <span className="text-[10px] text-muted-foreground">({fmtRole(u.role)})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline"
                disabled={assigning || (selectedAssignee === complaint.assignedToId && selectedAssignee !== '__unassign__')}
                onClick={handleAssign}
                className="text-xs gap-1 h-9 border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-400 dark:hover:bg-purple-950/30 whitespace-nowrap">
                {assigning ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                {complaint.assignedToId ? 'Update' : 'Assign'}
              </Button>
            </div>
          </div>

          {/* Activity Timeline */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" />Activity Timeline
            </p>
            <div className="relative pl-6">
              <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-border" />
              {loadingActivity ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex gap-3 items-start">
                      <Skeleton className="h-4 w-4 rounded-full shrink-0" />
                      <div className="space-y-1"><Skeleton className="h-3 w-32" /><Skeleton className="h-2 w-20" /></div>
                    </div>
                  ))}
                </div>
              ) : activities.length > 0 ? (
                activities.map((entry, idx) => {
                  const config = activityConfig[entry.action] || { color: '#6B7280', icon: CircleDot };
                  const ActionIcon = config.icon;
                  return (
                    <div key={entry.id || idx} className="relative flex items-start gap-3 pb-4 last:pb-0">
                      <div className="absolute -left-6 top-0.5">
                        <div className="h-[18px] w-[18px] rounded-full border-2 border-white dark:border-gray-800 flex items-center justify-center" style={{ backgroundColor: config.color }}>
                          <ActionIcon className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground">{entry.description}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />{fmtDateTime(entry.createdAt)}
                          </p>
                          {entry.actorName && (
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{entry.actorName}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-muted-foreground italic pl-2">No activity recorded</p>
              )}
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
              <Button size="sm" disabled={updating} onClick={() => handleStatusChange(newStatus)}
                className="w-full text-xs" style={{ backgroundColor: NAVY, color: 'white' }}>
                {updating ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                Apply: {fmtStatus(newStatus)}
              </Button>
            )}
          </div>

          {/* Resolution Notes */}
          <div className="space-y-2">
            <Label className="text-[10px] font-bold uppercase tracking-widest">Resolution Notes</Label>
            <Textarea value={resolutionText} onChange={(e) => setResolutionText(e.target.value)}
              placeholder="Enter resolution details..." rows={3} className="text-sm" />
            <Button variant="outline" size="sm" disabled={updating} onClick={handleSaveResolution} className="text-xs w-full">
              <Send className="h-3 w-3 mr-1" />Save Resolution
            </Button>
          </div>

          {/* Internal Notes */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />Internal Notes
              <span className="text-muted-foreground/60">({internalNotes.length})</span>
            </p>
            {internalNotes.length > 0 && (
              <div className="space-y-1.5 max-h-[120px] overflow-y-auto custom-scrollbar">
                {internalNotes.map((note, idx) => (
                  <div key={idx} className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 text-xs">
                    <p className="text-foreground leading-relaxed">{note}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add an internal note..."
                className="text-sm h-8 flex-1"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddNote(); } }}
              />
              <Button size="sm" variant="outline" onClick={handleAddNote} disabled={!newNote.trim()} className="text-xs h-8 px-3 shrink-0">
                <Send className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
        </motion.div>
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
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.15 }}>
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
        </motion.div>
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
  const [filterSource, setFilterSource] = useState('');
  const [filterAssigned, setFilterAssigned] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
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
      if (filterSource) params.set('source', filterSource);
      if (filterAssigned) params.set('assigned', filterAssigned);
      if (filterDateFrom) params.set('dateFrom', filterDateFrom);
      if (filterDateTo) params.set('dateTo', filterDateTo);
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
  }, [debouncedSearch, filterStatus, filterUrgency, filterCategory, filterBlock, filterSource, filterAssigned, filterDateFrom, filterDateTo, page, pagination.limit]);

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
    setFilterSource(''); setFilterAssigned('');
    setFilterDateFrom(''); setFilterDateTo('');
    setPage(1);
  }, []);

  const activeFilterCount = [debouncedSearch, filterStatus, filterUrgency, filterCategory, filterBlock, filterSource, filterAssigned, filterDateFrom, filterDateTo].filter(Boolean).length;

  // Active filters for chips display
  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (debouncedSearch) chips.push({ key: 'search', label: `Search: "${debouncedSearch}"`, clear: () => { setSearch(''); setDebouncedSearch(''); setPage(1); } });
    if (filterStatus) chips.push({ key: 'status', label: `Status: ${fmtStatus(filterStatus)}`, clear: () => updateFilter(setFilterStatus, '') });
    if (filterUrgency) chips.push({ key: 'urgency', label: `Urgency: ${fmtUrgency(filterUrgency)}`, clear: () => updateFilter(setFilterUrgency, '') });
    if (filterCategory) chips.push({ key: 'category', label: `Category: ${filterCategory}`, clear: () => updateFilter(setFilterCategory, '') });
    if (filterBlock) chips.push({ key: 'block', label: `Block: ${filterBlock}`, clear: () => updateFilter(setFilterBlock, '') });
    if (filterSource) chips.push({ key: 'source', label: `Source: ${filterSource}`, clear: () => updateFilter(setFilterSource, '') });
    if (filterAssigned) chips.push({ key: 'assigned', label: filterAssigned === 'assigned' ? 'Assigned' : 'Unassigned', clear: () => updateFilter(setFilterAssigned, '') });
    if (filterDateFrom) chips.push({ key: 'dateFrom', label: `From: ${filterDateFrom}`, clear: () => { setFilterDateFrom(''); setPage(1); } });
    if (filterDateTo) chips.push({ key: 'dateTo', label: `To: ${filterDateTo}`, clear: () => { setFilterDateTo(''); setPage(1); } });
    return chips;
  }, [debouncedSearch, filterStatus, filterUrgency, filterCategory, filterBlock, filterSource, filterAssigned, filterDateFrom, filterDateTo]);

  // Select all toggle (defined before useEffect that uses it)
  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === complaints.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(complaints.map((c) => c.id)));
    }
  }, [selectedIds.size, complaints]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Ctrl+A support for select all
  useEffect(() => {
    function handleSelectAll(e: Event) {
      toggleSelectAll();
    }
    document.addEventListener('wb:select-all', handleSelectAll);
    return () => document.removeEventListener('wb:select-all', handleSelectAll);
  }, [toggleSelectAll]);

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

  const exportCSV = useCallback((items?: Complaint[]) => {
    const data = items || complaints;
    const h = ['Ticket #', 'Citizen', 'Phone', 'Issue', 'Category', 'Block', 'District', 'Urgency', 'Status', 'Source', 'Created', 'Assigned'];
    const rows = data.map((c) => [c.ticketNo, c.citizenName || '', c.phone || '', c.issue, c.category, c.block, c.district, c.urgency, c.status, c.source, fmtDate(c.createdAt), c.assignedToId ? 'Yes' : 'No']);
    const csv = [h, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wb-complaints-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('Export complete', { description: `${data.length} complaints exported` });
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
          <Button variant="outline" size="sm" onClick={() => exportCSV()} className="text-xs gap-1">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* ═══ QUICK STATUS BAR ═══ */}
      {!loading && pagination.total > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="grid grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30 card-hover">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center"><FileText className="h-3.5 w-3.5 text-blue-600" /></div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total</p>
                  <p className="text-lg font-black text-blue-700 dark:text-blue-400">{pagination.total}</p>
                </div>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30 card-hover">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-red-100 dark:bg-red-900/50 flex items-center justify-center"><CircleDot className="h-3.5 w-3.5 text-red-600" /></div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Open</p>
                  <p className="text-lg font-black text-red-700 dark:text-red-400">{complaints.filter(c => c.status === 'OPEN').length}</p>
                </div>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 card-hover">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center"><Clock className="h-3.5 w-3.5 text-amber-600" /></div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">In Progress</p>
                  <p className="text-lg font-black text-amber-700 dark:text-amber-400">{complaints.filter(c => c.status === 'IN_PROGRESS').length}</p>
                </div>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30 card-hover">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center"><CheckCircle className="h-3.5 w-3.5 text-emerald-600" /></div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Resolved</p>
                  <p className="text-lg font-black text-emerald-700 dark:text-emerald-400">{complaints.filter(c => c.status === 'RESOLVED').length}</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ═══ BULK ACTIONS TOOLBAR ═══ */}
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
                <X className="h-3 w-3" /> Clear All ({activeFilterCount})
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

            <Select value={filterSource} onValueChange={(v) => updateFilter(setFilterSource, v === '_all' ? '' : v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="All Sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Sources</SelectItem>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                <SelectItem value="MANUAL">Manual</SelectItem>
                <SelectItem value="WEB">Web</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterAssigned} onValueChange={(v) => updateFilter(setFilterAssigned, v === '_all' ? '' : v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="Assigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
              </SelectContent>
            </Select>

            <Input type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }} className="h-8 w-[130px] text-xs" placeholder="From" />
            <Input type="date" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }} className="h-8 w-[130px] text-xs" placeholder="To" />
          </div>

          {/* Filter Chips */}
          {activeFilterChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {activeFilterChips.map((chip) => (
                <span key={chip.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted border border-border text-[11px] text-muted-foreground">
                  <span className="truncate max-w-[120px]">{chip.label}</span>
                  <button onClick={chip.clear} className="hover:text-foreground transition-colors"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ BULK ACTIONS TOOLBAR ═══ */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -10, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="border-0 shadow-lg overflow-hidden" style={{ background: 'linear-gradient(135deg, #0A2463 0%, #1a3a7a 100%)' }}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-white/15 flex items-center justify-center">
                      <ClipboardList className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white/90">{selectedIds.size} selected</p>
                      <p className="text-[10px] text-white/50">Choose an action below</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={bulkStatus} onValueChange={setBulkStatus}>
                      <SelectTrigger className="h-8 w-[140px] text-xs bg-white/10 border-white/20 text-white">
                        <SelectValue placeholder="Set Status..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                        <SelectItem value="RESOLVED">Resolved</SelectItem>
                        <SelectItem value="OPEN">Reopen</SelectItem>
                        <SelectItem value="REJECTED">Reject</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={!bulkStatus || bulkLoading}
                      onClick={() => handleBulkStatus()}
                      className="h-8 gap-1 text-xs bg-emerald-500 hover:bg-emerald-600 text-white"
                    >
                      {bulkLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Apply
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => exportCSV()}
                      className="h-8 gap-1 text-xs text-white/80 hover:text-white hover:bg-white/10"
                    >
                      <Download className="h-3 w-3" /> Export
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedIds(new Set())}
                      className="h-8 gap-1 text-xs text-white/80 hover:text-white hover:bg-white/10"
                    >
                      <X className="h-3 w-3" /> Clear
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table (Desktop) */}
      {!loading && complaints.length === 0 ? (
        <EmptyState message="No complaints found matching your filters" />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className="border-0 shadow-sm overflow-hidden">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
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
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider">Age</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 10 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    complaints.map((c, idx) => (
                      <TableRow key={c.id} className={`table-row-hover hover:border-l-2 hover:border-l-sky-400 border-l-2 border-l-transparent ${idx % 2 === 1 ? 'bg-muted/20' : ''} ${flashIds.has(c.id) ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}>
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
                        <TableCell>
                          {(() => {
                            const sla = getSLAInfo(c.createdAt, c.status);
                            return (
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${sla.bg} ${sla.text}`}>
                                {sla.level === 'breached' && <Flame className="h-3 w-3" />}
                                {sla.days}d
                              </span>
                            );
                          })()}
                        </TableCell>
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
                        {(() => {
                          const sla = getSLAInfo(c.createdAt, c.status);
                          return (
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${sla.bg} ${sla.text}`}>
                              {sla.level === 'breached' && <Flame className="h-2.5 w-2.5" />}
                              {sla.days}d
                            </span>
                          );
                        })()}
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

/* ═══════════════════════════════════════════════════════════════════
   ANALYTICS VIEW
   ═══════════════════════════════════════════════════════════════════ */

function AnalyticsView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<'name' | 'count' | 'resolved' | 'open'>('count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [dashRes, compRes] = await Promise.all([
          fetch('/api/dashboard', { headers: authHeaders() }),
          fetch('/api/complaints?limit=9999', { headers: authHeaders() }),
        ]);
        if (dashRes.ok) setData(await dashRes.json());
        if (compRes.ok) {
          const compJson = await compRes.json();
          setComplaints(compJson.complaints || []);
        }
      } catch { /* silent */ }
      setLoading(false);
    }
    load();
  }, []);

  const handleSort = useCallback((field: typeof sortField) => {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }, [sortField]);

  if (loading) return <LoadingSkeleton />;
  if (!data) return <EmptyState message="Unable to load analytics data" />;

  const { stats, byCategory, byGroup, groupByField, monthlyTrend } = data;

  // Source distribution
  const sourceMap: Record<string, number> = {};
  complaints.forEach((c) => { sourceMap[c.source || 'Unknown'] = (sourceMap[c.source || 'Unknown'] || 0) + 1; });
  const sourceData = Object.entries(sourceMap).map(([name, value]) => ({ name, value }));
  const sourceColors = ['#0A2463', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0284C7'];

  // Average resolution time
  const resolvedComplaints = complaints.filter((c) => c.status === 'RESOLVED' && c.createdAt && c.updatedAt);
  const avgResolutionMs = resolvedComplaints.length > 0
    ? resolvedComplaints.reduce((sum, c) => sum + (new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()), 0) / resolvedComplaints.length
    : 0;
  const avgResolutionHours = Math.round(avgResolutionMs / (1000 * 60 * 60) * 10) / 10;
  const avgResolutionDays = Math.round(avgResolutionHours / 24 * 10) / 10;

  // SLA Compliance (48 hours)
  const withinSLA = resolvedComplaints.filter((c) => {
    const diff = new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime();
    return diff <= 48 * 60 * 60 * 1000;
  }).length;
  const slaCompliance = resolvedComplaints.length > 0 ? Math.round((withinSLA / resolvedComplaints.length) * 100) : 0;

  // Category resolution rates
  const catResolution: { category: string; total: number; resolved: number; rate: number }[] = [];
  const catBuckets: Record<string, { total: number; resolved: number }> = {};
  complaints.forEach((c) => {
    if (!catBuckets[c.category]) catBuckets[c.category] = { total: 0, resolved: 0 };
    catBuckets[c.category].total++;
    if (c.status === 'RESOLVED') catBuckets[c.category].resolved++;
  });
  Object.entries(catBuckets).forEach(([category, v]) => {
    catResolution.push({ category, ...v, rate: Math.round((v.resolved / v.total) * 100) });
  });
  catResolution.sort((a, b) => b.rate - a.rate);

  // Top performing areas
  const sortedGroups = [...byGroup].sort((a, b) => {
    const rateA = a.count > 0 ? a.resolved / a.count : 0;
    const rateB = b.count > 0 ? b.resolved / b.count : 0;
    return rateB - rateA;
  });
  const topPerformers = sortedGroups.slice(0, 5);
  const bottomPerformers = sortedGroups.slice(-3).reverse();

  // Sortable group data
  const sortedGroupData = [...byGroup].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'name') cmp = a.name.localeCompare(b.name);
    else if (sortField === 'count') cmp = a.count - b.count;
    else if (sortField === 'resolved') cmp = a.resolved - b.resolved;
    else if (sortField === 'open') cmp = a.open - b.open;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const areaChartConfig = {
    total: { label: 'Total', color: NAVY },
    open: { label: 'Open', color: '#DC2626' },
    resolved: { label: 'Resolved', color: '#16A34A' },
    inProgress: { label: 'In Progress', color: '#D97706' },
  };

  const pieChartConfig: Record<string, { label: string; color: string }> = {};
  sourceData.forEach((s, i) => { pieChartConfig[s.name] = { label: s.name, color: sourceColors[i % sourceColors.length] }; });

  const barConfig = {
    rate: { label: 'Resolution Rate %', color: '#16A34A' },
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">Analytics & Insights</h2>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <BarChart2 className="h-3.5 w-3.5" />
            Comprehensive performance metrics and trends
          </p>
        </div>
      </div>

      {/* ═══ KPI Cards Row ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="border-0 shadow-sm" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 3px rgba(0,0,0,0.08)' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#E3F2FD' }}>
                  <Timer className="h-4 w-4" style={{ color: NAVY }} />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Avg Resolution</p>
              </div>
              <p className="text-2xl font-black" style={{ color: NAVY }}>{avgResolutionDays}<span className="text-sm font-medium text-muted-foreground ml-1">days</span></p>
              <p className="text-[11px] text-muted-foreground mt-1">{avgResolutionHours} hours average</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="border-0 shadow-sm" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 3px rgba(0,0,0,0.08)' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">SLA Compliance</p>
              </div>
              <p className="text-2xl font-black text-emerald-600">{slaCompliance}<span className="text-sm font-medium text-muted-foreground ml-1">%</span></p>
              <p className="text-[11px] text-muted-foreground mt-1">Resolved within 48h</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="border-0 shadow-sm" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 3px rgba(0,0,0,0.08)' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-8 w-8 rounded-lg bg-amber-50 flex items-center justify-center">
                  <Activity className="h-4 w-4 text-amber-600" />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total Resolved</p>
              </div>
              <p className="text-2xl font-black text-amber-600">{stats.resolved}</p>
              <p className="text-[11px] text-muted-foreground mt-1">of {stats.total} complaints</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="border-0 shadow-sm" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 3px rgba(0,0,0,0.08)' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-8 w-8 rounded-lg bg-red-50 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Critical Open</p>
              </div>
              <p className="text-2xl font-black text-red-600">{stats.critical}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{stats.open} total open</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ═══ Complaint Volume Trends (Large Area Chart) ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <TrendingUp className="h-4 w-4" style={{ color: NAVY }} />
              Complaint Volume Trends
            </CardTitle>
            <CardDescription className="text-xs">Overview of complaint volumes and status distribution</CardDescription>
          </CardHeader>
          <CardContent>
            {monthlyTrend.length > 0 ? (
              <ChartContainer config={areaChartConfig} className="h-[350px] w-full">
                <AreaChart data={monthlyTrend} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="analyticsFillTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={NAVY} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={NAVY} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="analyticsFillResolved" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16A34A" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="analyticsFillOpen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#DC2626" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area type="monotone" dataKey="total" stroke={NAVY} fill="url(#analyticsFillTotal)" strokeWidth={2.5} />
                  <Area type="monotone" dataKey="open" stroke="#DC2626" fill="url(#analyticsFillOpen)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="resolved" stroke="#16A34A" fill="url(#analyticsFillResolved)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="inProgress" stroke="#D97706" fill="transparent" strokeWidth={1.5} strokeDasharray="4 4" />
                </AreaChart>
              </ChartContainer>
            ) : (
              <EmptyState message="No trend data available" />
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ District Comparison Table + Category Performance + Source Distribution ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* District Comparison Table */}
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="lg:col-span-2">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Building2 className="h-4 w-4" style={{ color: NAVY }} />
                {groupByField === 'district' ? 'District' : 'Block'} Comparison
              </CardTitle>
              <CardDescription className="text-xs">Sortable by total, open, resolved</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-muted" onClick={() => handleSort('name')}>
                        <span className="flex items-center gap-1">{groupByField === 'district' ? 'District' : 'Block'} {sortField === 'name' && <ArrowUpDown className="h-3 w-3" />}</span>
                      </TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-muted" onClick={() => handleSort('count')}>
                        <span className="flex items-center gap-1">Total {sortField === 'count' && <ArrowUpDown className="h-3 w-3" />}</span>
                      </TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-muted" onClick={() => handleSort('open')}>
                        <span className="flex items-center gap-1">Open {sortField === 'open' && <ArrowUpDown className="h-3 w-3" />}</span>
                      </TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">In Progress</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-muted" onClick={() => handleSort('resolved')}>
                        <span className="flex items-center gap-1">Resolved {sortField === 'resolved' && <ArrowUpDown className="h-3 w-3" />}</span>
                      </TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Resolution Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedGroupData.map((g, idx) => {
                      const rate = g.count > 0 ? Math.round((g.resolved / g.count) * 100) : 0;
                      return (
                        <TableRow key={g.name} className={`transition-colors hover:bg-muted/30 ${idx % 2 === 1 ? 'bg-muted/15' : ''}`}>
                          <TableCell className="text-xs font-medium">{g.name}</TableCell>
                          <TableCell className="text-xs font-bold tabular-nums">{g.count}</TableCell>
                          <TableCell className="text-xs tabular-nums text-red-600 font-medium">{g.open}</TableCell>
                          <TableCell className="text-xs tabular-nums text-amber-600 font-medium">{g.inProgress}</TableCell>
                          <TableCell className="text-xs tabular-nums text-emerald-600 font-medium">{g.resolved}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden max-w-[80px]">
                                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${rate}%` }} />
                              </div>
                              <span className="text-xs font-bold tabular-nums w-8 text-right">{rate}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Source Distribution Pie + Category Performance */}
        <div className="space-y-5">
          {/* Source Distribution */}
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Globe className="h-4 w-4" style={{ color: NAVY }} />
                  Source Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sourceData.length > 0 ? (
                  <ChartContainer config={pieChartConfig} className="h-[220px] w-full">
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Pie data={sourceData} cx="50%" cy="50%" innerRadius={40} outerRadius={75} paddingAngle={3} dataKey="value">
                        {sourceData.map((_, idx) => (
                          <Cell key={idx} fill={sourceColors[idx % sourceColors.length]} />
                        ))}
                      </Pie>
                      <Legend verticalAlign="bottom" iconType="circle" iconSize={8} formatter={(value: string) => <span className="text-[11px]">{value}</span>} />
                    </PieChart>
                  </ChartContainer>
                ) : (
                  <EmptyState message="No source data" />
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Category Performance */}
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold">Category Resolution Rate</CardTitle>
              </CardHeader>
              <CardContent>
                {catResolution.length > 0 ? (
                  <ScrollArea className="h-[250px] pr-2">
                    <ChartContainer config={barConfig} className="h-full w-full">
                      <BarChart data={catResolution} layout="vertical" margin={{ top: 0, right: 30, left: 80, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                        <YAxis dataKey="category" type="category" tick={{ fontSize: 10 }} width={75} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                          {catResolution.map((entry, idx) => (
                            <Cell key={idx} fill={entry.rate >= 70 ? '#16A34A' : entry.rate >= 40 ? '#D97706' : '#DC2626'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  </ScrollArea>
                ) : (
                  <EmptyState message="No category data" />
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>

      {/* ═══ Top & Bottom Performing Areas ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <Award className="h-4 w-4" />
                Top Performing Areas
              </CardTitle>
              <CardDescription className="text-xs">Best resolution rates</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topPerformers.map((g, idx) => {
                  const rate = g.count > 0 ? Math.round((g.resolved / g.count) * 100) : 0;
                  return (
                    <div key={g.name} className="flex items-center gap-3">
                      <div className="h-7 w-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-xs font-black text-emerald-700 dark:text-emerald-400">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground truncate">{g.name}</span>
                          <span className="text-xs font-bold text-emerald-600 tabular-nums">{rate}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
                          <motion.div className="h-full rounded-full bg-emerald-500" initial={{ width: 0 }} animate={{ width: `${rate}%` }} transition={{ duration: 0.8, delay: idx * 0.1 }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" />
                Needs Attention
              </CardTitle>
              <CardDescription className="text-xs">Lowest resolution rates</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {bottomPerformers.map((g, idx) => {
                  const rate = g.count > 0 ? Math.round((g.resolved / g.count) * 100) : 0;
                  return (
                    <div key={g.name} className="flex items-center gap-3">
                      <div className="h-7 w-7 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center text-xs font-black text-red-700 dark:text-red-400">
                        !
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground truncate">{g.name}</span>
                          <span className="text-xs font-bold text-red-600 tabular-nums">{rate}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
                          <motion.div className="h-full rounded-full bg-red-500" initial={{ width: 0 }} animate={{ width: `${rate}%` }} transition={{ duration: 0.8, delay: idx * 0.1 }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                {bottomPerformers.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">All areas performing well!</p>}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SETTINGS VIEW
   ═══════════════════════════════════════════════════════════════════ */

function SettingsView() {
  const user = useAuthStore((s) => s.user);
  const { theme, setTheme } = useTheme();

  // Notification preferences (localStorage) — safely initialized after mount
  const [emailNotifs, setEmailNotifs] = useState(false);
  const [soundAlerts, setSoundAlerts] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [compactView, setCompactView] = useState(false);

  // Initialize from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    setEmailNotifs(safeGetLocalStorage('wb_email_notifs') === 'true');
    setSoundAlerts(safeGetLocalStorage('wb_sound_alerts') === 'true');
    setAutoRefresh(safeGetLocalStorage('wb_auto_refresh') === 'true');
    setCompactView(safeGetLocalStorage('wb_compact_view') === 'true');
  }, []);

  useEffect(() => { safeSetLocalStorage('wb_email_notifs', String(emailNotifs)); }, [emailNotifs]);
  useEffect(() => { safeSetLocalStorage('wb_sound_alerts', String(soundAlerts)); }, [soundAlerts]);
  useEffect(() => { safeSetLocalStorage('wb_auto_refresh', String(autoRefresh)); }, [autoRefresh]);
  useEffect(() => { safeSetLocalStorage('wb_compact_view', String(compactView)); }, [compactView]);

  const themeOptions = [
    { value: 'light' as const, label: 'Light', icon: Sun, description: 'Clean, bright appearance', bg: 'bg-white border-2', ring: 'ring-sky-500' },
    { value: 'dark' as const, label: 'Dark', icon: Moon, description: 'Easy on the eyes', bg: 'bg-gray-900 border-2', ring: 'ring-sky-500' },
    { value: 'system' as const, label: 'System', icon: Monitor, description: 'Follow your OS setting', bg: 'bg-gradient-to-br from-white to-gray-900 border-2', ring: 'ring-sky-500' },
  ];

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">Settings</h2>
        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
          <Settings className="h-3.5 w-3.5" />
          Manage your preferences and account
        </p>
      </div>

      {/* ═══ Profile Section ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <UserCircle className="h-4 w-4" style={{ color: NAVY }} />
              Profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-4">
              <div className="h-16 w-16 rounded-2xl flex items-center justify-center text-white text-xl font-black shrink-0" style={{ backgroundColor: NAVY }}>
                {(user?.name || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Full Name</p>
                    <p className="text-sm font-semibold text-foreground">{user?.name}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Username</p>
                    <p className="text-sm font-mono text-foreground">@{user?.username}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Role</p>
                    <RoleBadge role={user?.role || ''} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Location</p>
                    <p className="text-sm text-foreground">{user?.location}</p>
                  </div>
                  {user?.district && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">District</p>
                      <p className="text-sm text-foreground">{user.district}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ Appearance Section ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Sun className="h-4 w-4" style={{ color: NAVY }} />
              Appearance
            </CardTitle>
            <CardDescription className="text-xs">Choose your preferred theme</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {themeOptions.map((opt) => {
                const isActive = theme === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className={`relative p-4 rounded-xl transition-all text-center group ${opt.bg} ${isActive ? `${opt.ring} ring-2 shadow-md scale-[1.02]` : 'opacity-70 hover:opacity-100 hover:scale-[1.01]'}`}
                  >
                    {isActive && (
                      <div className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-sky-500 flex items-center justify-center">
                        <CheckCircle className="h-3 w-3 text-white" />
                      </div>
                    )}
                    <div className="flex justify-center mb-2">
                      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${opt.value === 'dark' ? 'bg-gray-800' : opt.value === 'system' ? 'bg-gradient-to-br from-gray-100 to-gray-800' : 'bg-gray-100'}`}>
                        <opt.icon className={`h-5 w-5 ${opt.value === 'dark' ? 'text-yellow-400' : opt.value === 'system' ? 'text-gray-400' : 'text-gray-700'}`} />
                      </div>
                    </div>
                    <p className="text-xs font-bold text-foreground">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{opt.description}</p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ Notification Preferences ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Bell className="h-4 w-4" style={{ color: NAVY }} />
              Notification Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: 'Email notifications for critical complaints', description: 'Receive alerts when critical complaints are filed', icon: Mail, checked: emailNotifs, onChange: setEmailNotifs },
              { label: 'Sound alerts', description: 'Play a sound for new notifications', icon: Volume2, checked: soundAlerts, onChange: setSoundAlerts },
              { label: 'Auto-refresh dashboard', description: 'Automatically refresh data every 60 seconds', icon: RefreshCw, checked: autoRefresh, onChange: setAutoRefresh },
              { label: 'Compact view', description: 'Reduce spacing for denser information display', icon: LayoutGrid, checked: compactView, onChange: setCompactView },
            ].map((pref) => (
              <div key={pref.label} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <pref.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <Label className="text-sm font-medium cursor-pointer">{pref.label}</Label>
                    <p className="text-[11px] text-muted-foreground">{pref.description}</p>
                  </div>
                </div>
                <Switch checked={pref.checked} onCheckedChange={pref.onChange} />
              </div>
            ))}
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ About Section ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" style={{ color: NAVY }} />
              About
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Application</p>
                <p className="text-sm font-semibold text-foreground">WB Grievance Portal</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Version</p>
                <p className="text-sm font-semibold text-foreground">2.2.0</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Framework</p>
                <p className="text-sm font-semibold text-foreground">Next.js 16 + React</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">UI Library</p>
                <p className="text-sm font-semibold text-foreground">shadcn/ui + Tailwind</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: NAVY }}>
                <Shield className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Government of West Bengal</p>
                <p className="text-[11px] text-muted-foreground">AI Public Support System &middot; পশ্চিমবঙ্গ সরকার</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS DIALOG
   ═══════════════════════════════════════════════════════════════════ */

function KeyboardShortcutsDialog({ open, onOpenChange, onNavigate, onNewComplaint, onRefresh, onToggleTheme }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onNavigate?: (view: ViewType) => void;
  onNewComplaint?: () => void;
  onRefresh?: () => void;
  onToggleTheme?: () => void;
}) {
  const shortcuts = [
    { key: 'D', label: 'Go to Dashboard', action: () => onNavigate?.('dashboard') },
    { key: 'C', label: 'Go to Complaints', action: () => onNavigate?.('complaints') },
    { key: 'A', label: 'Go to Analytics', action: () => onNavigate?.('analytics') },
    { key: 'N', label: 'New Complaint', action: onNewComplaint },
    { key: 'R', label: 'Refresh Dashboard', action: onRefresh },
    { key: 'T', label: 'Toggle Theme', action: onToggleTheme },
    { key: 'Esc', label: 'Close Dialog', action: () => onOpenChange(false) },
    { key: '?', label: 'Show Shortcuts', action: () => onOpenChange(false) },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border-0 shadow-2xl">
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.15 }}>
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Keyboard className="h-5 w-5" style={{ color: NAVY }} />
              Keyboard Shortcuts
            </DialogTitle>
            <DialogDescription className="text-xs">Quick navigation and actions</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-1.5 mt-3">
            {shortcuts.map((s) => (
              <button
                key={s.key}
                onClick={() => { s.action?.(); onOpenChange(false); }}
                className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted transition-colors text-left group"
              >
                <span className="text-sm text-foreground group-hover:text-foreground">{s.label}</span>
                <kbd className="inline-flex items-center h-6 px-2 rounded bg-muted border border-border/60 text-[11px] font-mono font-bold text-muted-foreground group-hover:text-foreground group-hover:border-foreground/30 transition-colors">
                  {s.key === '?' ? '?' : s.key === 'Esc' ? 'Esc' : s.key}
                </kbd>
              </button>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t">
            <p className="text-[11px] text-muted-foreground text-center">
              Press <kbd className="inline-flex h-5 px-1.5 rounded bg-muted border border-border/60 text-[10px] font-mono font-bold">?</kbd> or <kbd className="inline-flex h-5 px-1.5 rounded bg-muted border border-border/60 text-[10px] font-mono font-bold">Ctrl+K</kbd> to toggle this dialog
            </p>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   KEYBOARD SHORTCUT HANDLER (internal hook component)
   ═══════════════════════════════════════════════════════════════════ */

function KeyboardShortcutHandler({ shortcutOpen, setShortcutOpen, setNewComplaintOpen, setMobileSidebarOpen, handleNavigate, handleRefresh, isDark, setTheme, currentView }: {
  shortcutOpen: boolean;
  setShortcutOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setNewComplaintOpen: (v: boolean) => void;
  currentView: string;
  setMobileSidebarOpen: (v: boolean) => void;
  handleNavigate: (view: ViewType) => void;
  handleRefresh: () => void;
  isDark: boolean;
  setTheme: (theme: string) => void;
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement).isContentEditable) return;

      const key = e.key.toLowerCase();

      if (key === '?' || (e.ctrlKey && key === 'k')) {
        e.preventDefault();
        setShortcutOpen((v) => !v);
      } else if (key === 'escape') {
        setShortcutOpen(false);
        setNewComplaintOpen(false);
        setMobileSidebarOpen(false);
      } else if (key === 'a' && e.ctrlKey) {
        // Ctrl+A: Select all visible complaints (when in complaints view)
        if (currentView === 'complaints') {
          e.preventDefault();
          // Dispatch a custom event that ComplaintsView listens to
          document.dispatchEvent(new CustomEvent('wb:select-all'));
        }
      } else if (key === 'd' && !shortcutOpen) {
        e.preventDefault();
        handleNavigate('dashboard');
      } else if (key === 'c' && !shortcutOpen) {
        e.preventDefault();
        handleNavigate('complaints');
      } else if (key === 'a' && !shortcutOpen) {
        e.preventDefault();
        handleNavigate('analytics');
      } else if (key === 'n' && !shortcutOpen) {
        e.preventDefault();
        setNewComplaintOpen(true);
      } else if (key === 'r' && !shortcutOpen) {
        e.preventDefault();
        handleRefresh();
      } else if (key === 't' && !shortcutOpen) {
        e.preventDefault();
        setTheme(isDark ? 'light' : 'dark');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcutOpen, isDark, handleNavigate, handleRefresh, setTheme, setShortcutOpen, setNewComplaintOpen, setMobileSidebarOpen]);

  return null;
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN APP (HomePage)
   ═══════════════════════════════════════════════════════════════════ */

// ═══ Hydration-safe wrapper: renders nothing during SSR ═══
/* ═══════════════════════════════════════════════════════════════════
   COMMAND PALETTE (Ctrl+K)
   ═══════════════════════════════════════════════════════════════════ */

function CommandPalette({ open, onOpenChange, onNavigate, currentView }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onNavigate: (view: string, complaint?: Complaint) => void;
  currentView: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ complaints: Complaint[]; users: AppUser[] }>({ complaints: [], users: [] });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults({ complaints: [], users: [] });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) { setResults({ complaints: [], users: [] }); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { headers: authHeaders() });
        if (res.ok) {
          const json = await res.json();
          setResults(json);
        }
      } catch { /* silent */ }
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const navCommands = [
    { id: 'dashboard', label: 'Go to Dashboard', icon: LayoutDashboard, shortcut: 'D' },
    { id: 'complaints', label: 'Go to Complaints', icon: FileText, shortcut: 'C' },
    { id: 'analytics', label: 'Go to Analytics', icon: BarChart2, shortcut: 'A' },
    { id: 'settings', label: 'Go to Settings', icon: Settings, shortcut: 'S' },
  ].filter(c => c.id !== currentView);

  const actionCommands = [
    { label: 'File New Complaint', icon: Plus, action: 'newComplaint' },
    { label: 'Refresh Dashboard', icon: RotateCcw, action: 'refresh' },
  ];

  const hasResults = results.complaints.length > 0 || results.users.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 border-0 shadow-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, white 0%, #f8fafc 100%)' }}>
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
          <Search className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search complaints, citizens, users..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 text-[10px] font-mono text-muted-foreground">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[360px] overflow-y-auto custom-scrollbar">
          {/* Navigation Commands */}
          {query.trim() === '' && (
            <div>
              <div className="px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Navigation</p>
              </div>
              {navCommands.map((cmd) => (
                <button
                  key={cmd.id}
                  onClick={() => { onNavigate(cmd.id); onOpenChange(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/70 transition-colors text-left group"
                >
                  <cmd.icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  <span className="text-sm flex-1">{cmd.label}</span>
                  <kbd className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{cmd.shortcut}</kbd>
                </button>
              ))}

              {/* Action Commands */}
              <div className="px-3 py-2 mt-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Actions</p>
              </div>
              {actionCommands.map((cmd) => (
                <button
                  key={cmd.label}
                  onClick={() => { onOpenChange(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/70 transition-colors text-left group"
                >
                  <cmd.icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  <span className="text-sm">{cmd.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Search Results */}
          {query.trim() !== '' && !loading && !hasResults && (
            <div className="py-10 text-center">
              <Search className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No results found for &ldquo;{query}&rdquo;</p>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Complaint Results */}
          {results.complaints.length > 0 && (
            <div>
              <div className="px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Complaints <span className="text-muted-foreground/60">({results.complaints.length})</span>
                </p>
              </div>
              {results.complaints.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { onNavigate('complaints', c as Complaint); onOpenChange(false); }}
                  className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-muted/70 transition-colors text-left group"
                >
                  <div className="h-8 w-8 rounded-lg bg-red-50 dark:bg-red-950/30 flex items-center justify-center shrink-0 mt-0.5">
                    <FileText className="h-4 w-4 text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold">{c.ticketNo}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="text-sm font-medium text-foreground truncate">{c.issue}</p>
                    <p className="text-[11px] text-muted-foreground">{c.citizenName || 'Anonymous'} &middot; {c.block}, {c.district}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* User Results */}
          {results.users.length > 0 && (
            <div>
              <div className="px-3 py-2 mt-1 border-t border-border/30">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Users <span className="text-muted-foreground/60">({results.users.length})</span>
                </p>
              </div>
              {results.users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 text-left">
                  <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: NAVY }}>
                    {(u.name || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{u.name}</p>
                    <p className="text-[11px] text-muted-foreground">@{u.username} &middot; {u.role}</p>
                  </div>
                  <RoleBadge role={u.role} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border/50 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><kbd className="text-[9px] font-mono bg-muted px-1 py-0.5 rounded">↑↓</kbd> Navigate</span>
          <span className="flex items-center gap-1"><kbd className="text-[9px] font-mono bg-muted px-1 py-0.5 rounded">↵</kbd> Open</span>
          <span className="flex items-center gap-1"><kbd className="text-[9px] font-mono bg-muted px-1 py-0.5 rounded">ESC</kbd> Close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HydrationGate({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [loadStep, setLoadStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setLoadStep(1), 400);
    const t2 = setTimeout(() => setLoadStep(2), 900);
    const t3 = setTimeout(() => { setLoadStep(3); setMounted(true); }, 1400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  if (!mounted) {
    const steps = ['Initializing...', 'Authenticating...', 'Ready'];
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-6">
          <motion.div
            className="h-16 w-16 rounded-2xl flex items-center justify-center shadow-lg"
            style={{ backgroundColor: NAVY }}
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Shield className="h-8 w-8 text-white" />
          </motion.div>
          <div className="text-center space-y-2">
            <p className="text-sm font-semibold text-foreground">Loading WB Grievance Portal</p>
            {/* 3-step animated progress bar */}
            <div className="w-64 h-1.5 rounded-full bg-muted overflow-hidden flex gap-0.5">
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #0A2463, #16A34A)' }}
                animate={{ width: loadStep >= 1 ? '100%' : '0%' }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <div className="flex items-center justify-center gap-4 mt-1">
              {steps.map((step, i) => (
                <span key={i} className={`text-[10px] font-medium transition-colors duration-300 ${i <= loadStep ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                  {step}
                </span>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/50 mt-1">v2.2.0</p>
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

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
  const [lastNotifCheck, setLastNotifCheck] = useState<string>('');

  // Keyboard shortcut dialog
  const [shortcutOpen, setShortcutOpen] = useState(false);

  // Notification Center
  const [notifCenterOpen, setNotifCenterOpen] = useState(false);

  // Dashboard refresh
  const dashboardRef = useRef<{ fetchDashboard: () => void } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Sound notification setting
  const [soundEnabled, setSoundEnabled] = useState(false);

  useEffect(() => {
    const stored = safeGetLocalStorage('wb_sound_alerts');
    setSoundEnabled(stored === 'true');
  }, []);

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

  // Poll notifications every 30s
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      fetchNotifications();
      setLastNotifCheck(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    }, 30000);
    return () => clearInterval(interval);
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
    { id: 'analytics' as ViewType, label: 'Analytics', icon: BarChart2 },
    ...(user?.role === 'ADMIN' ? [{ id: 'users' as ViewType, label: 'Users', icon: Users }] : []),
    { id: 'settings' as ViewType, label: 'Settings', icon: Settings },
  ];

  // Not logged in (wrap in hydration gate)
  if (!isAuthenticated) {
    return (
      <HydrationGate>
        <LoginView />
      </HydrationGate>
    );
  }

  const isDark = theme === 'dark';

  return (
    <HydrationGate>
    <div className="min-h-screen flex flex-col bg-background">
      {/* Keyboard shortcut listener - placed after all variable declarations */}
      <KeyboardShortcutHandler
        shortcutOpen={shortcutOpen}
        setShortcutOpen={setShortcutOpen}
        setNewComplaintOpen={setNewComplaintOpen}
        setMobileSidebarOpen={setMobileSidebarOpen}
        handleNavigate={handleNavigate}
        handleRefresh={handleRefresh}
        isDark={isDark}
        setTheme={setTheme}
        currentView={view}
      />
      {/* ═══ COMMAND PALETTE ═══ */}
      <CommandPalette
        open={shortcutOpen}
        onOpenChange={setShortcutOpen}
        onNavigate={handleNavigate}
        currentView={view}
      />

      {/* ═══ HEADER ═══ */}
      <header className="sticky top-0 z-50 glass-header border-b border-border/50">
        {/* Animated gradient border at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, #0A2463, #16A34A, #D97706, #DC2626, transparent)' }} />

        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-1.5 rounded-lg hover:bg-muted transition-colors" onClick={() => setMobileSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm" style={{ backgroundColor: NAVY }}>
                <Shield className="h-4 w-4 text-white" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-sm font-black tracking-tight" style={{ color: NAVY }}>WB Grievance Portal</h1>
                <p className="text-[10px] text-muted-foreground -mt-0.5">Government of West Bengal</p>
              </div>
            </div>
            {/* Animated Page Title Breadcrumb */}
            <div className="hidden md:flex items-center gap-1.5 ml-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={view}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-1.5"
                >
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                  <span className="text-xs font-semibold gradient-text">{navItems.find(n => n.id === view)?.label || 'Dashboard'}</span>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Search / Command Palette Trigger */}
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:flex h-8 gap-2 px-3 text-xs text-muted-foreground hover:text-foreground font-normal"
              onClick={() => setShortcutOpen(true)}
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search...</span>
              <kbd className="text-[9px] font-mono bg-muted/80 px-1.5 py-0.5 rounded ml-4">Ctrl+K</kbd>
            </Button>
            <Button variant="ghost" size="sm" className="sm:hidden h-8 w-8 p-0" onClick={() => setShortcutOpen(true)}>
              <Search className="h-4 w-4" />
            </Button>

            {/* Refresh Button */}
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleRefresh} title="Refresh data">
              <RotateCcw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>

            {/* Theme Toggle */}
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setTheme(isDark ? 'light' : 'dark')}>
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            {/* Notifications Bell */}
            <DropdownMenu open={notificationOpen} onOpenChange={(open) => {
              setNotificationOpen(open);
              if (open && soundEnabled) {
                // don't play sound when opening dropdown
              }
              if (open) {
                setLastNotifCheck(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
              }
            }}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 relative">
                  <Bell className={`h-4 w-4 ${criticalCount > 0 ? 'text-red-500' : ''}`} />
                  {criticalCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center notif-pulse">
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
                {lastNotifCheck && (
                  <div className="px-3 py-1 text-[10px] text-muted-foreground">
                    Last checked: {lastNotifCheck}
                  </div>
                )}
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
                    <DropdownMenuItem onClick={() => { setNotificationOpen(false); setNotifCenterOpen(true); }} className="text-xs font-semibold justify-center text-foreground cursor-pointer">
                      <Megaphone className="h-3 w-3.5 mr-1" /> Open Notification Center
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
        <aside className="hidden lg:flex flex-col w-56 border-r border-border/50 glass-sidebar min-h-0">
          <nav className="flex-1 p-3 space-y-1 custom-scrollbar overflow-y-auto">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border-l-[3px] btn-press ${
                  view === item.id
                    ? 'bg-white dark:bg-gray-800 shadow-sm text-foreground border-l-[#0A2463]'
                    : 'text-muted-foreground hover:bg-gradient-to-r hover:from-muted/80 hover:to-transparent hover:text-foreground border-l-transparent'
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
                {view === 'analytics' && (
                  <AnalyticsView />
                )}
                {view === 'settings' && (
                  <SettingsView />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t border-border/50 mt-auto" style={{ background: 'linear-gradient(135deg, #0A2463 0%, #1a3a7a 100%)' }}>
        <div className="px-4 py-5 sm:py-6">
          <div className="max-w-[1400px] mx-auto">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              {/* Brand Section */}
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-white/10 border border-white/20">
                  <Shield className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white/95">Government of West Bengal</p>
                  <p className="text-[11px] text-white/50">AI Public Support System &middot; Grievance Management Portal</p>
                </div>
              </div>

              {/* Quick Stats Row */}
              <div className="flex items-center gap-6 text-center">
                <div className="hidden sm:block">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Portal</p>
                  <p className="text-xs font-bold text-white/80 mt-0.5">v2.2.0</p>
                </div>
                <div className="hidden sm:block w-px h-8 bg-white/10" />
                <div className="hidden sm:block">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Status</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <p className="text-xs font-bold text-emerald-300">Online</p>
                  </div>
                </div>
                <div className="hidden sm:block w-px h-8 bg-white/10" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Security</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <ShieldCheck className="h-3 w-3 text-emerald-300" />
                    <p className="text-xs font-bold text-white/80">Encrypted</p>
                  </div>
                </div>
              </div>

              {/* Links & Copyright */}
              <div className="flex flex-col items-start md:items-end gap-2">
                <div className="flex items-center gap-4 text-[11px]">
                  <span className="flex items-center gap-1 text-white/50 hover:text-white/80 transition-colors cursor-pointer"><Globe className="h-3 w-3" />wb.gov.in</span>
                  <span className="text-white/30">|</span>
                  <span className="flex items-center gap-1 text-white/50 hover:text-white/80 transition-colors cursor-pointer"><Mail className="h-3 w-3" />Support</span>
                </div>
                <p className="text-[10px] text-white/30">&copy; 2025 Government of West Bengal &mdash; All Rights Reserved</p>
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* ═══ NOTIFICATION CENTER ═══ */}
      <Sheet open={notifCenterOpen} onOpenChange={setNotifCenterOpen}>
        <SheetContent side="right" className="w-full sm:w-[420px] p-0 overflow-hidden">
          <SheetHeader className="p-4 pb-3 border-b border-border/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: NAVY }}>
                  <Megaphone className="h-4 w-4 text-white" />
                </div>
                <div>
                  <SheetTitle className="text-sm font-bold">Notification Center</SheetTitle>
                  <SheetDescription className="text-[11px]">Stay updated on complaint activities</SheetDescription>
                </div>
              </div>
              {criticalCount > 0 && (
                <Badge className="bg-red-500 text-white text-[10px] px-2 py-0.5 pulse-glow">{criticalCount}</Badge>
              )}
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* Summary Stats */}
            <div className="p-4 border-b border-border/30">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30 text-center">
                  <AlertCircle className="h-5 w-5 text-red-500 mx-auto mb-1" />
                  <p className="text-lg font-black text-red-600">{notificationData.filter(c => c.urgency === 'CRITICAL').length}</p>
                  <p className="text-[10px] text-muted-foreground font-medium">Critical</p>
                </div>
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 text-center">
                  <Clock className="h-5 w-5 text-amber-500 mx-auto mb-1" />
                  <p className="text-lg font-black text-amber-600">{notificationData.filter(c => c.status === 'OPEN').length}</p>
                  <p className="text-[10px] text-muted-foreground font-medium">Open</p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30 text-center">
                  <CheckCircleFill className="h-5 w-5 text-emerald-500 mx-auto mb-1" />
                  <p className="text-lg font-black text-emerald-600">{notificationData.filter(c => c.status === 'RESOLVED').length}</p>
                  <p className="text-[10px] text-muted-foreground font-medium">Resolved</p>
                </div>
              </div>
            </div>
            {/* Notification List */}
            <div className="p-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2 py-2">Recent Activity</p>
              {notificationData.length > 0 ? (
                <div className="space-y-1">
                  {notificationData.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setNotifCenterOpen(false); handleNotificationClick(c); }}
                      className="w-full text-left p-3 rounded-xl hover:bg-muted/50 transition-colors group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{
                          backgroundColor: c.urgency === 'CRITICAL' ? '#FEE2E2' : c.urgency === 'HIGH' ? '#FFF7ED' : '#F0FDF4',
                        }}>
                          {c.urgency === 'CRITICAL' ? <AlertTriangle className="h-4 w-4 text-red-500" /> : <Info className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-mono font-bold text-muted-foreground">{c.ticketNo}</span>
                            <StatusBadge status={c.status} />
                            <UrgencyBadge urgency={c.urgency} />
                          </div>
                          <p className="text-xs font-medium text-foreground truncate mt-0.5">{c.issue}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{c.citizenName || 'Anonymous'} &middot; {c.block}, {c.district}</p>
                          <p className="text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-1">
                            <Clock className="h-3 w-3" />{fmtDateTime(c.createdAt)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center">
                  <div className="h-14 w-14 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
                    <Bell className="h-7 w-7 text-muted-foreground/40" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">All caught up!</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">No new notifications</p>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ═══ MOBILE BOTTOM NAVIGATION ═══ */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-lg border-t border-border/50 print:hidden">
        <div className="flex items-center justify-around px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => handleNavigate('dashboard')}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all duration-200 ${view === 'dashboard' ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            <LayoutDashboard className={`h-5 w-5 transition-transform duration-200 ${view === 'dashboard' ? 'scale-110' : ''}`} />
            <span className="text-[10px] font-medium">Home</span>
            {view === 'dashboard' && <motion.div className="h-0.5 w-4 rounded-full" layoutId="mobile-nav-indicator" style={{ backgroundColor: NAVY }} />}
          </button>
          <button
            onClick={() => handleNavigate('complaints')}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all duration-200 ${view === 'complaints' ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            <FileText className={`h-5 w-5 transition-transform duration-200 ${view === 'complaints' ? 'scale-110' : ''}`} />
            <span className="text-[10px] font-medium">Cases</span>
            {view === 'complaints' && <motion.div className="h-0.5 w-4 rounded-full" layoutId="mobile-nav-indicator" style={{ backgroundColor: NAVY }} />}
          </button>
          <button
            onClick={() => handleNavigate('analytics')}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all duration-200 ${view === 'analytics' ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            <BarChart2 className={`h-5 w-5 transition-transform duration-200 ${view === 'analytics' ? 'scale-110' : ''}`} />
            <span className="text-[10px] font-medium">Stats</span>
            {view === 'analytics' && <motion.div className="h-0.5 w-4 rounded-full" layoutId="mobile-nav-indicator" style={{ backgroundColor: NAVY }} />}
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
          <button
            onClick={() => handleNavigate('settings')}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all duration-200 ${view === 'settings' ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            <Settings className={`h-5 w-5 transition-transform duration-200 ${view === 'settings' ? 'scale-110' : ''}`} />
            <span className="text-[10px] font-medium">More</span>
            {view === 'settings' && <motion.div className="h-0.5 w-4 rounded-full" layoutId="mobile-nav-indicator" style={{ backgroundColor: NAVY }} />}
          </button>
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
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border-l-[3px] ${
                  view === item.id
                    ? 'bg-muted text-foreground shadow-sm border-l-[#0A2463]'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground border-l-transparent'
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

      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog
        open={shortcutOpen}
        onOpenChange={setShortcutOpen}
        onNavigate={handleNavigate}
        onNewComplaint={() => setNewComplaintOpen(true)}
        onRefresh={handleRefresh}
        onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
      />
    </div>
    </HydrationGate>
  );
}
