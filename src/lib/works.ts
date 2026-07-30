/**
 * Development works — shared vocabulary and the money arithmetic.
 *
 * Kept out of the route so the four amounts that people routinely conflate are
 * defined in one place: what a work was estimated at, what was sanctioned
 * against it, what has actually been released, and what has been spent. Those
 * diverge for months at a time, and a dashboard that adds the wrong pair tells
 * an MLA they have money they do not have.
 */

export const WORK_CATEGORIES = [
  'ROAD', 'WATER', 'ELECTRICITY', 'SCHOOL', 'HEALTH', 'DRAINAGE',
  'COMMUNITY_HALL', 'STREETLIGHT', 'TOILET', 'IRRIGATION', 'OTHER',
] as const;

export const FUND_SOURCES = [
  'MLA_LAD', 'MPLAD', 'STATE_SCHEME', 'PANCHAYAT', 'CSR', 'OTHER',
] as const;

export const WORK_STATUSES = [
  'PROPOSED', 'SANCTIONED', 'IN_PROGRESS', 'COMPLETED', 'STALLED', 'CANCELLED',
] as const;

export type WorkStatus = (typeof WORK_STATUSES)[number];

/** Agencies that actually execute work in a WB constituency. */
export const EXECUTING_AGENCIES = [
  'Gram Panchayat',
  'Panchayat Samiti',
  'Zilla Parishad',
  'PWD',
  'PHE',
  'WBSEDCL',
  'Irrigation Department',
  'Block Development Office',
  'Other',
];

/**
 * Indian financial year for a date: April to March, labelled "2026-27".
 *
 * Asked for in IST rather than derived from the server clock — a work created
 * just after midnight on 1 April must not be filed against the previous year
 * because the server happens to sit in another timezone.
 */
const IST_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit',
});
export function financialYear(d: Date = new Date()): string {
  const parts = IST_PARTS.formatToParts(d);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The last few financial years, newest first, for a year picker. */
export function recentFinancialYears(n = 4, from: Date = new Date()): string[] {
  const current = financialYear(from);
  const start = Number(current.slice(0, 4));
  return Array.from({ length: n }, (_, i) => {
    const s = start - i;
    return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
  });
}

export interface WorkAmounts {
  estimated_cost: number | null;
  sanctioned_amount: number | null;
  released_amount: number | null;
  spent_amount: number | null;
  status: string;
}

export interface FundSummary {
  allocated: number;
  sanctioned: number;
  released: number;
  spent: number;
  /** Allocated minus sanctioned — what may still be committed to new work. */
  uncommitted: number;
  /** Sanctioned minus spent — committed money not yet paid out. */
  inFlight: number;
  counts: Record<string, number>;
  works: number;
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Roll works up against an allocation.
 *
 * Cancelled works are excluded from every total: money on a cancelled sanction
 * goes back to the pool, and counting it as committed makes the remaining
 * balance read lower than it is — the error that causes an office to stop
 * sanctioning work it could afford.
 */
export function summarise(works: WorkAmounts[], allocated: number): FundSummary {
  const live = works.filter((w) => w.status !== 'CANCELLED');
  const sanctioned = live.reduce((s, w) => s + num(w.sanctioned_amount), 0);
  const released = live.reduce((s, w) => s + num(w.released_amount), 0);
  const spent = live.reduce((s, w) => s + num(w.spent_amount), 0);

  const counts: Record<string, number> = {};
  for (const w of works) counts[w.status] = (counts[w.status] || 0) + 1;

  return {
    allocated,
    sanctioned,
    released,
    spent,
    uncommitted: allocated - sanctioned,
    inFlight: sanctioned - spent,
    counts,
    works: works.length,
  };
}

/** Indian short form — an MLA reads lakh and crore, not 6000000. */
export function inr(n: number | null | undefined): string {
  const v = num(n);
  if (v === 0) return '₹0';
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `₹${(v / 1e3).toFixed(1)}k`;
  return `₹${v.toFixed(0)}`;
}
