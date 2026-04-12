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
  ArrowUp, Flame, CalendarRange, TimerReset, Server, Radio,
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
import { toast } from 'sonner';
import { useTheme } from 'next-themes';
import { useAuthStore } from '@/lib/auth-store';
import { useI18nStore } from '@/lib/i18n-store';
import { motion, AnimatePresence } from 'framer-motion';
import type { Complaint, DashboardData, ViewType } from '@/lib/types';
import { NAVY, NAVY_DARK, ROLE_COLORS } from '@/lib/constants';
import { fmtDate, fmtDateTime, fmtRole, safeGetLocalStorage, authHeaders } from '@/lib/helpers';
import { StatusBadge, UrgencyBadge } from '@/components/common';
import { LoginView } from '@/components/LoginView';
import { DashboardView } from '@/components/DashboardView';
import { ComplaintDetailDialog } from '@/components/ComplaintDetailDialog';
import { NewComplaintDialog } from '@/components/NewComplaintDialog';
import { ComplaintsView } from '@/components/ComplaintsView';
import { UserManagementView } from '@/components/UserManagementView';
import { AnalyticsView } from '@/components/AnalyticsView';
import { SettingsView } from '@/components/SettingsView';
import { HydrationGate } from '@/components/HydrationGate';
import { CommandPalette, KeyboardShortcutsDialog, KeyboardShortcutHandler } from '@/components/CommandPalette';
import { AnnouncementBanner } from '@/components/AnnouncementBanner';
import { TicketTrackerDialog } from '@/components/TicketTrackerDialog';
import { AuditLogView } from '@/components/AuditLogView';
import { PublicStatusPage } from '@/components/PublicStatusPage';
import IntegrationsView from '@/components/IntegrationsView';
import DeploymentGuideView from '@/components/DeploymentGuideView';
import LiveDataMonitor from '@/components/LiveDataMonitor';
export default function HomePage() {
  const { user, isAuthenticated, logout, checkAuth } = useAuthStore();
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useI18nStore();
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

  // Ticket Tracker Dialog
  const [ticketTrackerOpen, setTicketTrackerOpen] = useState(false);

  // Dashboard refresh
  const dashboardRef = useRef<{ fetchDashboard: () => void } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Sound notification setting
  const [soundEnabled, setSoundEnabled] = useState(false);

  // Session timeout (30 min warning, 35 min auto-logout)
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [sessionWarningShown, setSessionWarningShown] = useState(false);

  useEffect(() => {
    const stored = safeGetLocalStorage('wb_sound_alerts');
    setSoundEnabled(stored === 'true');
    // Restore auth session on mount
    checkAuth();
  }, []);

  // Track user activity for session timeout
  useEffect(() => {
    if (!isAuthenticated) return;
    const activityHandler = () => {
      setLastActivity(Date.now());
      setSessionWarningShown(false);
    };
    window.addEventListener('mousemove', activityHandler);
    window.addEventListener('keydown', activityHandler);
    window.addEventListener('click', activityHandler);
    window.addEventListener('scroll', activityHandler);
    return () => {
      window.removeEventListener('mousemove', activityHandler);
      window.removeEventListener('keydown', activityHandler);
      window.removeEventListener('click', activityHandler);
      window.removeEventListener('scroll', activityHandler);
    };
  }, [isAuthenticated]);

  // Session timeout check (every 30s)
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      const idle = Date.now() - lastActivity;
      if (idle >= 25 * 60 * 1000 && !sessionWarningShown) {
        toast.warning('Session Expiring Soon', { description: 'You have been inactive for 25 minutes. You will be signed out in 5 minutes.', duration: 8000 });
        setSessionWarningShown(true);
      }
      if (idle >= 30 * 60 * 1000) {
        toast.error('Session Expired', { description: 'You have been signed out due to inactivity.' });
        logout();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, lastActivity, sessionWarningShown, logout]);

  // Footer uptime counter
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setUptimeSeconds((p) => p + 1), 1000);
    return () => clearInterval(interval);
  }, []);
  const uptimeDisplay = useMemo(() => {
    const h = Math.floor(uptimeSeconds / 3600);
    const m = Math.floor((uptimeSeconds % 3600) / 60);
    const s = uptimeSeconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }, [uptimeSeconds]);

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
    { id: 'dashboard' as ViewType, label: t('dashboard'), icon: LayoutDashboard },
    { id: 'complaints' as ViewType, label: t('complaints'), icon: FileText },
    { id: 'analytics' as ViewType, label: t('analytics'), icon: BarChart2 },
    { id: 'liveData' as ViewType, label: 'Live Data', icon: Radio },
    ...(user?.role === 'ADMIN' ? [{ id: 'systemStatus' as ViewType, label: t('systemStatus'), icon: Activity }] : []),
    ...(user?.role === 'ADMIN' ? [{ id: 'integrations' as ViewType, label: 'Integrations', icon: Zap }] : []),
    ...(user?.role === 'ADMIN' ? [{ id: 'audit' as ViewType, label: t('auditLog'), icon: History }] : []),
    ...(user?.role === 'ADMIN' ? [{ id: 'deployment' as ViewType, label: 'Deployment', icon: Server }] : []),
    ...(user?.role === 'ADMIN' ? [{ id: 'users' as ViewType, label: t('users'), icon: Users }] : []),
    { id: 'settings' as ViewType, label: t('settings'), icon: Settings },
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
        {/* Animated vivid gradient ribbon at bottom — 3px with shimmer */}
        <div className="absolute bottom-0 left-0 right-0 header-ribbon" />

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
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-black tracking-tight" style={{ color: NAVY }}>WB Grievance Portal</h1>
                  {user?.role === 'ADMIN' && (
                    <span className="live-badge">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                      </span>
                      LIVE
                    </span>
                  )}
                </div>
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
              className="hidden sm:flex h-8 gap-2 px-3 text-xs text-muted-foreground hover:text-foreground font-normal search-btn-gradient"
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

            {/* Language Toggle — EN / বাং */}
            <button
              onClick={() => setLang(lang === 'en' ? 'bn' : 'en')}
              className="hidden sm:flex lang-toggle"
              title={lang === 'en' ? 'Switch to Bengali' : 'Switch to English'}
            >
              <span className={`lang-toggle-btn ${lang === 'en' ? 'active' : ''}`}>
                EN
              </span>
              <span className={`lang-toggle-btn ${lang === 'bn' ? 'active' : ''}`}>
                বাং
              </span>
            </button>

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
                <Button variant="ghost" size="sm" className={`h-8 w-8 p-0 relative ${criticalCount > 0 ? 'animate-wiggle' : ''}`}>
                  <Bell className={`h-4 w-4 ${criticalCount > 0 ? 'text-red-500 animate-bell-ring' : ''}`} />
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
                  {t('notifications')}
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
                  <LogOut className="h-3.5 w-3.5 mr-2" />{t('signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* ═══ ANNOUNCEMENT BANNER ═══ */}
      <AnnouncementBanner
        message="Portal maintenance scheduled for June 15, 2025 (Saturday) from 2:00 AM to 6:00 AM IST. Please save your work before then."
        type="warning"
      />

      {/* ═══ LAYOUT ═══ */}
      <div className="flex flex-1">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex flex-col w-56 border-r border-border/50 glass-sidebar min-h-0 sidebar-accent">
          {/* User Avatar Section */}
          <div className="p-4 pb-3 border-b border-border/30">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm" style={{ backgroundColor: NAVY }}>
                {(user?.name || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground truncate">{user?.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{user?.username}</p>
              </div>
            </div>
          </div>
          <nav className="flex-1 p-3 space-y-1 custom-scrollbar overflow-y-auto">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border-l-[3px] btn-press group ${
                  view === item.id
                    ? 'nav-active-gradient shadow-sm text-foreground border-l-[#0A2463]'
                    : 'text-muted-foreground hover:bg-gradient-to-r hover:from-muted/80 hover:to-transparent hover:text-foreground hover:scale-[1.02] border-l-transparent'
                }`}
              >
                <item.icon className={`h-4 w-4 transition-transform duration-200 ${view === item.id ? 'text-[#0A2463]' : 'group-hover:scale-110'}`} />
                <span className="flex-1 text-left">{item.label}</span>
                {item.id === 'complaints' && criticalCount > 0 && (
                  <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold animate-badge-in">
                    {criticalCount > 99 ? '99+' : criticalCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
          {/* Quick Stats Mini Section + Sign Out */}
          <div className="p-3 border-t border-border/50">
            {/* Quick Stats Pills */}
            <div className="flex items-center gap-1.5 mb-3">
              <div className="stat-pill flex-1 justify-center">
                <span className="stat-pill-dot bg-red-500" />
                <span className="text-red-600 dark:text-red-400">{criticalCount}</span>
              </div>
              <div className="stat-pill flex-1 justify-center">
                <span className="stat-pill-dot bg-amber-500" />
                <span className="text-amber-600 dark:text-amber-400">3</span>
              </div>
              <div className="stat-pill flex-1 justify-center">
                <span className="stat-pill-dot bg-sky-500" />
                <span className="text-sky-600 dark:text-sky-400">5</span>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-white/50 dark:bg-gray-800/50 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="h-4 w-4" style={{ color: NAVY }} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Secured</span>
              </div>
              <p className="text-[11px] text-muted-foreground">{t('sessionActive')}</p>
              <Button variant="ghost" size="sm" onClick={() => logout()} className="w-full mt-2 h-7 text-xs text-red-600 dark:text-red-400 gap-1 hover:bg-red-50 dark:hover:bg-red-950/30">
                <LogOut className="h-3 w-3" /> {t('signOut')}
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
                {view === 'audit' && (
                  <AuditLogView />
                )}
                {view === 'systemStatus' && (
                  <PublicStatusPage />
                )}
                {view === 'settings' && (
                  <SettingsView />
                )}
                {view === 'integrations' && (
                  <IntegrationsView />
                )}
                {view === 'deployment' && (
                  <DeploymentGuideView />
                )}
                {view === 'liveData' && (
                  <LiveDataMonitor />
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
                  <p className="text-[11px] text-white/50">AI Public Support System &middot; Grievance Portal v2.8.0</p>
                </div>
              </div>

              {/* Quick Links */}
              <div className="hidden sm:flex items-center gap-4 text-[11px]">
                <span className="text-white/40 hover:text-white/80 transition-colors cursor-pointer flex items-center gap-1"><LayoutDashboard className="h-3 w-3" />{t('dashboard')}</span>
                <span className="text-white/30">|</span>
                <span className="text-white/40 hover:text-white/80 transition-colors cursor-pointer flex items-center gap-1" onClick={() => setTicketTrackerOpen(true)}><FileText className="h-3 w-3" />{lang === 'en' ? 'Track Status' : 'ট্র্যাক স্ট্যাটাস'}</span>
                <span className="text-white/30">|</span>
                <span className="text-white/40 hover:text-white/80 transition-colors cursor-pointer flex items-center gap-1"><BarChart2 className="h-3 w-3" />{t('analytics')}</span>
                <span className="text-white/30">|</span>
                <span className="text-white/40 hover:text-white/80 transition-colors cursor-pointer flex items-center gap-1"><CircleHelp className="h-3 w-3" />{lang === 'en' ? 'Help' : 'সাহায্য'}</span>
              </div>

              {/* Status Indicators */}
              <div className="flex items-center gap-4 text-center">
                <div className="hidden sm:block">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">{t('version')}</p>
                  <p className="text-xs font-bold text-white/80 mt-0.5">v2.8.0</p>
                </div>
                <div className="hidden sm:block w-px h-8 bg-white/10" />
                <div className="hidden sm:block">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">{t('status')}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                    </span>
                    <p className="text-xs font-bold text-emerald-300">{t('online')}</p>
                  </div>
                </div>
                <div className="hidden sm:block w-px h-8 bg-white/10" />
                <div className="hidden sm:block">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">{t('uptime')}</p>
                  <p className="text-xs font-bold text-white/80 mt-0.5 font-mono">{uptimeDisplay}</p>
                </div>
                <div className="hidden sm:block w-px h-8 bg-white/10" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">{t('security')}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <ShieldCheck className="h-3 w-3 text-emerald-300" />
                    <p className="text-xs font-bold text-white/80">{t('encrypted')}</p>
                  </div>
                </div>
              </div>

              {/* Copyright */}
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

      {/* ═══ TICKET TRACKER DIALOG ═══ */}
      <TicketTrackerDialog open={ticketTrackerOpen} onOpenChange={setTicketTrackerOpen} />

      {/* ═══ MOBILE BOTTOM NAVIGATION ═══ */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 mobile-bottom-nav-glass border-t border-border/50 print:hidden">
        <div className="flex items-center justify-around px-2 py-1.5" style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}>
          <button
            onClick={() => handleNavigate('dashboard')}
            className={`mobile-nav-item flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all duration-200 ${view === 'dashboard' ? 'mobile-nav-active text-foreground' : 'text-muted-foreground'}`}
          >
            <LayoutDashboard className={`h-5 w-5 transition-transform duration-200 ${view === 'dashboard' ? 'scale-110' : ''}`} />
            <span className="text-[10px] font-medium">Home</span>
          </button>
          <button
            onClick={() => setTicketTrackerOpen(true)}
            className="mobile-nav-item flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all duration-200 text-muted-foreground"
          >
            <Search className="h-5 w-5" />
            <span className="text-[10px] font-medium">Track</span>
          </button>
          <button
            onClick={() => handleNavigate('complaints')}
            className={`mobile-nav-item flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all duration-200 ${view === 'complaints' ? 'mobile-nav-active text-foreground' : 'text-muted-foreground'}`}
          >
            <FileText className={`h-5 w-5 transition-transform duration-200 ${view === 'complaints' ? 'scale-110' : ''}`} />
            <span className="text-[10px] font-medium">Cases</span>
          </button>
          <button
            onClick={() => handleNavigate('analytics')}
            className={`mobile-nav-item flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all duration-200 ${view === 'analytics' ? 'mobile-nav-active text-foreground' : 'text-muted-foreground'}`}
          >
            <BarChart2 className={`h-5 w-5 transition-transform duration-200 ${view === 'analytics' ? 'scale-110' : ''}`} />
            <span className="text-[10px] font-medium">Stats</span>
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
            className={`mobile-nav-item flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all duration-200 ${view === 'settings' ? 'mobile-nav-active text-foreground' : 'text-muted-foreground'}`}
          >
            <Settings className={`h-5 w-5 transition-transform duration-200 ${view === 'settings' ? 'scale-110' : ''}`} />
            <span className="text-[10px] font-medium">More</span>
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