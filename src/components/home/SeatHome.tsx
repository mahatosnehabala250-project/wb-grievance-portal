'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, RotateCcw, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authHeaders } from '@/lib/helpers';
import { useNav } from '@/lib/nav-context';
import {
  CATEGORY_LABEL, Empty, Figures, Headline, LoadingRows, PageHead, Panel, Ticket, WaitBar, daysSince, dueFor, plural,
} from './homeKit';
import { useComplaintOpener } from './useComplaintOpener';

type Row = {
  id: string; ticket: string; citizen: string | null; village: string | null; block: string | null;
  category: string | null; issue: string | null; urgency?: string | null; status: string;
  days: number; past_due: boolean; owner?: string | null; stale_days?: number;
};
type Brief = { id: string; ticket: string; issue: string | null; days: number };
type Dup = { citizen: string | null; village: string | null; category: string | null; keep: Brief; copies: Brief[] };
type SeatData = {
  seat: { ac: string; ac_no: number | null; mla: string | null; district: string | null; blocks: string[]; booths: number; booths_covered: number };
  figures: { total: number; open: number; no_owner: number; past_due: number; new_7d: number; resolved_30d: number;
    oldest_days: number | null; last_filed_at: string | null; duplicates: number };
  no_owner: Row[]; follow_up: Row[]; duplicates: Dup[];
  by_block: { block: string; open: number; total: number; villages: { village: string; open: number }[] }[];
  team: { id: string; name: string; role_level: string | null; block: string | null; open: number; oldest: number | null }[];
};
type Person = { id: string; name: string; role_level?: string | null; constituency?: string | null; block?: string | null };

const ROLE: Record<string, string> = {
  KARYAKARTA: 'Karyakarta', GP_COORD: 'GP coordinator', BLOCK_COORD: 'Block president', MLA: 'MLA',
  MP: 'MP', DISTRICT_ADMIN: 'District president', OFFICER: 'Office',
};

function headline(d: SeatData): { text: string; sub: string; tone?: 'late' } {
  const f = d.figures;
  const quiet = daysSince(f.last_filed_at);
  const quietNote = f.new_7d === 0 && quiet !== null && quiet > 14 ? ` No new complaint has come in for ${quiet} days.` : '';
  if (!f.open) {
    return {
      text: `Nothing is open in ${d.seat.ac}.`,
      sub: f.total ? `All ${plural(f.total, 'complaint')} so far are closed.${quietNote}` : 'No complaint has come in from this seat yet.',
    };
  }
  const dupNote = f.duplicates ? ` ${plural(f.duplicates, 'is a copy', 'are copies')} of an earlier complaint from the same citizen.` : '';
  if (f.no_owner) {
    const text = f.no_owner === f.open
      ? `${plural(f.open, 'open complaint')}, and nobody is on any of them`
      : `${f.no_owner} of ${plural(f.open, 'open complaint')} ${f.no_owner === 1 ? 'has' : 'have'} nobody on them`;
    return { text, sub: `The oldest has waited ${plural(f.oldest_days ?? 0, 'day')}.${dupNote}${quietNote}`, tone: 'late' };
  }
  return {
    text: `${plural(f.open, 'open complaint')}, each with an owner`,
    sub: `${f.past_due ? `${plural(f.past_due, 'is', 'are')} past the deadline. ` : ''}Follow up with each owner today.${quietNote}`,
    tone: f.past_due ? 'late' : undefined,
  };
}

