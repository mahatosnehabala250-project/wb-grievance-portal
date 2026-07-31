/**
 * rbac.ts — Role-Based Access Control (single source of truth)
 *
 * Governance hierarchy (rank: lower number = more power):
 *   ADMIN(0) → MP(1) → MLA(2) → DISTRICT_ADMIN(3) → BLOCK_COORD(4) → GP_COORD(5) → KARYAKARTA(6) / OFFICER(6)
 *
 * Every rule here is enforced SERVER-SIDE. The client may hide UI, but these
 * functions are the actual gate. Never trust role/scope data from the request
 * body — always derive from the verified JWT payload.
 *
 * NOTE on column casing: in production the Supabase REST adapter returns RAW
 * DB columns. complaints mixes camelCase (quoted: "ticketNo", "createdAt")
 * and snake_case (gp_code, assembly_constituency). Record matchers below read
 * both shapes defensively.
 */

import { db } from '@/lib/db';
import type { JWTPayload } from '@/lib/jwt';

// ─────────────────────────────────────────────────────────────────
// Role ranks
// ─────────────────────────────────────────────────────────────────

export const ROLE_LEVEL_RANK: Record<string, number> = {
  MP: 1,
  MLA: 2,
  DISTRICT_ADMIN: 3,
  BLOCK_COORD: 4,
  GP_COORD: 5,
  KARYAKARTA: 6,
  OFFICER: 6,
};

/** Effective rank for an actor — ADMIN base role outranks everything. */
export function actorRank(user: JWTPayload): number {
  if (user.role === 'ADMIN') return 0;
  if (user.role === 'STATE') return 0; // state-wide officers act as admin-scope
  const lvl = user.role_level || 'OFFICER';
  if (ROLE_LEVEL_RANK[lvl] !== undefined) return ROLE_LEVEL_RANK[lvl];
  // Legacy base roles without role_level
  if (user.role === 'DISTRICT') return 3;
  if (user.role === 'BLOCK') return 4;
  return 6;
}

// ─────────────────────────────────────────────────────────────────
// User creation hierarchy
// Each role may create ONLY roles strictly below its rank, and ONLY
// within its own geographic scope (enforced by validateNewUserScope).
// ─────────────────────────────────────────────────────────────────

const CREATABLE: Record<string, string[]> = {
  ADMIN: ['MP', 'MLA', 'DISTRICT_ADMIN', 'BLOCK_COORD', 'GP_COORD', 'KARYAKARTA', 'OFFICER'],
  MP: ['MLA', 'BLOCK_COORD', 'GP_COORD', 'KARYAKARTA', 'OFFICER'],
  MLA: ['BLOCK_COORD', 'GP_COORD', 'KARYAKARTA', 'OFFICER'],
  DISTRICT_ADMIN: ['BLOCK_COORD', 'GP_COORD', 'KARYAKARTA', 'OFFICER'],
  BLOCK_COORD: ['GP_COORD', 'KARYAKARTA'],
  GP_COORD: ['KARYAKARTA'],
  KARYAKARTA: [],
  OFFICER: [],
};

export function creatableRoleLevels(user: JWTPayload): string[] {
  if (user.role === 'ADMIN') return CREATABLE.ADMIN;
  return CREATABLE[user.role_level || 'OFFICER'] || [];
}

export function canCreateRoleLevel(user: JWTPayload, targetLevel: string): boolean {
  return creatableRoleLevels(user).includes(targetLevel);
}

// ─────────────────────────────────────────────────────────────────
// Geography helpers (DB-backed, constituency_block_mapping is the
// authoritative AC ↔ Lok Sabha ↔ block mapping)
// ─────────────────────────────────────────────────────────────────

interface ACMappingRow {
  constituency: string;
  lok_sabha: string;
  district: string;
  block_name: string;
  mla_name: string | null;
}

let mappingCache: { rows: ACMappingRow[]; at: number } | null = null;
const MAPPING_TTL_MS = 5 * 60 * 1000;

async function getMappingRows(): Promise<ACMappingRow[]> {
  if (mappingCache && Date.now() - mappingCache.at < MAPPING_TTL_MS) {
    return mappingCache.rows;
  }
  // constituency_block_mapping is not in the Prisma schema — query via the
  // Supabase client embedded in the db adapter when available, else Prisma raw.
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await supabase
    .from('constituency_block_mapping')
    .select('constituency, lok_sabha, district, block_name, mla_name');
  if (error) throw new Error(`[RBAC] mapping load failed: ${error.message}`);
  mappingCache = { rows: (data || []) as ACMappingRow[], at: Date.now() };
  return mappingCache.rows;
}

