export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import type { JWTPayload } from '@/lib/jwt';
import { assembliesForLokSabha, assembliesForDistrict } from '@/lib/rbac';
import { normBlock } from '@/lib/block-name';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/geo/tree — the real district → AC → block → GP options, so forms can
 * offer dropdowns instead of free text.
 *
 * Every geography field on the create-user form was a text input validated only
 * for non-emptiness. A typo ("Bandwaan", or a trailing space) produces an account
 * whose scope filter matches no rows at all, so that MLA silently sees an empty
 * dashboard — and rbac's validateNewUserScope explicitly lets an ADMIN "place
 * anyone anywhere", which is exactly how the nine seats get onboarded. Serving
 * the options from the mapping tables removes the class of error rather than
 * validating after the fact.
 *
 * Purulia is 9 ACs / 20 blocks / 170 GPs, so the whole tree ships in one small
 * payload and the client filters it. Villages are the one level big enough to
 * fetch per-GP (see ?gp_code=).
 *
 * Scoped: the caller only ever sees their own jurisdiction's geography.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const norm = (s?: string | null) => (s || '').trim().toLowerCase();

/** ACs the caller may place users in. `null` = unrestricted (ADMIN/STATE). */
async function allowedAssemblies(u: JWTPayload): Promise<string[] | null> {
  if (u.role === 'ADMIN' || u.role === 'STATE') return null;
  const lvl = u.role_level;
  if (lvl === 'MP' && u.lok_sabha_constituency) return assembliesForLokSabha(u.lok_sabha_constituency);
  if (lvl === 'MLA' && u.constituency) return [u.constituency];
  if (lvl === 'DISTRICT_ADMIN' || u.role === 'DISTRICT') {
    const d = u.district || u.block;
    return d ? assembliesForDistrict(d) : [];
  }
  // Block/GP coordinators create only below themselves; the AC they sit in is
  // enough to drive their dropdowns.
  if (u.constituency) return [u.constituency];
  return [];
}

export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  try {
    // Villages for one GP — the only level too large to ship wholesale.
    const gpCode = request.nextUrl.searchParams.get('gp_code');
    if (gpCode) {
      const { data, error } = await supabase
        .from('lgd_villages')
        .select('village_code, village_name, assembly_constituency')
        .eq('gp_code', gpCode)
        .order('village_name');
      if (error) throw error;
      const allowed = await allowedAssemblies(payload);
      const rows = (data || []).filter(
        (v) => !allowed || allowed.some((a) => norm(a) === norm(v.assembly_constituency))
      );
      return NextResponse.json({
        villages: rows.map((v) => ({ code: v.village_code, name: v.village_name })),
      });
    }

    const allowed = await allowedAssemblies(payload);
    const inScope = (ac?: string | null) =>
      !allowed || allowed.some((a) => norm(a) === norm(ac));

    const { data: mapRows, error: mapErr } = await supabase
      .from('constituency_block_mapping')
      .select('district, lok_sabha, constituency, block_name');
    if (mapErr) throw mapErr;

    const { data: psRows, error: psErr } = await supabase
      .from('polling_stations')
      .select('ac, block_name, gp_code, gp_name')
      .not('gp_code', 'is', null);
    if (psErr) throw psErr;

    const maps = (mapRows || []).filter((r) => inScope(r.constituency));

    const districts = [...new Set(maps.map((r) => r.district).filter(Boolean))].sort();

    const acSeen = new Map<string, { constituency: string; district: string; lok_sabha: string }>();
    for (const r of maps) {
      if (r.constituency && !acSeen.has(r.constituency)) {
        acSeen.set(r.constituency, {
          constituency: r.constituency,
          district: r.district,
          lok_sabha: r.lok_sabha,
        });
      }
    }
    const acs = [...acSeen.values()].sort((a, b) => a.constituency.localeCompare(b.constituency));

    // block_norm is what callers must match on: block names arrive from
    // constituency_block_mapping here but from polling_stations on the GP list
    // below, and the two spell several blocks differently (Bandwan/Bundwan,
    // Purulia I/Purulia-I). Filtering GPs by the raw name would silently return
    // an empty list for those.
    const blockSeen = new Map<string, { block_name: string; block_norm: string; constituency: string; district: string }>();
    for (const r of maps) {
      const key = `${r.block_name}|${r.constituency}`;
      if (r.block_name && !blockSeen.has(key)) {
        blockSeen.set(key, {
          block_name: r.block_name,
          block_norm: normBlock(r.block_name),
          constituency: r.constituency,
          district: r.district,
        });
      }
    }
    const blocks = [...blockSeen.values()].sort((a, b) => a.block_name.localeCompare(b.block_name));

    // One row per GP — polling_stations carries ac, block and gp together, so it
    // is the only table that yields the full chain without a join.
    const gpSeen = new Map<string, { gp_code: string; gp_name: string; block_name: string; block_norm: string; constituency: string }>();
    for (const r of psRows || []) {
      if (!r.gp_code || gpSeen.has(r.gp_code) || !inScope(r.ac)) continue;
      gpSeen.set(r.gp_code, {
        gp_code: r.gp_code,
        gp_name: r.gp_name || r.gp_code,
        block_name: r.block_name || '',
        block_norm: normBlock(r.block_name),
        constituency: r.ac || '',
      });
    }
    const gps = [...gpSeen.values()].sort((a, b) => a.gp_name.localeCompare(b.gp_name));

    const lokSabhas = [...new Set(maps.map((r) => r.lok_sabha).filter(Boolean))].sort();

    return NextResponse.json({ districts, lokSabhas, acs, blocks, gps });
  } catch (error) {
    console.error('[geo/tree] error:', error);
    return NextResponse.json({ error: 'Failed to load geography' }, { status: 500 });
  }
}
