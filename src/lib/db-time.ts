/**
 * Reading a timestamp that came out of the database.
 *
 * The complaint tables store time in `timestamp without time zone` columns
 * holding UTC, and PostgREST serialises them with no zone marker at all:
 *
 *     "2026-08-09T12:05:35.345"
 *
 * JavaScript reads a bare date-time like that as *local* time. On the Vercel
 * server, which runs in UTC, that happens to be right — so every count, age and
 * SLA figure computed server-side was correct. In a browser in India the same
 * string became 12:05 IST instead of 17:35 IST, and every time the app printed
 * was five and a half hours early. Nothing looked broken; the numbers were
 * simply wrong, in the one direction nobody double-checks.
 *
 * So: never hand a database timestamp straight to `new Date()`. Use dbDate(),
 * which assumes UTC when the string does not say otherwise and leaves anything
 * already carrying a zone alone.
 */

/** Trailing `Z`, or a `+05:30` / `-0800` style offset. */
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** A bare date-time with no zone: `YYYY-MM-DD` then `T` or a space, then a time. */
const BARE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

export function dbDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);

  const s = String(value).trim();
  if (BARE_DATETIME.test(s) && !HAS_ZONE.test(s)) {
    // Postgres writes a space where ISO wants a T; both shapes reach us.
    return new Date(s.replace(' ', 'T') + 'Z');
  }
  return new Date(s);
}

/**
 * Milliseconds since epoch, or NaN for anything unreadable — so callers can do
 * arithmetic without every one of them repeating the null check.
 */
export function dbTime(value: string | number | Date | null | undefined): number {
  const d = dbDate(value);
  return d ? d.getTime() : NaN;
}

/**
 * The constituency runs on IST, so times are pinned to it rather than to
 * whatever zone the viewer's device happens to be in. A PA checking the roster
 * from outside the state should still see the hour the office saw.
 */
export const IST = 'Asia/Kolkata';
