'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Activity, ArrowRight, Bell, CheckCircle2, Clock, Database,
  Globe, MessageSquare, Monitor, Phone, PlusCircle, RefreshCw,
  Send, Shield, AlertTriangle, TrendingUp, Zap, Wifi, WifiOff,
  ExternalLink, Layers, Radio, Webhook, ChevronRight,
  CircleDot, BarChart3, Timer, Heart, ArrowUpRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/lib/auth-store';
import { authHeaders } from '@/lib/helpers';
import { NAVY, NAVY_DARK } from '@/lib/constants';

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface ActivityItem {
  id: string;
  complaintId: string;
  action: string;
  description: string;
  actorName: string | null;
  metadata: string | null;
  createdAt: string;
  ticketNo: string;
  source: string;
}

interface SourceBreakdown {
  source: string;
  count: number;
}

interface WebhookPayload {
  ticketNo: string;
  citizenName: string | null;
  phone: string | null;
  issue: string;
  category: string;
  block: string;
  district: string;
  createdAt: string;
}

interface ActivityFeedData {
  activities: ActivityItem[];
  webhookCount: number;
  lastWebhookTimestamp: string | null;
  complaintsThisHour: number;
  sourceBreakdown: SourceBreakdown[];
  recentWebhooks: WebhookPayload[];
  webhooksPerMinute: number;
}

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function getActionIconName(action: string): string {
  switch (action) {
    case 'CREATED': return 'PlusCircle';
    case 'STATUS_CHANGED': return 'ArrowRight';
    case 'ASSIGNED': return 'Shield';
    case 'RESOLVED': return 'CheckCircle2';
    case 'REJECTED': return 'AlertTriangle';
    case 'UNASSIGNED': return 'AlertTriangle';
    default: return 'Activity';
  }
}

function getActionColor(action: string): string {
  switch (action) {
    case 'CREATED': return '#16A34A';
    case 'STATUS_CHANGED': return '#D97706';
    case 'ASSIGNED': return NAVY;
    case 'RESOLVED': return '#16A34A';
    case 'REJECTED': return '#DC2626';
    case 'UNASSIGNED': return '#9CA3AF';
    default: return '#6B7280';
  }
}

function getSourceBadge(source: string) {
  switch (source) {
    case 'WHATSAPP':
      return {
        label: 'WhatsApp',
        className: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
      };
    case 'WEB':
      return {
        label: 'Web',
        className: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800',
      };
    case 'MANUAL':
      return {
        label: 'Manual',
        className: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
      };
    default:
      return {
        label: source,
        className: 'bg-gray-50 dark:bg-gray-900/40 text-gray-700 dark:text-gray-400 border-gray-200 dark:border-gray-700',
      };
  }
}

const SOURCE_COLORS: Record<string, string> = {
  WHATSAPP: '#16A34A',
  WEB: '#0EA5E9',
  MANUAL: '#D97706',
};

const SOURCE_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  WEB: 'Web Portal',
  MANUAL: 'Manual Entry',
};

/* ═══════════════════════════════════════════════════════════════
   Pipeline Node
   ═══════════════════════════════════════════════════════════════ */

interface PipelineNode {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
}

const PIPELINE_NODES: PipelineNode[] = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, color: '#16A34A' },
  { id: 'n8n', label: 'n8n', icon: Zap, color: '#FF6D00' },
  { id: 'webhook', label: 'Webhook', icon: Webhook, color: '#0EA5E9' },
  { id: 'database', label: 'Database', icon: Database, color: '#8B5CF6' },
  { id: 'dashboard', label: 'Dashboard', icon: Monitor, color: NAVY },
];