const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();

/** All assembly constituencies under a parliamentary (Lok Sabha) seat. */
export async function assembliesForLokSabha(lokSabha: string): Promise<string[]> {
  const rows = await getMappingRows();
  const set = new Set<string>();
  for (const r of rows) {
    if (norm(r.lok_sabha) === norm(lokSabha)) set.add(r.constituency);
  }
  return [...set];
}

/** All blocks under an assembly constituency. */
export async function blocksForAssembly(constituency: string): Promise<string[]> {
  const rows = await getMappingRows();
  return rows.filter(r => norm(r.constituency) === norm(constituency)).map(r => r.block_name);
}

/** All assembly constituencies inside a district. */
export async function assembliesForDistrict(district: string): Promise<string[]> {
  const rows = await getMappingRows();
  const set = new Set<string>();
  for (const r of rows) {
    if (norm(r.district) === norm(district)) set.add(r.constituency);
  }
  return [...set];
}

/** MLA display names per AC (for MP Command Center cards). */
export async function mlaNamesByAssembly(lokSabha: string): Promise<Record<string, string | null>> {
  const rows = await getMappingRows();
  const out: Record<string, string | null> = {};
  for (const r of rows) {
    if (norm(r.lok_sabha) === norm(lokSabha)) out[r.constituency] = r.mla_name;
  }
  return out;
}

/** Can `user` view/manage data for assembly constituency `ac`? (async — uses mapping) */
export async function canAccessAssembly(user: JWTPayload, ac: string): Promise<boolean> {
  if (user.role === 'ADMIN' || user.role === 'STATE') return true;
  const lvl = user.role_level;
  if (lvl === 'MLA') return norm(user.constituency) === norm(ac);
  if (lvl === 'MP') {
    if (!user.lok_sabha_constituency) return false;
    const acs = await assembliesForLokSabha(user.lok_sabha_constituency);
    return acs.some(a => norm(a) === norm(ac));
  }
  if (lvl === 'DISTRICT_ADMIN' || user.role === 'DISTRICT') {
    const rows = await getMappingRows();
    const district = user.district || user.block;
    return rows.some(r => norm(r.constituency) === norm(ac) && norm(r.district) === norm(district));
  }
  return false;
}

/**
 * May this account see a whole district at once?
 *
 * Gating on the base role alone is a trap: every MLA account in this database
 * carries `role = 'DISTRICT'` alongside `role_level = 'MLA'`, so a check for
 * `role === 'DISTRICT'` hands a single-seat MLA the entire district — all nine
 * constituencies in Purulia, including eight other clients' numbers.
 *
 * A governance designation always wins over the legacy base role. Legacy
 * district accounts (role='DISTRICT' with no designation, or the default
 * OFFICER) keep the access they have always had.
 */
export function hasDistrictWideScope(user: JWTPayload): boolean {
  if (user.role === 'ADMIN' || user.role === 'STATE') return true;
  if (user.role_level === 'DISTRICT_ADMIN') return true;
  const lvl = user.role_level;
  return user.role === 'DISTRICT' && (!lvl || lvl === 'OFFICER');
}

// ─────────────────────────────────────────────────────────────────
// Per-record complaint scope check (mirror of getComplaintScopeFilter
// in jwt.ts, but applied to a single fetched record — used by
// /api/complaints/[id] GET/PATCH so scoped users can't touch records
// outside their jurisdiction by guessing IDs)
// ─────────────────────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

