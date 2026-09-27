'use client';

import type { ReactNode } from 'react';
import { dbDate } from '@/lib/db-time';

/** Shared pieces for the district and seat home screens, so both read as one product. */

export type Tone = 'late' | 'done' | 'info' | 'saffron' | undefined;

const toneText: Record<string, string> = {
  late: 'text-late', done: 'text-done', info: 'text-info', saffron: 'text-saffron',
};

export function daysSince(ts?: string | null): number | null {
  const d = dbDate(ts ?? null);
  if (!d || Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

export function fmtShortDate(ts?: string | null): string {
  const d = dbDate(ts ?? null);
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
}

export function PageHead({ title, meta, right, back }: { title: string; meta?: ReactNode; right?: ReactNode; back?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {meta && <p className="mt-0.5 text-sm text-muted-foreground">{meta}</p>}
      </div>
      {right}
    </div>
  );
}

/** The one sentence that says what matters today, with its explanation under it. */
export function Headline({ text, sub, tone }: { text: string; sub?: string; tone?: Tone }) {
  return (
    <div className="mt-5 max-w-3xl">
      <p className={`text-xl font-semibold leading-snug text-balance ${tone ? toneText[tone] : 'text-foreground'}`}>{text}</p>
      {sub && <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{sub}</p>}
    </div>
  );
}

export type Figure = { label: string; value: ReactNode; tone?: Tone; hint?: string };

/** A single strip of figures separated by rules — not a row of cards. */
export function Figures({ items }: { items: Figure[] }) {
  return (
    <dl className="mt-5 grid grid-cols-2 border-y border-border sm:grid-cols-3 lg:flex">
      {items.map((f, i) => (
        <div key={f.label}
          className={`px-4 py-3 lg:flex-1 ${i === 0 ? 'lg:pl-0' : ''} border-border ${i > 0 ? 'lg:border-l' : ''} ${i % 2 ? 'border-l sm:border-l-0' : ''}`}>
          <dd className={`text-[26px] font-semibold leading-tight tabular-nums ${f.tone ? toneText[f.tone] : 'text-foreground'}`}>{f.value}</dd>
          <dt className="text-[13px] text-muted-foreground">{f.label}</dt>
          {f.hint && <p className="text-xs text-muted-foreground/70">{f.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

export function Panel({ title, count, note, action, children, className = '' }: {
  title: string; count?: number; note?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-lg border border-border bg-card ${className}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-[15px] font-semibold text-foreground">
          {title}{count !== undefined && <span className="ml-2 font-normal tabular-nums text-muted-foreground">{count}</span>}
        </h2>
        {note && <p className="text-[13px] text-muted-foreground">{note}</p>}
        {action}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-sm text-muted-foreground">{children}</p>;
}

/**
 * Days waiting on a shared scale, with the deadline marked. Everything before
 * the deadline is neutral; only the time past it is drawn in the late colour,
 * so how overdue a case is reads without reading the number.
 */
export function WaitBar({ days, dueDays, max }: { days: number; dueDays: number; max: number }) {
  const scale = Math.max(max, dueDays, 1);
  const w = Math.min(days, scale) / scale * 100;
  const due = Math.min(dueDays, scale) / scale * 100;
  const late = days > dueDays;
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-1.5 flex-1 rounded-full bg-muted" aria-hidden>
        <div className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/40" style={{ width: `${Math.min(w, due)}%` }} />
        {late && <div className="absolute inset-y-0 rounded-r-full bg-late" style={{ left: `${due}%`, width: `${w - due}%` }} />}
        <div className="absolute -top-1 bottom-[-4px] w-px bg-foreground/50" style={{ left: `${due}%` }} title="Deadline" />
      </div>
      <span className={`w-16 shrink-0 text-right text-[13px] font-medium tabular-nums ${late ? 'text-late' : 'text-muted-foreground'}`}>
        {plural(days, 'day')}
      </span>
    </div>
  );
}

export const DUE_DAYS: Record<string, number> = { CRITICAL: 1, HIGH: 3, MEDIUM: 7, LOW: 15 };
export const dueFor = (urgency?: string | null) => DUE_DAYS[String(urgency || '').toUpperCase()] ?? 7;

export const CATEGORY_LABEL = (c?: string | null) =>
  String(c || 'OTHER').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase());

export function Ticket({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[12.5px] text-muted-foreground">{children}</span>;
}

export function LoadingRows() {
  return (
    <div className="mt-6 space-y-3" aria-busy>
      {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/60" />)}
    </div>
  );
}
