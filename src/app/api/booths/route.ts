export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import type { JWTPayload } from '@/lib/jwt';
import { assembliesForLokSabha, userInManageScope } from '@/lib/rbac';
import { createClient } from '@supabase/supabase-js';

/**
 * /api/booths — polling_stations (election booth) directory + karyakarta
 * assignment / village-mapping correction, scoped to the caller's governance
 * jurisdiction (same hierarchy as /api/users and /api/complaints).
 *
 * GET   ?ac=&gp_code=&q=&weak=1&limit=&offset= — list booths in scope.
 * PATCH { id, karyakarta_user_id?, village_code? } — reassign karyakarta
 *       and/or correct the village/GP/block mapping for a booth.
 *
 * RLS is enabled on polling_stations with no policies, so this route MUST use
 * the service-role client (same pattern as getMappingRows() in rbac.ts).
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AnyRecord = Record<string, unknown>;

const ALL_ACS = [
  'Bandwan', 'Balarampur', 'Baghmundi', 'Joypur', 'Purulia',
  'Manbazar', 'Kashipur', 'Para', 'Raghunathpur',
];

const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();

// polling_stations.block_name uses LGD spellings; users.block uses ECI
// spellings. Normalize both sides the same way before comparing (CONTEXT).
const BLOCK_ALIASES: Record<string, string> = {
  bundwan: 'bandwan',
  bagmundi: 'baghmundi',
  jaipur: 'joypur',
};
function normBlock(s: string | null | undefined): string {
  const v = (s || '').toLowerCase().replace(/[\s-]/g, '');
  return BLOCK_ALIASES[v] || v;
}

interface Scope {
  acs: string[];        // allowed assembly constituencies
  blockNorm?: string;   // BLOCK_COORD / BLOCK — normalized block match (JS-side)
  gpCode?: string;      // GP_COORD — exact gp_code match
  karyakartaId?: string; // KARYAKARTA (and unscoped fallback) — own booths only
}

type ScopeResult = { scope: Scope } | { error: string; status: number };

async function resolveScope(payload: JWTPayload): Promise<ScopeResult> {
  if (payload.role === 'ADMIN' || payload.role === 'STATE') {
    return { scope: { acs: ALL_ACS } };
  }

  const lvl = payload.role_level;

  if (lvl === 'MP') {
    if (!payload.lok_sabha_constituency) {
      return { error: 'Your account has no lok_sabha_constituency set', status: 403 };
    }
    const acs = await assembliesForLokSabha(payload.lok_sabha_constituency);
    if (acs.length === 0) {
      return { error: 'No assemblies found for your parliamentary seat', status: 403 };
    }
    return { scope: { acs } };
  }

  if (lvl === 'MLA') {
    if (!payload.constituency) {
      return { error: 'Your account has no constituency set', status: 403 };
    }
    return { scope: { acs: [payload.constituency] } };
  }

  if (lvl === 'DISTRICT_ADMIN' || payload.role === 'DISTRICT') {
    return { scope: { acs: ALL_ACS } };
  }

  if (lvl === 'BLOCK_COORD' || payload.role === 'BLOCK') {
    if (!payload.block) {
      return { error: 'Your account has no block set', status: 403 };
    }
    return { scope: { acs: ALL_ACS, blockNorm: normBlock(payload.block) } };
  }

  if (lvl === 'GP_COORD') {
    if (!payload.gp_code) {
      return { error: 'Your account has no gp_code set', status: 403 };
    }
    return { scope: { acs: ALL_ACS, gpCode: payload.gp_code } };
  }

  if (lvl === 'KARYAKARTA') {
    return { scope: { acs: ALL_ACS, karyakartaId: payload.userId } };
  }

  // Unscoped / legacy OFFICER: safest default — only booths assigned to them.
  return { scope: { acs: ALL_ACS, karyakartaId: payload.userId } };
}

function boothInScope(scope: Scope, booth: AnyRecord): boolean {
  const ac = String(booth.ac || '');
  if (!scope.acs.some((a) => norm(a) === norm(ac))) return false;
  if (scope.blockNorm && normBlock(booth.block_name as string) !== scope.blockNorm) return false;
  if (scope.gpCode && booth.gp_code !== scope.gpCode) return false;
  if (scope.karyakartaId && booth.karyakarta_user_id !== scope.karyakartaId) return false;
  return true;
}

// GET /api/booths — list booths within the actor's jurisdiction.
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  try {
    const resolved = await resolveScope(payload);
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const { scope } = resolved;

    const { searchParams } = new URL(request.url);
    const acParam = searchParams.get('ac');
    const gpCodeParam = searchParams.get('gp_code');
    const qParam = searchParams.get('q');
    const weakParam = searchParams.get('weak');

    let effectiveAc: string | null = null;
    if (acParam) {
      if (!scope.acs.some((a) => norm(a) === norm(acParam))) {
        return NextResponse.json({ error: `AC ${acParam} is outside your jurisdiction` }, { status: 403 });
      }
      effectiveAc = acParam;
    } else if (scope.acs.length === 1) {
      effectiveAc = scope.acs[0];
    }
    // Else: no ac given and caller has multiple/all ACs — return all (bounded by limit).

    const limitRaw = parseInt(searchParams.get('limit') || '500', 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 500, 1), 1000);
    const offsetRaw = parseInt(searchParams.get('offset') || '0', 10);
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

    let query = supabase.from('polling_stations').select('*');

    query = effectiveAc ? query.eq('ac', effectiveAc) : query.in('ac', scope.acs);

    if (scope.gpCode) {
      query = query.eq('gp_code', scope.gpCode);
    } else if (gpCodeParam) {
      query = query.eq('gp_code', gpCodeParam);
    }
    if (scope.karyakartaId) {
      query = query.eq('karyakarta_user_id', scope.karyakartaId);
    }
    if (weakParam === '1') {
      query = query.lt('match_score', 0.4);
    }
    if (qParam) {
      const like = `%${qParam}%`;
      query = query.or(
        `ps_name.ilike.${like},village_name.ilike.${like},village_raw.ilike.${like},ps_no.ilike.${like}`
      );
    }
    query = query.order('ac', { ascending: true }).order('id', { ascending: true });

    // BLOCK_COORD's alias-normalized block match can't be done server-side by
    // Postgrest, so that role pages in JS after the fetch instead of via
    // .range() — everything else uses SQL-side pagination.
    const needsJsBlockFilter = !!scope.blockNorm;
    if (!needsJsBlockFilter) {
      query = query.range(offset, offset + limit - 1);
    } else {
      query = query.limit(3000); // safety cap; district has ~2,802 booths total
    }

    const { data, error } = await query;
    if (error) throw error;

    let booths = (data || []) as AnyRecord[];
    if (needsJsBlockFilter) {
      booths = booths.filter((r) => normBlock(r.block_name as string) === scope.blockNorm);
      booths = booths.slice(offset, offset + limit);
    }

    // Enrich with karyakarta display name.
    const karyakartaIds = [...new Set(
      booths
        .map((b) => b.karyakarta_user_id)
        .filter((v): v is string => typeof v === 'string' && !!v)
    )];
    const namesById: Record<string, string> = {};
    if (karyakartaIds.length > 0) {
      const { data: userRows } = await supabase.from('users').select('id, name').in('id', karyakartaIds);
      for (const u of (userRows || []) as AnyRecord[]) {
        namesById[u.id as string] = u.name as string;
      }
    }
    const enriched = booths.map((b) => ({
      ...b,
      karyakarta_name: b.karyakarta_user_id ? (namesById[b.karyakarta_user_id as string] || null) : null,
    }));

    return NextResponse.json({ booths: enriched, meta: { acs: scope.acs, total: enriched.length } });
  } catch (error) {
    console.error('List booths error:', error);
    return NextResponse.json({ error: 'Failed to list booths' }, { status: 500 });
  }
}

// PATCH /api/booths — reassign karyakarta and/or correct village mapping.
// KARYAKARTA / OFFICER are read-only. Everyone else may mutate ONLY booths
// already inside their scope (boothInScope, mirroring userInManageScope).
export async function PATCH(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const lvl = payload.role_level;
  if (lvl === 'KARYAKARTA' || lvl === 'OFFICER' || (!lvl && payload.role === 'OFFICER')) {
    return NextResponse.json({ error: 'Your role has read-only access to booths' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, karyakarta_user_id, village_code } = body;

    if (!id) return NextResponse.json({ error: 'Booth id required' }, { status: 400 });

    const { data: boothRow, error: fetchErr } = await supabase
      .from('polling_stations')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !boothRow) {
      return NextResponse.json({ error: 'Booth not found' }, { status: 404 });
    }
    const booth = boothRow as AnyRecord;

    const resolved = await resolveScope(payload);
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const { scope } = resolved;
    if (!boothInScope(scope, booth)) {
      return NextResponse.json({ error: 'Booth is outside your jurisdiction' }, { status: 403 });
    }

    const updateData: AnyRecord = {};

    // ── Karyakarta (re)assignment ──
    if (karyakarta_user_id !== undefined) {
      if (karyakarta_user_id === null) {
        updateData.karyakarta_user_id = null;
      } else {
        const { data: targetUserRow, error: userErr } = await supabase
          .from('users')
          .select('*')
          .eq('id', karyakarta_user_id)
          .single();
        if (userErr || !targetUserRow) {
          return NextResponse.json({ error: 'karyakarta_user_id not found' }, { status: 400 });
        }
        const targetUser = targetUserRow as AnyRecord;
        if (!targetUser.isActive) {
          return NextResponse.json({ error: 'That user is not active' }, { status: 400 });
        }
        const targetLevel = targetUser.role_level as string;
        if (!['KARYAKARTA', 'GP_COORD'].includes(targetLevel)) {
          return NextResponse.json(
            { error: 'karyakarta_user_id must reference a KARYAKARTA or GP_COORD user' },
            { status: 400 }
          );
        }
        if (payload.role !== 'ADMIN') {
          const allowed = await userInManageScope(payload, targetUser);
          if (!allowed) {
            return NextResponse.json({ error: 'Target user is outside your manage scope' }, { status: 403 });
          }
        }
        updateData.karyakarta_user_id = targetUser.id;
      }
    }

    // ── Village / GP / block mapping correction ──
    if (village_code) {
      const { data: villageRow, error: vErr } = await supabase
        .from('lgd_villages')
        .select('village_code, village_name, gp_code, assembly_constituency')
        .eq('village_code', village_code)
        .single();
      if (vErr || !villageRow) {
        return NextResponse.json({ error: 'Village not found' }, { status: 400 });
      }
      const v = villageRow as AnyRecord;
      if (norm(v.assembly_constituency as string) !== norm(booth.ac as string)) {
        return NextResponse.json(
          { error: `Village belongs to ${v.assembly_constituency}, not ${booth.ac}` },
          { status: 403 }
        );
      }

      const { data: gpRow } = await supabase
        .from('lgd_gram_panchayats')
        .select('gp_code, gp_name, block_code')
        .eq('gp_code', v.gp_code)
        .single();
      const gp = gpRow as AnyRecord | null;

      let blockName: string | null = null;
      if (gp?.block_code) {
        const { data: blockRow } = await supabase
          .from('lgd_blocks')
          .select('block_code, block_name')
          .eq('block_code', gp.block_code)
          .single();
        blockName = ((blockRow as AnyRecord | null)?.block_name as string) || null;
      }

      // The corrected mapping must ALSO stay inside the actor's jurisdiction —
      // otherwise a GP/block coordinator could remap a booth out of their own
      // GP/block (same AC) and lose control over it.
      if (!boothInScope(scope, { ...booth, gp_code: v.gp_code, block_name: blockName })) {
        return NextResponse.json(
          { error: 'Corrected village is outside your jurisdiction' },
          { status: 403 }
        );
      }

      updateData.village_code = v.village_code;
      updateData.village_name = v.village_name;
      updateData.gp_code = v.gp_code;
      updateData.gp_name = gp?.gp_name ?? null;
      updateData.block_name = blockName;
      updateData.match_score = 1;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('polling_stations')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();
    if (updateErr || !updated) throw updateErr || new Error('Update failed');

    return NextResponse.json({ booth: updated, success: true });
  } catch (error) {
    console.error('Update booth error:', error);
    return NextResponse.json({ error: 'Failed to update booth' }, { status: 500 });
  }
}
