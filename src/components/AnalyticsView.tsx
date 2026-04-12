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
export function AnalyticsView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<'name' | 'count' | 'resolved' | 'open'>('count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [activeTab, setActiveTab] = useState<'analytics' | 'audit'>('analytics');

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

  // Top/bottom performing areas
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
      {/* Tab Bar */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/50 w-fit">
        <button onClick={() => setActiveTab('analytics')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'analytics' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          <BarChart2 className="h-4 w-4 inline mr-1.5" />Analytics
        </button>
        <button onClick={() => setActiveTab('audit')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'audit' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          <History className="h-4 w-4 inline mr-1.5" />Audit Trail
        </button>
      </div>

      {activeTab === 'audit' ? <AuditTrailView /> : (
      <>
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
        </>
      )}
    </div>
  );
}

interface AuditEntry {
  id: string; complaintId: string; ticketNo: string; action: string;
  description: string; actorName: string | null; createdAt: string;
}

const ACTION_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  CREATED: { bg: 'bg-sky-50 dark:bg-sky-950/40', text: 'text-sky-700 dark:text-sky-400', dot: 'bg-sky-500' },
  STATUS_CHANGED: { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
  ASSIGNED: { bg: 'bg-purple-50 dark:bg-purple-950/40', text: 'text-purple-700 dark:text-purple-400', dot: 'bg-purple-500' },
  UNASSIGNED: { bg: 'bg-gray-50 dark:bg-gray-900/40', text: 'text-gray-600 dark:text-gray-400', dot: 'bg-gray-400' },
  ESCALATED: { bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500' },
  RESOLVED: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' },
  REJECTED: { bg: 'bg-gray-50 dark:bg-gray-900/40', text: 'text-gray-600 dark:text-gray-400', dot: 'bg-gray-400' },
  COMMENTED: { bg: 'bg-indigo-50 dark:bg-indigo-950/40', text: 'text-indigo-700 dark:text-indigo-400', dot: 'bg-indigo-500' },
};

function AuditTrailView() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');

  const fetchAudit = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50', offset: String(offset) });
      if (actionFilter) params.set('action', actionFilter);
      const res = await fetch(`/api/audit-log?${params}`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        if (offset === 0) {
          setEntries(json.entries);
          setTotal(json.total);
        } else {
          setEntries((prev) => [...prev, ...json.entries]);
        }
      } else {
        setEntries([]); setTotal(0);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [actionFilter]);

  useEffect(() => { fetchAudit(); }, [fetchAudit]);

  const actionTypes = ['CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'ESCALATED', 'RESOLVED', 'REJECTED', 'COMMENTED'];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2">
            <History className="h-4 w-4" style={{ color: NAVY }} />
            Audit Trail
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{total} activity entries</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={actionFilter || 'all'} onValueChange={(v) => setActionFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="All Actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {actionTypes.map((a) => (
                <SelectItem key={a} value={a}>{a.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => fetchAudit()} className="text-xs h-8 gap-1">
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {loading && entries.length === 0 ? (
        <div className="space-y-2">{[0,1,2,3,4].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : entries.length === 0 ? (
        <EmptyState message="No activity entries found" icon={History} />
      ) : (
        <>
          <div className="rounded-xl border border-border/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="text-[10px] font-bold uppercase w-[140px]">Timestamp</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase w-[120px]">Actor</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase w-[130px]">Action</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase w-[100px]">Ticket</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase">Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e, idx) => {
                  const colors = ACTION_COLORS[e.action] || ACTION_COLORS.CREATED;
                  return (
                    <TableRow key={e.id} className={`table-row-hover ${idx % 2 === 1 ? 'bg-muted/15' : ''}`}>
                      <TableCell className="text-xs font-mono text-muted-foreground py-2">{fmtDateTime(e.createdAt)}</TableCell>
                      <TableCell className="text-xs font-medium py-2">{e.actorName || 'System'}</TableCell>
                      <TableCell className="py-2">
                        <Badge variant="outline" className={`text-[10px] font-semibold px-2 py-0.5 ${colors.bg} ${colors.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${colors.dot} mr-1`} />
                          {e.action.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono font-bold py-2">{e.ticketNo || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2 max-w-[250px] truncate">{e.description}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {entries.length < total && (
            <div className="text-center">
              <Button variant="outline" size="sm" onClick={() => fetchAudit(entries.length)} disabled={loading} className="text-xs gap-1">
                {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
                Load More ({total - entries.length} remaining)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}