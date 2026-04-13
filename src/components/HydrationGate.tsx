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
export function HydrationGate({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [loadStep, setLoadStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setLoadStep(1), 200);
    const t2 = setTimeout(() => setLoadStep(2), 400);
    const t3 = setTimeout(() => { setLoadStep(3); setMounted(true); }, 600);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  if (!mounted) {
    const steps = ['Initializing...', 'Authenticating...', 'Ready'];
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #061539 0%, #0A2463 40%, #1a3a7a 100%)' }}>
        {/* Subtle animated gradient overlay */}
        <div className="absolute inset-0 opacity-15" style={{ background: 'radial-gradient(ellipse at 30% 50%, rgba(99,102,241,0.4) 0%, transparent 50%), radial-gradient(ellipse at 70% 30%, rgba(16,185,129,0.3) 0%, transparent 50%)' }} />
        <div className="relative z-10 flex flex-col items-center gap-6">
          <motion.div
            className="h-16 w-16 rounded-2xl flex items-center justify-center shadow-lg bg-white/15 backdrop-blur-sm border border-white/20"
            animate={{ scale: [1, 1.05, 1], y: [0, -4, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Shield className="h-8 w-8 text-white" />
          </motion.div>
          <div className="text-center space-y-3">
            <p className="text-sm font-semibold text-white">Loading WB Grievance Portal</p>
            {/* 3-step animated progress bar */}
            <div className="w-64 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #16A34A, #22D3EE)' }}
                animate={{ width: `${((loadStep + 1) / 3) * 100}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <div className="flex items-center justify-center gap-4 mt-1">
              {steps.map((step, i) => (
                <span key={i} className={`text-[10px] font-medium transition-all duration-300 ${i <= loadStep ? 'text-white' : 'text-white/30'}`}>
                  {step}
                </span>
              ))}
            </div>
            <p className="text-[10px] text-white/40 mt-1">v2.5.0</p>
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}