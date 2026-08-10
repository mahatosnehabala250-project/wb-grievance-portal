/**
 * How long a complaint may sit before the office is late.
 *
 * This is the single definition. It used to exist in eight places in three
 * different shapes — six copied objects across the map, intelligence and MLA
 * routes, an urgency-blind rule in helpers.ts that called anything over seven
 * days breached, and a Postgres trigger writing 6h/24h/72h/168h into a column
 * nothing reads. The same complaint could therefore be "past deadline" on the
 * map and "on time" in the list beside it.
 *
 * The old allowances (6 hours for critical, 1 day for high, 3 for medium) were
 * written for a helpdesk, not a constituency office. Against them Purulia
 * showed ten of eleven open cases breached while its median case actually
 * closed in three days — a measure that is red no matter what anyone does
 * carries no information and gets ignored. These allowances are what a block
 * office can realistically hold itself to, so red means somebody is genuinely
 * late.
 */

import { dbDate } from './db-time';

export const SLA_DAYS: Record<string, number> = {
  CRITICAL: 1,
  HIGH: 3,
  MEDIUM: 7,
  LOW: 15,
};

/** Anything with an unrecognised urgency is treated as MEDIUM. */
export const DEFAULT_SLA_DAYS = SLA_DAYS.MEDIUM;

export function slaDaysFor(urgency: string | null | undefined): number {
  return SLA_DAYS[String(urgency || '').toUpperCase()] ?? DEFAULT_SLA_DAYS;
}

const DAY_MS = 86_400_000;

/** When this complaint becomes late. */
export function slaDeadline(createdAt: string | Date, urgency: string | null | undefined): Date {
  // dbDate, not new Date: a database timestamp arrives with no zone marker and
  // would otherwise be read as local time in the browser.
  const start = dbDate(createdAt) ?? new Date(NaN);
  return new Date(start.getTime() + slaDaysFor(urgency) * DAY_MS);
}

/**
 * Whether an *open* complaint is past its deadline. Resolved and rejected
 * cases are never breached — the clock stops when the case is closed, and
 * counting finished work as late was how the old figure inflated itself.
 */
const CLOSED = new Set(['RESOLVED', 'REJECTED', 'CLOSED']);

export function isBreached(
  createdAt: string | Date,
  urgency: string | null | undefined,
  status?: string | null,
  now: Date = new Date(),
): boolean {
  if (status && CLOSED.has(String(status).toUpperCase())) return false;
  return now.getTime() > slaDeadline(createdAt, urgency).getTime();
}

export type SlaLevel = 'ok' | 'warning' | 'breached';

/**
 * Three-band state. "warning" starts at two-thirds of the allowance, which is
 * the point where a case still has time but will not survive being forgotten
 * over a weekend.
 */
export const WARNING_AT = 2 / 3;

export function slaLevel(
  createdAt: string | Date,
  urgency: string | null | undefined,
  status?: string | null,
  now: Date = new Date(),
): SlaLevel {
  if (status && CLOSED.has(String(status).toUpperCase())) return 'ok';
  const start = dbDate(createdAt);
  if (!start) return 'ok';
  const elapsed = (now.getTime() - start.getTime()) / DAY_MS;
  const allowed = slaDaysFor(urgency);
  if (elapsed > allowed) return 'breached';
  if (elapsed >= allowed * WARNING_AT) return 'warning';
  return 'ok';
}
