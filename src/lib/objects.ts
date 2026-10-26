/**
 * Places and people as things you can open.
 *
 * Every seat, block, panchayat, village, booth and team member has one address,
 * `#/<type>/<key>`, so a name shown anywhere in the app can link to it, the
 * browser's back button walks the trail, and a link can be sent to someone.
 * Keys are LGD codes for blocks, panchayats and villages, `<ac_no>-<part>` for
 * booths, the seat name for seats, and the user id for people. Blocks and
 * panchayats also open by name; the page then settles on the code.
 */

export const OBJECT_TYPES = ['district', 'seat', 'block', 'gp', 'village', 'booth', 'person'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];
export type ObjectRef = { type: ObjectType; key: string };

export const OBJECT_NOUN: Record<ObjectType, string> = {
  district: 'District', seat: 'Assembly seat', block: 'Block', gp: 'Panchayat',
  village: 'Village', booth: 'Booth', person: 'Person',
};

export function isObjectType(t: string): t is ObjectType {
  return (OBJECT_TYPES as readonly string[]).includes(t);
}

/** Keys are names, codes or ids: letters in any script, digits, and a few separators. */
export function isObjectKey(k: string): boolean {
  return /^[\p{L}\p{M}\p{N} .,()_'-]{1,80}$/u.test(k);
}

export function objectHref(ref: ObjectRef): string {
  return `#/${ref.type}/${encodeURIComponent(ref.key)}`;
}

export function parseObjectHash(hash: string): ObjectRef | null {
  const m = /^#\/([a-z]+)\/(.+)$/.exec(hash || '');
  if (!m || !isObjectType(m[1])) return null;
  let key: string;
  try { key = decodeURIComponent(m[2]); } catch { return null; }
  return isObjectKey(key) ? { type: m[1], key } : null;
}

// ─── The shape /api/objects/[type]/[key] returns ───────────────────

export type TrailStep = { type: ObjectType; key: string; label: string; label_bn?: string | null };
export type Fact = { label: string; value: string | number | null; type?: ObjectType | null; key?: string | null; href?: string | null };
export type ChildRow = {
  type: ObjectType; key: string; label: string; label_bn?: string | null; sub?: string | null;
  open: number; total: number; past_due: number;
};
export type BoothRow = {
  type: 'booth'; key: string; label: string; sub?: string | null; village_code?: string | null;
  karyakarta?: string | null; karyakarta_id?: string | null; open: number; total: number;
};
export type TeamRow = {
  type: 'person'; key: string; label: string; role_level?: string | null; block?: string | null;
  open: number; oldest: number | null;
};
export type ObjectComplaint = {
  id: string; ticket: string; citizen: string | null; issue: string | null; category: string | null;
  urgency: string | null; status: string; ac: string | null; village: string | null; village_code: string | null;
  gp: string | null; gp_code: string | null; block: string | null; block_code: string | null; booth_key: string | null;
  owner_id: string | null; owner_name: string | null; created_at: string; is_open: boolean; age_days: number;
  past_due: boolean; days_over: number | null;
};
export type ObjectFigures = {
  total: number; open: number; no_owner: number; past_due: number; new_30d: number; resolved_30d: number;
  oldest_days: number | null; last_filed_at: string | null;
};
export type ObjectView = {
  type: ObjectType; key: string; kind: string; title: string; title_bn: string | null;
  trail: TrailStep[]; facts: Fact[];
  children: { title: string; type: ObjectType; items: ChildRow[] } | null;
  booths: BoothRow[]; team: TeamRow[];
  figures: ObjectFigures; weekly: number[];
  categories: { category: string; open: number; total: number }[];
  complaints: ObjectComplaint[];
};

export type SearchHit = { type: ObjectType | 'complaint'; key: string; label: string; label_bn: string | null; sub: string | null };

export const ROLE_NOUN: Record<string, string> = {
  KARYAKARTA: 'Karyakarta', GP_COORD: 'GP coordinator', BLOCK_COORD: 'Block president', MLA: 'MLA',
  MP: 'MP', DISTRICT_ADMIN: 'District president', OFFICER: 'Office',
};
