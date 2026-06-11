import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter, JWTPayload } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/intelligence/brief — role-adaptive intelligence brief.
 *
 * Every number here is computed from complaints ALREADY filtered through
 * getComplaintScopeFilter (same single source of truth as /api/complaints),
 * so a karyakarta's brief is village-level, a GP coordinator's is GP-level,
 * an MLA's is constituency-level, an MP's is seat-level — enforced server-side.
 *
 * The only cross-scope data returned is the PEER BENCHMARK, which exposes
 * AGGREGATE COUNTS ONLY (area name + totals + resolution rate) of sibling
 * areas — zero complaint details, zero PII. This is deliberate: "how do I
 * rank against my peers" is the core political question.
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
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const dt = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  return null;
};

const ACTIVE_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'REGISTERED', 'ASSIGNED']);
const isActive = (c: C) => ACTIVE_STATUSES.has(str(c, 'status'));
const isResolved = (c: C) => str(c, 'status') === 'RESOLVED';

/** Sub-area grouping field per role (what the "hotspots" drill into). */
function subAreaOf(user: JWTPayload, c: C): string {
  const lvl = user.role_level;
  if (lvl === 'KARYAKARTA' || lvl === 'GP_COORD') return str(c, 'village') || 'Unknown village';
  if (lvl === 'BLOCK_COORD' || user.role === 'BLOCK') return str(c, 'gp_name', 'gpName') || str(c, 'village') || 'Unknown GP';
  if (lvl === 'MLA') return str(c, 'block') || 'Unknown block';
  if (lvl === 'MP') return str(c, 'assembly_constituency', 'assemblyConstituency', 'constituency') || 'Unknown AC';
  if (lvl === 'DISTRICT_ADMIN' || user.role === 'DISTRICT') return str(c, 'block') || 'Unknown block';
  return str(c, 'district') || 'Unknown district';
}

function subAreaLabel(user: JWTPayload): string {
  const lvl = user.role_level;
  if (lvl === 'KARYAKARTA' || lvl === 'GP_COORD') return 'Village';
  if (lvl === 'BLOCK_COORD' || user.role === 'BLOCK') return 'Gram Panchayat';
  if (lvl === 'MLA') return 'Block';
  if (lvl === 'MP') return 'Assembly Constituency';
  if (lvl === 'DISTRICT_ADMIN' || user.role === 'DISTRICT') return 'Block';
  return 'District';
}

function scopeLabel(user: JWTPayload): string {
  const lvl = user.role_level;
  if (lvl === 'KARYAKARTA') return (user.assigned_villages || []).join(', ') || user.gp_name || 'My villages';
  if (lvl === 'GP_COORD') return user.gp_name || `GP ${user.gp_code}`;
  if (lvl === 'BLOCK_COORD' || user.role === 'BLOCK') return user.block;
  if (lvl === 'MLA') return user.constituency || '';
  if (lvl === 'MP') return user.lok_sabha_constituency || '';
  if (lvl === 'DISTRICT_ADMIN' || user.role === 'DISTRICT') return user.district || user.block || '';
  return 'West Bengal';
}

