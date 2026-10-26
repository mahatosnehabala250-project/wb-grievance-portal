'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, ChevronRight, ExternalLink, Link2, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authHeaders } from '@/lib/helpers';
import {
  OBJECT_NOUN, ROLE_NOUN, type ChildRow, type ObjectComplaint, type ObjectRef, type ObjectView,
} from '@/lib/objects';
import {
  CATEGORY_LABEL, Empty, Figures, Headline, LoadingRows, Panel, Ticket, daysSince, plural,
} from '@/components/home/homeKit';
import { useComplaintOpener } from '@/components/home/useComplaintOpener';
import { ObjectLink, PlaceName } from './ObjectLink';
import { rememberObject } from './recent';

/** How a level is named after a place in the trail: "Hura block", "Lakhanpur panchayat". */
const TRAIL_NOUN: Record<string, string> = { seat: 'seat', block: 'block', gp: 'panchayat', village: 'village' };

function headline(v: ObjectView): { text: string; sub?: string; tone?: 'late' | 'done' } {
  const f = v.figures;
  const name = v.type === 'booth' ? v.title : (v.title_bn || v.title);
  if (v.type === 'person') {
    if (!f.total) return { text: `Nothing has been given to ${v.title} yet.` };
    if (!f.open) return { text: `${v.title} has nothing open.`, sub: `${plural(f.total, 'complaint')} handled so far, all closed.`, tone: 'done' };
    return {
      text: `${v.title} is carrying ${plural(f.open, 'open complaint')}`,
      sub: f.past_due ? `${plural(f.past_due, 'is', 'are')} past the deadline. The oldest has waited ${plural(f.oldest_days ?? 0, 'day')}.`
        : `None is past its deadline. The oldest has waited ${plural(f.oldest_days ?? 0, 'day')}.`,
      tone: f.past_due ? 'late' : undefined,
    };
  }
  if (!f.total) return { text: `No complaint has come in from ${name} yet.` };
  if (!f.open) return { text: `Nothing is open in ${name}.`, sub: `All ${plural(f.total, 'complaint')} from here are closed.`, tone: 'done' };

  const parts = [`${plural(f.open, 'open complaint')} in ${name}`];
  const notes: string[] = [];
  if (f.past_due) notes.push(`${f.past_due} past the deadline`);
  if (f.no_owner) notes.push(`${f.no_owner} with nobody on ${f.no_owner === 1 ? 'it' : 'them'}`);
  const text = notes.length ? `${parts[0]}, ${notes.join(' and ')}` : parts[0];

  const busiest = v.children?.items.filter((c) => c.open > 0).sort((a, b) => b.open - a.open)[0];
  const topCat = v.categories.filter((c) => c.open > 0)[0];
  const subs: string[] = [];
  if (busiest && busiest.open < f.open) subs.push(`${busiest.label_bn || busiest.label} has the most, ${busiest.open}.`);
  if (topCat) subs.push(`${CATEGORY_LABEL(topCat.category)} is the biggest problem, ${plural(topCat.open, 'open complaint')}.`);
  return { text, sub: subs.join(' ') || undefined, tone: f.past_due || f.no_owner ? 'late' : undefined };
}

/** Twelve weekly bars, oldest on the left, this week in saffron. */
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 7, gap = 3, h = 30;
  const label = `Filed per week, oldest first: ${values.join(', ')}`;
  return (
    <svg width={values.length * (w + gap) - gap} height={h} role="img" aria-label={label} className="block">
      <title>{label}</title>
      {values.map((n, i) => {
        const bh = n ? Math.max(3, (n / max) * h) : 1.5;
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={1.5}
          className={i === values.length - 1 ? 'fill-primary' : n ? 'fill-muted-foreground/55' : 'fill-muted-foreground/20'} />;
      })}
    </svg>
  );
}

