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
export function CommandPalette({ open, onOpenChange, onNavigate, currentView }: {
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

export function KeyboardShortcutsDialog({ open, onOpenChange, onNavigate, onNewComplaint, onRefresh, onToggleTheme }: {
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

export function KeyboardShortcutHandler({ shortcutOpen, setShortcutOpen, setNewComplaintOpen, setMobileSidebarOpen, handleNavigate, handleRefresh, isDark, setTheme, currentView }: {
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