'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Zap,
  Clock,
  Server,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  Wifi,
  WifiOff,
  Gauge,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { motion, AnimatePresence } from 'framer-motion';
import { NAVY } from '@/lib/constants';

/* ══════════════════════════════════════════════════════════════
   TYPES
   ══════════════════════════════════════════════════════════════ */

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type EndpointStatus = 'loading' | 'healthy' | 'error';

interface EndpointCheck {
  id: string;
  path: string;
  method: HttpMethod;
  workflows: string[];
  description: string;
  testUrl: string;
  status: EndpointStatus;
  responseTime: number | null;
  statusCode: number | null;
  error: string | null;
  lastChecked: Date | null;
}

/* ══════════════════════════════════════════════════════════════
   ENDPOINT DEFINITIONS
   ══════════════════════════════════════════════════════════════ */

const ENDPOINTS: Omit<EndpointCheck, 'status' | 'responseTime' | 'statusCode' | 'error' | 'lastChecked'>[] = [
  {
    id: 'n8n-complaints',
    path: '/api/n8n/complaints',
    method: 'GET',
    workflows: ['WB-02', 'WB-05', 'WB-06', 'WB-08'],
    description: 'Public complaints feed',
    testUrl: '/api/n8n/complaints',
  },
  {
    id: 'n8n-complaints-id',
    path: '/api/n8n/complaints/[id]',
    method: 'PATCH',
    workflows: ['WB-02'],
    description: 'Update complaint by ID',
    testUrl: '/api/n8n/complaints/test-id-000',
  },
  {
    id: 'n8n-bulk-update',
    path: '/api/n8n/complaints/bulk-update',
    method: 'PATCH',
    workflows: ['WB-08'],
    description: 'Bulk update complaints',
    testUrl: '/api/n8n/complaints/bulk-update',
  },
  {
    id: 'n8n-sms-send',
    path: '/api/n8n/sms/send',
    method: 'POST',
    workflows: ['WB-03'],
    description: 'Send SMS notifications',
    testUrl: '/api/n8n/sms/send',
  },
  {
    id: 'n8n-stats',
    path: '/api/n8n/stats',
    method: 'GET',
    workflows: ['WB-06'],
    description: 'Dashboard statistics',
    testUrl: '/api/n8n/stats',
  },
  {
    id: 'n8n-reports-save',
    path: '/api/n8n/reports/save',
    method: 'POST',
    workflows: ['WB-06'],
    description: 'Save generated reports',
    testUrl: '/api/n8n/reports/save',
  },
  {
    id: 'n8n-airtable-sync',
    path: '/api/n8n/airtable/sync-analysis',
    method: 'POST',
    workflows: ['WB-07'],
    description: 'Sync analysis to Airtable',
    testUrl: '/api/n8n/airtable/sync-analysis',
  },
  {
    id: 'n8n-airtable-complaints',
    path: '/api/n8n/airtable/complaints',
    method: 'GET',
    workflows: ['WB-08'],
    description: 'Airtable complaints sync',
    testUrl: '/api/n8n/airtable/complaints',
  },
  {
    id: 'n8n-airtable-bulk',
    path: '/api/n8n/airtable/bulk-upsert',
    method: 'POST',
    workflows: ['WB-08'],
    description: 'Bulk upsert to Airtable',
    testUrl: '/api/n8n/airtable/bulk-upsert',
  },
  {
    id: 'complaints-search',
    path: '/api/complaints/search',
    method: 'GET',
    workflows: ['WB-01'],
    description: 'Duplicate phone check',
    testUrl: '/api/complaints/search?phone=test',
  },
  {
    id: 'complaints-escalate-batch',
    path: '/api/complaints/escalate-batch',
    method: 'POST',
    workflows: ['WB-05'],
    description: 'Batch escalate complaints',
    testUrl: '/api/complaints/escalate-batch',
  },
  {
    id: 'webhook-complaint',
    path: '/api/webhook/complaint',
    method: 'POST',
    workflows: ['WB-01'],
    description: 'WhatsApp webhook intake',
    testUrl: '/api/webhook/complaint',
  },
];

/* ══════════════════════════════════════════════════════════════
   ANIMATION VARIANTS
   ══════════════════════════════════════════════════════════════ */

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.9 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.25 } },
};

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  POST: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  PATCH: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400',
  PUT: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400',
  DELETE: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
};

