import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/map/villages — scope-locked VILLAGE-level intelligence for the
 * dark "Command Map" room.
 *
 * Returns, for the caller's jurisdiction only (getComplaintScopeFilter — same
 * boundary as /api/complaints & /api/map/risk):
 *   - points[]   : one glowing map point per village WITH complaints
 *                  (lat/lng from lgd_villages, + total/active/critical/resolved/slaBreached)
 *   - data{}     : same aggregate keyed by village_code (for choropleth joins)
 *   - categories : top complaint categories in scope (for the insight panel)
 *   - trend      : last-7-days vs prior-7-days complaint volume (% change)
 *   - meta/scope
 *
 * Complaints store `village` as free text → resolved to LGD village_code by
 * name (within Purulia / district 321). Junk/test complaints from villages we
 * have no coordinates for simply don't plot — which keeps the map clean.
 * Aggregate-only; no individual-citizen data leaves the server.
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
const dt = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  return null;
};
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  return null;
};
const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const ACTIVE = new Set(['OPEN', 'IN_PROGRESS', 'REGISTERED', 'ASSIGNED']);
const SLA_DAYS: Record<string, number> = { CRITICAL: 0.25, HIGH: 1, MEDIUM: 3, LOW: 7 };

interface Agg { code: string; name: string; lat: number; lng: number; total: number; active: number; critical: number; resolved: number; slaBreached: number; cats: Record<string, number>; }

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const where = getComplaintScopeFilter(payload);
    const complaints: C[] = await db.complaint.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 });

    // village_name -> [village_code] and code -> {name, lat, lng} for Purulia (321)
    const nameToCodes = new Map<string, string[]>();
    const codeMeta = new Map<string, { name: string; lat: number | null; lng: number | null }>();
    for (let from = 0; from < 4000; from += 1000) {
      const { data, error } = await supabase
        .from('lgd_villages')
        .select('village_code, village_name, lat, lng')
        .eq('district_code', '321')
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      for (const r of data as C[]) {
        const code = str(r, 'village_code');
        const nm = str(r, 'village_name');
        if (!code) continue;
        const nk = norm(nm);
        if (nk) { const arr = nameToCodes.get(nk); if (arr) arr.push(code); else nameToCodes.set(nk, [code]); }
        codeMeta.set(code, { name: nm, lat: num(r.lat), lng: num(r.lng) });
      }
      if (data.length < 1000) break;
    }

    const now = Date.now();
    const DAY = 86400000;
    const agg: Record<string, Agg> = {};
    const cats: Record<string, number> = {};
    let last7 = 0, prior7 = 0, matched = 0;
    // compact event stream for the time-slider (one row per plottable complaint)
    const series: { code: string; ts: number; crit: boolean; active: boolean }[] = [];
    let minTs = Infinity, maxTs = 0;

    for (const c of complaints) {
      const created = dt(c.createdAt ?? c.created_at);
      if (created) {
        const ageDays = (now - created.getTime()) / DAY;
        if (ageDays <= 7) last7++;
        else if (ageDays <= 14) prior7++;
      }
      const cat = (str(c, 'category') || 'OTHER').toUpperCase();
      cats[cat] = (cats[cat] || 0) + 1;

      const nk = norm(str(c, 'village'));
      if (!nk) continue;
      const codes = nameToCodes.get(nk);
      if (!codes || codes.length === 0) continue;
      const code = codes[0];
      const meta = codeMeta.get(code);
      if (!meta) continue;
      matched++;
      const a = agg[code] || (agg[code] = {
        code, name: meta.name, lat: meta.lat ?? 0, lng: meta.lng ?? 0,
        total: 0, active: 0, critical: 0, resolved: 0, slaBreached: 0, cats: {},
      });
      const status = str(c, 'status');
      const urgency = str(c, 'urgency');
      const isActive = ACTIVE.has(status);
      a.total++;
      a.cats[cat] = (a.cats[cat] || 0) + 1;
      if (isActive) a.active++;
      if (status === 'RESOLVED') a.resolved++;
      if (urgency === 'CRITICAL' && isActive) a.critical++;
      if (isActive && created && now - created.getTime() > (SLA_DAYS[urgency] || 3) * DAY) a.slaBreached++;
      if (created) { const ts = created.getTime(); series.push({ code, ts, crit: urgency === 'CRITICAL', active: isActive }); if (ts < minTs) minTs = ts; if (ts > maxTs) maxTs = ts; }
    }

    const all = Object.values(agg);
    const points = all.filter(a => a.lat && a.lng);
    const data: Record<string, Omit<Agg, 'code' | 'name' | 'lat' | 'lng'>> = {};
    for (const a of all) data[a.code] = { total: a.total, active: a.active, critical: a.critical, resolved: a.resolved, slaBreached: a.slaBreached, cats: a.cats };

    const categories = Object.entries(cats).map(([label, n]) => ({ label, n })).sort((x, y) => y.n - x.n).slice(0, 6);
    const pct = prior7 > 0 ? Math.round(((last7 - prior7) / prior7) * 100) : (last7 > 0 ? 100 : 0);

    return NextResponse.json({
      points,
      data,
      categories,
      series,
      range: { min: minTs === Infinity ? 0 : minTs, max: maxTs },
      trend: { last7, prior7, pct },
      meta: {
        villagesWithComplaints: all.length,
        plottable: points.length,
        complaintsMatched: matched,
        complaintsTotal: complaints.length,
        activeTotal: all.reduce((s, a) => s + a.active, 0),
        criticalTotal: all.reduce((s, a) => s + a.critical, 0),
      },
      scope: { level: payload.role_level || payload.role },
    });
  } catch (err) {
    console.error('Village map error:', err);
    return NextResponse.json({ error: 'Failed to load village map' }, { status: 500 });
  }
}
