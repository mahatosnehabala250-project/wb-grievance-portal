'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Building2, Activity, CheckCircle2, AlertTriangle, RefreshCw,
  MapPin, Users, Vote, Landmark, ShieldAlert, TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import { motion } from 'framer-motion';

/* ─── Types (mirror get_district_command_center) ─────────────── */
interface ACRow {
  constituency: string;
  mla_name: string | null;
  total: number;
  active: number;
  resolved: number;
  resolution_rate: number;
  critical_open: number;
  last_7d: number;
  top_category: string | null;
  booths: number;
  booths_covered: number;
  karyakartas: number;
}

interface BlockRow {
  block: string;
  constituency: string | null;
  total: number;
  active: number;
  resolved: number;
}

interface TrendPoint { month: string; filed: number; resolved: number }

interface DistrictStats {
  district: string;
  total_complaints: number;
  total_active: number;
  total_resolved: number;
  resolution_rate: number;
  critical_open: number;
  last_24h: number;
  last_7d: number;
  constituencies: ACRow[];
  blocks: BlockRow[];
  trend: TrendPoint[];
  unmapped_in_district: number;
}

/* ─── Helpers ────────────────────────────────────────────────── */
function RateBadge({ rate, hasData }: { rate: number; hasData: boolean }) {
  if (!hasData) return <Badge variant="outline" className="text-[10px]">No data</Badge>;
  if (rate >= 75) return <Badge className="text-[10px] bg-emerald-600 hover:bg-emerald-600">Good</Badge>;
  if (rate >= 40) return <Badge className="text-[10px] bg-amber-500 hover:bg-amber-500">Watch</Badge>;
  return <Badge className="text-[10px] bg-red-600 hover:bg-red-600">Alert</Badge>;
}