function createInitialEndpoints(): EndpointCheck[] {
  return ENDPOINTS.map((ep) => ({
    ...ep,
    status: 'loading' as EndpointStatus,
    responseTime: null,
    statusCode: null,
    error: null,
    lastChecked: null,
  }));
}

function formatResponseTime(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 100) return `${ms}ms`;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getResponseTimeColor(ms: number | null): string {
  if (ms === null) return 'text-muted-foreground';
  if (ms < 200) return 'text-emerald-600 dark:text-emerald-400';
  if (ms < 500) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */

export function N8nEndpointHealth() {
  const [endpoints, setEndpoints] = useState<EndpointCheck[]>(createInitialEndpoints);
  const [isTestingAll, setIsTestingAll] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const healthyCount = endpoints.filter((ep) => ep.status === 'healthy').length;
  const errorCount = endpoints.filter((ep) => ep.status === 'error').length;
  const loadingCount = endpoints.filter((ep) => ep.status === 'loading').length;
  const totalCount = endpoints.length;
  const allDone = loadingCount === 0;

  const avgResponseTime = (() => {
    const withTime = endpoints.filter((ep) => ep.responseTime !== null);
    if (withTime.length === 0) return null;
    return Math.round(withTime.reduce((acc, ep) => acc + (ep.responseTime ?? 0), 0) / withTime.length);
  })();

  const testEndpoint = useCallback(async (endpoint: EndpointCheck, signal?: AbortSignal): Promise<EndpointCheck> => {
    const start = performance.now();
    try {
      const res = await fetch(endpoint.testUrl, {
        method: 'GET',
        signal,
      });
      const elapsed = Math.round(performance.now() - start);
      // Any non-5xx response means the endpoint is reachable
      const isHealthy = res.status < 500;
      return {
        ...endpoint,
        status: isHealthy ? 'healthy' : 'error',
        responseTime: elapsed,
        statusCode: res.status,
        error: isHealthy ? null : `HTTP ${res.status}`,
        lastChecked: new Date(),
      };
    } catch (err) {
      const elapsed = Math.round(performance.now() - start);
      const errorMsg = err instanceof DOMException && err.name === 'AbortError'
        ? 'Aborted'
        : 'Network error / Unreachable';
      return {
        ...endpoint,
        status: 'error',
        responseTime: elapsed,
        statusCode: null,
        error: errorMsg,
        lastChecked: new Date(),
      };
    }
  }, []);

  const testAllEndpoints = useCallback(async () => {
    // Abort any previous in-flight requests
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setIsTestingAll(true);
    setEndpoints((prev) =>
      prev.map((ep) => ({
        ...ep,
        status: 'loading' as EndpointStatus,
        responseTime: null,
        statusCode: null,
        error: null,
      }))
    );

    // Test all endpoints concurrently
    const results = await Promise.all(
      endpoints.map((ep) => testEndpoint(ep, controller.signal))
    );

    setEndpoints(results);
    setIsTestingAll(false);
  }, [endpoints, testEndpoint]);

  // Initial mount: test all
  useEffect(() => {
    testAllEndpoints();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      {/* ═══ HEADER ═══ */}
      <motion.div variants={fadeUp} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="h-11 w-11 rounded-xl flex items-center justify-center shadow-sm"
            style={{ backgroundColor: NAVY }}
          >
            <Activity className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-foreground">n8n Endpoint Health</h2>
              {allDone && (
                <Badge
                  className={`text-[9px] px-2 py-0 font-bold gap-1 ${
                    healthyCount === totalCount
                      ? 'bg-emerald-500 text-white'
                      : healthyCount > 0
                        ? 'bg-amber-500 text-white'
                        : 'bg-red-500 text-white'
                  }`}
                >
                  {healthyCount === totalCount ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : errorCount > 0 ? (
                    <AlertTriangle className="h-3 w-3" />
                  ) : (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  {healthyCount}/{totalCount} Healthy
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Real-time health check of all n8n-facing API endpoints
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDetails(!showDetails)}
            className="h-9 gap-2 text-xs"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${showDetails ? 'rotate-180' : ''}`}
            />
            {showDetails ? 'Compact' : 'Details'}
          </Button>
          <Button
            size="sm"
            onClick={testAllEndpoints}
            disabled={isTestingAll}
            className="h-9 gap-2 text-xs font-bold shadow-sm"
            style={{ backgroundColor: NAVY }}
          >
            <RefreshCw className={`h-4 w-4 ${isTestingAll ? 'animate-spin' : ''}`} />
            Test All
          </Button>
        </div>
      </motion.div>

      {/* ═══ SUMMARY CARDS ═══ */}
      <motion.div variants={fadeUp} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Total Endpoints */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Server className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Total
            </span>
          </div>
          <p className="text-2xl font-black text-foreground">{totalCount}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">API endpoints</p>
        </Card>

        {/* Healthy */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wifi className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Healthy
            </span>
          </div>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
            {healthyCount}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Responding 2xx–4xx</p>
        </Card>

        {/* Errors */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <WifiOff className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Errors
            </span>
          </div>
          <p className="text-2xl font-black text-red-600 dark:text-red-400">{errorCount}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Failed / 5xx</p>
        </Card>

        {/* Avg Response Time */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Gauge className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Avg Latency
            </span>
          </div>
          <p className="text-2xl font-black text-foreground">
            {avgResponseTime !== null ? `${avgResponseTime}ms` : '—'}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Across all endpoints</p>
        </Card>
      </motion.div>

      {/* ═══ OVERALL STATUS BAR ═══ */}
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-muted-foreground">Overall Health</span>
              <span className="text-xs font-bold text-muted-foreground">
                {healthyCount}/{totalCount} endpoints ({Math.round((healthyCount / totalCount) * 100)}%)
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{
                  width: `${totalCount > 0 ? (healthyCount / totalCount) * 100 : 0}%`,
                  backgroundColor:
                    healthyCount === totalCount
                      ? '#16A34A'
                      : healthyCount > totalCount * 0.5
                        ? '#F59E0B'
                        : '#EF4444',
                }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
          </div>
        </Card>
      </motion.div>

      {/* ═══ ENDPOINT LIST ═══ */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader className="pb-3 px-4 pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" style={{ color: NAVY }} />
                <CardTitle className="text-sm font-bold">Endpoint Status</CardTitle>
                <Badge variant="secondary" className="text-[10px]">
                  {totalCount} endpoints
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  <span>Healthy</span>
                </div>
                <div className="flex items-center gap-1">
                  <XCircle className="h-3 w-3 text-red-500" />
                  <span>Error</span>
                </div>
                <div className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />
                  <span>Loading</span>
                </div>
              </div>
            </div>
            <CardDescription className="text-[11px]">
              Real-time response check of all n8n-facing API routes
            </CardDescription>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
              <div className="space-y-2">
                <AnimatePresence mode="popLayout">
                  {endpoints.map((ep, idx) => (
                    <motion.div
                      key={ep.id}
                      variants={scaleIn}
                      initial="hidden"
                      animate="show"
                      exit="hidden"
                      transition={{ delay: idx * 0.03 }}
                      className={`group relative rounded-xl border transition-all duration-200 ${
                        ep.status === 'healthy'
                          ? 'bg-emerald-50/40 dark:bg-emerald-950/10 border-emerald-200/50 dark:border-emerald-800/30 hover:border-emerald-300/70'
                          : ep.status === 'error'
                            ? 'bg-red-50/40 dark:bg-red-950/10 border-red-200/50 dark:border-red-800/30 hover:border-red-300/70'
                            : 'bg-amber-50/30 dark:bg-amber-950/5 border-amber-200/40 dark:border-amber-800/20'
                      }`}
                    >
                      <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                        {/* Status Icon */}
                        <div className="shrink-0">
                          {ep.status === 'healthy' && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                            >
                              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                            </motion.div>
                          )}
                          {ep.status === 'error' && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                            >
                              <XCircle className="h-5 w-5 text-red-500" />
                            </motion.div>
                          )}
                          {ep.status === 'loading' && (
                            <Loader2 className="h-5 w-5 text-amber-500 animate-spin" />
                          )}
                        </div>

                        {/* Endpoint Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* HTTP Method Badge */}
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${METHOD_COLORS[ep.method]}`}
                            >
                              {ep.method}
                            </span>

                            {/* Endpoint Path — monospace */}
                            <code className="text-xs font-mono font-semibold text-foreground truncate">
                              {ep.path}
                            </code>
                          </div>

                          {/* Description */}
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                            {ep.description}
                          </p>

                          {/* Expanded Details */}
                          <AnimatePresence>
                            {showDetails && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                              >
                                <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30">
                                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    Response: {formatResponseTime(ep.responseTime)}
                                  </span>
                                  {ep.statusCode !== null && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                      <ExternalLink className="h-3 w-3" />
                                      Status: {ep.statusCode}
                                    </span>
                                  )}
                                  {ep.lastChecked && (
                                    <span className="text-[10px] text-muted-foreground">
                                      Checked: {ep.lastChecked.toLocaleTimeString('en-IN', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                      })}
                                    </span>
                                  )}
                                </div>
                                {ep.error && (
                                  <p className="text-[10px] text-red-600 dark:text-red-400 mt-1 font-mono">
                                    {ep.error}
                                  </p>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        {/* Workflow Badges */}
                        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                          {ep.workflows.map((wf) => (
                            <Badge
                              key={wf}
                              variant="outline"
                              className="text-[9px] px-1.5 py-0 font-mono font-bold border-foreground/10"
                            >
                              {wf}
                            </Badge>
                          ))}
                        </div>

                        {/* Response Time (always visible, compact) */}
                        <div className="shrink-0 text-right min-w-[50px]">
                          {ep.status === 'loading' ? (
                            <Skeleton className="h-4 w-12 rounded" />
                          ) : (
                            <span
                              className={`text-[11px] font-mono font-bold ${getResponseTimeColor(ep.responseTime)}`}
                            >
                              {formatResponseTime(ep.responseTime)}
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ WORKFLOW → ENDPOINT MAPPING ═══ */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader className="pb-3 px-4 pt-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4" style={{ color: NAVY }} />
              <CardTitle className="text-sm font-bold">Workflow → Endpoint Mapping</CardTitle>
            </div>
            <CardDescription className="text-[11px]">
              Which workflows depend on which API endpoints
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {[
                { workflow: 'WB-01', name: 'WhatsApp Intake', color: 'border-emerald-300 dark:border-emerald-700' },
                { workflow: 'WB-02', name: 'Auto-Assignment', color: 'border-blue-300 dark:border-blue-700' },
                { workflow: 'WB-03', name: 'Status Notification', color: 'border-purple-300 dark:border-purple-700' },
                { workflow: 'WB-05', name: 'SLA Escalation', color: 'border-red-300 dark:border-red-700' },
                { workflow: 'WB-06', name: 'Daily Report', color: 'border-cyan-300 dark:border-cyan-700' },
                { workflow: 'WB-07', name: 'AI Brain', color: 'border-amber-300 dark:border-amber-700' },
                { workflow: 'WB-08', name: 'Airtable Sync', color: 'border-teal-300 dark:border-teal-700' },
              ].map((wf) => {
                const wfEndpoints = endpoints.filter((ep) => ep.workflows.includes(wf.workflow));
                const wfHealthy = wfEndpoints.filter((ep) => ep.status === 'healthy').length;
                const wfTotal = wfEndpoints.length;
                const allWfHealthy = wfTotal > 0 && wfHealthy === wfTotal;
                return (
                  <div
                    key={wf.workflow}
                    className={`rounded-lg border-l-4 ${wf.color} p-3 bg-muted/30`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold font-mono">{wf.workflow}</span>
                        <span className="text-[10px] text-muted-foreground">{wf.name}</span>
                      </div>
                      <Badge
                        className={`text-[9px] px-1.5 py-0 font-bold ${
                          allWfHealthy
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                        }`}
                      >
                        {wfHealthy}/{wfTotal}
                      </Badge>
                    </div>
                    <div className="space-y-0.5">
                      {wfEndpoints.map((ep) => (
                        <div
                          key={ep.id}
                          className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                        >
                          {ep.status === 'healthy' ? (
                            <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                          ) : ep.status === 'error' ? (
                            <XCircle className="h-2.5 w-2.5 text-red-500 shrink-0" />
                          ) : (
                            <Loader2 className="h-2.5 w-2.5 text-amber-500 animate-spin shrink-0" />
                          )}
                          <code className="font-mono truncate">{ep.path}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ FOOTER NOTE ═══ */}
      <motion.div variants={fadeUp} className="text-center py-2">
        <p className="text-[10px] text-muted-foreground/60">
          Endpoints are tested using GET requests. Non-GET endpoints (POST/PATCH) are checked for reachability only.
          &middot; Auto-refreshed on mount &middot; Click &quot;Test All&quot; to re-check
        </p>
      </motion.div>
    </motion.div>
  );
}

export default N8nEndpointHealth;
