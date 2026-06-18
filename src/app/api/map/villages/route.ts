import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/map/villages — scope-locked, VILLAGE-level complaint aggregation.
 *
 * Returns one entry per LGD village_code that has at least one complaint within
 * the caller's jurisdiction, so the map can paint the village-boundary
 * choropleth (public asset /purulia-villages.geojson, keyed by `v` = vil_lgd =
 * lgd_villages.village_code). Scope is enforced server-side via
 * getComplaintScopeFilter — same boundary as /api/complaints & /api/map/risk.
 *
 * Complaints store `village` as free text, so we resolve each to its LGD
 * village_code by name (within Purulia / district 321). Name collisions are
 * rare and only affect which same-named village lights up — aggregate-only,
 * no individual-citizen data is returned.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type C = Record<string, unknown>;
const str = (c: C, ...keys: string[]): string => {
  for (const k of keys) { const v = c[k]; if (typeof v === 'string' && v) return v; }
  return '';
};
const ACTIVE = new Set(['OPEN', 'IN_PROGRESS', 'REGISTERED', 'ASSIGNED']);
const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const where = getComplaintScopeFilter(payload);
    const complaints: C[] = await db.complaint.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 });

    // village_name -> [village_code] for Purulia (district 321), paginated
    const nameToCodes = new Map<string, string[]>();
    for (let from = 0; from < 4000; from += 1000) {
      const { data, error } = await supabase
        .from('lgd_villages')
        .select('village_code, village_name')
        .eq('district_code', '321')
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      for (const r of data as C[]) {
        const nk = norm(str(r, 'village_name'));
        const code = str(r, 'village_code');
        if (!nk || !code) continue;
        const arr = nameToCodes.get(nk);
        if (arr) arr.push(code); else nameToCodes.set(nk, [code]);
      }
      if (data.length < 1000) break;
    }

    const agg: Record<string, { total: number; active: number; critical: number; resolved: number }> = {};
    let matched = 0;
    for (const c of complaints) {
      const nk = norm(str(c, 'village'));
      if (!nk) continue;
      const codes = nameToCodes.get(nk);
      if (!codes || codes.length === 0) continue;
      const code = codes[0]; // name collisions rare; pick first
      matched++;
      const a = agg[code] || (agg[code] = { total: 0, active: 0, critical: 0, resolved: 0 });
      const status = str(c, 'status');
      const urgency = str(c, 'urgency');
      a.total++;
      if (ACTIVE.has(status)) a.active++;
      if (status === 'RESOLVED') a.resolved++;
      if (urgency === 'CRITICAL' && ACTIVE.has(status)) a.critical++;
    }

    return NextResponse.json({
      data: agg,
      meta: { villagesWithComplaints: Object.keys(agg).length, complaintsMatched: matched, complaintsTotal: complaints.length },
      scope: { level: payload.role_level || payload.role },
    });
  } catch (err) {
    console.error('Village map error:', err);
    return NextResponse.json({ error: 'Failed to load village map' }, { status: 500 });
  }
}