function Kpi({
  icon: Icon, label, value, sub, tone = 'default',
}: {
  icon: React.ElementType; label: string; value: string | number; sub?: string;
  tone?: 'default' | 'warn' | 'good';
}) {
  const toneCls =
    tone === 'warn' ? 'text-red-600 dark:text-red-400'
    : tone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-foreground';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <Icon className="w-3.5 h-3.5" />
          <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
        </div>
        <div className={`text-2xl font-bold tabular-nums ${toneCls}`}>{value}</div>
        {sub ? <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

/* ─── Main ───────────────────────────────────────────────────── */
export function DistrictCommandView() {
  const [stats, setStats] = useState<DistrictStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetch('/api/district/dashboard', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setStats(json.data || null);
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error || 'Could not load district data');
      }
    } catch {
      toast.error('Could not load district data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading district data…</span>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <Building2 className="w-8 h-8" />
        <p className="text-sm">No district data found.</p>
        <Button size="sm" variant="outline" onClick={() => load()}>Try again</Button>
      </div>
    );
  }

  const acs = stats.constituencies || [];
  const blocks = stats.blocks || [];
  const totalBooths = acs.reduce((s, a) => s + (a.booths || 0), 0);
  const coveredBooths = acs.reduce((s, a) => s + (a.booths_covered || 0), 0);
  const coveragePct = totalBooths > 0 ? Math.round((coveredBooths / totalBooths) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Landmark className="w-5 h-5 text-primary" />
            {stats.district} District — Organisation Command
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {acs.length} assemblies · {blocks.length} blocks · {totalBooths.toLocaleString('en-IN')} booths
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => load(true)} disabled={refreshing}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Activity} label="Total complaints" value={stats.total_complaints.toLocaleString('en-IN')}
             sub={`${stats.last_7d} in the last 7 days`} />
        <Kpi icon={AlertTriangle} label="Open now" value={stats.total_active.toLocaleString('en-IN')} />
        <Kpi icon={CheckCircle2} label="Resolution rate" value={`${stats.resolution_rate}%`}
             sub={`${stats.total_resolved} resolved`}
             tone={stats.resolution_rate >= 40 ? 'good' : 'default'} />
        <Kpi icon={ShieldAlert} label="Critical open" value={stats.critical_open}
             tone={stats.critical_open > 0 ? 'warn' : 'default'} />
      </div>

      {/* Data-integrity strip — only when there is something to say. Mirrors the
          JS-24 guard so a district president sees data loss in their own district
          instead of trusting a clean-looking zero. */}
      {stats.unmapped_in_district > 0 && (
        <Card className="border-amber-400/60 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-3 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm">
              <span className="font-semibold">
                {stats.unmapped_in_district === 1
                  ? '1 complaint is not linked to any assembly'
                  : `${stats.unmapped_in_district} complaints are not linked to any assembly`}
              </span>
              <span className="text-muted-foreground">
                {' '}— {stats.unmapped_in_district === 1 ? 'it appears' : 'they appear'} on no MLA&apos;s
                dashboard, because the block or village was not found in the mapping.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-AC cards — the core "9 seats at a glance" */}
      <div>
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          By assembly
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {acs.map((ac, i) => (
            <motion.div
              key={ac.constituency}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.3) }}
            >
              <Card className="h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-sm truncate">{ac.constituency}</CardTitle>
                      {ac.mla_name ? (
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{ac.mla_name}</p>
                      ) : null}
                    </div>
                    <RateBadge rate={ac.resolution_rate} hasData={ac.total > 0} />
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2.5">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-lg font-bold tabular-nums">{ac.total}</div>
                      <div className="text-[10px] text-muted-foreground">Total</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold tabular-nums text-amber-600">{ac.active}</div>
                      <div className="text-[10px] text-muted-foreground">Open</div>
                    </div>
                    <div>
                      <div className={`text-lg font-bold tabular-nums ${ac.critical_open > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {ac.critical_open}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Critical</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t pt-2">
                    <span className="flex items-center gap-1">
                      <Vote className="w-3 h-3" />
                      {ac.booths} booths
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {ac.karyakartas} workers
                    </span>
                    {ac.top_category ? (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{ac.top_category}</Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Trend */}
      {stats.trend?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              Last 6 months — filed vs resolved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer className="h-[180px] w-full" config={{
              filed: { label: 'Filed', color: '#FF6B00' },
              resolved: { label: 'Resolved', color: '#10B981' },
            }}>
              <AreaChart data={stats.trend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="dF" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FF6B00" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#FF6B00" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dR" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="filed" stroke="#FF6B00" fill="url(#dF)" strokeWidth={2} />
                <Area type="monotone" dataKey="resolved" stroke="#10B981" fill="url(#dR)" strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {/* Sangathan coverage — real numbers, including an honest zero. Booth
          assignment is the district president's own pending work, so it is shown
          as a target rather than dressed up as a achievement. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Users className="w-4 h-4 text-muted-foreground" />
            Booth coverage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">{coveredBooths.toLocaleString('en-IN')}</span>
            <span className="text-sm text-muted-foreground">
              / {totalBooths.toLocaleString('en-IN')} booths ({coveragePct}%)
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${coveragePct}%` }} />
          </div>
          {coveredBooths === 0 && (
            <p className="text-[11px] text-muted-foreground">
              No booths have a worker assigned yet. Assigning one per booth tracks GP-level
              complaints and builds the record needed for the 2028 panchayat election.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Block rollup — panchayat samiti level, the 2028 unit */}
      {blocks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              By block (panchayat samiti)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-muted-foreground border-b">
                    <th className="py-1.5 pr-3 font-medium">Block</th>
                    <th className="py-1.5 pr-3 font-medium">Assembly</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Total</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Open</th>
                    <th className="py-1.5 font-medium text-right">Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  {blocks.map((b) => (
                    <tr key={b.block} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 font-medium">{b.block}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{b.constituency || '—'}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{b.total}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-amber-600">{b.active}</td>
                      <td className="py-1.5 text-right tabular-nums text-emerald-600">{b.resolved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default DistrictCommandView;
