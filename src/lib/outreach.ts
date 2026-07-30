/**
 * Rules for outbound messaging to citizens.
 *
 * These live apart from the route so the guardrails can be read in one place —
 * they are the part of this feature that keeps a client out of trouble, and
 * they must not be buried inside request handling.
 */

/** Hard ceiling on one campaign. Anything larger is a mailing list, not an office. */
export const MAX_RECIPIENTS = 2000;

/** Nobody wants an office message at 11pm. IST hours, inclusive of start. */
export const QUIET_HOURS = { from: 21, to: 8 };

export const AUDIENCE_KINDS = ['SERVICE', 'BROADCAST'] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];

/** Roles allowed to actually send. Coordinators may draft, not send. */
export const SEND_ROLES = ['MP', 'MLA', 'DISTRICT_ADMIN'];

export const OPT_OUT_LINE = 'Reply STOP to stop receiving these messages.';

/**
 * Current hour in IST, regardless of where the server runs.
 *
 * Asked for by name rather than computed from getTimezoneOffset(): the offset
 * carries a sign that is easy to apply backwards, and getting it wrong silences
 * sending during the working day while waving it through at midnight — the
 * exact opposite of the rule.
 */
const IST_HOUR_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false,
});
export function istHour(now: Date = new Date()): number {
  return Number(IST_HOUR_FMT.format(now));
}

export function inQuietHours(now: Date = new Date()): boolean {
  const h = istHour(now);
  return h >= QUIET_HOURS.from || h < QUIET_HOURS.to;
}

/**
 * Every message carries a way out. Appended rather than left to the writer,
 * because the one time it is forgotten is the time it matters.
 */
export function withOptOut(message: string): string {
  const m = message.trim();
  return m.toUpperCase().includes('STOP') ? m : `${m}\n\n${OPT_OUT_LINE}`;
}

/** Digits only, so 91-prefixed and plain numbers match the same person. */
export function normalisePhone(p: string | null | undefined): string {
  const d = (p || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

export interface AudienceRow {
  phone: string;
  citizen_name: string | null;
  village: string | null;
  complaint_id: string | null;
}

export interface AudienceResult {
  recipients: AudienceRow[];
  excluded: { optedOut: number; noConsent: number; noPhone: number; duplicates: number };
  capped: boolean;
}

/**
 * Reduce raw complaint rows to a deduplicated, permitted audience.
 *
 * Exclusions are counted rather than silently dropped: an operator about to
 * message a village deserves to know that 40 of them opted out, and a campaign
 * that quietly shrinks looks like it worked when it did not.
 */
export function buildAudience(
  rows: Array<{ phone: string | null; citizenName: string | null; village: string | null; id: string }>,
  kind: AudienceKind,
  optedOut: Set<string>,
  consented: Set<string>
): AudienceResult {
  const seen = new Set<string>();
  const recipients: AudienceRow[] = [];
  const excluded = { optedOut: 0, noConsent: 0, noPhone: 0, duplicates: 0 };

  for (const r of rows) {
    const phone = normalisePhone(r.phone);
    if (!phone || phone.length < 10) { excluded.noPhone++; continue; }
    if (seen.has(phone)) { excluded.duplicates++; continue; }
    if (optedOut.has(phone)) { excluded.optedOut++; continue; }
    if (kind === 'BROADCAST' && !consented.has(phone)) { excluded.noConsent++; continue; }

    seen.add(phone);
    recipients.push({
      phone,
      citizen_name: r.citizenName,
      village: r.village,
      complaint_id: r.id,
    });
  }

  const capped = recipients.length > MAX_RECIPIENTS;
  return { recipients: capped ? recipients.slice(0, MAX_RECIPIENTS) : recipients, excluded, capped };
}
