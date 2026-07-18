export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import type { JWTPayload } from '@/lib/jwt';
import { assembliesForLokSabha } from '@/lib/rbac';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/war-room — single scoped aggregation backing the War Room screen
 * (see WAR_ROOM.md): live complaint ticker, KPI strip, GP hotspots, block
 * heat, karyakarta activity, and the Balarampur battleground overlay.
 *
 * One fetch of the caller's in-scope complaints (getComplaintScopeFilter),
 * everything below is derived from that same array — no per-widget re-query.
 * Aggregate-only, RBAC-scoped like /api/hotspots and /api/map/politics.
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
const dateOf = (c: C, ...keys: string[]): Date | null => {
  for (const k of keys) {
    const v = c[k];
    if (v instanceof Date) return v;
    if (typeof v === 'string' && v) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
};

const CLOSED = new Set(['RESOLVED', 'REJECTED']);
const BREACH_URGENCY = new Set(['HIGH', 'CRITICAL']);

const ALL_ACS = [
  'Bandwan', 'Balarampur', 'Baghmundi', 'Joypur', 'Purulia',
  'Manbazar', 'Kashipur', 'Para', 'Raghunathpur',
];

const BLOCK_ALIASES: Record<string, string> = {
  bundwan: 'bandwan',
  bagmundi: 'baghmundi',
  jaipur: 'joypur',
};
function normBlock(s: string | null | undefined): string {
  const v = (s || '').toLowerCase().replace(/[\s-]/g, '');
  return BLOCK_ALIASES[v] || v;
}

interface AcScope {
  acs: string[];
  blockNorm?: string;
  gpCode?: string;
  karyakartaId?: string;
}

// Mirrors the scope-resolution used by /api/booths — narrowed to just what's
// needed to bound the polling_stations query for karyakarta activity (2.3).
async function resolveAcScope(payload: JWTPayload): Promise<AcScope> {
  if (payload.role === 'ADMIN' || payload.role === 'STATE') return { acs: ALL_ACS };

  const lvl = payload.role_level;

  if (lvl === 'MP' && payload.lok_sabha_constituency) {
    const acs = await assembliesForLokSabha(payload.lok_sabha_constituency);
    return { acs: acs.length > 0 ? acs : ALL_ACS };
  }
  if (lvl === 'MLA' && payload.constituency) {
    return { acs: [payload.constituency] };
  }
  if (lvl === 'DISTRICT_ADMIN' || payload.role === 'DISTRICT') {
    return { acs: ALL_ACS };
  }
  if (lvl === 'BLOCK_COORD' || payload.role === 'BLOCK') {
    return { acs: ALL_ACS, blockNorm: normBlock(payload.block) };
  }
  if (lvl === 'GP_COORD' && payload.gp_code) {
    return { acs: ALL_ACS, gpCode: payload.gp_code };
  }
  if (lvl === 'KARYAKARTA') {
    return { acs: ALL_ACS, karyakartaId: payload.userId };
  }
  // Unscoped / legacy OFFICER: own booths only.
  return { acs: ALL_ACS, karyakartaId: payload.userId };
}

export async function GET(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // ── Fetch in-scope complaints once ───────────────────────
    const where = getComplaintScopeFilter(payload);
    const complaints: C[] = await db.complaint.findMany({
      where,
      select: {
        ticketNo: true,
        citizenName: true,
        issue: true,
        category: true,
        village: true,
        gp_name: true,
        gpName: true,
        block: true,
        assembly_constituency: true,
        assemblyConstituency: true,
        urgency: true,
        status: true,
        pct: true,
        createdAt: true,
        updatedAt: true,
        assignedOfficerName: true,
      },
    });

    const now = new Date();
    const todayKey = now.toDateString();

    // ── 1. KPIs ───────────────────────────────────────────────
    let open = 0;
    let breached = 0;
    let resolvedToday = 0;
    let slaAtRisk = 0;
    let openAgeDaysSum = 0;
    let sawBalarampur = false;

    for (const c of complaints) {
      const status = str(c, 'status');
      const urgency = str(c, 'urgency');
      const pct = num(c, 'pct');
      const isOpen = !CLOSED.has(status);
      const ac = str(c, 'assembly_constituency', 'assemblyConstituency');
      if (ac === 'Balarampur') sawBalarampur = true;

      if (isOpen) {
        open++;
        const isBreach = (pct !== null && pct >= 100) || BREACH_URGENCY.has(urgency);
        if (isBreach) breached++;
        if (pct !== null && pct >= 75 && pct < 100) slaAtRisk++;
        const created = dateOf(c, 'createdAt');
        if (created) openAgeDaysSum += (now.getTime() - created.getTime()) / 86400000;
      }
      if (status === 'RESOLVED') {
        const updated = dateOf(c, 'updatedAt');
        if (updated && updated.toDateString() === todayKey) resolvedToday++;
      }
    }
    const avgOpenAgeDays = open > 0 ? Math.round((openAgeDaysSum / open) * 10) / 10 : 0;

    const kpis = {
      open,
      breached,
      resolvedToday,
      total: complaints.length,
      slaAtRisk,
      avgOpenAgeDays,
    };

    // ── 2. Live ticker — 15 most recent ──────────────────────
    const ticker = complaints
      .slice()
      .sort((a, b) => {
        const da = dateOf(a, 'createdAt')?.getTime() ?? 0;
        const db_ = dateOf(b, 'createdAt')?.getTime() ?? 0;
        return db_ - da;
      })
      .slice(0, 15)
      .map((c) => {
        const created = dateOf(c, 'createdAt');
        const issueRaw = str(c, 'issue');
        return {
          ticketNo: str(c, 'ticketNo') || null,
          issue: issueRaw.length > 60 ? issueRaw.slice(0, 60).trimEnd() + '…' : issueRaw,
          category: str(c, 'category') || 'OTHER',
          block: str(c, 'block') || null,
          gp_name: str(c, 'gp_name', 'gpName') || null,
          urgency: str(c, 'urgency') || null,
          status: str(c, 'status') || null,
          ageHours: created ? Math.round(((now.getTime() - created.getTime()) / 3600000) * 10) / 10 : null,
        };
      });

    // ── 3. Hotspot GPs (same aggregation as /api/hotspots) ───
    type Group = {
      assembly_constituency: string;
      block: string;
      gp_name: string;
      open: number;
      breached: number;
      openCats: Record<string, number>;
    };
    const groups: Record<string, Group> = {};
    const blockMap: Record<string, { open: number; breached: number }> = {};

    for (const c of complaints) {
      const ac = str(c, 'assembly_constituency', 'assemblyConstituency');
      const block = str(c, 'block') || 'Unknown';
      const gpName = str(c, 'gp_name', 'gpName');
      const status = str(c, 'status');
      const urgency = str(c, 'urgency');
      const category = str(c, 'category') || 'OTHER';
      const pct = num(c, 'pct');
      const isOpen = !CLOSED.has(status);
      const isBreach = (pct !== null && pct >= 100) || BREACH_URGENCY.has(urgency);

      if (isOpen) {
        const bm = blockMap[block] || (blockMap[block] = { open: 0, breached: 0 });
        bm.open++;
        if (isBreach) bm.breached++;
      }

      if (!gpName) continue; // drop groups with no GP name

      const key = `${ac}||${block}||${gpName}`;
      if (!groups[key]) {
        groups[key] = { assembly_constituency: ac, block, gp_name: gpName, open: 0, breached: 0, openCats: {} };
      }
      const g = groups[key];
      if (isOpen) {
        g.open++;
        g.openCats[category] = (g.openCats[category] || 0) + 1;
        if (isBreach) g.breached++;
      }
    }

    const hotspotGPs = Object.values(groups)
      .map((g) => ({
        assembly_constituency: g.assembly_constituency,
        block: g.block,
        gp_name: g.gp_name,
        open: g.open,
        breached: g.breached,
        topCategory: Object.entries(g.openCats).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      }))
      .sort((a, b) => b.breached - a.breached || b.open - a.open)
      .slice(0, 8);

    // ── 4. Block heat strip ──────────────────────────────────
    const blockHeat = Object.entries(blockMap)
      .map(([block, v]) => ({ block, open: v.open, breached: v.breached }))
      .sort((a, b) => b.open - a.open);

    // ── 5. Karyakarta activity ───────────────────────────────
    const acScope = await resolveAcScope(payload);
    let karyakartaCount = 0;
    let assignedBooths = 0;
    let totalBooths = 0;
    try {
      let boothQuery = supabase.from('polling_stations').select('ac, karyakarta_user_id, block_name, gp_code');
      boothQuery = acScope.acs.length === 1
        ? boothQuery.eq('ac', acScope.acs[0])
        : boothQuery.in('ac', acScope.acs);
      if (acScope.gpCode) boothQuery = boothQuery.eq('gp_code', acScope.gpCode);
      if (acScope.karyakartaId) boothQuery = boothQuery.eq('karyakarta_user_id', acScope.karyakartaId);

      const { data: boothRows } = await boothQuery.limit(3000);
      let booths = (boothRows || []) as C[];
      if (acScope.blockNorm) {
        booths = booths.filter((b) => normBlock(str(b, 'block_name')) === acScope.blockNorm);
      }

      totalBooths = booths.length;
      const assignedIds = new Set(
        booths
          .map((b) => b.karyakarta_user_id)
          .filter((v): v is string => typeof v === 'string' && !!v)
      );
      assignedBooths = assignedIds.size > 0
        ? booths.filter((b) => typeof b.karyakarta_user_id === 'string' && !!b.karyakarta_user_id).length
        : 0;

      if (assignedIds.size > 0) {
        const { data: kUsers } = await supabase
          .from('users')
          .select('id, role_level, isActive')
          .in('id', [...assignedIds]);
        karyakartaCount = (kUsers || []).filter(
          (u) => (u as C).role_level === 'KARYAKARTA' && (u as C).isActive === true
        ).length;
      }
    } catch (e) {
      console.error('War room karyakarta activity error:', e);
      // Leave counts at 0 rather than fail the whole endpoint — honest empty state.
    }
    const karyakartaActivity = { karyakartaCount, assignedBooths, totalBooths };

    // ── 6. Balarampur battleground overlay (same rule as /api/hotspots) ──
    const lvl = payload.role_level;
    const hasBalarampurAccess =
      sawBalarampur ||
      payload.role === 'ADMIN' ||
      payload.role === 'STATE' ||
      lvl === 'DISTRICT_ADMIN' ||
      lvl === 'MP' ||
      (lvl === 'MLA' && payload.constituency === 'Balarampur');

    let battleground: Array<{
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
        .slice(0, 12);

      battleground = sorted.map((b) => {
        const ps = str(b, 'ps');
        const match = psByNo[ps.trim()];
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
      kpis,
      ticker,
      hotspotGPs,
      blockHeat,
      karyakartaActivity,
      battleground,
      ...(note ? { note } : {}),
      meta: {
        scope: payload.role_level || payload.role,
        constituency: payload.constituency || null,
      },
    });
  } catch (err) {
    console.error('War room error:', err);
    return NextResponse.json({ error: 'Failed to load war room data' }, { status: 500 });
  }
}
