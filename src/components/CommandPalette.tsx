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
import { Landmark, Layers, Home, Vote, User, Map as MapIcon, CornerDownLeft } from 'lucide-react';
import { useComplaintOpener } from '@/components/home/useComplaintOpener';
import { objectHref, type ObjectType, type SearchHit } from '@/lib/objects';
import { recentObjects, type RecentObject } from '@/components/objects/recent';
const HIT_ICON: Record<string, React.ElementType> = {
  complaint: FileText, district: MapIcon, seat: Landmark, block: Layers, gp: Building2,
  village: Home, booth: Vote, person: User,
};
const HIT_GROUP: Record<string, string> = {
  complaint: 'Tickets', district: 'District', seat: 'Assembly seats', block: 'Blocks', gp: 'Panchayats',
  village: 'Villages', booth: 'Booths', person: 'People',
};
const GROUP_ORDER = ['complaint', 'district', 'seat', 'block', 'gp', 'village', 'booth', 'person'];

type PaletteItem = {
  id: string; group: string; icon: React.ElementType; label: string; labelBn?: string | null; sub?: string | null;
  run: () => void;
};

/**
 * Find anything: every seat, block, panchayat, village, booth, person and ticket
 * the account may see, by English or Bengali name. Opening a place goes to its
 * page; a ticket opens the complaint where you are. With nothing typed it offers
 * the places opened last and the screens this role can open.
 */
