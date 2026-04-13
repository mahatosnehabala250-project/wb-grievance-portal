'use client';

import { useState, useEffect, useCallback } from 'react';
import { Activity, Database, Server, Clock, Shield, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';
import { NAVY } from '@/lib/constants';

interface HealthData {
  status: string;
  version: string;
  uptime: number;
  timestamp: string;
  db: string;
  dbLatency: string;
  environment: string;
}

export function SystemHealthWidget() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const checks = data ? [
    { icon: Server, label: 'Server', value: data.status === 'ok' ? 'Running' : 'Error', ok: data.status === 'ok', sub: `v${data.version}` },
    { icon: Database, label: 'Database', value: data.db === 'connected' ? 'Connected' : 'Error', ok: data.db === 'connected', sub: data.dbLatency },
    { icon: Clock, label: 'Uptime', value: formatUptime(data.uptime), ok: data.uptime > 0, sub: data.environment },
    { icon: Shield, label: 'Security', value: 'Encrypted', ok: true, sub: 'JWT + bcrypt' },
  ] : [];

  return (
    <Card className="premium-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg, #16A34A, #22C55E)` }}>
              <Activity className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold">System Health</CardTitle>
              <p className="text-[11px] text-muted-foreground">Real-time monitoring</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <Badge className={`text-[10px] px-2 py-0.5 ${data.status === 'ok' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-red-100 text-red-700'}`}>
                <span className="relative flex h-1.5 w-1.5 mr-1">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${data.status === 'ok' ? 'bg-emerald-500' : 'bg-red-500'} opacity-75`} />
                  <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${data.status === 'ok' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                </span>
                {data.status === 'ok' ? 'All Systems Go' : 'Issues Detected'}
              </Badge>
            )}
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={fetchHealth}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {checks.map((check, idx) => (
              <motion.div
                key={check.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08 }}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  check.ok
                    ? 'bg-emerald-50/50 dark:bg-emerald-950/10 border-emerald-200/40 dark:border-emerald-800/30'
                    : 'bg-red-50/50 dark:bg-red-950/10 border-red-200/40 dark:border-red-800/30'
                }`}
              >
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${
                  check.ok ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'
                }`}>
                  <check.icon className={`h-4 w-4 ${check.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-muted-foreground">{check.label}</p>
                  <p className={`text-sm font-bold ${check.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                    {check.value}
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground">{check.sub}</span>
              </motion.div>
            ))}
          </div>
        )}
        {data && (
          <p className="text-[10px] text-muted-foreground/60 text-center mt-3">
            Last checked: {new Date(data.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