function AssignMenu({ row, people, seat, label, onDone }: {
  row: Row; people: Person[]; seat: SeatData['seat']; label: string; onDone: () => void;
}) {
  const nav = useNav();
  const [busy, setBusy] = useState(false);
  const local = people.filter((p) =>
    (p.constituency && p.constituency.toLowerCase() === seat.ac.toLowerCase()) ||
    (p.block && seat.blocks.some((b) => b.toLowerCase() === String(p.block).toLowerCase())));
  const others = people.filter((p) => !local.includes(p));

  async function give(p: Person) {
    setBusy(true);
    try {
      const r = await fetch(`/api/complaints/${row.id}`, {
        method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedToId: p.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not assign');
      toast.success(`${row.ticket} assigned to ${p.name}`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not assign');
    } finally { setBusy(false); }
  }

  const item = (p: Person) => (
    <DropdownMenuItem key={p.id} onSelect={() => give(p)} className="flex flex-col items-start gap-0">
      <span>{p.name}</span>
      <span className="text-xs text-muted-foreground">{ROLE[p.role_level || ''] || 'Office'}{p.block ? `, ${p.block}` : ''}</span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant={label === 'Assign' ? 'default' : 'outline'} disabled={busy}>{busy ? 'Saving…' : label}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {local.length > 0 && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">In {seat.ac}</DropdownMenuLabel>}
        {local.map(item)}
        {local.length > 0 && others.length > 0 && <DropdownMenuSeparator />}
        {others.length > 0 && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Everyone else you manage</DropdownMenuLabel>}
        {others.map(item)}
        {people.length === 0 && <DropdownMenuItem disabled>Nobody on the team yet</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => nav?.goTo('users')}><UserPlus className="mr-2 h-4 w-4" />Add someone to the team</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SeatHome({ ac, onBack }: { ac?: string; onBack?: () => void }) {
  const nav = useNav();
  const [data, setData] = useState<SeatData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/home/seat${ac ? `?ac=${encodeURIComponent(ac)}` : ''}`, { headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load this seat');
      setData(j.data);
      setLoadedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this seat');
    }
  }, [ac]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/users/list', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((j) => setPeople(j.users || []))
      .catch(() => setPeople([]));
  }, []);

  const { openComplaint, dialog } = useComplaintOpener(load);
  const maxDays = useMemo(() => Math.max(15, ...(data?.no_owner.map((r) => r.days) ?? [0])), [data]);

  async function closeCopies(dup: Dup) {
    try {
      for (const c of dup.copies) {
        const r = await fetch(`/api/complaints/${c.id}`, {
          method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'CLOSED', resolution: `Duplicate of ${dup.keep.ticket}` }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not close the copy');
      }
      toast.success(`Closed ${plural(dup.copies.length, 'copy', 'copies')}, kept ${dup.keep.ticket}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not close the copy');
    }
  }

  if (error) {
    return (
      <div className="py-10">
        {onBack && <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-2"><ArrowLeft className="mr-1 h-4 w-4" />All seats</Button>}
        <p className="text-late">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load}>Try again</Button>
      </div>
    );
  }
  if (!data) return <LoadingRows />;

  const { seat, figures: f } = data;
  const h = headline(data);
  const maxBlock = Math.max(1, ...data.by_block.map((b) => b.open));

  return (
    <div className="pb-10">
      <PageHead
        back={onBack && <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-1 text-muted-foreground"><ArrowLeft className="mr-1 h-4 w-4" />All seats</Button>}
        title={seat.ac}
        meta={[seat.ac_no ? `Assembly seat ${seat.ac_no}` : null, seat.mla ? `MLA ${seat.mla}` : null, seat.blocks.length ? `Blocks: ${seat.blocks.join(', ')}` : null].filter(Boolean).join('. ')}
        right={<Button variant="outline" size="sm" onClick={load}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {loadedAt ? loadedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Refresh'}</Button>}
      />
      <Headline text={h.text} sub={h.sub} tone={h.tone} />
      <Figures items={[
        { label: 'open', value: f.open },
        { label: 'with nobody on them', value: f.no_owner, tone: f.no_owner ? 'late' : undefined },
        { label: 'past the deadline', value: f.past_due, tone: f.past_due ? 'late' : undefined },
        { label: 'new this week', value: f.new_7d },
        { label: 'closed in 30 days', value: f.resolved_30d, tone: f.resolved_30d ? 'done' : undefined },
        { label: 'booths with a karyakarta', value: <>{seat.booths_covered}<span className="text-base text-muted-foreground">/{seat.booths}</span></> },
      ]} />

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5 min-w-0">
          <Panel title="Needs an owner" count={data.no_owner.length} note="Oldest first. The mark on each bar is its deadline.">
            {data.no_owner.length === 0 ? <Empty>Every open complaint has someone on it.</Empty> : (
              <ul>
                {data.no_owner.map((r) => (
                  <li key={r.id} className="grid items-center gap-3 border-t border-border px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_220px_auto]">
                    <button type="button" onClick={() => openComplaint(r.id)} className="min-w-0 text-left">
                      <span className="flex flex-wrap items-baseline gap-x-3">
                        <span className="font-medium text-foreground">{r.citizen || 'Citizen'}</span>
                        <span className="text-sm text-muted-foreground">{[r.village, r.block].filter(Boolean).join(', ')}</span>
                        <Ticket>{r.ticket}</Ticket>
                      </span>
                      <span className="mt-0.5 block text-[15px] leading-snug text-foreground/90 line-clamp-2">{r.issue}</span>
                      <span className="text-xs text-muted-foreground">{CATEGORY_LABEL(r.category)}{r.urgency && r.urgency !== 'MEDIUM' ? `, ${r.urgency.toLowerCase()} urgency` : ''}</span>
                    </button>
                    <WaitBar days={r.days} dueDays={dueFor(r.urgency)} max={maxDays} />
                    <div className="md:text-right"><AssignMenu row={r} people={people} seat={seat} label="Assign" onDone={load} /></div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Assigned, not moving" count={data.follow_up.length} note="Longest without an update first">
            {data.follow_up.length === 0 ? <Empty>Nothing assigned is waiting on an update.</Empty> : (
              <ul>
                {data.follow_up.map((r) => (
                  <li key={r.id} className="grid items-center gap-3 border-t border-border px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_auto]">
                    <button type="button" onClick={() => openComplaint(r.id)} className="min-w-0 text-left">
                      <span className="flex flex-wrap items-baseline gap-x-3">
                        <span className="font-medium text-foreground">{r.owner || 'Owner'}</span>
                        <span className={`text-sm ${(r.stale_days ?? 0) > 3 ? 'text-late' : 'text-muted-foreground'}`}>no update for {plural(r.stale_days ?? 0, 'day')}</span>
                        <Ticket>{r.ticket}</Ticket>
                      </span>
                      <span className="mt-0.5 block text-[15px] leading-snug text-foreground/90 line-clamp-2">{r.issue}</span>
                      <span className="text-xs text-muted-foreground">{r.citizen}, {[r.village, r.block].filter(Boolean).join(', ')}</span>
                    </button>
                    <div className="md:text-right"><AssignMenu row={r} people={people} seat={seat} label="Reassign" onDone={load} /></div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {data.duplicates.length > 0 && (
            <Panel title="Filed twice" count={data.duplicates.length} note="Same citizen, same problem. Keep the first, close the copy. The citizen is not messaged.">
              <ul>
                {data.duplicates.map((d) => (
                  <li key={d.keep.id} className="grid items-center gap-3 border-t border-border px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{d.citizen || 'Citizen'} <span className="text-sm font-normal text-muted-foreground">{d.village}, {CATEGORY_LABEL(d.category)}</span></p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Keep <button type="button" onClick={() => openComplaint(d.keep.id)} className="font-mono text-foreground underline-offset-2 hover:underline">{d.keep.ticket}</button>
                        {' '}({plural(d.keep.days, 'day')} old). Close {d.copies.map((c, i) => (
                          <span key={c.id}>{i > 0 && ', '}<button type="button" onClick={() => openComplaint(c.id)} className="font-mono text-foreground underline-offset-2 hover:underline">{c.ticket}</button></span>
                        ))}.
                      </p>
                    </div>
                    <div className="md:text-right"><Button size="sm" variant="outline" onClick={() => closeCopies(d)}>Close the copy</Button></div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <aside className="space-y-5">
          <Panel title="Where it is open">
            {data.by_block.length === 0 ? <Empty>No complaints from this seat yet.</Empty> : (
              <ul className="space-y-4 px-4 py-4">
                {data.by_block.map((b) => (
                  <li key={b.block}>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-medium text-foreground">{b.block}</span>
                      <span className="text-sm tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{b.open}</span> open of {b.total}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${b.open / maxBlock * 100}%` }} /></div>
                    {b.villages.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{b.villages.map((v) => `${v.village} ${v.open}`).join(', ')}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Team" count={data.team.length}>
            {data.team.length === 0 ? (
              <div className="px-4 py-4">
                <p className="text-sm text-muted-foreground">Nobody from the party covers this seat yet, so complaints here have nobody to go to.</p>
                <Button size="sm" className="mt-3" onClick={() => nav?.goTo('users')}><UserPlus className="mr-1.5 h-4 w-4" />Add a karyakarta</Button>
              </div>
            ) : (
              <ul>
                {data.team.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{ROLE[m.role_level || ''] || 'Office'}{m.block ? `, ${m.block}` : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold tabular-nums ${m.open ? 'text-foreground' : 'text-muted-foreground'}`}>{m.open} open</p>
                      {m.oldest !== null && <p className="text-xs text-muted-foreground">oldest {plural(m.oldest, 'day')}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
      {dialog}
    </div>
  );
}
