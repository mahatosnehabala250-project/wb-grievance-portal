'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authHeaders } from '@/lib/helpers';
import type { Complaint, DashboardData } from '@/lib/types';
import {
  CATEGORY_LABEL, Empty, Figures, Headline, LoadingRows, PageHead, Panel, Ticket, daysSince, fmtShortDate, plural,
} from '@/components/home/homeKit';
import { useComplaintOpener } from '@/components/home/useComplaintOpener';
import { ObjectLink } from '@/components/objects/ObjectLink';

/**
 * Operations — the whole system on one page, for whoever runs it: how much is
 * open and how late, where it sits, what it is about, who is carrying it, and
 * the complaints that need a hand today. Reads /api/dashboard (already scoped
 * to the account) and /api/leaderboard.
 */

type Leader = { id: string; name: string; block: string | null; assigned: number; resolved: number; inProgress: number; open: number; resolutionRate: number };
type Row = Complaint & Record<string, unknown>;

const PERIODS = [
  { key: 'all', label: 'All time', days: null },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '30', label: 'Last 30 days', days: 30 },
] as const;

const STATUS_PARTS: { key: keyof DashboardData['stats']; label: string; cls: string }[] = [
  { key: 'registered', label: 'New', cls: 'bg-info' },
  { key: 'open', label: 'Open', cls: 'bg-primary' },
  { key: 'assigned', label: 'Assigned', cls: 'bg-primary/60' },
  { key: 'inProgress', label: 'In progress', cls: 'bg-saffron/40' },
  { key: 'resolved', label: 'Resolved', cls: 'bg-done' },
  { key: 'rejected', label: 'Rejected', cls: 'bg-muted-foreground/40' },
];

const str = (c: Row, ...keys: string[]) => {
  for (const k of keys) { const v = c[k]; if (typeof v === 'string' && v) return v; }
  return null;
};

function ComplaintLine({ c, onOpen }: { c: Row; onOpen: (id: string) => void }) {
  const village = str(c, 'village');
  const days = daysSince(c.createdAt as unknown as string) ?? 0;
  return (
    <li className="grid gap-x-4 gap-y-1 border-t border-border px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <button type="button" onClick={() => onOpen(c.id)} className="block w-full min-w-0 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-medium text-foreground">{c.citizenName || 'Citizen'}</span>
            <Ticket>{c.ticketNo}</Ticket>
          </span>
          <span className="mt-0.5 block text-[15px] leading-snug text-foreground/90 line-clamp-2">{c.issue}</span>
        </button>
        <p className="mt-1 text-xs text-muted-foreground">
          {CATEGORY_LABEL(c.category)}
          {village && <> in <ObjectLink type="village" id={str(c, 'village_code', 'villageCode')}>{village}</ObjectLink></>}
          {c.block && <>, <ObjectLink type="block" id={c.block}>{c.block}</ObjectLink></>}
        </p>
      </div>
      <p className="text-xs tabular-nums text-muted-foreground sm:text-right">{fmtShortDate(c.createdAt as unknown as string)}<br className="hidden sm:block" /> {plural(days, 'day')} ago</p>
    </li>
  );
}

