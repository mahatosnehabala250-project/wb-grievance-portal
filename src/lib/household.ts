/**
 * Households — the ledger's spine.
 *
 * A complaint answers "what happened". A household answers "to whom, overall".
 * The same family files again across years, from a phone that carries every
 * member's voice; until they are grouped, the ledger is rows, not relationships.
 *
 * Two keys, in order of trust:
 *   1. Phone. Every complaint from the same WhatsApp number is one household —
 *      the family phone is the family. Normalised to its last ten digits so
 *      +91 prefixes and stray formatting cannot split it.
 *   2. Name + village. For the rows that arrived without a phone, a
 *      conservative key: normalised name at normalised village. Anything
 *      fuzzier would merge neighbours; anything stricter would split
 *      transliterations. This is deliberately the second choice, not the first.
 *
 * Booth linkage is deliberately absent from the key. A booth is derived, not
 * identity-defining: the household keeps its villages and the caller can
 * resolve booths from them (village → polling_stations shortlist today, the
 * electoral roll's exact answer once Phase 3 lands).
 */

/** Strip formatting noise; keep the last ten digits of anything longer. */
export function normPhone(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 7) return ''; // too short to be a real Indian number
  return digits.slice(-10);
}

/**
 * Honorifics that travel with names in this data. Removing them lets
 * "Shri Bikash Bauri" and "Bikash Bauri" land on the same person key.
 * Bengali honorifics are included; Bengali script itself needs no folding.
 */
const HONORIFICS =
  /^(?:shri|shree|smt|sm|srimati|md|mohammad|muhammad|sk|sheikh|dr| shri |।)?\s*/i;

/** Lowercase, strip punctuation and honorifics, collapse whitespace. */
export function normPersonName(raw: string | null | undefined): string {
  let s = String(raw ?? '').trim().toLowerCase();
  s = s.replace(/[.,;:'"()|]/g, ' ');
  // Drop leading honorifics repeatedly ("Md Sk Rahim")
  for (let i = 0; i < 3; i++) s = s.replace(/^(shri|shree|smt|srimati|md|mohammad|muhammad|sk|sheikh|dr|md\.)\s+/, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** Village names fold like block names: case and spacing only. */
export function normVillage(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface HouseholdSource {
  ticketNo?: string | null;
  citizenName?: string | null;
  phone?: string | null;
  village?: string | null;
  gp_name?: string | null;
  block?: string | null;
  status?: string | null;
  category?: string | null;
  satisfactionRating?: number | string | null;
  createdAt?: string | Date | null;
}

export interface HouseholdRecord {
  key: string;
  /** Phone-keyed households carry the phone; name-keyed ones do not. */
  phone: string | null;
  displayName: string;
  village: string;
  gp: string;
  block: string;
  tickets: string[];
  total: number;
  open: number;
  resolved: number;
  /** Distinct categories, most frequent first, capped for display. */
  topCategories: string[];
  ratings: number[];
  avgRating: number | null;
  lastAt: string | null;
}

export function householdKey(c: HouseholdSource): string {
  const p = normPhone(c.phone);
  if (p) return 'P:' + p;
  const n = normPersonName(c.citizenName);
  const v = normVillage(c.village);
  if (n && v) return `N:${n}|${v}`;
  // No phone and no usable name+place: it cannot be grouped honestly.
  return '';
}

/**
 * Group complaints into household records. Rows that yield no key are skipped
 * and counted, never silently merged into someone else's family.
 */
export function buildHouseholds(rows: HouseholdSource[]): {
  households: HouseholdRecord[];
  ungrouped: number;
} {
  const byKey = new Map<string, HouseholdRecord>();
  const catCount = new Map<string, Map<string, number>>();
  let ungrouped = 0;

  for (const c of rows) {
    const key = householdKey(c);
    if (!key) {
      ungrouped++;
      continue;
    }
    let h = byKey.get(key);
    if (!h) {
      h = {
        key,
        phone: normPhone(c.phone) || null,
        displayName: String(c.citizenName || '').trim() || 'Unknown',
        village: String(c.village || '').trim(),
        gp: String(c.gp_name || '').trim(),
        block: String(c.block || '').trim(),
        tickets: [],
        total: 0,
        open: 0,
        resolved: 0,
        topCategories: [],
        ratings: [],
        avgRating: null,
        lastAt: null,
      };
      byKey.set(key, h);
      catCount.set(key, new Map());
    }
    h.total++;
    h.tickets.push(String(c.ticketNo || ''));
    const status = String(c.status || '').toUpperCase();
    if (status === 'RESOLVED') h.resolved++;
    else if (status !== 'REJECTED') h.open++;
    const cat = String(c.category || '').toUpperCase();
    if (cat) {
      const m = catCount.get(key)!;
      m.set(cat, (m.get(cat) || 0) + 1);
    }
    const r = Number(c.satisfactionRating);
    if (Number.isFinite(r) && r >= 1 && r <= 5) h.ratings.push(r);
    const t = c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt;
    if (t && (!h.lastAt || t > h.lastAt)) {
      h.lastAt = t;
      // keep the freshest name; people correct spellings over time
      if (String(c.citizenName || '').trim()) h.displayName = String(c.citizenName).trim();
    }
  }

  const households = Array.from(byKey.values()).map((h) => {
    h.tickets = h.tickets.filter(Boolean).slice(0, 50);
    const m = catCount.get(h.key)!;
    h.topCategories = Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
    h.avgRating = h.ratings.length
      ? Math.round((h.ratings.reduce((s, x) => s + x, 0) / h.ratings.length) * 10) / 10
      : null;
    return h;
  });

  // Most-engaged first: the ledger's front page is its busiest families.
  households.sort((a, b) => b.total - a.total || (b.lastAt || '').localeCompare(a.lastAt || ''));
  return { households, ungrouped };
}
