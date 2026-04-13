'use client';

import { useState, useEffect, useCallback } from 'react';
import { Activity, Database, Server, Clock, RefreshCw, ShieldCheck, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { NAVY } from '@/lib/constants';
import { useI18nStore } from '@/lib/i18n-store';

interface HealthData {
  status: string;
  uptime: number;
  timestamp: string;
  version: string;
  db: string;
  dbLatencyMs: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatMemory(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PublicStatusPage() {
  const { t } = useI18nStore();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string>('');

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
        setLastChecked(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      } else {
        setError('Failed to fetch health data');
      }
    } catch {
      setError('Network error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  const getDbStatusColor = (status: string) => {
    if (status === 'connected') return { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800', icon: CheckCircle2 };
    if (status === 'degraded') return { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800', icon: AlertTriangle };
    return { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800', icon: XCircle };
  };

  if (loading && !health) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">{t('systemStatus')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('loading')}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-5">
                <div className="animate-pulse space-y-3">
                  <div className="h-4 w-24 bg-muted rounded" />
                  <div className="h-3 w-32 bg-muted rounded" />
                  <div className="h-3 w-20 bg-muted rounded" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error && !health) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">{t('systemStatus')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
        </div>
        <Button onClick={fetchHealth} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  if (!health) return null;

  const apiOk = health.status === 'ok';
  const dbInfo = getDbStatusColor(health.db);
  const DbIcon = dbInfo.icon;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">{t('systemStatus')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">West Bengal AI Public Support System</p>
        </div>
        <div className="flex items-center gap-2">
          {lastChecked && (
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              {t('lastChecked')}: {lastChecked}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchHealth}
            disabled={loading}
            className="text-xs gap-1.5"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {t('refreshData')}
          </Button>
        </div>
      </div>

      {/* Overall Status Banner */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="border-0 shadow-sm overflow-hidden" style={{ background: 'linear-gradient(135deg, #0A2463 0%, #1a3a7a 100%)' }}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-white/15 flex items-center justify-center">
                  <ShieldCheck className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">System Health</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`relative flex h-2.5 w-2.5`}>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                    </span>
                    <p className="text-xs font-semibold text-emerald-300">All Systems Operational</p>
                  </div>
                </div>
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200/60">Version</p>
                <p className="text-lg font-black text-white">v{health.version}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* API Status */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="border-0 shadow-sm hover:shadow-lg transition-all">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="h-10 w-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
                  <Activity className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t('operational')}</span>
                </div>
              </div>
              <p className="text-sm font-bold text-foreground">{t('apiStatus')}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                API server is responding normally
              </p>
              <div className="mt-3 pt-3 border-t border-border/50">
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {t('lastChecked')}: {lastChecked}
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Database Status */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="border-0 shadow-sm hover:shadow-lg transition-all">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div className={`h-10 w-10 rounded-xl ${dbInfo.bg} flex items-center justify-center`}>
                  <Database className={`h-5 w-5 ${dbInfo.text}`} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${dbInfo.dot}`} />
                  <span className={`text-xs font-semibold ${dbInfo.text}`}>
                    {health.db === 'connected' ? t('operational') : health.db === 'degraded' ? t('degraded') : t('down')}
                  </span>
                </div>
              </div>
              <p className="text-sm font-bold text-foreground">{t('databaseStatus')}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                SQLite database connection
              </p>
              <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Latency: {health.dbLatencyMs}ms
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Server Uptime */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="border-0 shadow-sm hover:shadow-lg transition-all">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="h-10 w-10 rounded-xl bg-sky-50 dark:bg-sky-950/30 flex items-center justify-center">
                  <Server className="h-5 w-5 text-sky-600 dark:text-sky-400" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t('operational')}</span>
                </div>
              </div>
              <p className="text-sm font-bold text-foreground">{t('serverUptime')}</p>
              <p className="text-xl font-black tabular-nums text-foreground mt-1">{formatUptime(health.uptime)}</p>
              <div className="mt-3 pt-3 border-t border-border/50">
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Since last restart
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* System Details */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Server className="h-4 w-4" style={{ color: NAVY }} />
              System Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Version</p>
                <p className="text-sm font-semibold text-foreground">v{health.version}</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Status</p>
                <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> OK
                </p>
              </div>
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">DB Latency</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">{health.dbLatencyMs}ms</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Memory (RSS)</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">{formatMemory(health.memory.rss)}</p>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-border/50">
              <p className="text-[10px] text-muted-foreground">
                Last refreshed: {health.timestamp ? new Date(health.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'N/A'}
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
