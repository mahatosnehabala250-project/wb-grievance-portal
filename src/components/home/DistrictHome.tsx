'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authHeaders } from '@/lib/helpers';
import {
  CATEGORY_LABEL, Empty, Figures, Headline, LoadingRows, PageHead, Panel, Ticket, daysSince, fmtShortDate, plural,
} from './homeKit';
import { SeatHome } from './SeatHome';
import { useComplaintOpener } from './useComplaintOpener';

type Seat = {
  ac: string; ac_no: number | null; mla: string | null; booths: number; booths_covered: number; team: number;
  total: number; open: number; no_owner: number; past_due: number; resolved: number;
  oldest_days: number | null; last_filed_at: string | null;
};
type Item = {
  id: string; ticket: string; citizen: string | null; ac: string; village: string | null; block: string | null;
  category: string | null; issue: string | null; days: number; past_due: boolean; owner: string | null;
};
type DistrictData = {
  district: string;
  figures: { seats: number; total: number; open: number; no_owner: number; past_due: number; new_7d: number;
    resolved_30d: number; last_filed_at: string | null; booths: number; booths_covered: number; team: number };
  seats: Seat[]; attention: Item[];
};

function headline(d: DistrictData): { text: string; sub: string; tone?: 'late' } {
  const f = d.figures;
  const quiet = daysSince(f.last_filed_at);
  const parts: string[] = [];
  if (f.open) parts.push(f.past_due === f.open ? 'Every one is past its deadline.' : `${plural(f.past_due, 'is', 'are')} past the deadline.`);
  if (f.new_7d === 0 && quiet !== null && quiet > 14) parts.push(`No new complaint has come in from any seat for ${quiet} days.`);
  if (f.booths && f.booths_covered === 0) parts.push(`None of the ${f.booths.toLocaleString('en-IN')} booths has a karyakarta on record yet.`);
  if (!f.open) return { text: `Nothing is open across ${d.district}.`, sub: parts.join(' ') };
  if (f.no_owner) {
    return {
      text: f.no_owner === f.open
        ? `${plural(f.open, 'open complaint')} across ${d.district}, and nobody is on any of them`
        : `${f.no_owner} of ${plural(f.open, 'open complaint')} across ${d.district} ${f.no_owner === 1 ? 'has' : 'have'} nobody on them`,
      sub: parts.join(' '), tone: 'late',
    };
  }
  return { text: `${plural(f.open, 'open complaint')} across ${d.district}, each with an owner`, sub: parts.join(' '), tone: f.past_due ? 'late' : undefined };
}

export function DistrictHome() {
  const [data, setData] = useState<DistrictData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seat, setSeat] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch('/api/home/district', { headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load the district');
      setData(j.data);
      setLoadedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the district');
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const { openComplaint, dialog } = useComplaintOpener(load);

  if (seat) return <SeatHome ac={seat} onBack={() => { setSeat(null); load(); }} />;
  if (error) {
    return (
      <div className="py-10">
        <p className="text-late">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load}>Try again</Button>
      </div>
    );
  }
  if (!data) return <LoadingRows />;

  const f = data.figures;
  const h = headline(data);
  const withOpen = data.seats.filter((s) => s.open > 0).length;

  return (
    <div className="pb-10">
      <PageHead
        title={`${data.district} district`}
        meta={`${plural(f.seats, 'assembly seat')}, ${f.booths.toLocaleString('en-IN')} booths`}
        right={<Button variant="outline" size="sm" onClick={load}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {loadedAt ? loadedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Refresh'}</Button>}
      />
      <Headline text={h.text} sub={h.sub} tone={h.tone} />
      <Figures items={[
        { label: 'open', value: f.open },
        { label: 'with nobody on them', value: f.no_owner, tone: f.no_owner ? 'late' : undefined },
        { label: 'past the deadline', value: f.past_due, tone: f.past_due ? 'late' : undefined },
        { label: 'new this week', value: f.new_7d },
        { label: 'seats with open complaints', value: <>{withOpen}<span className="text-base text-muted-foreground">/{f.seats}</span></> },
        { label: 'booths with a karyakarta', value: <>{f.booths_covered}<span className="text-base text-muted-foreground">/{f.booths.toLocaleString('en-IN')}</span></> },
      ]} />

      <Panel className="mt-6" title="Seats" note="Open a seat to hand out its complaints">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[13px] text-muted-foreground">
                <th className="px-4 py-2.5 font-normal">Seat</th>
                <th className="px-3 py-2.5 text-right font-normal">Open</th>
                <th className="px-3 py-2.5 text-right font-normal">Nobody on them</th>
                <th className="px-3 py-2.5 text-right font-normal">Oldest waiting</th>
                <th className="px-3 py-2.5 font-normal">Booths with a karyakarta</th>
                <th className="px-3 py-2.5 text-right font-normal">Last complaint</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {data.seats.map((s) => (
                <tr key={s.ac} tabIndex={0} role="button" aria-label={`Open ${s.ac}`}
                  onClick={() => setSeat(s.ac)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSeat(s.ac); } }}
                  className="cursor-pointer border-t border-border outline-none hover:bg-muted/50 focus-visible:bg-muted/60">
                  <td className="px-4 py-3">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">{s.ac_no ?? ''}</span>
                    <span className="font-medium text-foreground">{s.ac}</span>
                    <span className="block pl-[calc(2ch+0.5rem)] text-xs text-muted-foreground">{s.mla || 'MLA not set'}</span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-foreground">{s.open}</td>
                  <td className={`px-3 py-3 text-right tabular-nums ${s.no_owner ? 'font-semibold text-late' : 'text-muted-foreground'}`}>{s.no_owner}</td>
                  <td className={`px-3 py-3 text-right tabular-nums ${s.oldest_days !== null && s.past_due ? 'text-late' : 'text-muted-foreground'}`}>
                    {s.oldest_days !== null ? plural(s.oldest_days, 'day') : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 rounded-full bg-muted">
                        <div className="h-full rounded-full bg-done" style={{ width: `${s.booths ? s.booths_covered / s.booths * 100 : 0}%` }} />
                      </div>
                      <span className="tabular-nums text-muted-foreground">{s.booths_covered}/{s.booths}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{fmtShortDate(s.last_filed_at)}</td>
                  <td className="pr-3 text-muted-foreground"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="mt-5" title="Oldest open complaints" count={data.attention.length} note="Across every seat, oldest first">
        {data.attention.length === 0 ? <Empty>Nothing is open.</Empty> : (
          <ul>
            {data.attention.map((r) => (
              <li key={r.id} className="border-t border-border first:border-t-0">
                <button type="button" onClick={() => openComplaint(r.id)}
                  className="grid w-full items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted/40 md:grid-cols-[120px_minmax(0,1fr)_auto]">
                  <span className="text-sm font-medium text-foreground">{r.ac}</span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-sm text-foreground">{r.citizen || 'Citizen'}</span>
                      <span className="text-sm text-muted-foreground">{[r.village, r.block].filter(Boolean).join(', ')}</span>
                      <Ticket>{r.ticket}</Ticket>
                    </span>
                    <span className="block truncate text-[15px] text-foreground/90">{r.issue || CATEGORY_LABEL(r.category)}</span>
                  </span>
                  <span className="text-sm md:text-right">
                    <span className={`block tabular-nums ${r.past_due ? 'text-late' : 'text-muted-foreground'}`}>{plural(r.days, 'day')} waiting</span>
                    <span className={`block text-xs ${r.owner ? 'text-muted-foreground' : 'font-medium text-late'}`}>{r.owner || 'Nobody on it'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {dialog}
    </div>
  );
}