/** Peer benchmark config: column to group siblings by + filter to siblings. */
function peerConfig(user: JWTPayload): { groupCol: string; filterCol?: string; filterVal?: string; selfName: string; label: string } | null {
  const lvl = user.role_level;
  if (lvl === 'KARYAKARTA' || lvl === 'GP_COORD') {
    if (!user.block && !user.gp_name) return null;
    return { groupCol: 'gp_name', filterCol: 'block', filterVal: user.block, selfName: user.gp_name || '', label: 'GPs in your block' };
  }
  if (lvl === 'BLOCK_COORD' || user.role === 'BLOCK') {
    return { groupCol: 'block', filterCol: 'district', filterVal: user.district || '', selfName: user.block, label: 'Blocks in your district' };
  }
  if (lvl === 'MLA') {
    return { groupCol: 'assembly_constituency', filterCol: 'parliamentary_constituency', filterVal: '', selfName: user.constituency || '', label: 'Constituencies nearby' };
  }
  if (lvl === 'MP') {
    return { groupCol: 'parliamentary_constituency', selfName: user.lok_sabha_constituency || '', label: 'Parliamentary seats' };
  }
  if (lvl === 'DISTRICT_ADMIN' || user.role === 'DISTRICT') {
    return { groupCol: 'district', selfName: user.district || user.block || '', label: 'Districts' };
  }
  return { groupCol: 'district', selfName: '', label: 'Districts' };
}

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    // ── Scoped complaints (THE security boundary) ──
    const where = getComplaintScopeFilter(payload);
    const complaints: C[] = await db.complaint.findMany({ where, orderBy: { createdAt: 'desc' }, take: 2000 });

    const now = Date.now();
    const DAY = 86400000;
    const d7 = now - 7 * DAY, d14 = now - 14 * DAY;

    // ── Core KPIs ──
    let total = 0, active = 0, resolved = 0, critical = 0, slaBreached = 0;
    let resDaysSum = 0, resDaysN = 0;
    const ratings: number[] = [];
    const recentRatings: number[] = [];
    const ratingDist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let filed7 = 0, filedPrev7 = 0, resolved14 = 0;

    const catNow: Record<string, number> = {};
    const catPrev: Record<string, number> = {};
    const catAll: Record<string, { count: number; active: number; resolved: number }> = {};
    const areas: Record<string, { total: number; active: number; critical: number; slaBreached: number; resolved: number }> = {};
    const officers: Record<string, { total: number; resolved: number; active: number }> = {};
    const weeks: Record<string, { filed: number; resolved: number }> = {};

    const SLA_DAYS: Record<string, number> = { CRITICAL: 0.25, HIGH: 1, MEDIUM: 3, LOW: 7 };

    for (const c of complaints) {
      total++;
      const created = dt(c.createdAt);
      const resolvedAt = dt(c.resolvedAt) || (isResolved(c) ? dt(c.updatedAt) : null);
      const cat = str(c, 'category') || 'OTHER';
      const urgency = str(c, 'urgency');
      const area = subAreaOf(payload, c);

      if (!catAll[cat]) catAll[cat] = { count: 0, active: 0, resolved: 0 };
      catAll[cat].count++;
      if (!areas[area]) areas[area] = { total: 0, active: 0, critical: 0, slaBreached: 0, resolved: 0 };
      areas[area].total++;

      const act = isActive(c);
      const res = isResolved(c);
      if (act) { active++; catAll[cat].active++; areas[area].active++; }
      if (res) { resolved++; catAll[cat].resolved++; areas[area].resolved++; }
      if (urgency === 'CRITICAL' && act) { critical++; areas[area].critical++; }

      // SLA breach (urgency-based, same model as MLA stats)
      if (act && created) {
        const slaMs = (SLA_DAYS[urgency] || 3) * DAY;
        if (now - created.getTime() > slaMs) { slaBreached++; areas[area].slaBreached++; }
      }

      // Resolution velocity
      if (res && created && resolvedAt) {
        resDaysSum += Math.max(0, (resolvedAt.getTime() - created.getTime()) / DAY);
        resDaysN++;
      }
      if (res && resolvedAt && resolvedAt.getTime() >= d14) resolved14++;

      // Momentum + category surge windows
      if (created) {
        const t = created.getTime();
        if (t >= d7) { filed7++; catNow[cat] = (catNow[cat] || 0) + 1; }
        else if (t >= d14) { filedPrev7++; catPrev[cat] = (catPrev[cat] || 0) + 1; }
        // Weekly trend buckets (last 12 weeks)
        const weekIdx = Math.floor((now - t) / (7 * DAY));
        if (weekIdx < 12) {
          const key = String(weekIdx);
          if (!weeks[key]) weeks[key] = { filed: 0, resolved: 0 };
          weeks[key].filed++;
        }
      }
      if (res && resolvedAt) {
        const weekIdx = Math.floor((now - resolvedAt.getTime()) / (7 * DAY));
        if (weekIdx < 12) {
          const key = String(weekIdx);
          if (!weeks[key]) weeks[key] = { filed: 0, resolved: 0 };
          weeks[key].resolved++;
        }
      }

      // Sentiment
      const rating = num(c.satisfactionRating);
      if (rating >= 1 && rating <= 5) {
        ratings.push(rating);
        ratingDist[String(rating)]++;
        if (resolvedAt && resolvedAt.getTime() >= d14) recentRatings.push(rating);
      }

      // Officer performance
      const officer = str(c, 'assignedOfficerName');
      if (officer) {
        if (!officers[officer]) officers[officer] = { total: 0, resolved: 0, active: 0 };
        officers[officer].total++;
        if (res) officers[officer].resolved++;
        if (act) officers[officer].active++;
      }
    }

    const avgRating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;
    const recentAvg = recentRatings.length ? Math.round((recentRatings.reduce((a, b) => a + b, 0) / recentRatings.length) * 10) / 10 : null;
    const avgResolutionDays = resDaysN ? Math.round((resDaysSum / resDaysN) * 10) / 10 : null;
    const momentumPct = filedPrev7 > 0 ? Math.round(((filed7 - filedPrev7) / filedPrev7) * 100) : (filed7 > 0 ? 100 : 0);

    // ── Political Risk Index (0–100) ──
    const activeRatio = total ? active / total : 0;
    const slaRatio = active ? slaBreached / active : 0;
    const criticalRatio = total ? critical / total : 0;
    const momentumFactor = Math.max(0, Math.min(1, momentumPct / 100));
    const sentimentFactor = avgRating !== null ? (5 - avgRating) / 4 : 0.5;
    const riskScore = Math.round(
      activeRatio * 30 + slaRatio * 25 + criticalRatio * 15 + momentumFactor * 20 + sentimentFactor * 10
    );
    const riskGrade =
      riskScore < 20 ? 'LOW' : riskScore < 40 ? 'GUARDED' : riskScore < 60 ? 'ELEVATED' : riskScore < 80 ? 'HIGH' : 'SEVERE';
    const riskDrivers: string[] = [];
    if (activeRatio > 0.5) riskDrivers.push(`${Math.round(activeRatio * 100)}% complaints still unresolved`);
    if (slaRatio > 0.3) riskDrivers.push(`${slaBreached} SLA breaches (${Math.round(slaRatio * 100)}% of active)`);
    if (critical > 0) riskDrivers.push(`${critical} critical complaints pending`);
    if (momentumPct > 30) riskDrivers.push(`Complaint volume up ${momentumPct}% week-over-week`);
    if (avgRating !== null && avgRating < 3) riskDrivers.push(`Citizen satisfaction low (${avgRating}/5)`);

    // ── Category surges ──
    const categorySurges = Object.keys({ ...catNow, ...catPrev })
      .map(cat => {
        const cur = catNow[cat] || 0, prev = catPrev[cat] || 0;
        const pct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0);
        return { category: cat, current: cur, previous: prev, pctChange: pct };
      })
      .filter(s => s.current >= 2 && s.pctChange >= 25)
      .sort((a, b) => b.pctChange - a.pctChange)
      .slice(0, 5);

    // ── Hotspots (sub-areas ranked by mini risk) ──
    const hotspots = Object.entries(areas)
      .map(([name, a]) => ({
        name,
        ...a,
        risk: Math.round(
          (a.total ? a.active / a.total : 0) * 40 +
          (a.active ? a.slaBreached / a.active : 0) * 30 +
          Math.min(1, a.critical / 3) * 30
        ),
      }))
      .sort((a, b) => b.risk - a.risk || b.active - a.active)
      .slice(0, 8);

    // ── Early warnings (rule engine) ──
    const warnings: Array<{ severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'; title: string; detail: string }> = [];
    for (const s of categorySurges.slice(0, 3)) {
      warnings.push({
        severity: s.pctChange >= 100 ? 'CRITICAL' : 'HIGH',
        title: `${s.category} complaints surging`,
        detail: `${s.current} this week vs ${s.previous} last week (+${s.pctChange}%)`,
      });
    }
    for (const h of hotspots.filter(h => h.critical >= 2).slice(0, 2)) {
      warnings.push({ severity: 'CRITICAL', title: `Critical cluster in ${h.name}`, detail: `${h.critical} critical complaints active — needs immediate visit` });
    }
    if (slaRatio > 0.3 && slaBreached >= 3) {
      warnings.push({ severity: 'HIGH', title: 'SLA discipline breaking down', detail: `${slaBreached} active complaints past deadline (${Math.round(slaRatio * 100)}%)` });
    }
    if (momentumPct >= 60 && filed7 >= 3) {
      warnings.push({ severity: 'HIGH', title: 'Complaint volume spike', detail: `${filed7} new complaints in 7 days (+${momentumPct}% WoW) — ground discontent rising` });
    }
    if (avgRating !== null && avgRating < 2.5 && ratings.length >= 3) {
      warnings.push({ severity: 'MEDIUM', title: 'Citizen sentiment negative', detail: `Average rating ${avgRating}/5 across ${ratings.length} rated complaints` });
    }
    if (resolved14 === 0 && active > 5) {
      warnings.push({ severity: 'MEDIUM', title: 'Resolution stalled', detail: `Zero complaints resolved in 14 days while ${active} remain active` });
    }

    // ── PR wins (recently resolved, well-rated) ──
    const wins = complaints
      .filter(c => isResolved(c))
      .map(c => ({ c, at: dt(c.resolvedAt) || dt(c.updatedAt) }))
      .filter(x => x.at && x.at.getTime() >= d14)
      .sort((a, b) => (num(b.c.satisfactionRating) - num(a.c.satisfactionRating)) || (b.at!.getTime() - a.at!.getTime()))
      .slice(0, 5)
      .map(({ c, at }) => ({
        ticketNo: str(c, 'ticketNo'),
        issue: str(c, 'issue'),
        village: str(c, 'village'),
        category: str(c, 'category'),
        rating: num(c.satisfactionRating) || null,
        resolvedAt: at!.toISOString(),
      }));

    // ── Quick wins (old, low-urgency, easy closes) ──
    const quickWins = complaints
      .filter(c => str(c, 'status') === 'OPEN' && ['LOW', 'MEDIUM'].includes(str(c, 'urgency')))
      .map(c => ({ c, created: dt(c.createdAt) }))
      .filter(x => x.created && now - x.created.getTime() > 7 * DAY)
      .sort((a, b) => a.created!.getTime() - b.created!.getTime())
      .slice(0, 5)
      .map(({ c, created }) => ({
        ticketNo: str(c, 'ticketNo'),
        issue: str(c, 'issue'),
        village: str(c, 'village'),
        category: str(c, 'category'),
        daysOld: Math.floor((now - created!.getTime()) / DAY),
      }));

    // ── Weekly trend (oldest → newest) ──
    const trend = Array.from({ length: 12 }, (_, i) => {
      const idx = 11 - i;
      const w = weeks[String(idx)] || { filed: 0, resolved: 0 };
      return { week: `W-${idx}`, filed: w.filed, resolved: w.resolved };
    });

    // ── Officer leaderboard ──
    const officerBoard = Object.entries(officers)
      .map(([name, o]) => ({ name, ...o, score: Math.round((o.resolved / Math.max(o.total, 1)) * 100) }))
      .sort((a, b) => b.score - a.score || b.total - a.total)
      .slice(0, 6);

    // ── Peer benchmark (AGGREGATES ONLY — no complaint details, no PII) ──
    let benchmark: { label: string; peers: Array<{ name: string; total: number; resolved: number; resolutionRate: number; isSelf: boolean }>; percentile: number | null } | null = null;
    const pc = peerConfig(payload);
    if (pc) {
      let q = supabase.from('complaints').select(`${pc.groupCol}, status`);
      if (pc.filterCol && pc.filterVal) q = q.eq(pc.filterCol, pc.filterVal);
      const { data: peerRows } = await q.limit(5000);
      if (peerRows) {
        const agg: Record<string, { total: number; resolved: number }> = {};
        for (const r of peerRows as unknown as C[]) {
          const name = str(r, pc.groupCol);
          if (!name) continue;
          if (!agg[name]) agg[name] = { total: 0, resolved: 0 };
          agg[name].total++;
          if (str(r, 'status') === 'RESOLVED') agg[name].resolved++;
        }
        const peers = Object.entries(agg)
          .map(([name, a]) => ({
            name, ...a,
            resolutionRate: a.total ? Math.round((a.resolved / a.total) * 100) : 0,
            isSelf: name.toLowerCase() === pc.selfName.toLowerCase(),
          }))
          .sort((a, b) => b.resolutionRate - a.resolutionRate)
          .slice(0, 10);
        const selfIdx = peers.findIndex(p => p.isSelf);
        benchmark = {
          label: pc.label,
          peers,
          percentile: selfIdx >= 0 && peers.length > 1
            ? Math.round(((peers.length - 1 - selfIdx) / (peers.length - 1)) * 100)
            : null,
        };
      }
    }

    return NextResponse.json({
      data: {
        scope: {
          level: payload.role_level || payload.role,
          label: scopeLabel(payload),
          subAreaLabel: subAreaLabel(payload),
          generatedAt: new Date().toISOString(),
        },
        riskIndex: { score: riskScore, grade: riskGrade, drivers: riskDrivers },
        kpis: {
          total, active, resolved, critical, slaBreached,
          resolutionRate: total ? Math.round((resolved / total) * 100) : 0,
          avgResolutionDays, avgRating, ratedCount: ratings.length,
          filed7, filedPrev7, momentumPct, resolved14,
        },
        trend,
        categoryShare: Object.entries(catAll)
          .map(([category, v]) => ({ category, ...v }))
          .sort((a, b) => b.count - a.count),
        categorySurges,
        hotspots,
        sentiment: {
          distribution: ratingDist, avg: avgRating, recentAvg,
          direction: avgRating !== null && recentAvg !== null
            ? (recentAvg > avgRating ? 'improving' : recentAvg < avgRating ? 'declining' : 'stable')
            : 'unknown',
        },
        officers: officerBoard,
        benchmark,
        warnings,
        wins,
        quickWins,
      },
    });
  } catch (error) {
    console.error('Intelligence brief error:', error);
    return NextResponse.json({ error: 'Failed to generate intelligence brief' }, { status: 500 });
  }
}