export function OperationsView({ onDashboardData, onNavigate }: {
  onDashboardData?: (d: DashboardData) => void;
  onNavigate?: (view: string, complaint?: Complaint, filterStatus?: string) => void;
}) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('all');
  const [data, setData] = useState<DashboardData | null>(null);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const days = PERIODS.find((p) => p.key === period)?.days;
    const qs = days ? `?from=${encodeURIComponent(new Date(Date.now() - days * 86_400_000).toISOString())}` : '';
    try {
      const r = await fetch(`/api/dashboard${qs}`, { headers: authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'The figures did not load');
      setData(j as DashboardData);
      setLoadedAt(new Date());
      onDashboardData?.(j as DashboardData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The figures did not load');
    }
    fetch('/api/leaderboard', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { leaderboard: [] }))
      .then((j) => setLeaders(j.leaderboard || []))
      .catch(() => setLeaders([]));
  }, [period, onDashboardData]);

  useEffect(() => { load(); }, [load]);
  const { openComplaint, dialog } = useComplaintOpener(load);

  const derived = useMemo(() => {
    if (!data) return null;
    const s = data.stats;
    const openAll = s.open + s.registered + s.assigned + s.inProgress;
    const busiest = [...data.byGroup].sort((a, b) => (b.open + b.inProgress) - (a.open + a.inProgress))[0];
    const topCat = data.byCategory[0];
    return { s, openAll, busiest, topCat };
  }, [data]);

  if (error && !data) {
    return (
      <div className="max-w-xl py-12">
        <p className="text-lg font-semibold text-foreground">{error}</p>
        <p className="mt-1 text-sm text-muted-foreground">The complaint service did not answer. Nothing was changed.</p>
        <Button size="sm" className="mt-4" onClick={load}>Try again</Button>
      </div>
    );
  }
  if (!data || !derived) return <LoadingRows />;

  const { s, openAll, busiest, topCat } = derived;
  const periodLabel = PERIODS.find((p) => p.key === period)!.label.toLowerCase();
  const headText = !s.total ? `No complaints ${period === 'all' ? 'yet' : `in the ${periodLabel}`}.`
    : !openAll ? `Nothing is open. All ${plural(s.total, 'complaint')} are closed.`
    : `${plural(openAll, 'open complaint')}${s.slaBreaches ? `, ${s.slaBreaches} past the deadline` : ''}`;
  const subParts: string[] = [];
  if (busiest && busiest.open + busiest.inProgress > 0) subParts.push(`${busiest.name} has the most, ${busiest.open + busiest.inProgress}.`);
  if (topCat) subParts.push(`${CATEGORY_LABEL(topCat.category)} is the most raised, ${plural(topCat.count, 'complaint')}.`);
  const maxBlock = Math.max(1, ...data.byGroup.map((g) => g.count));
  const maxCat = Math.max(1, ...data.byCategory.map((c) => c.count));
  const maxMonth = Math.max(1, ...data.monthlyTrend.map((m) => m.total));
  const critical = data.criticalComplaints as Row[];

  return (
    <div className="pb-12">
      <PageHead
        title="Operations"
        meta={`Every complaint you can see, ${periodLabel}${loadedAt ? `, as of ${loadedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Period" className="flex rounded-md border border-border p-0.5 text-[13px]">
              {PERIODS.map((p) => (
                <button key={p.key} role="tab" type="button" aria-selected={period === p.key} onClick={() => setPeriod(p.key)}
                  className={`rounded px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${period === p.key ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={load} aria-label="Refresh"><RotateCcw className="h-3.5 w-3.5" /></Button>
          </div>
        }
      />
      <Headline text={headText} sub={subParts.join(' ') || undefined} tone={s.slaBreaches ? 'late' : undefined} />
      <Figures items={[
        { label: 'open', value: openAll },
        { label: 'past the deadline', value: s.slaBreaches, tone: s.slaBreaches ? 'late' : undefined },
        { label: 'critical', value: s.critical, tone: s.critical ? 'late' : undefined },
        { label: `resolved, ${s.resolutionRate}% of all`, value: s.resolved, tone: s.resolved ? 'done' : undefined },
        { label: s.ratedCount ? `citizen rating, from ${plural(s.ratedCount, 'rating')}` : 'citizen rating', value: s.avgSatisfaction != null ? <>{s.avgSatisfaction.toFixed(1)}<span className="text-base text-muted-foreground">/5</span></> : '—' },
      ]} />

      {/* Where every complaint stands, as one bar */}
      {s.total > 0 && (
        <div className="mt-6">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img"
            aria-label={STATUS_PARTS.map((p) => `${p.label} ${s[p.key]}`).join(', ')}>
            {STATUS_PARTS.map((p) => Number(s[p.key]) > 0 && (
              <div key={p.key} className={p.cls} style={{ width: `${(Number(s[p.key]) / s.total) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
            {STATUS_PARTS.map((p) => (
              <li key={p.key} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${p.cls}`} aria-hidden />
                {p.label} <span className="font-semibold tabular-nums text-foreground">{Number(s[p.key])}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Panel title="Critical and still open" count={critical.length}
            action={onNavigate && openAll > 0 ? <Button variant="ghost" size="sm" onClick={() => onNavigate('complaints', undefined, 'OPEN')}>All open complaints</Button> : undefined}>
            {critical.length === 0 ? <Empty>No critical complaint is open.</Empty> : (
              <ul>{critical.map((c) => <ComplaintLine key={c.id} c={c} onOpen={openComplaint} />)}</ul>
            )}
          </Panel>

          <Panel title={data.groupByField === 'district' ? 'By district' : 'By block'} note="Open and in progress, of all filed">
            {data.byGroup.length === 0 ? <Empty>Nothing filed {period === 'all' ? 'yet' : `in the ${periodLabel}`}.</Empty> : (
              <ul>
                {data.byGroup.map((g) => {
                  const live = g.open + g.inProgress;
                  return (
                    <li key={g.name} className="grid grid-cols-[minmax(0,1fr)_minmax(60px,180px)_80px] items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
                      <span className="truncate text-sm font-medium text-foreground">
                        {data.groupByField === 'block' ? <ObjectLink type="block" id={g.name}>{g.name}</ObjectLink> : g.name}
                      </span>
                      <span className="relative h-1.5 rounded-full bg-muted" aria-hidden>
                        <span className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/30" style={{ width: `${(g.count / maxBlock) * 100}%` }} />
                        <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(live / maxBlock) * 100}%` }} />
                      </span>
                      <span className="text-right text-sm tabular-nums"><span className="font-semibold text-foreground">{live}</span><span className="text-muted-foreground"> of {g.count}</span></span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Latest complaints" count={Math.min(10, data.recent.length)}>
            {data.recent.length === 0 ? <Empty>No complaint has come in yet.</Empty> : (
              <ul>{(data.recent as Row[]).map((c) => <ComplaintLine key={c.id} c={c} onOpen={openComplaint} />)}</ul>
            )}
          </Panel>
        </div>

        <aside className="space-y-5">
          <Panel title="Filed each month" note="Resolved in green">
            {data.monthlyTrend.length === 0 ? <Empty>No complaints in this period.</Empty> : (
              <div className="px-4 py-4">
                <div className="flex h-32 items-end gap-2" role="img"
                  aria-label={data.monthlyTrend.map((m) => `${m.label}: ${m.total} filed, ${m.resolved} resolved`).join('; ')}>
                  {data.monthlyTrend.map((m) => (
                    <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${m.label}: ${m.total} filed, ${m.resolved} resolved`}>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{m.total}</span>
                      <div className="relative w-full rounded-t bg-muted-foreground/30" style={{ height: `${Math.max(4, (m.total / maxMonth) * 96)}px` }}>
                        <div className="absolute inset-x-0 bottom-0 rounded-t bg-done/80" style={{ height: `${m.total ? (m.resolved / m.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-2">
                  {data.monthlyTrend.map((m) => <span key={m.month} className="flex-1 text-center text-[11px] text-muted-foreground">{m.label.split(' ')[0]}</span>)}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="What people raise">
            {data.byCategory.length === 0 ? <Empty>Nothing yet.</Empty> : (
              <ul className="space-y-2.5 px-4 py-4">
                {data.byCategory.slice(0, 8).map((c) => (
                  <li key={c.category}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-foreground">{CATEGORY_LABEL(c.category)}</span>
                      <span className="font-semibold tabular-nums text-foreground">{c.count}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-primary" style={{ width: `${(c.count / maxCat) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Who is carrying it" count={leaders.length || undefined} note="Assigned, resolved">
            {leaders.length === 0 ? <Empty>Nothing has been assigned to anyone yet.</Empty> : (
              <ul>
                {leaders.slice(0, 8).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
                    <div className="min-w-0">
                      <ObjectLink type="person" id={l.id} className="block truncate text-sm font-medium text-foreground">{l.name}</ObjectLink>
                      <p className="text-xs text-muted-foreground">{l.block && !['ALL', 'WEST BENGAL'].includes(l.block.toUpperCase()) ? l.block : 'Whole area'}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm tabular-nums"><span className="font-semibold text-foreground">{l.resolved}</span><span className="text-muted-foreground"> of {l.assigned}</span></p>
                      <p className={`text-xs tabular-nums ${l.open + l.inProgress ? 'text-muted-foreground' : 'text-done'}`}>{l.open + l.inProgress ? `${l.open + l.inProgress} still open` : 'all done'}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Urgency">
            <ul className="divide-y divide-border">
              {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((u) => {
                const n = data.byUrgency.find((x) => x.urgency === u)?.count ?? 0;
                return (
                  <li key={u} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className={u === 'CRITICAL' && n ? 'text-late' : 'text-foreground'}>{u.charAt(0) + u.slice(1).toLowerCase()}</span>
                    <span className="font-semibold tabular-nums text-foreground">{n}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </aside>
      </div>
      {dialog}
    </div>
  );
}