function field(c: AnyRecord, ...keys: string[]): string {
  for (const k of keys) {
    const v = c[k];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

export function complaintInScope(user: JWTPayload, complaint: AnyRecord): boolean {
  if (user.role === 'ADMIN' || user.role === 'STATE') return true;

  const lvl = user.role_level;
  const cAssembly = field(complaint, 'assembly_constituency', 'assemblyConstituency', 'constituency');
  const cParliament = field(complaint, 'parliamentary_constituency', 'parliamentaryConstituency');
  const cDistrict = field(complaint, 'district');
  const cBlock = field(complaint, 'block');
  const cGpCode = field(complaint, 'gp_code', 'gpCode');
  const cVillage = field(complaint, 'village');

  if (lvl === 'MP' && user.lok_sabha_constituency) {
    return norm(cParliament) === norm(user.lok_sabha_constituency);
  }
  if (lvl === 'MLA' && user.constituency) {
    return norm(cAssembly) === norm(user.constituency);
  }
  if (lvl === 'DISTRICT_ADMIN') {
    return norm(cDistrict) === norm(user.district || user.block);
  }
  if (lvl === 'BLOCK_COORD' && user.block) {
    return norm(cBlock) === norm(user.block);
  }
  if (lvl === 'GP_COORD' && user.gp_code) {
    return norm(cGpCode) === norm(user.gp_code);
  }
  if (lvl === 'KARYAKARTA') {
    if (user.assigned_villages && user.assigned_villages.length > 0) {
      return user.assigned_villages.some(v => norm(v) === norm(cVillage));
    }
    if (user.gp_code) return norm(cGpCode) === norm(user.gp_code);
    return false;
  }

  // Legacy base roles
  if (user.role === 'DISTRICT') {
    return norm(cDistrict) === norm(user.district || user.block);
  }
  if (user.role === 'BLOCK' && user.block) {
    return norm(cBlock) === norm(user.block);
  }
  // Safe default: own block only
  return !!user.block && norm(cBlock) === norm(user.block);
}

/**
 * Can `user` mutate (status / resolution / assignment / urgency) a complaint?
 * KARYAKARTA is read-only — party workers report, they don't administer.
 * Everyone else may mutate ONLY records already in their scope
 * (check complaintInScope first; this is the role gate).
 */
export function canMutateComplaints(user: JWTPayload): boolean {
  if (user.role === 'ADMIN' || user.role === 'STATE') return true;
  if (user.role_level === 'KARYAKARTA') return false;
  return true; // MP, MLA, DISTRICT_ADMIN, BLOCK_COORD, GP_COORD, OFFICER, DISTRICT, BLOCK
}

// ─────────────────────────────────────────────────────────────────
// User-record scope check — which users can the actor SEE / EDIT?
// A user record is in the actor's scope if it sits at a lower rank
// AND inside the actor's geography.
// ─────────────────────────────────────────────────────────────────

export async function userInManageScope(actor: JWTPayload, target: AnyRecord): Promise<boolean> {
  if (actor.role === 'ADMIN') return true;

  const targetLevel = (target.role_level as string) || 'OFFICER';
  const aRank = actorRank(actor);
  const tRank = ROLE_LEVEL_RANK[targetLevel] ?? 6;
  if (tRank <= aRank) return false; // can't manage same-or-higher rank

  const lvl = actor.role_level;
  const tConstituency = field(target, 'constituency');
  const tLokSabha = field(target, 'lok_sabha_constituency');
  const tDistrict = field(target, 'district');
  const tBlock = field(target, 'block');
  const tGpCode = field(target, 'gp_code');

  if (lvl === 'MP') {
    if (!actor.lok_sabha_constituency) return false;
    // Direct LS match, or AC under the seat, or block under one of those ACs
    if (norm(tLokSabha) === norm(actor.lok_sabha_constituency)) return true;
    const acs = await assembliesForLokSabha(actor.lok_sabha_constituency);
    if (tConstituency && acs.some(a => norm(a) === norm(tConstituency))) return true;
    if (tBlock) {
      for (const ac of acs) {
        const blocks = await blocksForAssembly(ac);
        if (blocks.some(b => norm(b) === norm(tBlock))) return true;
      }
    }
    return false;
  }
  if (lvl === 'MLA') {
    if (!actor.constituency) return false;
    if (norm(tConstituency) === norm(actor.constituency)) return true;
    if (tBlock) {
      const blocks = await blocksForAssembly(actor.constituency);
      return blocks.some(b => norm(b) === norm(tBlock));
    }
    return false;
  }
  if (lvl === 'DISTRICT_ADMIN' || actor.role === 'DISTRICT') {
    return norm(tDistrict) === norm(actor.district || actor.block);
  }
  if (lvl === 'BLOCK_COORD' || actor.role === 'BLOCK') {
    return norm(tBlock) === norm(actor.block);
  }
  if (lvl === 'GP_COORD') {
    return !!actor.gp_code && norm(tGpCode) === norm(actor.gp_code);
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────
// New-user jurisdiction validation: when actor creates a user, the
// new user's geography is FORCED inside the actor's own scope.
// Returns { ok } or { ok: false, error } with a citizen-readable reason.
// ─────────────────────────────────────────────────────────────────

export interface NewUserGeo {
  role_level: string;
  constituency?: string | null;          // required for MLA
  lok_sabha_constituency?: string | null; // required for MP
  district?: string | null;
  block?: string | null;
  gp_code?: string | null;
  gp_name?: string | null;
  assigned_villages?: string[] | null;
}

export async function validateNewUserScope(
  actor: JWTPayload,
  geo: NewUserGeo
): Promise<{ ok: true; geo: NewUserGeo } | { ok: false; error: string }> {
  const lvl = geo.role_level;

  // Build the geography that will actually be persisted. Any field the caller
  // omitted (or that the actor's role must own) is FORCED to the actor's own
  // jurisdiction, so a scoped creator can never mint an unbound user or one
  // tagged to a seat/district/block outside their scope. `overrides` win.
  const resolve = (overrides: Partial<NewUserGeo>): NewUserGeo => ({
    role_level: lvl,
    constituency: geo.constituency ?? null,
    lok_sabha_constituency: geo.lok_sabha_constituency ?? null,
    district: geo.district ?? null,
    block: geo.block ?? null,
    gp_code: geo.gp_code ?? null,
    gp_name: geo.gp_name ?? null,
    assigned_villages: geo.assigned_villages ?? null,
    ...overrides,
  });

  if (!canCreateRoleLevel(actor, lvl)) {
    return { ok: false, error: `Your role cannot create ${lvl} users` };
  }

  // Required geography per target role
  if (lvl === 'MP' && !geo.lok_sabha_constituency) {
    return { ok: false, error: 'MP user requires lok_sabha_constituency' };
  }
  if (lvl === 'MLA' && !geo.constituency) {
    return { ok: false, error: 'MLA user requires constituency (assembly)' };
  }
  if (lvl === 'DISTRICT_ADMIN' && !geo.district) {
    return { ok: false, error: 'DISTRICT_ADMIN user requires district' };
  }
  if (lvl === 'BLOCK_COORD' && !geo.block) {
    return { ok: false, error: 'BLOCK_COORD user requires block' };
  }
  if (lvl === 'GP_COORD' && !geo.gp_code) {
    return { ok: false, error: 'GP_COORD user requires gp_code' };
  }
  if (lvl === 'KARYAKARTA' && !geo.gp_code && (!geo.assigned_villages || geo.assigned_villages.length === 0)) {
    return { ok: false, error: 'KARYAKARTA user requires gp_code or assigned_villages' };
  }

  // ADMIN can place anyone anywhere (no forcing — persist as supplied)
  if (actor.role === 'ADMIN') return { ok: true, geo: resolve({}) };

  const actorLvl = actor.role_level;

  if (actorLvl === 'MP') {
    if (!actor.lok_sabha_constituency) return { ok: false, error: 'Your account has no lok_sabha_constituency set' };
    const acs = await assembliesForLokSabha(actor.lok_sabha_constituency);
    // Every user the MP creates is anchored to the MP's parliamentary seat.
    const forceSeat = { lok_sabha_constituency: actor.lok_sabha_constituency };
    if (lvl === 'MLA') {
      const inSeat = acs.some(a => norm(a) === norm(geo.constituency));
      if (!inSeat) return { ok: false, error: `${geo.constituency} is not an assembly under ${actor.lok_sabha_constituency} parliamentary seat` };
      return { ok: true, geo: resolve(forceSeat) };
    }
    // Lower roles: block must belong to an AC under the seat (when block given)
    if (geo.block) {
      for (const ac of acs) {
        const blocks = await blocksForAssembly(ac);
        if (blocks.some(b => norm(b) === norm(geo.block))) return { ok: true, geo: resolve(forceSeat) };
      }
      return { ok: false, error: `Block ${geo.block} is outside your parliamentary seat` };
    }
    if (geo.constituency) {
      const inSeat = acs.some(a => norm(a) === norm(geo.constituency));
      if (!inSeat) return { ok: false, error: `${geo.constituency} is outside your parliamentary seat` };
    }
    return { ok: true, geo: resolve(forceSeat) };
  }

  if (actorLvl === 'MLA') {
    if (!actor.constituency) return { ok: false, error: 'Your account has no constituency set' };
    const blocks = await blocksForAssembly(actor.constituency);
    if (geo.block && !blocks.some(b => norm(b) === norm(geo.block))) {
      return { ok: false, error: `Block ${geo.block} is outside ${actor.constituency} constituency` };
    }
    if (geo.constituency && norm(geo.constituency) !== norm(actor.constituency)) {
      return { ok: false, error: 'You can only create users in your own constituency' };
    }
    // Anchor to the MLA's assembly constituency regardless of what was sent.
    return { ok: true, geo: resolve({ constituency: actor.constituency }) };
  }

  if (actorLvl === 'DISTRICT_ADMIN' || actor.role === 'DISTRICT') {
    const district = actor.district || actor.block;
    if (geo.district && norm(geo.district) !== norm(district)) {
      return { ok: false, error: 'You can only create users in your own district' };
    }
    return { ok: true, geo: resolve({ district: district ?? null }) };
  }

  if (actorLvl === 'BLOCK_COORD' || actor.role === 'BLOCK') {
    if (geo.block && norm(geo.block) !== norm(actor.block)) {
      return { ok: false, error: 'You can only create users in your own block' };
    }
    return { ok: true, geo: resolve({ block: actor.block ?? null, district: actor.district ?? geo.district ?? null }) };
  }

  if (actorLvl === 'GP_COORD') {
    if (geo.gp_code && norm(geo.gp_code) !== norm(actor.gp_code)) {
      return { ok: false, error: 'You can only create karyakartas in your own gram panchayat' };
    }
    return {
      ok: true,
      geo: resolve({
        gp_code: actor.gp_code ?? null,
        gp_name: actor.gp_name ?? geo.gp_name ?? null,
        block: actor.block ?? geo.block ?? null,
        district: actor.district ?? geo.district ?? null,
        constituency: actor.constituency ?? geo.constituency ?? null,
      }),
    };
  }

  return { ok: false, error: 'Your role cannot create users' };
}

// ─────────────────────────────────────────────────────────────────
// User-list scope filter — which users appear in the actor's list?
// Returns a where-fragment (literal DB column names — Supabase mode).
// MP/MLA need post-filtering (block lists) → use userListPostFilter.
// ─────────────────────────────────────────────────────────────────

export async function getUserListScope(actor: JWTPayload): Promise<{
  where: Record<string, unknown>;
  postFilter?: (u: AnyRecord) => boolean;
}> {
  if (actor.role === 'ADMIN') return { where: {} };

  const lvl = actor.role_level;

  // Geography alone let a district president list the ADMIN and STATE accounts
  // that happen to sit in their district — rows they can never manage
  // (userInManageScope rejects same-or-higher rank) but could still read. The
  // list now matches what is actually manageable: strictly lower rank.
  const aRank = actorRank(actor);
  const outranked = (u: AnyRecord) =>
    (ROLE_LEVEL_RANK[(u.role_level as string) || 'OFFICER'] ?? 6) > aRank
    && u.role !== 'ADMIN' && u.role !== 'STATE';
  const scoped = (
    where: Record<string, unknown>,
    extra?: (u: AnyRecord) => boolean
  ) => ({ where, postFilter: (u: AnyRecord) => outranked(u) && (!extra || extra(u)) });

  if (lvl === 'MP' && actor.lok_sabha_constituency) {
    const acs = await assembliesForLokSabha(actor.lok_sabha_constituency);
    const acSet = new Set(acs.map(norm));
    const blockSet = new Set<string>();
    for (const ac of acs) {
      for (const b of await blocksForAssembly(ac)) blockSet.add(norm(b));
    }
    const ls = norm(actor.lok_sabha_constituency);
    return scoped({}, (u) =>
      norm(u.lok_sabha_constituency as string) === ls ||
      acSet.has(norm(u.constituency as string)) ||
      blockSet.has(norm(u.block as string)));
  }
  if (lvl === 'MLA' && actor.constituency) {
    const blocks = await blocksForAssembly(actor.constituency);
    const blockSet = new Set(blocks.map(norm));
    const ac = norm(actor.constituency);
    return scoped({}, (u) =>
      norm(u.constituency as string) === ac ||
      blockSet.has(norm(u.block as string)));
  }
  if (lvl === 'DISTRICT_ADMIN' || actor.role === 'DISTRICT') {
    return scoped({ district: actor.district || actor.block });
  }
  if (lvl === 'BLOCK_COORD' || actor.role === 'BLOCK') {
    return scoped({ block: actor.block });
  }
  if (lvl === 'GP_COORD' && actor.gp_code) {
    return scoped({ gp_code: actor.gp_code });
  }
  // KARYAKARTA / OFFICER: no user management
  return { where: { id: '__none__' } };
}
