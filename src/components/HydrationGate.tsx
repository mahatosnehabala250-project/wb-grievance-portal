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
    // The app's own mark on the app's own ground, with a quiet bar that fills as
    // the page gets ready. (It used to announce "Authenticating..." on a timer
    // that knew nothing about authentication, under the wrong product name.)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-label="Loading">
        <div className="flex flex-col items-center gap-5">
          <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-md bg-primary text-2xl font-semibold text-primary-foreground" lang="bn">ব</span>
          <p className="text-sm font-medium text-foreground" lang="bn">বাংলার সহায়ক</p>
          <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full bg-primary"
              animate={{ width: `${((loadStep + 1) / 3) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}