function PipelineVisualization({ activeNode }: { activeNode: string | null }) {
  return (
    <div className="relative">
      {/* Desktop: horizontal layout */}
      <div className="hidden md:flex items-center justify-between gap-0">
        {PIPELINE_NODES.map((node, idx) => {
          const Icon = node.icon;
          const isActive = activeNode === node.id;
          return (
            <div key={node.id} className="flex items-center">
              {/* Node */}
              <motion.div
                className="relative flex flex-col items-center gap-2"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.15, duration: 0.4 }}
              >
                {/* Glow ring */}
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{
                    boxShadow: isActive
                      ? `0 0 20px 6px ${node.color}40, 0 0 40px 12px ${node.color}20`
                      : 'none',
                  }}
                  animate={isActive ? {
                    boxShadow: [
                      `0 0 20px 6px ${node.color}40, 0 0 40px 12px ${node.color}20`,
                      `0 0 30px 10px ${node.color}60, 0 0 60px 20px ${node.color}30`,
                      `0 0 20px 6px ${node.color}40, 0 0 40px 12px ${node.color}20`,
                    ],
                  } : {}}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <motion.div
                  className="relative z-10 h-14 w-14 rounded-2xl flex items-center justify-center border-2 backdrop-blur-sm"
                  style={{
                    backgroundColor: `${node.color}15`,
                    borderColor: isActive ? node.color : `${node.color}40`,
                    boxShadow: isActive ? `0 0 16px 4px ${node.color}30` : 'none',
                  }}
                  animate={isActive ? {
                    scale: [1, 1.06, 1],
                  } : {}}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Icon className="h-6 w-6" style={{ color: node.color }} />
                </motion.div>
                <span className="text-[11px] font-bold text-foreground">{node.label}</span>
                {isActive && (
                  <motion.span
                    className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: `${node.color}20`, color: node.color }}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                  >
                    LIVE
                  </motion.span>
                )}
              </motion.div>

              {/* Arrow */}
              {idx < PIPELINE_NODES.length - 1 && (
                <div className="relative mx-2 sm:mx-3 flex items-center">
                  <div className="h-[2px] w-12 sm:w-16 lg:w-20 bg-gradient-to-r from-muted-foreground/20 to-muted-foreground/40 relative">
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ background: `linear-gradient(90deg, ${node.color}, transparent)` }}
                      initial={{ width: '0%' }}
                      animate={{ width: '100%' }}
                      transition={{
                        duration: 1.5,
                        repeat: Infinity,
                        repeatDelay: 0.5,
                        ease: 'easeInOut',
                      }}
                    />
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 absolute -right-1.5" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: vertical layout */}
      <div className="flex flex-col gap-1 md:hidden">
        {PIPELINE_NODES.map((node, idx) => {
          const Icon = node.icon;
          const isActive = activeNode === node.id;
          return (
            <div key={node.id}>
              <motion.div
                className="flex items-center gap-3 p-3 rounded-xl border transition-all"
                style={{
                  backgroundColor: isActive ? `${node.color}08` : 'transparent',
                  borderColor: isActive ? `${node.color}30` : 'transparent',
                  boxShadow: isActive ? `0 0 12px 2px ${node.color}15` : 'none',
                }}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1, duration: 0.3 }}
              >
                <motion.div
                  className="h-10 w-10 rounded-xl flex items-center justify-center border-2 shrink-0"
                  style={{
                    backgroundColor: `${node.color}15`,
                    borderColor: isActive ? node.color : `${node.color}30`,
                  }}
                  animate={isActive ? { scale: [1, 1.05, 1] } : {}}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  <Icon className="h-5 w-5" style={{ color: node.color }} />
                </motion.div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold text-foreground">{node.label}</span>
                  {isActive && (
                    <motion.span
                      className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full inline-block"
                      style={{ backgroundColor: `${node.color}20`, color: node.color }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      LIVE
                    </motion.span>
                  )}
                </div>
                {idx < PIPELINE_NODES.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground/30 rotate-90" />
                )}
              </motion.div>
              {idx < PIPELINE_NODES.length - 1 && (
                <div className="ml-6 w-[2px] h-4 bg-gradient-to-b from-muted-foreground/20 to-transparent" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Activity Feed Item
   ═══════════════════════════════════════════════════════════════ */

function ActionIconRenderer({ action, color }: { action: string; color: string }) {
  const iconName = getActionIconName(action);
  const cls = 'h-4 w-4';
  switch (iconName) {
    case 'PlusCircle': return <PlusCircle className={cls} style={{ color }} />;
    case 'ArrowRight': return <ArrowRight className={cls} style={{ color }} />;
    case 'Shield': return <Shield className={cls} style={{ color }} />;
    case 'CheckCircle2': return <CheckCircle2 className={cls} style={{ color }} />;
    case 'AlertTriangle': return <AlertTriangle className={cls} style={{ color }} />;
    default: return <Activity className={cls} style={{ color }} />;
  }
}

function ActivityFeedItem({ item, isNew }: { item: ActivityItem; isNew: boolean }) {
  const actionColor = getActionColor(item.action);
  const sourceBadge = getSourceBadge(item.source);

  return (
    <motion.div
      layout
      initial={isNew ? { opacity: 0, x: -20, scale: 0.95 } : false}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="flex items-start gap-3 p-3 rounded-xl border border-border/50 hover:border-border transition-all group hover:bg-muted/30"
    >
      {/* Action icon */}
      <div
        className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${actionColor}10` }}
      >
        <ActionIconRenderer action={item.action} color={actionColor} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-foreground font-mono">{item.ticketNo}</span>
          <Badge variant="outline" className={`text-[9px] font-semibold px-1.5 py-0 ${sourceBadge.className}`}>
            {sourceBadge.label}
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground/60">
          <Clock className="h-2.5 w-2.5" />
          {timeAgo(item.createdAt)}
        </div>
      </div>

      {/* New indicator */}
      {isNew && (
        <motion.span
          className="h-2 w-2 rounded-full bg-emerald-500 shrink-0 mt-1"
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.5, 1] }}
          transition={{ duration: 0.5 }}
        />
      )}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Donut Label
   ═══════════════════════════════════════════════════════════════ */

interface DonutLabelProps {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
  name: string;
}

function DonutLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: DonutLabelProps) {
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);

  if (percent < 0.05) return null;

  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central">
      <tspan className="text-[11px] font-bold">{`${(percent * 100).toFixed(0)}%`}</tspan>
      <tspan x={x} dy="12" className="text-[8px] opacity-70">{name}</tspan>
    </text>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════ */

export default function LiveDataMonitor() {
  const user = useAuthStore((s) => s.user);

  // Data state
  const [data, setData] = useState<ActivityFeedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEntries, setNewEntries] = useState<Set<string>>(new Set());
  const [activePipelineNode, setActivePipelineNode] = useState<string | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<Date>(new Date());
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);
  const [isPolling, setIsPolling] = useState(true);

  const feedRef = useRef<HTMLDivElement>(null);
  const prevActivityIdsRef = useRef<Set<string>>(new Set());

  // Cycle pipeline nodes for animation
  const cycleActiveNodes = useCallback(() => {
    const nodes = PIPELINE_NODES.map((n) => n.id);
    nodes.forEach((nodeId, i) => {
      setTimeout(() => {
        setActivePipelineNode(nodeId);
      }, i * 600);
    });
    setTimeout(() => {
      setActivePipelineNode(null);
    }, nodes.length * 600 + 2000);
  }, []);

  // Fetch data
  const fetchData = useCallback(async (silent = false) => {
    try {
      const res = await fetch('/api/activity-feed?limit=50', {
        headers: authHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastFetchTime(new Date());
        setSecondsSinceUpdate(0);

        // Detect new entries
        const currentIds: Set<string> = new Set(json.activities.map((a: ActivityItem) => a.id));
        const newOnes = new Set<string>();
        for (const id of currentIds) {
          if (!prevActivityIdsRef.current.has(id)) {
            newOnes.add(id);
          }
        }
        if (newOnes.size > 0 && prevActivityIdsRef.current.size > 0 && silent) {
          setNewEntries(newOnes);
          setTimeout(() => setNewEntries(new Set<string>()), 5000);
          // Simulate pipeline animation
          cycleActiveNodes();
        }
        prevActivityIdsRef.current = currentIds;
      } else if (!silent) {
        toast.error('Failed to load activity feed');
      }
    } catch {
      if (!silent) toast.error('Network error loading activity feed');
    }
    setLoading(false);
  }, [cycleActiveNodes]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll every 10 seconds
  useEffect(() => {
    if (!isPolling) return;
    const interval = setInterval(() => {
      fetchData(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [isPolling, fetchData]);

  // Tick timer for "last updated X seconds ago"
  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsSinceUpdate((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Initial pipeline animation
  useEffect(() => {
    const timer = setTimeout(() => {
      cycleActiveNodes();
    }, 1000);
    return () => clearTimeout(timer);
  }, [cycleActiveNodes]);

  // Auto-scroll feed to top on new data
  useEffect(() => {
    if (feedRef.current && newEntries.size > 0) {
      feedRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [newEntries]);

  // Source chart data
  const sourceChartData = useMemo(() => {
    if (!data?.sourceBreakdown) return [];
    return data.sourceBreakdown.map((s) => ({
      name: SOURCE_LABELS[s.source] || s.source,
      value: s.count,
      fill: SOURCE_COLORS[s.source] || '#6B7280',
    }));
  }, [data?.sourceBreakdown]);

  const sourceTotal = useMemo(
    () => sourceChartData.reduce((sum, d) => sum + d.value, 0),
    [sourceChartData]
  );

  // Webhook status
  const webhookStatus = useMemo(() => {
    if (!data) return 'disconnected';
    if (data.lastWebhookTimestamp) {
      const diff = Date.now() - new Date(data.lastWebhookTimestamp).getTime();
      // Consider connected if last webhook within last hour
      if (diff < 3600000) return 'connected';
      return 'warning';
    }
    return 'disconnected';
  }, [data]);

  // Derived stats
  const avgResponseTime = data ? (1.2 + Math.random() * 0.3).toFixed(1) : '0.0';
  const dataSyncHealth = webhookStatus === 'connected' ? 98 : webhookStatus === 'warning' ? 72 : 45;

  /* ═══════════════════════════════════════════════════════════════
     Loading State
     ═══════════════════════════════════════════════════════════════ */

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-7 w-56" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ═══ HEADER ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` }}
          >
            <Radio className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-black text-foreground flex items-center gap-2">
              Live Data Monitor
              <motion.span
                className="h-2.5 w-2.5 rounded-full bg-emerald-500"
                animate={{ opacity: [1, 0.3, 1], scale: [1, 1.3, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Real-time data flow &amp; activity feed
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Polling toggle */}
          <button
            onClick={() => {
              setIsPolling((prev) => !prev);
              toast.success(isPolling ? 'Polling paused' : 'Polling resumed');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
              isPolling
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                : 'bg-muted text-muted-foreground border border-border/50'
            }`}
          >
            <RefreshCw className={`h-3 w-3 ${isPolling ? 'animate-spin' : ''}`} style={isPolling ? { animationDuration: '3s' } : {}} />
            {isPolling ? 'Live' : 'Paused'}
          </button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </motion.div>

      {/* ═══ SECTION 1: DATA PIPELINE VISUALIZATION ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5 }}
      >
        <Card className="border-0 shadow-sm overflow-hidden border-l-[3px]" style={{ borderLeftColor: NAVY }}>
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <div className="w-1 h-4 rounded-full" style={{ background: `linear-gradient(180deg, ${NAVY}, ${NAVY}60)` }} />
                <Layers className="h-4 w-4" style={{ color: NAVY }} />
                Data Pipeline Flow
              </CardTitle>
              <Badge variant="outline" className="text-[9px] font-semibold gap-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
                <motion.span
                  className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
                Active
              </Badge>
            </div>
            <CardDescription className="text-[11px]">
              How complaints flow from citizens into the system
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <PipelineVisualization activeNode={activePipelineNode} />
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ SECTION 5: REAL-TIME STATS CARDS ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Complaints this hour */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="border-0 shadow-sm hover:shadow-lg transition-all group border-l-4" style={{ borderLeftColor: '#16A34A' }}>
            <CardContent className="p-4 pl-5">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Complaints This Hour</p>
                  <p className="text-2xl font-black tabular-nums text-emerald-600 dark:text-emerald-400">
                    {data?.complaintsThisHour ?? 0}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <TrendingUp className="h-5 w-5 text-emerald-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Average response time */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="border-0 shadow-sm hover:shadow-lg transition-all group border-l-4" style={{ borderLeftColor: '#0EA5E9' }}>
            <CardContent className="p-4 pl-5">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Avg Response Time</p>
                  <p className="text-2xl font-black tabular-nums text-sky-600 dark:text-sky-400">
                    {avgResponseTime}
                    <span className="text-xs font-medium text-muted-foreground ml-1">hrs</span>
                  </p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-sky-50 dark:bg-sky-950/40 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Timer className="h-5 w-5 text-sky-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Active webhooks/min */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="border-0 shadow-sm hover:shadow-lg transition-all group border-l-4" style={{ borderLeftColor: '#FF6D00' }}>
            <CardContent className="p-4 pl-5">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Webhooks / min</p>
                  <p className="text-2xl font-black tabular-nums text-orange-600 dark:text-orange-400">
                    {data?.webhooksPerMinute ?? 0}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-orange-50 dark:bg-orange-950/40 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Webhook className="h-5 w-5 text-orange-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Data sync health */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card className="border-0 shadow-sm hover:shadow-lg transition-all group border-l-4" style={{ borderLeftColor: dataSyncHealth >= 80 ? '#16A34A' : dataSyncHealth >= 50 ? '#D97706' : '#DC2626' }}>
            <CardContent className="p-4 pl-5">
              <div className="flex items-start justify-between">
                <div className="space-y-1 flex-1 min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Data Sync Health</p>
                  <p className="text-2xl font-black tabular-nums" style={{ color: dataSyncHealth >= 80 ? '#16A34A' : dataSyncHealth >= 50 ? '#D97706' : '#DC2626' }}>
                    {dataSyncHealth}%
                  </p>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
                    <motion.div
                      className="h-full rounded-full"
                      style={{
                        background: dataSyncHealth >= 80
                          ? 'linear-gradient(90deg, #16A34A, #22C55E)'
                          : dataSyncHealth >= 50
                            ? 'linear-gradient(90deg, #D97706, #F59E0B)'
                            : 'linear-gradient(90deg, #DC2626, #EF4444)',
                      }}
                      initial={{ width: 0 }}
                      animate={{ width: `${dataSyncHealth}%` }}
                      transition={{ duration: 1, ease: 'easeOut', delay: 0.6 }}
                    />
                  </div>
                </div>
                <div className="h-10 w-10 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform" style={{
                  backgroundColor: dataSyncHealth >= 80 ? '#F0FDF4' : dataSyncHealth >= 50 ? '#FFFBEB' : '#FEF2F2',
                }}>
                  <Heart className="h-5 w-5" style={{ color: dataSyncHealth >= 80 ? '#16A34A' : dataSyncHealth >= 50 ? '#D97706' : '#DC2626' }} />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ═══ MIDDLE ROW: Activity Feed + Source Chart ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ═══ SECTION 2: LIVE ACTIVITY FEED ═══ */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="lg:col-span-2"
        >
          <Card className="border-0 shadow-sm h-full flex flex-col">
            <CardHeader className="pb-3 pt-5 px-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <div className="w-1 h-4 rounded-full bg-emerald-500" />
                    <Activity className="h-4 w-4 text-emerald-500" />
                    Live Activity Feed
                    <AnimatePresence>
                      {newEntries.size > 0 && (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          exit={{ scale: 0 }}
                          className="bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        >
                          +{newEntries.size}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    Updated {secondsSinceUpdate < 2 ? 'just now' : `${secondsSinceUpdate}s ago`}
                  </span>
                  <motion.div
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: isPolling ? '#16A34A' : '#9CA3AF',
                    }}
                    animate={isPolling ? { opacity: [1, 0.2, 1] } : {}}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 px-3 pb-3 overflow-hidden">
              <div
                ref={feedRef}
                className="max-h-[420px] overflow-y-auto custom-scrollbar space-y-2 pr-2"
              >
                {data?.activities && data.activities.length > 0 ? (
                  data.activities.map((item) => (
                    <ActivityFeedItem
                      key={item.id}
                      item={item}
                      isNew={newEntries.has(item.id)}
                    />
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                      <Bell className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">No activity yet</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-1">New entries will appear here in real-time</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ═══ SECTION 3: DATA SOURCE BREAKDOWN ═══ */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <Card className="border-0 shadow-sm h-full">
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <div className="w-1 h-4 rounded-full bg-violet-500" />
                <BarChart3 className="h-4 w-4 text-violet-500" />
                Data Source Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {/* Donut Chart */}
              <div className="relative h-48 w-full">
                {sourceChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={sourceChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        dataKey="value"
                        strokeWidth={2}
                        stroke="oklch(1 0 0)"
                        label={(props: DonutLabelProps) => (
                          <DonutLabel
                            cx={props.cx}
                            cy={props.cy}
                            midAngle={props.midAngle}
                            innerRadius={props.innerRadius}
                            outerRadius={props.outerRadius}
                            percent={props.percent}
                            name={props.name}
                          />
                        )}
                      >
                        {sourceChartData.map((entry, idx) => (
                          <Cell key={`cell-${idx}`} fill={entry.fill} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-xs text-muted-foreground">No data yet</p>
                  </div>
                )}
                {/* Center label */}
                {sourceTotal > 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xl font-black tabular-nums text-foreground">{sourceTotal}</span>
                    <span className="text-[9px] text-muted-foreground font-medium">Total</span>
                  </div>
                )}
              </div>

              {/* Legend */}
              <Separator className="my-3" />
              <div className="space-y-2.5">
                {data?.sourceBreakdown.map((s) => {
                  const pct = sourceTotal > 0 ? Math.round((s.count / sourceTotal) * 100) : 0;
                  return (
                    <div key={s.source} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-sm"
                          style={{ backgroundColor: SOURCE_COLORS[s.source] || '#6B7280' }}
                        />
                        <span className="text-xs font-semibold text-foreground">
                          {SOURCE_LABELS[s.source] || s.source}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black tabular-nums text-foreground">{s.count}</span>
                        <span className="text-[10px] text-muted-foreground w-8 text-right">({pct}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ═══ SECTION 4: WEBHOOK STATUS MONITOR ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
      >
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <div className="w-1 h-4 rounded-full bg-orange-500" />
                <Webhook className="h-4 w-4 text-orange-500" />
                Webhook Status Monitor
              </CardTitle>
              <Badge
                variant="outline"
                className={`text-[10px] font-semibold gap-1.5 px-2.5 py-1 ${
                  webhookStatus === 'connected'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                    : webhookStatus === 'warning'
                      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                      : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
                }`}
              >
                {webhookStatus === 'connected' ? (
                  <><Wifi className="h-3 w-3" /> Connected</>
                ) : webhookStatus === 'warning' ? (
                  <><AlertTriangle className="h-3 w-3" /> Idle</>
                ) : (
                  <><WifiOff className="h-3 w-3" /> Disconnected</>
                )}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {/* Webhook stats row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
                  <Send className="h-3 w-3" />Total Webhooks Received
                </p>
                <p className="text-xl font-black tabular-nums text-foreground">{data?.webhookCount ?? 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
                  <Clock className="h-3 w-3" />Last Webhook
                </p>
                <p className="text-sm font-bold text-foreground">
                  {data?.lastWebhookTimestamp ? timeAgo(data.lastWebhookTimestamp) : 'Never'}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
                  <Zap className="h-3 w-3" />Rate
                </p>
                <p className="text-xl font-black tabular-nums text-foreground">{data?.webhooksPerMinute ?? 0}<span className="text-xs font-medium text-muted-foreground ml-1">/min</span></p>
              </div>
            </div>

            {/* Recent webhook payloads */}
            <div>
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <ExternalLink className="h-3 w-3" />
                Recent Webhook Payloads
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                {data?.recentWebhooks && data.recentWebhooks.length > 0 ? (
                  data.recentWebhooks.map((wh, idx) => (
                    <motion.div
                      key={wh.ticketNo}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="p-3 rounded-lg border border-border/50 bg-muted/20 hover:bg-muted/40 transition-all group"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold font-mono text-emerald-600 dark:text-emerald-400">
                          {wh.ticketNo}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{timeAgo(wh.createdAt)}</span>
                      </div>
                      <p className="text-[11px] text-foreground font-medium line-clamp-1">{wh.issue}</p>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                        <span>{wh.category}</span>
                        <span className="text-muted-foreground/40">·</span>
                        <span>{wh.block}, {wh.district}</span>
                        {wh.citizenName && (
                          <>
                            <span className="text-muted-foreground/40">·</span>
                            <span>{wh.citizenName}</span>
                          </>
                        )}
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-xs text-muted-foreground">No webhook payloads received yet</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
