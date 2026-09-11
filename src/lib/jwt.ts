import { SignJWT, jwtVerify } from 'jose';
import { NextRequest } from 'next/server';
import { normBlock } from '@/lib/block-name';

// Security: JWT_SECRET must be set — never falls back to weak default
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('[FATAL] JWT_SECRET environment variable is not set. Set it in Vercel dashboard.');
}
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-only-not-for-production-change-me-32chars'
);

export interface JWTPayload {
  userId: string;
  username: string;
  role: string;
  name: string;
  block: string;
  district: string | null;
  // Governance hierarchy (Phase 1)
  role_level?: string;       // MP | MLA | DISTRICT_ADMIN | BLOCK_COORD | GP_COORD | KARYAKARTA | OFFICER
  constituency?: string | null;          // Assembly constituency (MLA)
  lok_sabha_constituency?: string | null; // Parliamentary constituency (MP)
  gp_code?: string | null;               // GP_COORD / KARYAKARTA scope
  gp_name?: string | null;
  assigned_villages?: string[] | null;   // KARYAKARTA scope
}

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export function getTokenFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/token=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

// Helper: verify token and return payload
export async function getAuthUser(request: NextRequest): Promise<JWTPayload | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}

/**
 * @deprecated Use `canAccessAssembly` from '@/lib/rbac' instead — this legacy
 * helper gives MP/DISTRICT_ADMIN unrestricted state-wide access, which is NOT
 * the production scope policy. Kept only for reference; no route uses it.
 */
export function canAccessConstituency(user: JWTPayload, targetConstituency: string): boolean {
  if (user.role_level === 'MP') return true;         // MP sees all
  if (user.role_level === 'DISTRICT_ADMIN') return true; // District admin sees all
  if (user.role === 'ADMIN') return true;             // System admin sees all
  if (user.role_level === 'MLA') {
    // MLA can only see their own constituency
    return user.constituency?.toLowerCase() === targetConstituency.toLowerCase();
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 1 — Governance hierarchy complaint visibility
//
// Single source of truth for "which complaints can this user see?".
// Returns a Prisma `where` fragment scoped to the user's jurisdiction.
// Scope is derived from the governance designation (role_level) first, then
// falls back to the base system role. Apply this LAST in a where-clause build
// so a scoped user can never broaden their own visibility via query params.
//
// Hierarchy → filter column on complaints:
//   ADMIN / STATE            → everything (state-wide)
//   MP                       → parliamentaryConstituency = lok_sabha_constituency
//   MLA                      → assemblyConstituency = constituency
//   DISTRICT / DISTRICT_ADMIN→ district
//   BLOCK_COORD / BLOCK      → block
//   GP_COORD                 → gp_code
//   KARYAKARTA               → village ∈ assigned_villages (fallback gp_code)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Seeded demo complaints are excluded from every scoped read.
 *
 * 537 of the 606 complaints in this database carry source='DEMO' — they were
 * seeded to make the product demonstrable. While they were counted, roughly
 * nine out of ten numbers an MLA saw were fiction: the category chart, the block
 * ranking, the volume trend, and worst of all the SLA queue, where 338 of the
 * 377 breached complaints were seeded rows from April. JS-05 was paging through
 * them every three hours and messaging the office about them.
 *
 * They are NOT deleted. They stay in the table, and setting
 * SHOW_DEMO_COMPLAINTS=true brings them back — which is what a demo deployment
 * should do. It is an environment variable rather than a query parameter on
 * purpose: it changes what every figure on the screen means, so flipping it
 * should be a deliberate act, not something a stray URL can do.
 */
const SHOW_DEMO = process.env.SHOW_DEMO_COMPLAINTS === 'true';

/**
 * Test complaints are the same problem in a different coat: the owner's own
 * WhatsApp end-to-end tests file real rows ("Gour Mahato", "Suresh Mahato"),
 * and on 2026-09-11 they were 55 of the 72 non-demo complaints. The phones are
 * listed in public.test_phones and exposed to PostgREST as the computed field
 * `is_test`, which the alerting workflows already filter on. Same rule as demo
 * rows: kept, hidden, and SHOW_TEST_COMPLAINTS=true brings them back.
 */
const SHOW_TEST = process.env.SHOW_TEST_COMPLAINTS === 'true';

/** Exclude seeded demo rows and test-phone rows unless this deployment asks for them. */
export function demoFilter(): Record<string, unknown> {
  return {
    ...(SHOW_DEMO ? {} : { source: { not: 'DEMO' } }),
    ...(SHOW_TEST ? {} : { is_test: false }),
  };
}

export function getComplaintScopeFilter(user: JWTPayload): Record<string, unknown> {
  return { ...scopeOnly(user), ...demoFilter() };
}

/** The jurisdiction scope by itself, with no demo-data decision in it. */
function scopeOnly(user: JWTPayload): Record<string, unknown> {
  // System admin → entire state (no filter)
  if (user.role === 'ADMIN') return {};

  const lvl = user.role_level;

  // Governance designation takes precedence over base role
  if (lvl === 'MP' && user.lok_sabha_constituency) {
    return { parliamentary_constituency: user.lok_sabha_constituency };
  }
  if (lvl === 'MLA' && user.constituency) {
    return { assembly_constituency: user.constituency };
  }
  if (lvl === 'DISTRICT_ADMIN' && (user.district || user.block)) {
    return { district: (user.district || user.block) as string };
  }
  if (lvl === 'BLOCK_COORD' && user.block) {
    // Match the canonical key, not the raw text: complaints carry LGD spellings
    // (Bundwan, Bagmundi, Jaipur, "Raghunath Pur-I") while every UI hands out the
    // ECI ones from constituency_block_mapping, so raw equality left coordinators
    // for those blocks with a silently empty dashboard.
    return { block_norm: normBlock(user.block) };
  }
  if (lvl === 'GP_COORD' && user.gp_code) {
    return { gp_code: user.gp_code };
  }
  if (lvl === 'KARYAKARTA') {
    if (user.assigned_villages && user.assigned_villages.length > 0) {
      return { village: { in: user.assigned_villages } };
    }
    if (user.gp_code) return { gp_code: user.gp_code };
  }

  // Fall back to base system role
  if (user.role === 'STATE') return {};
  if (user.role === 'DISTRICT') {
    // Legacy: district name was historically stored in the `block` field for DISTRICT role.
    const d = user.district || user.block;
    return d ? { district: d } : {};
  }
  if (user.role === 'BLOCK' && user.block) {
    return { block_norm: normBlock(user.block) };
  }
  // Safe default: restrict to own block (never show everything by accident)
  return user.block ? { block_norm: normBlock(user.block) } : {};
}
