export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/hotspots — GP-level grievance hotspot list, scope-locked to the
 * caller's jurisdiction (same boundary as /api/map/risk and /api/complaints),
 * plus a Balarampur booth-level battleground overlay for callers whose scope
 * covers that AC.
 *
 * Aggregate-only: GP-level counts + a public-record election overlay. No
 * individual-citizen data beyond what's already scoped to the caller.
 */

type C = Record<string, unknown>;
const str = (c: C, ...keys: string[]): string => {
  for (const k of keys) {
    const v = c[k];
    if (typeof v === 'string' && v) return v;
  }
  return '';
};
const num = (c: C, ...keys: string[]): number | null => {
  for (const k of keys) {
    const v = c[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v !== '' && !isNaN(Number(v))) return Number(v);
  }
  return null;
};

const CLOSED = new Set(['RESOLVED', 'REJECTED']);
const BREACH_URGENCY = new Set(['HIGH', 'CRITICAL']);

export async function GET(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    // ── Fetch in-scope complaints ────────────────────────────
    const where = getComplaintScopeFilter(payload);
    const complaints: C[] = await db.complaint.findMany({
      where,
      select: {
        assembly_constituency: true,
        block: true,
        gp_name: true,
        gp_code: true,
        village: true,
        status: true,
        urgency: true,
        category: true,
        pct: true,
      },
    });

    // ── Aggregate into GP-level hotspots ─────────────────────
    type Group = {
      assembly_constituency: string;
      block: string;
      gp_name: string;
      gp_code: string | null;
      total: number;
      open: number;
      breached: number;
      openCats: Record<string, number>;
    };
    const groups: Record<string, Group> = {};

    let totalOpen = 0;
    let sawBalarampur = false;

    for (const c of complaints) {
      const ac = str(c, 'assembly_constituency', 'assemblyConstituency');
      const block = str(c, 'block');
      const gpName = str(c, 'gp_name', 'gpName');
      const gpCode = str(c, 'gp_code', 'gpCode') || null;
      const status = str(c, 'status');
      const urgency = str(c, 'urgency');
      const category = str(c, 'category') || 'OTHER';
      const pct = num(c, 'pct');

      const isOpen = !CLOSED.has(status);
      if (isOpen) totalOpen++;
      if (ac === 'Balarampur') sawBalarampur = true;

      if (!gpName) continue; // drop groups with no GP name

      const key = `${ac}||${block}||${gpName}`;
      if (!groups[key]) {
        groups[key] = {
          assembly_constituency: ac,
          block,
          gp_name: gpName,
          gp_code: gpCode,
          total: 0,
          open: 0,
          breached: 0,
          openCats: {},
        };
      }
      const g = groups[key];
      g.total++;
      if (!g.gp_code && gpCode) g.gp_code = gpCode;
      if (isOpen) {
        g.open++;
        g.openCats[category] = (g.openCats[category] || 0) + 1;
      }
      const isBreach = (pct !== null && pct >= 100) || BREACH_URGENCY.has(urgency);
      if (isBreach) g.breached++;
    }

    const allHotspots = Object.values(groups).map((g) => {
      const topCategory =
        Object.entries(g.openCats).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      return {
        assembly_constituency: g.assembly_constituency,
        block: g.block,
        gp_name: g.gp_name,
        gp_code: g.gp_code,
        total: g.total,
        open: g.open,
        breached: g.breached,
        topCategory,
      };
    }).sort((a, b) => (b.breached - a.breached) || (b.open - a.open));

    const hotspots = allHotspots.slice(0, 50);

    // ── Balarampur battleground overlay ──────────────────────
    const lvl = payload.role_level;
    const hasBalarampurAccess =
      sawBalarampur ||
      payload.role === 'ADMIN' ||
      payload.role === 'STATE' ||
      payload.role === 'DISTRICT' ||
      lvl === 'DISTRICT_ADMIN' ||
      lvl === 'MP' ||
      (lvl === 'MLA' && payload.constituency === 'Balarampur');

    let battlegroundBooths: Array<{
      ps: string;
      village: string | null;
      gp_name: string | null;
      block_name: string | null;
      bjp: number | null;
      aitc: number | null;
      margin: number | null;
      winner: string;
    }> = [];
    let note: string | undefined;

    if (hasBalarampurAccess) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const [{ data: boothRows }, { data: psRows }] = await Promise.all([
        supabase
          .from('election_results_booth')
          .select('ac, ps, bjp, aitc, valid, nota, margin, w, r, village')
          .eq('ac', 'Balarampur'),
        supabase
          .from('polling_stations')
          .select('ps_no, village_name, gp_name, block_name')
          .eq('ac', 'Balarampur'),
      ]);

      const psByNo: Record<string, C> = {};
      for (const p of (psRows || []) as C[]) {
        const psNo = str(p, 'ps_no');
        if (psNo) psByNo[psNo.trim()] = p;
      }

      const booths = (boothRows || []) as C[];
      const sorted = booths
        .slice()
        .sort((a, b) => Math.abs(num(a, 'margin') ?? 0) - Math.abs(num(b, 'margin') ?? 0))
        .slice(0, 20);

      battlegroundBooths = sorted.map((b) => {
        const ps = str(b, 'ps');
        const match = psByNo[ps.trim()];
        // Per-booth winner from the actual party vote columns. NOTE: w/r are
        // "winner/runner-up votes" (generic, so w>=r is always true) — using them
        // would mark every booth BJP. bjp vs aitc gives the real per-booth winner.
        const bjpV = num(b, 'bjp') ?? 0;
        const aitcV = num(b, 'aitc') ?? 0;
        return {
          ps,
          village: match ? str(match, 'village_name') || str(b, 'village') || null : str(b, 'village') || null,
          gp_name: match ? str(match, 'gp_name') || null : null,
          block_name: match ? str(match, 'block_name') || null : null,
          bjp: num(b, 'bjp'),
          aitc: num(b, 'aitc'),
          margin: num(b, 'margin'),
          winner: bjpV >= aitcV ? 'BJP' : 'AITC',
        };
      });
    } else {
      note = 'Your jurisdiction does not include Balarampur — battleground booth overlay unavailable.';
    }

    return NextResponse.json({
      hotspots,
      battlegroundBooths,
      ...(note ? { note } : {}),
      meta: {
        scope: payload.role_level || payload.role,
        totalOpen,
        gpCount: allHotspots.length,
      },
    });
  } catch (err) {
    console.error('Hotspots error:', err);
    return NextResponse.json({ error: 'Failed to load hotspots' }, { status: 500 });
  }
}
