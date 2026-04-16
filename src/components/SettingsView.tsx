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
export function SettingsView() {
  const user = useAuthStore((s) => s.user);
  const { theme, setTheme } = useTheme();

  // Notification preferences (localStorage) — safely initialized after mount
  const [emailNotifs, setEmailNotifs] = useState(false);
  const [soundAlerts, setSoundAlerts] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [compactView, setCompactView] = useState(false);
  const [desktopNotifs, setDesktopNotifs] = useState(false);

  // Feedback form state
  const [feedbackName, setFeedbackName] = useState('');
  const [feedbackEmail, setFeedbackEmail] = useState('');
  const [feedbackCategory, setFeedbackCategory] = useState('General');
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  const handleFeedbackSubmit = useCallback(async () => {
    if (!feedbackName.trim() || !feedbackMessage.trim()) return;
    setFeedbackLoading(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: feedbackName,
          email: feedbackEmail,
          message: feedbackMessage,
          category: feedbackCategory,
          rating: feedbackRating,
        }),
      });
      if (res.ok) {
        toast.success('Feedback submitted', { description: 'Thank you for helping us improve!' });
        setFeedbackName('');
        setFeedbackEmail('');
        setFeedbackCategory('General');
        setFeedbackRating(5);
        setFeedbackMessage('');
      } else {
        toast.error('Failed to submit feedback', { description: 'Please try again later' });
      }
    } catch {
      toast.error('Network error', { description: 'Please check your connection' });
    }
    setFeedbackLoading(false);
  }, [feedbackName, feedbackEmail, feedbackCategory, feedbackRating, feedbackMessage]);

  // Initialize from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    setEmailNotifs(safeGetLocalStorage('wb_email_notifs') === 'true');
    setSoundAlerts(safeGetLocalStorage('wb_sound_alerts') === 'true');
    setAutoRefresh(safeGetLocalStorage('wb_auto_refresh') === 'true');
    setCompactView(safeGetLocalStorage('wb_compact_view') === 'true');
    setDesktopNotifs(safeGetLocalStorage('wb_desktop_notifs') === 'true');
    if (typeof Notification !== 'undefined') {
      setDesktopNotifs(Notification.permission === 'granted');
    }
  }, []);

  useEffect(() => { safeSetLocalStorage('wb_email_notifs', String(emailNotifs)); }, [emailNotifs]);
  useEffect(() => { safeSetLocalStorage('wb_sound_alerts', String(soundAlerts)); }, [soundAlerts]);
  useEffect(() => { safeSetLocalStorage('wb_auto_refresh', String(autoRefresh)); }, [autoRefresh]);
  useEffect(() => { safeSetLocalStorage('wb_compact_view', String(compactView)); }, [compactView]);

  const handleDesktopNotifToggle = useCallback(async (checked: boolean) => {
    if (checked) {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          setDesktopNotifs(true);
          safeSetLocalStorage('wb_desktop_notifs', 'true');
          toast.success('Desktop notifications enabled');
        } else {
          toast.error('Notification permission denied', { description: 'Please allow notifications in your browser settings' });
          setDesktopNotifs(false);
        }
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        setDesktopNotifs(true);
        safeSetLocalStorage('wb_desktop_notifs', 'true');
      } else {
        toast.error('Notifications blocked', { description: 'Please reset notification permissions in browser settings' });
      }
    } else {
      setDesktopNotifs(false);
      safeSetLocalStorage('wb_desktop_notifs', 'false');
    }
  }, []);

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

      {/* ═══ Profile Header Card with Gradient Background ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <div className="profile-header-gradient rounded-2xl shadow-lg overflow-hidden">
          <div className="px-6 py-8 sm:px-8 flex items-center gap-5 relative z-[1]">
            <div className="h-16 w-16 rounded-2xl flex items-center justify-center text-white text-2xl font-black shrink-0 shadow-lg bg-white/15 backdrop-blur-sm border border-white/20">
              {(user?.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-black text-white">{user?.name}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-white/15 text-blue-100 border border-white/20">
                  {user?.role === 'ADMIN' ? <Shield className="h-3 w-3 inline mr-1" /> : user?.role === 'STATE' ? <Globe className="h-3 w-3 inline mr-1" /> : user?.role === 'DISTRICT' ? <Building2 className="h-3 w-3 inline mr-1" /> : <MapPin className="h-3 w-3 inline mr-1" />}
                  {fmtRole(user?.role || '')}
                </span>
                <span className="text-[11px] text-blue-200/60 flex items-center gap-1">
                  <MapPin className="h-3 w-3" />{user?.block}{user?.district ? `, ${user.district}` : ''}
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ═══ Profile Details Section ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <UserCircle className="h-4 w-4" style={{ color: NAVY }} />
              Profile Details
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
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Block</p>
                    <p className="text-sm text-foreground">{user?.block}</p>
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

      {/* ═══ Section Divider ═══ */}
      <Separator className="my-1" />

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
                    className={`relative p-4 rounded-xl transition-all text-center group ${isActive ? 'theme-card-active' : `p-[1px] rounded-xl ${opt.bg}`} ${isActive ? 'scale-[1.02] shadow-lg' : 'opacity-70 hover:opacity-100 hover:scale-[1.01]'}`}
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

      {/* ═══ Section Divider ═══ */}
      <Separator className="my-1" />

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
              { label: 'Desktop notifications', description: 'Receive browser push notifications for critical updates', icon: Monitor, checked: desktopNotifs, onChange: (v: boolean) => handleDesktopNotifToggle(v) },
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

      {/* ═══ Section Divider ═══ */}
      <Separator className="my-1" />

      {/* ═══ Citizen Feedback Section ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <MessageSquare className="h-4 w-4" style={{ color: NAVY }} />
              💬 Citizen Feedback
            </CardTitle>
            <CardDescription className="text-xs">Help us improve this portal with your suggestions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="feedback-name" className="text-xs font-semibold">Name <span className="text-red-500">*</span></Label>
              <Input
                id="feedback-name"
                placeholder="Your name"
                value={feedbackName}
                onChange={(e) => setFeedbackName(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="feedback-email" className="text-xs font-semibold">Email <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="feedback-email"
                type="email"
                placeholder="your@email.com"
                value={feedbackEmail}
                onChange={(e) => setFeedbackEmail(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="feedback-category" className="text-xs font-semibold">Category</Label>
              <Select value={feedbackCategory} onValueChange={setFeedbackCategory}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="General">General</SelectItem>
                  <SelectItem value="Bug Report">Bug Report</SelectItem>
                  <SelectItem value="Feature Request">Feature Request</SelectItem>
                  <SelectItem value="Performance">Performance</SelectItem>
                  <SelectItem value="UI/UX">UI/UX</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Rating</Label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setFeedbackRating(star)}
                    className="p-0.5 hover:scale-110 transition-transform"
                  >
                    <Star
                      className={`h-6 w-6 transition-colors ${
                        star <= feedbackRating
                          ? 'text-amber-400 fill-amber-400'
                          : 'text-muted-foreground/40'
                      }`}
                    />
                  </button>
                ))}
                <span className="text-xs text-muted-foreground ml-2">{feedbackRating}/5</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="feedback-message" className="text-xs font-semibold">Feedback</Label>
              <Textarea
                id="feedback-message"
                placeholder="Share your suggestions for improving this portal..."
                value={feedbackMessage}
                onChange={(e) => setFeedbackMessage(e.target.value)}
                rows={4}
                className="text-sm resize-y min-h-[80px]"
              />
            </div>
            <Button
              onClick={handleFeedbackSubmit}
              disabled={feedbackLoading || !feedbackName.trim() || !feedbackMessage.trim()}
              className="w-full gap-2 text-sm"
              style={{ backgroundColor: NAVY, color: 'white' }}
            >
              {feedbackLoading ? (
                <><RefreshCw className="h-4 w-4 animate-spin" /> Submitting...</>
              ) : (
                <><Send className="h-4 w-4" /> Submit Feedback</>
              )}
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">
              Your feedback helps us improve this portal for all citizens of West Bengal.
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ Section Divider ═══ */}
      <Separator className="my-1" />

      {/* ═══ DANGER ZONE (All Users) ═══ */}
      {true && (
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}>
          <Card className="danger-zone border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" />
                Danger Zone
              </CardTitle>
              <CardDescription className="text-xs">Irreversible actions — proceed with caution</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30">
                <div>
                  <p className="text-sm font-semibold text-foreground">Clear All Local Data</p>
                  <p className="text-[11px] text-muted-foreground">Remove all locally stored preferences, tokens, and cached data</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      localStorage.clear();
                      toast.success('Local data cleared', { description: 'All preferences and cache have been removed. Please reload the page.' });
                    }
                  }}
                  className="h-8 gap-1.5 text-xs border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-3 w-3" /> Clear Data
                </Button>
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30">
                <div>
                  <p className="text-sm font-semibold text-foreground">Reset Settings to Default</p>
                  <p className="text-[11px] text-muted-foreground">Restore all notification and display settings to their defaults</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEmailNotifs(false); setSoundAlerts(false); setAutoRefresh(false); setCompactView(false); setDesktopNotifs(false);
                    safeSetLocalStorage('wb_email_notifs', 'false');
                    safeSetLocalStorage('wb_sound_alerts', 'false');
                    safeSetLocalStorage('wb_auto_refresh', 'false');
                    safeSetLocalStorage('wb_compact_view', 'false');
                    safeSetLocalStorage('wb_desktop_notifs', 'false');
                    toast.success('Settings reset', { description: 'All preferences restored to defaults' });
                  }}
                  className="h-8 gap-1.5 text-xs border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/40"
                >
                  <RotateCcw className="h-3 w-3" /> Reset
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ═══ KEYBOARD SHORTCUTS REFERENCE ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Keyboard className="h-4 w-4" style={{ color: NAVY }} />
              Keyboard Shortcuts
            </CardTitle>
            <CardDescription className="text-xs">Quick navigation and actions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { keys: ['D'], action: 'Go to Dashboard' },
                { keys: ['C'], action: 'Go to Complaints' },
                { keys: ['A'], action: 'Go to Analytics' },
                { keys: ['N'], action: 'New Complaint' },
                { keys: ['R'], action: 'Refresh Data' },
                { keys: ['T'], action: 'Toggle Theme' },
                { keys: ['Esc'], action: 'Close Dialog' },
                { keys: ['Ctrl', 'K'], action: 'Command Palette' },
                { keys: ['?'], action: 'Show Shortcuts' },
                { keys: ['Ctrl', 'A'], action: 'Select All' },
              ].map((shortcut) => (
                <div key={shortcut.action} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/50 border border-border/50 hover:bg-muted/80 transition-colors">
                  <span className="text-xs font-medium text-foreground">{shortcut.action}</span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.map((key, i) => (
                      <span key={i}>
                        <kbd className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-md bg-background border border-border text-[11px] font-mono font-semibold text-muted-foreground shadow-sm">
                          {key}
                        </kbd>
                        {i < shortcut.keys.length - 1 && <span className="text-[10px] text-muted-foreground mx-0.5">+</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ About Section ═══ */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
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