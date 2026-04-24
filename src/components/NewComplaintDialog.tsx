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
import { NAVY, NAVY_DARK, STATUS_MAP, URGENCY_MAP, URGENCY_BORDER_MAP, ROLE_MAP, ROLE_COLORS, CATEGORIES, CATEGORY_LABELS, CATEGORY_COLORS, WB_DISTRICTS, WB_DISTRICT_LIST } from '@/lib/constants';
import { fmtDate, fmtDateTime, fmtStatus, fmtUrgency, fmtRole, safeGetLocalStorage, safeSetLocalStorage, authHeaders, getDaysOld, getSLAInfo, playNotificationSound } from '@/lib/helpers';
import { StatusBadge, UrgencyBadge, RoleBadge, StatCard, MiniStat, PieLabel, LoadingSkeleton, EmptyState } from '@/components/common';

export function NewComplaintDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const [form, setForm] = useState({ citizenName: '', phone: '', issue: '', category: '', block: '', district: '', urgency: 'MEDIUM', description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Dynamic blocks based on selected district
  const availableBlocks = form.district && WB_DISTRICTS[form.district] ? WB_DISTRICTS[form.district] : [];

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
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c] || c}</SelectItem>)}
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
              <Label className="text-[10px] font-bold uppercase tracking-widest">District *</Label>
              <Select value={form.district} onValueChange={(v) => { update('district', v); update('block', ''); }}>
                <SelectTrigger className={`h-9 text-sm w-full ${errors.district ? 'border-red-400' : ''}`}>
                  <SelectValue placeholder="Select district..." />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {WB_DISTRICT_LIST.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.district && <p className="text-red-500 text-[11px]">{errors.district}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest">Block *</Label>
              {availableBlocks.length > 0 ? (
                <Select value={form.block} onValueChange={(v) => update('block', v)}>
                  <SelectTrigger className={`h-9 text-sm w-full ${errors.block ? 'border-red-400' : ''}`}>
                    <SelectValue placeholder="Select block..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {availableBlocks.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={form.block} onChange={(e) => update('block', e.target.value)} placeholder="Select district first" className={`h-9 text-sm ${errors.block ? 'border-red-400' : ''}`} disabled={!form.district} />
              )}
              {errors.block && <p className="text-red-500 text-[11px]">{errors.block}</p>}
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