function Trail({ v }: { v: ObjectView }) {
  if (!v.trail.length) return null;
  return (
    <nav aria-label="Where this sits" className="mb-3">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13.5px] text-muted-foreground">
        {v.trail.map((s) => (
          <li key={`${s.type}-${s.key}`} className="flex items-center gap-1.5">
            <ObjectLink type={s.type} id={s.key} className="text-muted-foreground">
              <PlaceName label={s.label} bn={s.label_bn} quiet />
            </ObjectLink>
            {TRAIL_NOUN[s.type] && <span className="text-muted-foreground/60">{TRAIL_NOUN[s.type]}</span>}
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden />
          </li>
        ))}
        <li aria-current="page" className="text-foreground">{v.title_bn && v.type !== 'booth' ? v.title_bn : v.title}</li>
      </ol>
    </nav>
  );
}

function ChildrenPanel({ v }: { v: ObjectView }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const c = v.children;
  const items = useMemo(() => {
    const list = c?.items ?? [];
    const needle = q.trim().toLowerCase();
    return needle ? list.filter((r) => r.label.toLowerCase().includes(needle) || (r.label_bn || '').includes(q.trim())) : list;
  }, [c, q]);
  if (!c || !c.items.length) return null;
  const maxOpen = Math.max(1, ...c.items.map((r) => r.open));
  const shown = all || q ? items : items.slice(0, 12);
  const withComplaints = c.items.filter((r) => r.total > 0).length;
  const noun = OBJECT_NOUN[c.type].toLowerCase();

  return (
    <Panel title={c.title} count={c.items.length}
      note={withComplaints ? `${withComplaints} with complaints. Most open first.` : `None has a complaint yet.`}>
      {c.items.length > 10 && (
        <div className="border-b border-border px-4 py-2.5">
          <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring">
            <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find a ${noun} in ${v.title}`} data-bare-focus
              aria-label={`Find a ${noun}`} className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </label>
        </div>
      )}
      {items.length === 0 ? <Empty>No {noun} here matches “{q}”.</Empty> : (
        <ul>
          {shown.map((r: ChildRow) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_48px_60px] items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_96px_72px]">
              <div className="min-w-0">
                <ObjectLink type={r.type} id={r.key} className="font-medium text-foreground">
                  <PlaceName label={r.label} bn={r.label_bn} />
                </ObjectLink>
                {r.sub && <p className="truncate text-xs text-muted-foreground">{r.sub}</p>}
              </div>
              <div className="h-1.5 rounded-full bg-muted" aria-hidden>
                {r.open > 0 && <div className={`h-full rounded-full ${r.past_due ? 'bg-late' : 'bg-primary'}`} style={{ width: `${(r.open / maxOpen) * 100}%` }} />}
              </div>
              <p className="text-right text-sm tabular-nums">
                {r.total ? <><span className="font-semibold text-foreground">{r.open}</span><span className="text-muted-foreground"> of {r.total}</span></>
                  : <span className="text-muted-foreground/70">none</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
      {!q && items.length > 12 && (
        <div className="border-t border-border px-4 py-2">
          <Button variant="ghost" size="sm" onClick={() => setAll((x) => !x)} className="-ml-2 text-muted-foreground">
            {all ? 'Show fewer' : `Show all ${items.length}`}
          </Button>
        </div>
      )}
    </Panel>
  );
}

const CLOSED = new Set(['RESOLVED', 'CLOSED', 'REJECTED']);
const STATUS_WORD: Record<string, string> = {
  OPEN: 'Open', REGISTERED: 'Open', ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved', CLOSED: 'Closed', REJECTED: 'Rejected',
};

function ComplaintRow({ c, v, onOpen }: { c: ObjectComplaint; v: ObjectView; onOpen: (id: string) => void }) {
  const closed = CLOSED.has(c.status);
  // Name only the places below this page; the page itself is already the context.
  const showVillage = c.village && !['village', 'booth'].includes(v.type);
  const showBlock = c.block && ['district', 'seat', 'person'].includes(v.type);
  return (
    <li className="grid gap-x-4 gap-y-1 border-t border-border px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <button type="button" onClick={() => onOpen(c.id)} className="block w-full min-w-0 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-medium text-foreground">{c.citizen || 'Citizen'}</span>
            <Ticket>{c.ticket}</Ticket>
          </span>
          <span className={`mt-0.5 block text-[15px] leading-snug line-clamp-2 ${closed ? 'text-muted-foreground' : 'text-foreground/90'}`}>{c.issue}</span>
        </button>
        {/* One sentence, so the punctuation sits where it belongs: "Water in Paharpur, Hura. With Biswajit." */}
        <p className="mt-1 text-xs text-muted-foreground">
          {CATEGORY_LABEL(c.category)}
          {showVillage && <> in <ObjectLink type="village" id={c.village_code}>{c.village}</ObjectLink></>}
          {showBlock && <>, <ObjectLink type="block" id={c.block_code || c.block}>{c.block}</ObjectLink></>}
          {v.type !== 'person' && (c.owner_id
            ? <>. With <ObjectLink type="person" id={c.owner_id}>{c.owner_name || 'someone'}</ObjectLink></>
            : !closed && <>. <span className="text-late">Nobody on it yet</span></>)}
        </p>
      </div>
      <div className="flex items-baseline gap-3 sm:block sm:text-right">
        <p className={`text-sm font-medium ${closed ? 'text-done' : 'text-foreground'}`}>{STATUS_WORD[c.status] || c.status}</p>
        {!closed && (
          <p className={`text-xs tabular-nums ${c.past_due ? 'text-late' : 'text-muted-foreground'}`}>
            {c.past_due && c.days_over ? `${plural(c.days_over, 'day')} past the deadline` : `waiting ${plural(c.age_days, 'day')}`}
          </p>
        )}
      </div>
    </li>
  );
}

function ComplaintsPanel({ v, onOpen }: { v: ObjectView; onOpen: (id: string) => void }) {
  const open = v.complaints.filter((c) => c.is_open);
  const [tab, setTab] = useState<'open' | 'all'>(open.length ? 'open' : 'all');
  const list = tab === 'open' ? open : v.complaints;
  // The list holds the most pressing 60; the tabs count everything, so a district
  // with 348 open never reads "Open 60".
  const shownOf = tab === 'open' ? v.figures.open : v.figures.total;
  const capped = shownOf > list.length;
  const tabs = (
    <div role="tablist" aria-label="Which complaints" className="flex rounded-md border border-border p-0.5 text-[13px]">
      {(['open', 'all'] as const).map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
          className={`rounded px-2.5 py-1 tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === t ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          {t === 'open' ? `Open ${v.figures.open.toLocaleString('en-IN')}` : `All ${v.figures.total.toLocaleString('en-IN')}`}
        </button>
      ))}
    </div>
  );
  return (
    <Panel title="Complaints" action={v.figures.total ? tabs : undefined}>
      {v.figures.total === 0 ? <Empty>{v.type === 'person' ? 'Nothing has been assigned yet.' : 'No complaint has come in from here yet.'}</Empty>
        : list.length === 0 ? <Empty>Nothing is open. Switch to All to see what was closed.</Empty> : (
          <ul>{list.map((c) => <ComplaintRow key={c.id} c={c} v={v} onOpen={onOpen} />)}</ul>
        )}
      {capped && list.length > 0 && (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          Showing the {list.length} most pressing of {shownOf.toLocaleString('en-IN')}. The full list is under Complaints.
        </p>
      )}
    </Panel>
  );
}

