'use client';

import { useState, useEffect, useCallback } from 'react';
import { Brain, AlertTriangle, TrendingUp, MapPin, Activity, RefreshCw, CheckCircle, XCircle, Eye, Zap, Shield, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import { CATEGORY_LABELS } from '@/lib/constants';

interface IntelAlert {
  id: string;
  alert_type: string;
  category: string;
  district: string;
  block: string | null;
  severity: number;
  confidence: number;
  complaint_count: number;
  trend_direction: string;
  status: string;
  title: string;
  summary: string;
  recommended_action: string;
  ai_brief: string | null;
  created_at: string;
  acknowledged_by: string | null;
}

interface IntelSummary {
  active_alerts: number;
  critical_alerts: number;
  high_alerts: number;
  districts_at_risk: number;
  latest_alerts: IntelAlert[] | null;
  trend_7day: Array<{ day: string; total: number; urgent: number }> | null;
  category_velocity: Array<{ category: string; last_24h: number; last_7d: number; last_30d: number }> | null;
}

const ALERT_TYPE_LABELS: Record<string, string> = {
  GEOGRAPHIC_CLUSTER: 'Geographic Cluster',
  FREQUENCY_SPIKE: 'Frequency Spike',
  CROSS_CATEGORY: 'Cross-Category Signal',
  SEASONAL_ANOMALY: 'Seasonal Anomaly',
};

function getSeverityColor(severity: number) {
  if (severity >= 75) return { bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800', badge: 'destructive' as const };
  if (severity >= 50) return { bg: 'bg-orange-50 dark:bg-orange-950/40', text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800', badge: 'default' as const };
  return { bg: 'bg-yellow-50 dark:bg-yellow-950/40', text: 'text-yellow-700 dark:text-yellow-500', border: 'border-yellow-200 dark:border-yellow-800', badge: 'outline' as const };
}

function SeverityBar({ value }: { value: number }) {
  const color = value >= 75 ? 'bg-red-500' : value >= 50 ? 'bg-orange-500' : 'bg-yellow-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums w-7">{value}</span>
    </div>
  );
}

export function IntelligenceView() {
  const [data, setData] = useState<{ summary: IntelSummary; alerts: IntelAlert[]; runs: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/intelligence', { headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e) {
      toast.error('Failed to load intelligence data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAction(id: string, action: string) {
    setActionLoading(id + action);
    try {
      const res = await fetch('/api/intelligence', {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) throw new Error();
      toast.success(action === 'acknowledge' ? 'Alert acknowledged' : action === 'resolve' ? 'Alert resolved' : 'Marked as false positive');
      load();
    } catch {
      toast.error('Failed to update alert');
    } finally {
      setActionLoading(null);
    }
  }

  const summary = data?.summary;
  const alerts = data?.alerts || [];
  const criticals = alerts.filter(a => a.severity >= 75);
  const highs = alerts.filter(a => a.severity >= 50 && a.severity < 75);
  const mediums = alerts.filter(a => a.severity < 50);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <Brain className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-medium">Intelligence Engine</h1>
            <p className="text-sm text-muted-foreground">Predictive analytics — patterns from citizen data</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-0 bg-secondary/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium mb-1">Active Alerts</p>
            <p className="text-2xl font-medium">{loading ? '—' : (summary?.active_alerts ?? 0)}</p>
          </CardContent>
        </Card>
        <Card className="border-0 bg-red-50 dark:bg-red-950/20">
          <CardContent className="p-4">
            <p className="text-xs text-red-600 dark:text-red-400 uppercase tracking-widest font-medium mb-1">Critical</p>
            <p className="text-2xl font-medium text-red-700 dark:text-red-400">{loading ? '—' : (summary?.critical_alerts ?? 0)}</p>
          </CardContent>
        </Card>
        <Card className="border-0 bg-orange-50 dark:bg-orange-950/20">
          <CardContent className="p-4">
            <p className="text-xs text-orange-600 dark:text-orange-400 uppercase tracking-widest font-medium mb-1">High</p>
            <p className="text-2xl font-medium text-orange-700 dark:text-orange-400">{loading ? '—' : (summary?.high_alerts ?? 0)}</p>
          </CardContent>
        </Card>
        <Card className="border-0 bg-secondary/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium mb-1">Districts at Risk</p>
            <p className="text-2xl font-medium">{loading ? '—' : (summary?.districts_at_risk ?? 0)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Category Velocity */}
      {summary?.category_velocity && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Category velocity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {summary.category_velocity.filter(c => c.last_7d > 0).slice(0, 8).map(c => (
                <div key={c.category} className="p-3 rounded-lg bg-secondary/40 space-y-1">
                  <p className="text-xs font-medium">{CATEGORY_LABELS[c.category] || c.category}</p>
                  <div className="flex gap-2 text-[11px] text-muted-foreground">
                    <span className="text-orange-600 font-medium">{c.last_24h} today</span>
                    <span>·</span>
                    <span>{c.last_7d} / 7d</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerts List */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-medium text-sm">Active intelligence alerts</h2>
          {alerts.length > 0 && <Badge variant="secondary">{alerts.length}</Badge>}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-secondary/40 animate-pulse" />)}
          </div>
        ) : alerts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <Shield className="w-8 h-8 mx-auto mb-3 text-emerald-500" />
              <p className="font-medium text-sm">No active threats detected</p>
              <p className="text-xs text-muted-foreground mt-1">Intelligence engine runs every 6 hours</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {alerts.map(alert => {
              const colors = getSeverityColor(alert.severity);
              const isExpanded = expandedAlert === alert.id;
              return (
                <Card key={alert.id} className={`border ${colors.border} ${colors.bg} transition-all`}>
                  <CardContent className="p-4 space-y-3">
                    {/* Alert Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge variant="outline" className={`text-[10px] ${colors.text} border-current`}>
                            {ALERT_TYPE_LABELS[alert.alert_type] || alert.alert_type}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {CATEGORY_LABELS[alert.category] || alert.category}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {alert.confidence}% confidence
                          </span>
                        </div>
                        <p className={`font-medium text-sm ${colors.text}`}>{alert.title}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3" />
                          {alert.block ? `${alert.block}, ` : ''}{alert.district}
                          <span className="mx-1">·</span>
                          <Activity className="w-3 h-3" />
                          {alert.complaint_count} complaints
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="w-20">
                          <SeverityBar value={alert.severity} />
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[11px] px-2"
                          onClick={() => setExpandedAlert(isExpanded ? null : alert.id)}
                        >
                          <Eye className="w-3 h-3 mr-1" />
                          {isExpanded ? 'Less' : 'Details'}
                        </Button>
                      </div>
                    </div>

                    {/* Summary */}
                    <p className="text-xs text-foreground/80 leading-relaxed">{alert.summary}</p>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="space-y-3 pt-2 border-t border-current/10">
                        <div className="rounded-lg bg-white/60 dark:bg-black/20 p-3 space-y-1">
                          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Recommended action</p>
                          <p className="text-xs">{alert.recommended_action}</p>
                        </div>
                        {alert.ai_brief && (
                          <div className="rounded-lg bg-violet-50/60 dark:bg-violet-950/20 p-3 space-y-1">
                            <p className="text-[10px] font-medium uppercase tracking-widest text-violet-600 dark:text-violet-400 flex items-center gap-1">
                              <Zap className="w-3 h-3" /> AI Intelligence Brief
                            </p>
                            <p className="text-xs leading-relaxed">{alert.ai_brief}</p>
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          Detected {new Date(alert.created_at).toLocaleString('en-IN')}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] gap-1"
                        disabled={!!actionLoading}
                        onClick={() => handleAction(alert.id, 'acknowledge')}
                      >
                        <CheckCircle className="w-3 h-3" />
                        {actionLoading === alert.id + 'acknowledge' ? 'Saving...' : 'Acknowledge'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] gap-1 text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                        disabled={!!actionLoading}
                        onClick={() => handleAction(alert.id, 'resolve')}
                      >
                        <Shield className="w-3 h-3" />
                        Resolve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px] gap-1 text-muted-foreground ml-auto"
                        disabled={!!actionLoading}
                        onClick={() => handleAction(alert.id, 'false_positive')}
                      >
                        <XCircle className="w-3 h-3" />
                        False positive
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Engine Status */}
      {data?.runs && data.runs.length > 0 && (
        <Card className="border-0 bg-secondary/30">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium mb-3">Engine run history</p>
            <div className="space-y-2">
              {data.runs.map((run, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{new Date(run.run_at).toLocaleString('en-IN')}</span>
                  <div className="flex items-center gap-3">
                    <span>{run.alerts_generated} alerts generated</span>
                    <Badge variant={run.status === 'SUCCESS' ? 'outline' : 'destructive'} className="text-[10px]">
                      {run.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