export function CommandPalette({ open, onOpenChange, onNavigate, currentView, destinations = [] }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onNavigate: (view: string, complaint?: Complaint) => void;
  currentView: string;
  destinations?: { id: string; label: string; icon: React.ElementType }[];
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentObject[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { openComplaint, dialog } = useComplaintOpener(() => {});

  useEffect(() => {
    if (!open) return;
    setQuery(''); setHits([]); setActive(0); setFailed(false);
    setRecent(recentObjects());
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); setSearching(false); setFailed(false); return; }
    setSearching(true);
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/objects/search?q=${encodeURIComponent(q)}`, { headers: authHeaders(), signal: ctl.signal });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Search failed');
        setHits(json.results || []); setFailed(false); setActive(0);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') { setHits([]); setFailed(true); }
      } finally {
        if (!ctl.signal.aborted) setSearching(false);
      }
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query]);

  const close = () => onOpenChange(false);
  const items: PaletteItem[] = useMemo(() => {
    if (query.trim().length >= 2) {
      return [...hits]
        .sort((a, b) => GROUP_ORDER.indexOf(a.type) - GROUP_ORDER.indexOf(b.type))
        .map((h) => ({
          id: `${h.type}:${h.key}`, group: HIT_GROUP[h.type] || 'Results', icon: HIT_ICON[h.type] || FileText,
          label: h.label, labelBn: h.label_bn, sub: h.sub,
          run: h.type === 'complaint'
            ? () => { close(); openComplaint(h.key); }
            : () => { close(); window.location.hash = objectHref({ type: h.type as ObjectType, key: h.key }); },
        }));
    }
    const recents: PaletteItem[] = recent.map((r) => ({
      id: `recent:${r.type}:${r.key}`, group: 'Opened recently', icon: HIT_ICON[r.type] || Clock,
      label: r.label, labelBn: r.label_bn, sub: r.kind,
      run: () => { close(); window.location.hash = objectHref({ type: r.type, key: r.key }); },
    }));
    const screens: PaletteItem[] = destinations.filter((d) => d.id !== currentView).map((d) => ({
      id: `go:${d.id}`, group: 'Go to', icon: d.icon, label: d.label,
      run: () => { close(); onNavigate(d.id); },
    }));
    return [...recents, ...screens];
  }, [hits, query, recent, destinations, currentView]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run(); }
  }

  const q = query.trim();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-xl gap-0 overflow-hidden border-border bg-popover p-0 shadow-2xl"
          // The dialog would focus the first result; typing then went to a button and
          // fired the app's one-letter shortcuts. Typing always belongs in the field.
          onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
        >
          <DialogTitle className="sr-only">Find anything</DialogTitle>
          <DialogDescription className="sr-only">Search places, people and tickets. Use the arrow keys to move and Enter to open.</DialogDescription>
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Find a village, panchayat, booth, person or ticket"
              aria-label="Find anything"
              data-bare-focus
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls="find-anything-list"
              aria-activedescendant={items[active] ? `find-${items[active].id}` : undefined}
              className="flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            {searching && <span className="text-xs text-muted-foreground" aria-live="polite">Searching</span>}
          </div>

          <div ref={listRef} id="find-anything-list" role="listbox" aria-label="Results" className="max-h-[400px] overflow-y-auto py-1.5 custom-scrollbar">
            {q.length >= 2 && !searching && failed && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Search did not answer. Try again in a moment.</p>
            )}
            {q.length >= 2 && !searching && !failed && items.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-foreground">Nothing matches “{q}”.</p>
                <p className="mt-1 text-xs text-muted-foreground">Try the English or the Bengali spelling, a booth number, or part of a ticket number.</p>
              </div>
            )}
            {q.length === 1 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Keep typing. Two letters are enough.</p>}
            {items.map((it, i) => {
              const header = i === 0 || items[i - 1].group !== it.group ? it.group : null;
              const Icon = it.icon;
              return (
                <div key={it.id}>
                  {header && <p className="px-4 pb-1 pt-2.5 text-xs font-medium text-muted-foreground">{header}</p>}
                  <button
                    type="button"
                    id={`find-${it.id}`}
                    tabIndex={-1}
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => it.run()}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${i === active ? 'bg-muted' : ''}`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${i === active ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        {it.labelBn && it.labelBn !== it.label ? <><span lang="bn">{it.labelBn}</span><span className="ml-1.5 text-muted-foreground">{it.label}</span></> : it.label}
                      </span>
                      {it.sub && <span className="block truncate text-xs text-muted-foreground">{it.sub}</span>}
                    </span>
                    {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">↑</kbd><kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">↓</kbd> move</span>
            <span className="flex items-center gap-1"><kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">Enter</kbd> open</span>
            <span className="flex items-center gap-1"><kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">Esc</kbd> close</span>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

export function KeyboardShortcutsDialog({ open, onOpenChange, onNavigate, onNewComplaint, onRefresh, onToggleTheme, onFind }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onFind?: () => void;
  onNavigate?: (view: ViewType) => void;
  onNewComplaint?: () => void;
  onRefresh?: () => void;
  onToggleTheme?: () => void;
}) {
  const shortcuts = [
    { key: 'Ctrl K', label: 'Find a village, person or ticket', action: onFind },
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
              <Keyboard className="h-5 w-5 text-primary" />
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
              Press <kbd className="inline-flex h-5 px-1.5 rounded bg-muted border border-border/60 text-[10px] font-mono font-bold">?</kbd> for this list, <kbd className="inline-flex h-5 px-1.5 rounded bg-muted border border-border/60 text-[10px] font-mono font-bold">Ctrl K</kbd> to search
            </p>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

export function KeyboardShortcutHandler({ shortcutOpen, setShortcutOpen, setHelpOpen, setNewComplaintOpen, setMobileSidebarOpen, handleNavigate, handleRefresh, isDark, setTheme, currentView }: {
  shortcutOpen: boolean;
  setShortcutOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Opens the shortcuts help; without it, ? falls back to the search box. */
  setHelpOpen?: (v: boolean) => void;
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

      if ((e.ctrlKey || e.metaKey) && key === 'k') {
        e.preventDefault();
        setHelpOpen?.(false);
        setShortcutOpen((v) => !v);
      } else if (key === '?') {
        e.preventDefault();
        if (setHelpOpen) { setShortcutOpen(false); setHelpOpen(true); } else setShortcutOpen((v) => !v);
      } else if (key === 'escape') {
        setShortcutOpen(false);
        setHelpOpen?.(false);
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
  }, [shortcutOpen, isDark, handleNavigate, handleRefresh, setTheme, setShortcutOpen, setHelpOpen, setNewComplaintOpen, setMobileSidebarOpen]);

  return null;
}