function FactsPanel({ v }: { v: ObjectView }) {
  const facts = v.facts.filter((f) => f.value !== null && f.value !== '' && f.value !== undefined);
  if (!facts.length) return null;
  return (
    <Panel title="Details">
      <dl className="divide-y divide-border">
        {facts.map((f) => (
          <div key={f.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-2.5 text-sm">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className="text-right font-medium tabular-nums text-foreground">
              {f.type && f.key ? <ObjectLink type={f.type} id={f.key}>{String(f.value)}</ObjectLink>
                : f.href ? (
                  <a href={f.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-foreground/25 underline-offset-[3px] hover:decoration-primary">
                    {String(f.value)}<ExternalLink className="h-3 w-3" aria-hidden /><span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : typeof f.value === 'number' ? f.value.toLocaleString('en-IN') : f.value}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function CategoriesPanel({ v }: { v: ObjectView }) {
  const cats = v.categories.filter((c) => c.total > 0);
  if (!cats.length) return null;
  const max = Math.max(1, ...cats.map((c) => c.total));
  return (
    <Panel title="What people raise here" note="Open, of all filed">
      <ul className="space-y-3 px-4 py-4">
        {cats.map((c) => (
          <li key={c.category}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-foreground">{CATEGORY_LABEL(c.category)}</span>
              <span className="tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{c.open}</span> of {c.total}</span>
            </div>
            <div className="relative mt-1.5 h-1.5 rounded-full bg-muted" aria-hidden>
              <div className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/30" style={{ width: `${(c.total / max) * 100}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(c.open / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function BoothsPanel({ v }: { v: ObjectView }) {
  if (!v.booths.length) return null;
  const busiestOnly = v.type === 'block' || v.type === 'seat';
  const covered = v.booths.filter((b) => b.karyakarta).length;
  return (
    <Panel title={busiestOnly ? 'Booths with the most complaints' : 'Booths'} count={busiestOnly ? undefined : v.booths.length}
      note={busiestOnly ? undefined : `${covered} of ${v.booths.length} ${v.booths.length === 1 ? 'has' : 'have'} a karyakarta`}>
      <ul className={v.booths.length > 8 ? 'max-h-[340px] overflow-y-auto' : ''}>
        {v.booths.map((b) => (
          <li key={b.key} className="flex items-start justify-between gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
            <div className="min-w-0">
              <ObjectLink type="booth" id={b.key} className="text-sm font-medium text-foreground">{b.label}</ObjectLink>
              {b.sub && <p className="truncate text-xs text-muted-foreground" title={b.sub}>{b.sub}</p>}
              <p className="text-xs text-muted-foreground">
                {b.karyakarta ? <ObjectLink type="person" id={b.karyakarta_id}>{b.karyakarta}</ObjectLink> : <span className="text-muted-foreground/70">No karyakarta yet</span>}
              </p>
            </div>
            <p className="shrink-0 text-right text-sm tabular-nums">
              {b.total ? <><span className="font-semibold text-foreground">{b.open}</span><span className="text-muted-foreground"> open</span></> : <span className="text-muted-foreground/70">none</span>}
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function TeamPanel({ v }: { v: ObjectView }) {
  if (v.type === 'person') return null;
  return (
    <Panel title="Team" count={v.team.length || undefined}>
      {v.team.length === 0 ? (
        <Empty>Nobody from the party is set up for {v.title_bn || v.title} yet, and nobody here owns an open complaint.</Empty>
      ) : (
        <ul>
          {v.team.map((m) => (
            <li key={m.key} className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
              <div className="min-w-0">
                <ObjectLink type="person" id={m.key} className="truncate text-sm font-medium text-foreground">{m.label}</ObjectLink>
                <p className="text-xs text-muted-foreground">
                  {ROLE_NOUN[m.role_level || ''] || 'Office'}
                  {/* "ALL" is a stored sentinel and "West Bengal" a state, not a block. */}
                  {m.block && !['ALL', 'WEST BENGAL'].includes(m.block.toUpperCase()) ? `, ${m.block}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-sm tabular-nums ${m.open ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{m.open} open here</p>
                {m.oldest !== null && <p className="text-xs text-muted-foreground">oldest {plural(m.oldest, 'day')}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ObjectPage({ objectRef }: { objectRef: ObjectRef }) {
  const [view, setView] = useState<ObjectView | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/objects/${objectRef.type}/${encodeURIComponent(objectRef.key)}`, { headers: authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError({ status: r.status, message: j.error || 'Could not load this page' }); return; }
      const v = j.data as ObjectView;
      setView(v);
      rememberObject({ type: v.type, key: v.key, label: v.title, label_bn: v.title_bn, kind: v.kind });
      // A page opened by name (or "home") settles on its canonical address, without a second history entry.
      const canonical = `#/${v.type}/${encodeURIComponent(v.key)}`;
      if (window.location.hash !== canonical && objectRef.key !== v.key) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${canonical}`);
      }
    } catch {
      setError({ status: 0, message: 'The server did not answer. Check the connection and try again.' });
    }
  }, [objectRef.type, objectRef.key]);

  useEffect(() => { setView(null); load(); }, [load]);
  // The tab names the place while it is open, and gives the name back on the way out.
  useEffect(() => {
    if (!view) return;
    const before = document.title;
    document.title = `${view.title_bn && view.type !== 'booth' ? view.title_bn : view.title}, ${view.kind.toLowerCase()} | Banglar Sahayak`;
    return () => { document.title = before; };
  }, [view]);

  const { openComplaint, dialog } = useComplaintOpener(load);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy. Copy the address from the browser bar instead.');
    }
  }

  if (error) {
    return (
      <div className="max-w-xl py-12">
        <p className="text-lg font-semibold text-foreground">{error.message}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {error.status === 403 ? 'Places outside your seats stay private to the people who run them.'
            : error.status === 404 ? 'The link may be old, or the place was typed differently. Search for it with Ctrl K.'
            : 'Nothing was changed.'}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.history.back()}><ArrowLeft className="mr-1.5 h-4 w-4" />Go back</Button>
          {error.status !== 403 && error.status !== 404 && <Button size="sm" onClick={load}>Try again</Button>}
        </div>
      </div>
    );
  }
  if (!view) return <LoadingRows />;

  const v = view;
  const f = v.figures;
  const h = headline(v);
  const weeklyTotal = v.weekly.reduce((a, b) => a + b, 0);
  const keyFact = v.type === 'booth' ? null : v.facts.find((x) => /code/i.test(x.label));

  return (
    <div className="pb-12">
      <Trail v={v} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground text-balance sm:text-[32px]">
            {v.type === 'booth' ? v.title : <PlaceName label={v.title} bn={v.title_bn} />}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {v.type === 'booth' && v.title_bn ? `${v.kind}, ${v.title_bn}` : v.kind}
            {keyFact ? `, LGD ${keyFact.value}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copyLink}><Link2 className="mr-1.5 h-3.5 w-3.5" />Copy link</Button>
          <Button variant="outline" size="sm" onClick={load} aria-label="Refresh"><RotateCcw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      <Headline text={h.text} sub={h.sub} tone={h.tone} />
      <Figures items={[
        { label: 'open', value: f.open },
        { label: 'past the deadline', value: f.past_due, tone: f.past_due ? 'late' : undefined },
        ...(v.type === 'person' ? [] : [{ label: 'with nobody on them', value: f.no_owner, tone: f.no_owner ? ('late' as const) : undefined }]),
        { label: 'closed in 30 days', value: f.resolved_30d, tone: f.resolved_30d ? ('done' as const) : undefined },
        {
          label: weeklyTotal ? `filed in 12 weeks, ${f.new_30d} in the last 30 days` : 'filed in the last 12 weeks',
          value: <span className="flex items-end gap-3">{weeklyTotal}<Sparkline values={v.weekly} /></span>,
          hint: f.last_filed_at && !f.new_30d ? `last one ${plural(daysSince(f.last_filed_at) ?? 0, 'day')} ago` : undefined,
        },
      ]} />

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <ChildrenPanel v={v} />
          <ComplaintsPanel v={v} onOpen={openComplaint} />
        </div>
        <aside className="space-y-5">
          <FactsPanel v={v} />
          <CategoriesPanel v={v} />
          <BoothsPanel v={v} />
          <TeamPanel v={v} />
        </aside>
      </div>
      {dialog}
    </div>
  );
}
