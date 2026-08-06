/**
 * intelligence.ts — shared intelligence-brief engine.
 *
 * Single computation used by BOTH:
 *   • /api/intelligence/brief        (interactive Intel Command view)
 *   • /api/cron/daily-briefs         (7AM Telegram push via n8n JS-21)
 *
 * All complaint data flows through getComplaintScopeFilter — the same
 * security boundary as /api/complaints. Peer benchmark exposes AGGREGATE
 * counts only (no complaint details, no PII).
 */

import { db } from '@/lib/db';
import { getComplaintScopeFilter, JWTPayload } from '@/lib/jwt';
import { canMutateComplaints, getUserListScope } from '@/lib/rbac';
import { createClient } from '@supabase/supabase-js';
import { SLA_DAYS } from '@/lib/sla';

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

function subAreaOf(user: JWTPayload, c: C): string {
  const lvl = user.role_level;
  if (lvl === 'KARYAKARTA' || lvl === 'GP_COORD') return str(c, 'village') || 'Unknown village';
  if (lvl === 'BLOCK_COORD' || user.role === 'BLOCK') return str(c, 'gp_name', 'gpName') || str(c, 'village') || 'Unknown GP';
  if (lvl === 'MLA') return str(c, 'block') || 'Unknown block';
  if (lvl === 'MP') return str(c, 'assembly_constituency', 'assemblyConstituency', 'constituency') || 'Unknown AC';
  if (lvl === 'DISTRICT_ADMIN' || user.role === 'DISTRICT') return str(c, 'block') || 'Unknown block';
  return str(c, 'district') || 'Unknown district';
}

export function subAreaLabel(user: JWTPayload): string {
  const lvl = user.role_level;
  if (lvl === 'KARYAKARTA' || lvl === 'GP_COORD') return 'Village';
  if (lvl === 'BLOCK_COORD' || user.role === 'BLOCK') return 'Gram Panchayat';
  if (lvl === 'MLA') return 'Block';
  if (lvl === 'MP') return 'Assembly Constituency';
  if (lvl === 'DISTRICT_ADMIN' || user.role === 'DISTRICT') return 'Block';
  return 'District';
}

export function scopeLabel(user: JWTPayload): string {
  const lvl = user.role_level;
  if (lvl === 'KARYAKARTA') return (user.assigned_villages || []).join(', ') || user.gp_name || 'My villages';
  if (lvl === 'GP_COORD') return user.gp_name || `GP ${user.gp_code}`;
  if (lvl === 'BLOCK_COORD' || user.role === 'BLOCK') return user.block;
  if (lvl === 'MLA') return user.constituency || '';
  if (lvl === 'MP') return user.lok_sabha_constituency || '';
  if (lvl === 'DISTRICT_ADMIN' || user.role === 'DISTRICT') return user.district || user.block || '';
  return 'West Bengal';
}

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

export interface IntelligenceBrief {
  scope: { level: string; label: string; subAreaLabel: string; generatedAt: string };
  riskIndex: { score: number; grade: string; drivers: string[] };
  kpis: {
    total: number; active: number; resolved: number; critical: number; slaBreached: number;
    resolutionRate: number; avgResolutionDays: number | null; avgRating: number | null;
    ratedCount: number; filed7: number; filedPrev7: number; momentumPct: number; resolved14: number;
  };
  /**
   * How long since the last complaint arrived in this scope.
   *
   * If WhatsApp intake breaks — number banned, token expired, n8n down — every
   * other number on every screen keeps looking healthy while nothing new comes
   * in. Nothing surfaced that, so silence was indistinguishable from calm.
   */
  intake: { lastReceivedAt: string | null; hoursSinceLast: number | null; status: 'LIVE' | 'QUIET' | 'STALLED' | 'NO_DATA' };
  trend: Array<{ week: string; filed: number; resolved: number }>;
  categoryShare: Array<{ category: string; count: number; active: number; resolved: number }>;
  categorySurges: Array<{ category: string; current: number; previous: number; pctChange: number }>;
  hotspots: Array<{ name: string; total: number; active: number; critical: number; slaBreached: number; resolved: number; risk: number }>;
  sentiment: { distribution: Record<string, number>; avg: number | null; recentAvg: number | null; direction: string };
  officers: Array<{ name: string; total: number; resolved: number; active: number; score: number }>;
  /**
   * Where this seat stands among its peers — position and spread only.
   *
   * This used to carry every peer by name with their totals and resolution
   * rate. The product is sold to nine MLAs inside one district, so that handed
   * each client their eight rivals' performance. Rank against an average keeps
   * what is actually useful ("3rd of 9, district average 27%") and gives away
   * nobody's numbers.
   */
  benchmark: {
    label: string;
    self: { total: number; resolved: number; resolutionRate: number } | null;
    rank: number | null;
    peerCount: number;
    averageRate: number;
    bestRate: number;
    percentile: number | null;
  } | null;
  warnings: Array<{ severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'; title: string; detail: string }>;
  wins: Array<{ ticketNo: string; issue: string; village: string; category: string; rating: number | null; resolvedAt: string }>;
  quickWins: Array<{ ticketNo: string; issue: string; village: string; category: string; daysOld: number }>;
}

export async function computeIntelligenceBrief(payload: JWTPayload): Promise<IntelligenceBrief> {
  const where = getComplaintScopeFilter(payload);
  const complaints: C[] = await db.complaint.findMany({ where, orderBy: { createdAt: 'desc' }, take: 2000 });

  const now = Date.now();
  const DAY = 86400000;
  const d7 = now - 7 * DAY, d14 = now - 14 * DAY;

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

    if (act && created) {
      const slaMs = (SLA_DAYS[urgency] || 3) * DAY;
      if (now - created.getTime() > slaMs) { slaBreached++; areas[area].slaBreached++; }
    }

    if (res && created && resolvedAt) {
      resDaysSum += Math.max(0, (resolvedAt.getTime() - created.getTime()) / DAY);
      resDaysN++;
    }
    if (res && resolvedAt && resolvedAt.getTime() >= d14) resolved14++;

    if (created) {
      const t = created.getTime();
      if (t >= d7) { filed7++; catNow[cat] = (catNow[cat] || 0) + 1; }
      else if (t >= d14) { filedPrev7++; catPrev[cat] = (catPrev[cat] || 0) + 1; }
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

    const rating = num(c.satisfactionRating);
    if (rating >= 1 && rating <= 5) {
      ratings.push(rating);
      ratingDist[String(rating)]++;
      if (resolvedAt && resolvedAt.getTime() >= d14) recentRatings.push(rating);
    }

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

  const categorySurges = Object.keys({ ...catNow, ...catPrev })
    .map(cat => {
      const cur = catNow[cat] || 0, prev = catPrev[cat] || 0;
      const pct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0);
      return { category: cat, current: cur, previous: prev, pctChange: pct };
    })
    .filter(s => s.current >= 2 && s.pctChange >= 25)
    .sort((a, b) => b.pctChange - a.pctChange)
    .slice(0, 5);

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

  const warnings: IntelligenceBrief['warnings'] = [];
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

  const trend = Array.from({ length: 12 }, (_, i) => {
    const idx = 11 - i;
    const w = weeks[String(idx)] || { filed: 0, resolved: 0 };
    return { week: `W-${idx}`, filed: w.filed, resolved: w.resolved };
  });

  const officerBoard = Object.entries(officers)
    .map(([name, o]) => ({ name, ...o, score: Math.round((o.resolved / Math.max(o.total, 1)) * 100) }))
    .sort((a, b) => b.score - a.score || b.total - a.total)
    .slice(0, 6);

  let benchmark: IntelligenceBrief['benchmark'] = null;
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
      // Ranked internally, then reduced to position and spread. Names never
      // leave this function — not to the client, not into the advisor's prompt.
      const ranked = Object.entries(agg)
        .map(([name, a]) => ({
          name, ...a,
          resolutionRate: a.total ? Math.round((a.resolved / a.total) * 100) : 0,
          isSelf: name.toLowerCase() === pc.selfName.toLowerCase(),
        }))
        .sort((a, b) => b.resolutionRate - a.resolutionRate);

      const selfIdx = ranked.findIndex(p => p.isSelf);
      const self = selfIdx >= 0 ? ranked[selfIdx] : null;
      const averageRate = ranked.length
        ? Math.round(ranked.reduce((s, p) => s + p.resolutionRate, 0) / ranked.length)
        : 0;

      benchmark = {
        label: pc.label,
        self: self ? { total: self.total, resolved: self.resolved, resolutionRate: self.resolutionRate } : null,
        rank: selfIdx >= 0 ? selfIdx + 1 : null,
        peerCount: ranked.length,
        averageRate,
        bestRate: ranked.length ? ranked[0].resolutionRate : 0,
        percentile: selfIdx >= 0 && ranked.length > 1
          ? Math.round(((ranked.length - 1 - selfIdx) / (ranked.length - 1)) * 100)
          : null,
      };
    }
  }

  // complaints is fetched ordered by createdAt desc, so the head is the newest.
  const lastReceived = dt(complaints[0]?.createdAt);
  const hoursSinceLast = lastReceived ? Math.round(((Date.now() - lastReceived.getTime()) / 36e5) * 10) / 10 : null;
  // 48h is deliberately generous: a quiet weekend in one assembly is normal,
  // a week of silence is not.
  const intakeStatus: 'LIVE' | 'QUIET' | 'STALLED' | 'NO_DATA' =
    hoursSinceLast === null ? 'NO_DATA'
    : hoursSinceLast <= 48 ? 'LIVE'
    : hoursSinceLast <= 168 ? 'QUIET'
    : 'STALLED';

  return {
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
    intake: {
      lastReceivedAt: lastReceived ? lastReceived.toISOString() : null,
      hoursSinceLast,
      status: intakeStatus,
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
  };
}

/* ─────────────────────────────────────────────────────────────────
 * Predictive Engine (Level 6) — computeForecast
 *
 * HONEST by design. A multi-agent review of the real data (56 complaints,
 * ~8 weeks, no full annual cycle, ~96% missing resolvedAt) concluded this is
 * EARLY-SIGNAL / crude-trend territory, NOT statistical forecasting. So this
 * ships only what is defensible today and explicitly WITHHOLDS the rest:
 *   • scope-wide volume as a RANGE (recency-weighted MA + damped momentum +
 *     Negative-Binomial-style band reflecting real overdispersion) — never a
 *     bare point; gated to >=6 weekly data points.
 *   • trajectory label (RISING / FLAT / COOLING) from damped momentum.
 *   • deterministic per-complaint SLA-breach GAUGE from age vs urgency-SLA
 *     (createdAt only; NOT a probability — resolvedAt is unusable).
 *   • per-area/category WATCH flags; a NUMBER only when total>=8 AND active>=5.
 *   • seasonal WATCHLIST with NO numbers (seasonal_patterns is a placeholder).
 * Withheld: per-cell point forecasts on n=1 cells, calibrated seasonality,
 * SLA-breach probability, velocity/ETA (needs a risk_history table — Phase 2).
 * Every output carries caveats. Aggregate-only, scope-locked.
 * ──────────────────────────────────────────────────────────────── */

const FORECAST_CAVEATS = [
  'Based on only ~56 complaints over under 2 months. This is an EARLY-SIGNAL trend, NOT a statistical forecast.',
  'The launch-week spike reflects portal rollout/adoption, not real demand — it is not a baseline to return to. Volume has since flattened.',
  'Zero full annual cycles exist, so NO seasonality can be learned. Any summer/monsoon expectation is a hypothesis to validate, not a data-derived forecast.',
  'Only the scope-wide total is forecastable. Per-block/per-category numbers are suppressed because most cells have very few complaints (sampling bias).',
  'SLA-breach risk is a deterministic age-vs-deadline gauge, NOT a calibrated probability. Resolution timing is missing for ~96% of complaints.',
  'Forecast bands are deliberately wide. The width is honest — narrowing it on this little data would be false precision.',
  'Revisit after 12+ months of history (ideally 2 full years) and after resolution timestamps are backfilled before treating any output as a calibrated forecast.',
];

const FC_SLA_DAYS = SLA_DAYS;

export interface ForecastResult {
  scope: { level: string; label: string; subAreaLabel: string; generatedAt: string };
  status: 'OK' | 'NOT_ENOUGH_DATA';
  confidence: 'LOW' | 'NOT-FORECASTABLE';
  weeksOfHistory: number;
  trajectory: 'RISING' | 'FLAT/STABILIZING' | 'COOLING' | null;
  level: number | null;
  momentum: number | null;
  dispersionVMR: number | null;
  history: Array<{ week: string; filed: number }>;
  volumeForecast: Array<{ weekAhead: number; point: number; lo: number; hi: number }>;
  areaSignals: Array<{ name: string; tier: 'USABLE' | 'WATCH'; sharePct: number; point: number | null; lo: number | null; hi: number | null }>;
  categorySignals: Array<{ category: string; tier: 'USABLE' | 'WATCH'; sharePct: number }>;
  slaRisk: { basis: string; counts: { breached: number; high: number; medium: number; low: number }; top: Array<{ ticketNo: string; category: string; urgency: string; ageDays: number; ratio: number; band: string }> };
  seasonal: { available: boolean; reason: string; watchlist: Array<{ category: string; district: string; note: string; confidence: string }> };
  caveats: string[];
  message: string;
}

async function computeSlaRisk(payload: JWTPayload): Promise<ForecastResult['slaRisk']> {
  const where = getComplaintScopeFilter(payload);
  const complaints: C[] = await db.complaint.findMany({ where, orderBy: { createdAt: 'desc' }, take: 2000 });
  const now = Date.now(), DAY = 86400000;
  const counts = { breached: 0, high: 0, medium: 0, low: 0 };
  const rows: ForecastResult['slaRisk']['top'] = [];
  for (const c of complaints) {
    if (!isActive(c)) continue;
    const created = dt(c.createdAt);
    if (!created) continue;
    const ageDays = (now - created.getTime()) / DAY;
    const urgency = str(c, 'urgency');
    const ratio = ageDays / (FC_SLA_DAYS[urgency] || 3);
    const band = ratio >= 1 ? 'BREACHED' : ratio >= 0.8 ? 'HIGH' : ratio >= 0.5 ? 'MEDIUM' : 'LOW';
    if (band === 'BREACHED') counts.breached++;
    else if (band === 'HIGH') counts.high++;
    else if (band === 'MEDIUM') counts.medium++;
    else counts.low++;
    rows.push({ ticketNo: str(c, 'ticketNo'), category: str(c, 'category') || 'OTHER', urgency: urgency || 'MEDIUM', ageDays: Math.round(ageDays * 10) / 10, ratio: Math.round(ratio * 100) / 100, band });
  }
  rows.sort((a, b) => b.ratio - a.ratio);
  return { basis: 'age-vs-SLA (createdAt only; resolvedAt unusable, ~96% null) — deterministic gauge, NOT a probability', counts, top: rows.slice(0, 8) };
}

async function computeSeasonalWatchlist(): Promise<ForecastResult['seasonal']> {
  try {
    const { data } = await supabase.from('seasonal_patterns').select('category, district, month, avg_complaints_per_week, confidence');
    const rows = (data || []) as unknown as Array<{ category: string; district: string; month: number; avg_complaints_per_week: number; confidence: number }>;
    const byKey: Record<string, typeof rows> = {};
    for (const r of rows) { const k = `${r.category}||${r.district}`; (byKey[k] ||= []).push(r); }
    const watchlist: ForecastResult['seasonal']['watchlist'] = [];
    for (const k of Object.keys(byKey)) {
      const arr = byKey[k].slice().sort((a, b) => a.month - b.month);
      for (let i = 1; i < arr.length; i++) {
        const prev = arr[i - 1], cur = arr[i];
        if (cur.avg_complaints_per_week > 1 && cur.confidence > 5 && cur.avg_complaints_per_week > prev.avg_complaints_per_week) {
          const p = Math.round(prev.avg_complaints_per_week * 10) / 10, c2 = Math.round(cur.avg_complaints_per_week * 10) / 10;
          watchlist.push({ category: cur.category, district: cur.district, note: `rose ${p}→${c2}/week month ${prev.month}→${cur.month} — watch (hypothesis to validate)`, confidence: 'LOW' });
        }
      }
    }
    return {
      available: false,
      reason: 'Single Apr–Jun cycle, no year key, confidence at its floor — not a calibrated seasonal model. (The table even shows WATER/Purulia FALLING into June, evidence it tracks rollout noise, not seasonality.)',
      watchlist: watchlist.slice(0, 3),
    };
  } catch {
    return { available: false, reason: 'seasonal data unavailable', watchlist: [] };
  }
}

export async function computeForecast(payload: JWTPayload): Promise<ForecastResult> {
  const brief = await computeIntelligenceBrief(payload);
  const scope = brief.scope;
  const history = brief.trend.map(t => ({ week: t.week, filed: t.filed }));
  const series0 = brief.trend.map(t => t.filed); // oldest → newest (W-11..W-0)

  const firstNonZero = series0.findIndex(v => v > 0);
  const weeksOfHistory = firstNonZero === -1 ? 0 : series0.length - firstNonZero;

  const [slaRisk, seasonal] = await Promise.all([computeSlaRisk(payload), computeSeasonalWatchlist()]);

  // STEP 0 — gate
  if (weeksOfHistory < 6) {
    return {
      scope, status: 'NOT_ENOUGH_DATA', confidence: 'NOT-FORECASTABLE', weeksOfHistory,
      trajectory: null, level: null, momentum: null, dispersionVMR: null, history,
      volumeForecast: [], areaSignals: [], categorySignals: [], slaRisk, seasonal,
      caveats: FORECAST_CAVEATS, message: 'Not enough weekly history yet — collecting. (Forecast unlocks at 6+ weeks of data.)',
    };
  }

  // STEP 1 — trim leading (pre-launch) zeros
  const w = series0.slice(firstNonZero);
  const n = w.length;

  // STEP 2 — recency-weighted level (window 3, linear weights 1,2,3)
  const level = n >= 3
    ? Math.round(((1 * w[n - 3] + 2 * w[n - 2] + 3 * w[n - 1]) / 6) * 10) / 10
    : Math.round((w.reduce((a, b) => a + b, 0) / n) * 10) / 10;

  // STEP 3 — momentum = mean WoW change over last 4 weeks
  const last4 = w.slice(-4);
  const diffs: number[] = [];
  for (let i = 1; i < last4.length; i++) diffs.push(last4[i] - last4[i - 1]);
  const momentum = diffs.length ? Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 100) / 100 : 0;
  const trajectory: ForecastResult['trajectory'] = momentum > 0.5 ? 'RISING' : momentum < -0.5 ? 'COOLING' : 'FLAT/STABILIZING';

  // STEP 5 — overdispersion VMR (drop the single launch spike), clamp 1..4
  const exSpike = (() => { const arr = [...w]; if (arr.length > 3) arr.splice(arr.indexOf(Math.max(...arr)), 1); return arr; })();
  const mean = exSpike.reduce((a, b) => a + b, 0) / exSpike.length;
  const variance = exSpike.reduce((a, b) => a + (b - mean) ** 2, 0) / exSpike.length;
  const dispersionVMR = Math.round(Math.max(1, Math.min(4, mean > 0 ? variance / mean : 1)) * 100) / 100;

  // STEP 4 — damped h-step point + NB-style band
  const phi = 0.5;
  const volumeForecast: ForecastResult['volumeForecast'] = [];
  for (let h = 1; h <= 4; h++) {
    let acc = 0;
    for (let j = 1; j <= h; j++) acc += Math.pow(phi, j) * momentum;
    const point = Math.max(0, Math.round((level + acc) * 10) / 10);
    // +0.5 continuity floor (count data near zero): the band must never collapse
    // to a false-certain "0–0" — even a cooling area can still get a complaint or two.
    const sd = Math.sqrt((point + 0.5) * dispersionVMR);
    volumeForecast.push({
      weekAhead: h, point,
      lo: Math.max(0, Math.round((point - 1.28 * sd) * 10) / 10),
      hi: Math.round((point + 1.28 * sd) * 10) / 10,
    });
  }

  // STEP 6 — per-area / per-category signals (number only on USABLE cells)
  const scopeTotal = brief.kpis.total || 1;
  const band1 = volumeForecast[0];
  const areaSignals: ForecastResult['areaSignals'] = [];
  for (const a of brief.hotspots) {
    const usable = a.total >= 8 && a.active >= 5;
    const watch = !usable && a.total >= 5;
    if (!usable && !watch) continue; // SUPPRESSED
    const sharePct = Math.round((100 * a.total) / scopeTotal);
    if (usable) {
      const share = a.total / scopeTotal;
      areaSignals.push({ name: a.name, tier: 'USABLE', sharePct, point: Math.round(share * level * 10) / 10, lo: Math.round(share * band1.lo * 10) / 10, hi: Math.round(share * band1.hi * 10) / 10 });
    } else {
      areaSignals.push({ name: a.name, tier: 'WATCH', sharePct, point: null, lo: null, hi: null });
    }
  }
  const categorySignals: ForecastResult['categorySignals'] = [];
  for (const c of brief.categoryShare) {
    const usable = c.count >= 8 && c.active >= 5;
    const watch = !usable && c.count >= 5;
    if (!usable && !watch) continue;
    categorySignals.push({ category: c.category, tier: usable ? 'USABLE' : 'WATCH', sharePct: Math.round((100 * c.count) / scopeTotal) });
  }

  return {
    scope, status: 'OK', confidence: 'LOW', weeksOfHistory, trajectory, level, momentum, dispersionVMR,
    history, volumeForecast, areaSignals, categorySignals, slaRisk, seasonal, caveats: FORECAST_CAVEATS, message: '',
  };
}

/* ─────────────────────────────────────────────────────────────────
 * Data Fusion / Entity Ontology (Level 7) — computeFusion
 *
 * Each geographic node (village/GP/block/AC, per the user's scope grain) becomes
 * a FUSED profile combining every REAL signal we have, ranked by a transparent
 * priority score. A 7-agent design review confirmed what is honest vs fabricated:
 *   REAL (fused): complaint load + risk, anger (NLP), top root-causes, category
 *     mix, a complaint-driven SCHEME-FAILURE proxy (Lakshmir Bhandar / Kanyashree
 *     / Pension / Yuvashree / Scholarship…), recurrence (repeat flag), and
 *     political context (MLA, party, ST/SC reservation, Lok Sabha) joined from
 *     constituency_block_mapping.
 *   NOT in the DB → shown as labeled "not connected" placeholders, NEVER faked:
 *     census/SECC demographics, past election results/margins, news sentiment,
 *     weather/mandi, true scheme enrollment %, map lat/lng, per-area officer cards.
 * Priority score blends the existing composite RISK with ORTHOGONAL salience
 * (scheme-failure %, concentration, recurrence, reservation) so signals already
 * inside risk (anger/SLA) are not double-counted. Aggregate-only, scope-locked.
 * ──────────────────────────────────────────────────────────────── */

const fnorm = (s: string): string => (s || '').toLowerCase().replace(/[\s-]+/g, ' ').trim();

// Complaint-driven welfare-scheme failure detection (matched on category + NLP root cause).
const SCHEME_PATTERNS: Array<{ scheme: string; re: RegExp }> = [
  { scheme: 'Lakshmir Bhandar', re: /lakshmir|laxmir|annapurna[\s-]?bhandar/i },
  { scheme: 'Kanyashree', re: /kanyashree/i },
  { scheme: 'Rupashree', re: /rupashree/i },
  { scheme: 'Yuvashree/Yuvasathi', re: /yuvashree|yuvasathi|yuva[\s-]?s/i },
  { scheme: 'Pension (Jai Bangla)', re: /pension|old[\s-]?age|widow|disabilit/i },
  { scheme: 'Scholarship / Sikshashree', re: /scholarship|sikshashree|shikshashree/i },
  { scheme: 'Bangla Awas (housing)', re: /awas|abas|pmay|housing[\s-]?scheme/i },
  { scheme: 'Khadya Sathi (ration)', re: /khadya|ration/i },
  { scheme: 'Swasthya Sathi (health)', re: /swasthya/i },
  { scheme: 'Krishak Bandhu', re: /krishak/i },
];

const FUSION_CAVEATS = [
  'This is a GRIEVANCE-intelligence fusion: it combines the signals we actually have, not a full demographic/electoral fusion.',
  'Scheme load is a complaint-DRIVEN failure proxy (who complained), NOT true enrollment or coverage % — it over-represents dissatisfied citizens.',
  'Political context (MLA, party, reservation) is reference data; vote share / margins / turnout are NOT in the system.',
  'External sources (census, election results, news, weather, scheme coverage, map pins, per-area officer cards) are NOT connected — shown as placeholders, never estimated.',
  'Dataset is currently single-district (Purulia) and small (~56 complaints); per-node detail on tiny nodes is directional only.',
  'Priority score blends the composite risk with orthogonal salience (scheme %, concentration, recurrence, reservation) — weights are transparent, not a calibrated probability.',
];

export interface FusionNode {
  name: string;
  political: { mla: string; party: string; reservation: string; lokSabha: string; constituency: string } | null;
  grievance: { total: number; active: number; resolved: number; resolutionRate: number; critical: number; slaBreached: number; risk: number };
  sentiment: { avgAnger: number | null; dominantEmotion: string | null; ratedAnger: number };
  schemeGrievance: { count: number; pct: number; byScheme: Array<{ scheme: string; count: number }> };
  recurrence: { repeatCount: number };
  topCauses: Array<{ rootCause: string; count: number }>;
  categoryMix: Array<{ category: string; count: number }>;
  priority: { score: number; grade: string; components: { risk: number; schemeLoad: number; concentration: number; recurrence: number; reservation: number } };
}

export interface FusionResult {
  scope: { level: string; label: string; subAreaLabel: string; generatedAt: string };
  nodeGrain: string;
  nodes: FusionNode[];
  external: Array<{ source: string; status: string; note: string }>;
  caveats: string[];
}

const NOT_CONNECTED: Array<{ source: string; note: string }> = [
  { source: 'Census / SECC demographics', note: 'population, literacy, SC/ST share, BPL — not in DB (only ST/SC reservation type as a coarse proxy)' },
  { source: 'Past election results / margins', note: 'only the sitting MLA + party are stored; no vote share, turnout, or margin' },
  { source: 'Local news / press sentiment', note: 'press_reports table is empty' },
  { source: 'Weather / rainfall / mandi prices', note: 'not connected' },
  { source: 'Scheme enrollment / coverage %', note: 'only a complaint-driven failure proxy exists; true saturation is not in the DB' },
  { source: 'Per-area officer scorecards', note: 'officer_scores has no area dimension and most complaints are unassigned' },
];

export async function computeFusion(payload: JWTPayload): Promise<FusionResult> {
  const brief = await computeIntelligenceBrief(payload);
  const riskByNode = new Map(brief.hotspots.map(h => [h.name, h]));

  const where = getComplaintScopeFilter(payload);
  const complaints: C[] = await db.complaint.findMany({ where, orderBy: { createdAt: 'desc' }, take: 3000 });

  const ids = complaints.map(c => str(c, 'id')).filter(Boolean);
  const nlpById = new Map<string, C>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from('complaint_nlp')
      .select('complaint_id, anger_score, emotion, root_cause, root_cause_key, severity_flags')
      .in('complaint_id', ids.slice(i, i + 200));
    for (const r of (data || []) as unknown as C[]) nlpById.set(str(r, 'complaint_id'), r);
  }

  // Political reference (block + AC level)
  const { data: mapRows } = await supabase
    .from('constituency_block_mapping')
    .select('block_name, constituency, constituency_type, mla_name, party, lok_sabha');
  const polByBlock = new Map<string, C>();
  const polByAC = new Map<string, C>();
  for (const r of (mapRows || []) as unknown as C[]) {
    polByBlock.set(fnorm(str(r, 'block_name')), r);
    const ac = fnorm(str(r, 'constituency'));
    if (!polByAC.has(ac)) polByAC.set(ac, r);
  }

  type Acc = {
    name: string; total: number; schemeByName: Record<string, number>; schemeCount: number;
    repeatCount: number; angerSum: number; angerN: number; emotions: Record<string, number>;
    causes: Record<string, number>; cats: Record<string, number>; blockNames: Set<string>;
  };
  const nodes: Record<string, Acc> = {};
  for (const c of complaints) {
    const name = subAreaOf(payload, c);
    if (!nodes[name]) nodes[name] = { name, total: 0, schemeByName: {}, schemeCount: 0, repeatCount: 0, angerSum: 0, angerN: 0, emotions: {}, causes: {}, cats: {}, blockNames: new Set() };
    const nd = nodes[name];
    nd.total++;
    const cat = (str(c, 'category') || 'OTHER').toUpperCase();
    nd.cats[cat] = (nd.cats[cat] || 0) + 1;
    const bn = fnorm(str(c, 'block'));
    if (bn) nd.blockNames.add(bn);
    const nlp = nlpById.get(str(c, 'id'));
    const hay = `${cat} ${nlp ? `${str(nlp, 'root_cause_key')} ${str(nlp, 'root_cause')}` : ''}`.toLowerCase();
    for (const sp of SCHEME_PATTERNS) {
      if (sp.re.test(hay)) { nd.schemeByName[sp.scheme] = (nd.schemeByName[sp.scheme] || 0) + 1; nd.schemeCount++; break; }
    }
    if (nlp) {
      const a = typeof nlp.anger_score === 'number' ? nlp.anger_score : null;
      if (a !== null) { nd.angerSum += a; nd.angerN++; }
      const emo = str(nlp, 'emotion'); if (emo) nd.emotions[emo] = (nd.emotions[emo] || 0) + 1;
      const rc = str(nlp, 'root_cause') || str(nlp, 'root_cause_key'); if (rc) nd.causes[rc] = (nd.causes[rc] || 0) + 1;
      const flags = Array.isArray(nlp.severity_flags) ? (nlp.severity_flags as unknown[]) : [];
      if (flags.includes('repeat')) nd.repeatCount++;
    }
  }

  const scopeTotal = brief.kpis.total || 1;
  const out: FusionNode[] = Object.values(nodes).map(nd => {
    const risk = riskByNode.get(nd.name);
    const grievance = risk
      ? { total: risk.total, active: risk.active, resolved: risk.resolved, critical: risk.critical, slaBreached: risk.slaBreached, resolutionRate: risk.total ? Math.round((risk.resolved / risk.total) * 100) : 0, risk: risk.risk }
      : { total: nd.total, active: 0, resolved: 0, critical: 0, slaBreached: 0, resolutionRate: 0, risk: 0 };
    const avgAnger = nd.angerN ? Math.round(nd.angerSum / nd.angerN) : null;
    const dominantEmotion = Object.entries(nd.emotions).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const schemePct = nd.total ? Math.round((100 * nd.schemeCount) / nd.total) : 0;

    // Political join: node may be a block (MLA scope), an AC (MP scope), or finer
    const nNorm = fnorm(nd.name);
    const singleBlock = nd.blockNames.size === 1 ? [...nd.blockNames][0] : null;
    const pr = polByBlock.get(nNorm) || polByAC.get(nNorm) || (singleBlock ? polByBlock.get(singleBlock) : undefined) || null;
    const political = pr
      ? { mla: str(pr, 'mla_name'), party: str(pr, 'party'), reservation: str(pr, 'constituency_type'), lokSabha: str(pr, 'lok_sabha'), constituency: str(pr, 'constituency') }
      : null;

    const concentration = Math.round((100 * nd.total) / scopeTotal);
    const schemeLoad = schemePct;
    const recurrence = Math.min(100, nd.repeatCount * 20);
    const reservation = political && (political.reservation === 'ST' || political.reservation === 'SC') ? 10 : 0;
    const priorityScore = Math.min(100, Math.round(grievance.risk * 0.5 + schemeLoad * 0.2 + concentration * 0.15 + recurrence * 0.1 + reservation));
    const grade = priorityScore >= 60 ? 'TOP' : priorityScore >= 40 ? 'HIGH' : priorityScore >= 20 ? 'WATCH' : 'LOW';

    return {
      name: nd.name, political, grievance,
      sentiment: { avgAnger, dominantEmotion, ratedAnger: nd.angerN },
      schemeGrievance: { count: nd.schemeCount, pct: schemePct, byScheme: Object.entries(nd.schemeByName).map(([scheme, count]) => ({ scheme, count })).sort((a, b) => b.count - a.count) },
      recurrence: { repeatCount: nd.repeatCount },
      topCauses: Object.entries(nd.causes).map(([rootCause, count]) => ({ rootCause, count })).sort((a, b) => b.count - a.count).slice(0, 4),
      categoryMix: Object.entries(nd.cats).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      priority: { score: priorityScore, grade, components: { risk: grievance.risk, schemeLoad, concentration, recurrence, reservation } },
    };
  }).sort((a, b) => b.priority.score - a.priority.score);

  return {
    scope: brief.scope,
    nodeGrain: brief.scope.subAreaLabel,
    nodes: out,
    external: NOT_CONNECTED.map(e => ({ source: e.source, status: 'NOT_CONNECTED', note: e.note })),
    caveats: FUSION_CAVEATS,
  };
}

/* ─────────────────────────────────────────────────────────────────
 * Network Intelligence (Level 8) — computeNetwork
 *
 * Recon verdict (real queries): issue-cascade / contagion graphs are NOT
 * supported by the data yet — category co-occurrence is thin and concentration-
 * driven, and ZERO root-causes span ≥2 villages. So those are honest "not enough
 * data" placeholders, never fabricated edges.
 *
 * What IS real and networked: the ORGANISATIONAL / escalation chain. Each scope
 * is a tree (e.g. MP: AC → block → village) with complaint load + unresolved%
 * + anger flowing through it, exposing WHERE in the chain the backlog concentrates
 * — the "weakest links". Plus a thin, clearly-caveated issue co-occurrence panel.
 * Aggregate-only, scope-locked.
 * ──────────────────────────────────────────────────────────────── */

export interface NetNode {
  name: string; level: string; total: number; active: number; resolved: number;
  unresolvedPct: number; avgAnger: number | null; children: NetNode[];
}
export interface NetworkResult {
  scope: { level: string; label: string; subAreaLabel: string; generatedAt: string };
  tree: NetNode[];
  weakestLinks: Array<{ name: string; level: string; total: number; unresolvedPct: number; avgAnger: number | null }>;
  coOccurrence: { edges: Array<{ a: string; b: string; sharedAreas: number }>; note: string };
  gaps: Array<{ feature: string; status: string; note: string }>;
  caveats: string[];
}

function netChain(user: JWTPayload, c: C): Array<{ level: string; name: string }> {
  const lvl = user.role_level;
  const out: Array<{ level: string; name: string }> = [];
  const push = (level: string, val: string) => { if (val) out.push({ level, name: val }); };
  if (user.role === 'ADMIN' || user.role === 'STATE') {
    push('District', str(c, 'district')); push('Assembly', str(c, 'assembly_constituency', 'assemblyConstituency', 'constituency')); push('Block', str(c, 'block'));
  } else if (lvl === 'MP') {
    push('Assembly', str(c, 'assembly_constituency', 'assemblyConstituency', 'constituency')); push('Block', str(c, 'block')); push('Village', str(c, 'village'));
  } else if (lvl === 'MLA') {
    push('Block', str(c, 'block')); push('Village', str(c, 'village'));
  } else if (lvl === 'DISTRICT_ADMIN' || user.role === 'DISTRICT') {
    push('Block', str(c, 'block')); push('Village', str(c, 'village'));
  } else if (lvl === 'BLOCK_COORD' || user.role === 'BLOCK') {
    push('Gram Panchayat', str(c, 'gp_name', 'gpName') || str(c, 'gp_code')); push('Village', str(c, 'village'));
  } else {
    push('Village', str(c, 'village'));
  }
  return out;
}

export async function computeNetwork(payload: JWTPayload): Promise<NetworkResult> {
  const where = getComplaintScopeFilter(payload);
  const complaints: C[] = await db.complaint.findMany({ where, orderBy: { createdAt: 'desc' }, take: 3000 });

  const ids = complaints.map(c => str(c, 'id')).filter(Boolean);
  const angerById = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('complaint_nlp').select('complaint_id, anger_score').in('complaint_id', ids.slice(i, i + 200));
    for (const r of (data || []) as unknown as C[]) {
      const a = typeof r.anger_score === 'number' ? r.anger_score : null;
      if (a !== null) angerById.set(str(r, 'complaint_id'), a);
    }
  }

  type Agg = { name: string; level: string; total: number; active: number; resolved: number; angerSum: number; angerN: number; children: Map<string, Agg> };
  const root = new Map<string, Agg>();
  for (const c of complaints) {
    const chain = netChain(payload, c);
    if (chain.length === 0) continue;
    let levelMap = root;
    for (const seg of chain) {
      if (!levelMap.has(seg.name)) levelMap.set(seg.name, { name: seg.name, level: seg.level, total: 0, active: 0, resolved: 0, angerSum: 0, angerN: 0, children: new Map() });
      const node = levelMap.get(seg.name)!;
      node.total++;
      if (isActive(c)) node.active++;
      if (isResolved(c)) node.resolved++;
      const a = angerById.get(str(c, 'id'));
      if (a !== undefined) { node.angerSum += a; node.angerN++; }
      levelMap = node.children;
    }
  }

  const weakest: NetworkResult['weakestLinks'] = [];
  const toNode = (agg: Agg): NetNode => {
    const unresolvedPct = agg.total ? Math.round((100 * (agg.total - agg.resolved)) / agg.total) : 0;
    const avgAnger = agg.angerN ? Math.round(agg.angerSum / agg.angerN) : null;
    if (agg.total >= 3 && unresolvedPct >= 60) weakest.push({ name: agg.name, level: agg.level, total: agg.total, unresolvedPct, avgAnger });
    return {
      name: agg.name, level: agg.level, total: agg.total, active: agg.active, resolved: agg.resolved, unresolvedPct, avgAnger,
      children: [...agg.children.values()].sort((a, b) => b.total - a.total).map(toNode),
    };
  };
  const tree = [...root.values()].sort((a, b) => b.total - a.total).map(toNode);
  weakest.sort((a, b) => b.unresolvedPct * b.total - a.unresolvedPct * a.total);

  // Issue co-occurrence (category pairs sharing ≥2 blocks) — thin, clearly caveated
  const blockCats: Record<string, Set<string>> = {};
  for (const c of complaints) {
    const b = str(c, 'block'); if (!b) continue;
    (blockCats[b] ||= new Set()).add((str(c, 'category') || 'OTHER').toUpperCase());
  }
  const pairCount: Record<string, number> = {};
  for (const b of Object.keys(blockCats)) {
    const cats = [...blockCats[b]].sort();
    for (let i = 0; i < cats.length; i++) for (let j = i + 1; j < cats.length; j++) {
      pairCount[`${cats[i]}||${cats[j]}`] = (pairCount[`${cats[i]}||${cats[j]}`] || 0) + 1;
    }
  }
  const edges = Object.entries(pairCount).filter(([, n]) => n >= 2)
    .map(([k, n]) => { const [a, b] = k.split('||'); return { a, b, sharedAreas: n }; })
    .sort((x, y) => y.sharedAreas - x.sharedAreas).slice(0, 8);

  return {
    scope: { level: payload.role_level || payload.role, label: scopeLabel(payload), subAreaLabel: subAreaLabel(payload), generatedAt: new Date().toISOString() },
    tree,
    weakestLinks: weakest.slice(0, 6),
    coOccurrence: {
      edges,
      note: edges.length
        ? 'Categories that recur in the same areas (co-location, NOT proven causation). Thin on current data — directional only.'
        : 'Not enough co-occurring data yet — needs more complaints across more areas.',
    },
    gaps: [
      { feature: 'Issue-cascade / contagion graph', status: 'NOT_ENOUGH_DATA', note: 'No root-cause currently spans ≥2 villages; cascade chains need longitudinal volume to be real, not fabricated.' },
      { feature: 'Competitor / opposition watch', status: 'NOT_CONNECTED', note: 'Single-party dataset; no opposition, election-margin, or press data connected.' },
    ],
    caveats: [
      'The organisational tree (load + unresolved%) is REAL. The issue-cascade graph is NOT — no root-cause spans multiple villages yet, so it is shown as a labeled gap, not fabricated.',
      'Co-occurrence = categories sharing an area (co-location), never proven causation; thin on ~56 complaints.',
      'Competitor watch needs opposition/election/news data that is not connected.',
    ],
  };
}

/* ─────────────────────────────────────────────────────────────────
 * LEVEL 10 — Autonomous Operations / AI Chief-of-Staff Action Queue.
 *
 * A scope-locked PROPOSAL queue, NOT an autopilot. The engine spots a real
 * signal on a real ticket, drafts the action + its ready-to-fire execute route,
 * and a human approves with one tap — then an EXISTING audited route runs it.
 *
 * Honesty discipline (verified by adversarial review):
 *  - Every item is built from the authoritative scoped complaint row-set, so it
 *    always carries a REAL `id` for the [id] execute routes (signals only rank).
 *  - Only action types with a real, scope-safe execution path exist.
 *  - REOPEN comes from status=RESOLVED AND satisfactionRating<=2 (real rows) —
 *    not from brief.wins[], which is sorted to EXCLUDE low ratings. Often empty.
 *  - Low volume ⇒ short/empty queue. We say so; we never pad.
 *  - Each execute.body is a single fixed field-set per action type. ESCALATE
 *    bodies carry ONLY { urgency } (never status) so an INTERNAL action can
 *    never silently fire a citizen (WB-03) notification.
 *  - KARYAKARTA (canMutateComplaints=false) gets an advisory, read-only queue.
 *  - No auto-pilot in v1: every write is human-approved.
 *  - There is NO honest free-text citizen-message endpoint → RESPOND_CITIZEN is
 *    surfaced as a disabled gap, never a fake "sent" button.
 * Aggregate ops telemetry only — no individual-voter profiling (DPDP/ECI).
 * ──────────────────────────────────────────────────────────────── */

export type ActionType = 'ASSIGN_OFFICER' | 'ESCALATE' | 'CHASE_STATUS' | 'CLOSE_QUICKWIN' | 'REOPEN';

export interface ActionItem {
  id: string;                 // `${actionType}:${complaintId}`
  complaintId: string;
  ticketNo: string;
  actionType: ActionType;
  title: string;
  why: string[];
  score: number;              // 0–100, deterministic, no probabilities
  components: { urgency: number; age: number; anger: number };
  riskTier: 'INTERNAL' | 'CITIZEN_FACING';
  area: string;
  // Ready-to-fire on approval. `needs` = a sub-input the human must supply.
  execute: { method: 'PATCH' | 'POST'; route: string; body?: Record<string, unknown>; needs?: 'officer' | 'resolution' | 'confirm' };
  executable: boolean;        // false for read-only role
  reason?: string;
}

export interface ActionQueue {
  scope: { level: string; label: string; generatedAt: string };
  canWrite: boolean;
  items: ActionItem[];
  officers: Array<{ id: string; name: string; area: string }>;  // scoped suggestions for ASSIGN
  stats: { proposed: number; actionedWindow: number; resolvedOfActioned: number; windowDays: number };
  disabledTypes: Array<{ type: string; reason: string }>;
  caveats: string[];
}

const OPS_SLA_DAYS = SLA_DAYS;
const URG_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const URG_WEIGHT: Record<string, number> = { CRITICAL: 100, HIGH: 70, MEDIUM: 40, LOW: 15 };
// Higher = handle first when one ticket qualifies for several actions.
const ACTION_PRIORITY: Record<ActionType, number> = { ASSIGN_OFFICER: 5, ESCALATE: 4, CHASE_STATUS: 3, CLOSE_QUICKWIN: 2, REOPEN: 1 };

export async function computeOperations(payload: JWTPayload): Promise<ActionQueue> {
  // Scope-locked authoritative row-set — the SOURCE of every action + its real id.
  const where = getComplaintScopeFilter(payload);
  const complaints: C[] = await db.complaint.findMany({ where, orderBy: { createdAt: 'desc' }, take: 3000 });
  const canWrite = canMutateComplaints(payload);

  // Per-ticket NLP anger (same batched pattern as computeNetwork).
  const ids = complaints.map(c => str(c, 'id')).filter(Boolean);
  const angerById = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    try {
      const { data } = await supabase.from('complaint_nlp').select('complaint_id, anger_score').in('complaint_id', ids.slice(i, i + 200));
      for (const r of (data || []) as unknown as C[]) {
        const a = typeof r.anger_score === 'number' ? r.anger_score : null;
        if (a !== null) angerById.set(str(r, 'complaint_id'), a);
      }
    } catch { /* anger is optional enrichment */ }
  }

  const now = Date.now();
  const DAY = 86400000;
  const candidates: ActionItem[] = [];

  for (const c of complaints) {
    const id = str(c, 'id');
    if (!id) continue;
    const ticketNo = str(c, 'ticketNo') || id.slice(0, 8);
    const status = str(c, 'status');
    const urgency = (str(c, 'urgency') || 'MEDIUM').toUpperCase();
    const assignedToId = str(c, 'assignedToId');
    const created = dt(c.createdAt);
    const ageDays = created ? Math.floor((now - created.getTime()) / DAY) : 0;
    const anger = angerById.get(id) ?? 0;
    const area = subAreaOf(payload, c);
    // Titles used to be the ticket number, which tells a reader nothing: an MLA
    // cannot act on "WB-DEMO-109B3BE4". Lead with what it is and where it is,
    // and let the UI carry the ticket number separately for lookup.
    const catLabel = (str(c, 'category') || 'Complaint').replace(/_/g, ' ').toLowerCase();
    const village = str(c, 'village') || str(c, 'gp_name');
    const subject = `${catLabel.charAt(0).toUpperCase()}${catLabel.slice(1)}${village ? ` · ${village}` : area ? ` · ${area}` : ''}`;
    const slaT = OPS_SLA_DAYS[urgency] ?? 3;
    const breached = isActive(c) && ageDays > slaT;
    const rating = typeof c.satisfactionRating === 'number' ? c.satisfactionRating as number : null;

    const urgencyW = URG_WEIGHT[urgency] ?? 30;
    const ageW = Math.min(100, Math.round((ageDays / Math.max(slaT, 0.5)) * 35));
    const angerW = Math.max(0, Math.min(100, Math.round(anger)));
    const score = Math.round(0.45 * urgencyW + 0.35 * ageW + 0.20 * angerW);
    const components = { urgency: urgencyW, age: ageW, anger: angerW };

    const mk = (
      actionType: ActionType, title: string, why: string[], riskTier: ActionItem['riskTier'],
      execute: ActionItem['execute'], itemScore = score,
    ): ActionItem => ({
      id: `${actionType}:${id}`, complaintId: id, ticketNo, actionType, title, why,
      score: Math.max(0, Math.min(100, itemScore)), components, riskTier, area, execute,
      executable: canWrite,
      reason: canWrite ? undefined : 'Read-only role — advisory only',
    });

    // 1) ASSIGN_OFFICER — active + unassigned (handle ownerless tickets first)
    if (isActive(c) && !assignedToId) {
      candidates.push(mk('ASSIGN_OFFICER',
        `Assign an officer — ${subject}`,
        [`${urgency} urgency`, 'unassigned', `${ageDays}d old`, ...(anger >= 60 ? [`anger ${angerW}`] : [])],
        'INTERNAL',
        { method: 'PATCH', route: `/api/complaints/${id}`, needs: 'officer' },
      ));
    }
    // 2) ESCALATE — active + SLA-breached + not already CRITICAL. Body = ONLY { urgency }.
    if (breached && urgency !== 'CRITICAL') {
      const next = URG_ORDER[Math.min(URG_ORDER.indexOf(urgency) + 1, URG_ORDER.length - 1)];
      candidates.push(mk('ESCALATE',
        `Escalate to ${next} — ${subject}`,
        [`SLA breached — ${ageDays}d open at ${urgency}`, ...(anger >= 50 ? [`anger ${angerW}`] : [])],
        'INTERNAL',
        { method: 'PATCH', route: `/api/complaints/${id}`, body: { urgency: next } },
      ));
    }
    // 3) CHASE_STATUS — stuck IN_PROGRESS > 7d → internal follow-up note
    if (status === 'IN_PROGRESS' && ageDays > 7) {
      candidates.push(mk('CHASE_STATUS',
        `Chase stalled — ${subject}`,
        [`In progress ${ageDays}d with no resolution`, ...(anger >= 50 ? [`anger ${angerW}`] : [])],
        'INTERNAL',
        { method: 'POST', route: `/api/complaints/${id}/comments`, body: { content: `Follow-up requested — ${ageDays} days in progress with no update. Please advance this ticket.` } },
      ));
    }
    // 4) CLOSE_QUICKWIN — old low/medium active ticket (human resolved it offline) → citizen-facing
    if (isActive(c) && (urgency === 'LOW' || urgency === 'MEDIUM') && ageDays > 7) {
      candidates.push(mk('CLOSE_QUICKWIN',
        `Quick win — close ${subject}`,
        [`${urgency}, ${ageDays}d old — cheap to clear`, 'notifies citizen (WB-03) on close'],
        'CITIZEN_FACING',
        { method: 'PATCH', route: `/api/complaints/${id}`, needs: 'resolution' },
        Math.round(score * 0.8),
      ));
    }
    // 5) REOPEN — resolved but poorly rated (real rows; often empty). Never auto.
    if (status === 'RESOLVED' && rating !== null && rating >= 1 && rating <= 2) {
      candidates.push(mk('REOPEN',
        `Reopen poorly-rated — ${subject}`,
        [`Citizen rated ${rating}★ after resolution`, ...(anger >= 50 ? [`anger ${angerW}`] : [])],
        'INTERNAL',
        { method: 'PATCH', route: `/api/complaints/${id}/reopen`, needs: 'confirm' },
        Math.round(40 + (2 - rating) * 18 + angerW * 0.2),
      ));
    }
  }

  // One action per ticket: highest ACTION_PRIORITY, then score.
  const byTicket = new Map<string, ActionItem>();
  for (const it of candidates) {
    const prev = byTicket.get(it.complaintId);
    if (!prev ||
      ACTION_PRIORITY[it.actionType] > ACTION_PRIORITY[prev.actionType] ||
      (ACTION_PRIORITY[it.actionType] === ACTION_PRIORITY[prev.actionType] && it.score > prev.score)) {
      byTicket.set(it.complaintId, it);
    }
  }
  const items = [...byTicket.values()].sort((a, b) => b.score - a.score).slice(0, 15);

  // Scoped officer suggestions for ASSIGN (best-effort; the PATCH route is the authority).
  let officers: ActionQueue['officers'] = [];
  if (canWrite) {
    try {
      const us = await getUserListScope(payload);
      let users: C[] = await db.user.findMany({ where: us.where as Record<string, string> });
      if (us.postFilter) users = users.filter(u => us.postFilter!(u as Record<string, unknown>));
      officers = users
        .filter(u => u.isActive !== false && str(u, 'id') && str(u, 'id') !== (payload.userId || ''))
        .map(u => ({ id: str(u, 'id'), name: str(u, 'name', 'username') || 'Unnamed', area: str(u, 'block', 'gp_name', 'village', 'district') }))
        .slice(0, 30);
    } catch { /* officer picker is optional */ }
  }

  // Outcome loop — derived from existing activity_logs (no new table). Honest correlation.
  const windowDays = 14;
  let actionedWindow = 0, resolvedOfActioned = 0;
  if (payload.userId) {
    try {
      const since = new Date(now - windowDays * DAY);
      const logs: C[] = await db.activityLog.findMany({ where: { actorId: payload.userId, createdAt: { gte: since } } });
      const MUT = new Set(['ASSIGNED', 'ESCALATED', 'STATUS_CHANGED', 'RESOLVED', 'COMMENT', 'REOPENED', 'UNASSIGNED']);
      const statusById = new Map(complaints.map(c => [str(c, 'id'), str(c, 'status')]));
      const touched = new Set<string>();
      for (const l of logs) {
        if (str(l, 'actorId', 'actor_id') !== (payload.userId || '')) continue;
        if (!MUT.has(str(l, 'action'))) continue;
        actionedWindow++;
        touched.add(str(l, 'complaintId', 'complaint_id'));
      }
      for (const cid of touched) if (statusById.get(cid) === 'RESOLVED') resolvedOfActioned++;
    } catch { /* outcome panel is best-effort */ }
  }

  const caveats: string[] = [
    'Yeh ek proposal queue hai, autopilot nahi — har action AAP approve karte ho, phir ek existing audited route execute karta hai.',
    'Har item ek REAL ticket + real signal (urgency, SLA-age, NLP anger) se bana hai. Koi fabricated priority ya probability nahi.',
    'Low volume (≈4 complaints/week) ki wajah se queue chhoti — kabhi sirf 2-3 items, ya khaali. Yeh honest hai, padding nahi.',
    'Outcome panel sirf CORRELATION dikhata hai ("ab resolved"), causation claim nahi — AI ne resolve nahi kiya, aapne kiya.',
    'Scope-locked: aapko sirf apni jurisdiction ke tickets dikhte hain; har write server-side complaintInScope + canMutateComplaints se dobara check hota hai.',
  ];
  if (!canWrite) caveats.unshift('Aapka role read-only hai (KARYAKARTA) — yeh queue advisory hai, approve buttons nahi aate.');

  return {
    scope: { level: payload.role_level || payload.role, label: scopeLabel(payload), generatedAt: new Date().toISOString() },
    canWrite,
    items,
    officers,
    stats: { proposed: items.length, actionedWindow, resolvedOfActioned, windowDays },
    disabledTypes: [
      { type: 'RESPOND_CITIZEN', reason: 'No honest free-text citizen-message endpoint exists yet. Citizen ko notify sirf status-change (WB-03) se hota hai — jab dedicated notify endpoint banega tab aayega.' },
      { type: 'AUTO_PILOT', reason: 'v1 mein sab human-approve. Unattended writes (AI khud actions fire kare) intentionally OFF — political/legal safety.' },
    ],
    caveats,
  };
}

/* ─────────────────────────────────────────────────────────────────
 * Telegram daily-brief formatting (HTML parse mode — Session 4 rule:
 * ALWAYS escape dynamic text for Telegram HTML)
 * ──────────────────────────────────────────────────────────────── */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const GRADE_EMOJI: Record<string, string> = {
  LOW: '🟢', GUARDED: '🟡', ELEVATED: '🟠', HIGH: '🔴', SEVERE: '🚨',
};

export function formatBriefForTelegram(b: IntelligenceBrief): string {
  // Telegram rich text (parse_mode=HTML). Uses bold/italic + an EXPANDABLE
  // blockquote so the brief stays compact but the detail is one tap away.
  // n8n's "Send Brief via Telegram" node MUST set parse_mode = HTML.
  const g = GRADE_EMOJI[b.riskIndex.grade] || '⚪';
  const mo = `${b.kpis.momentumPct >= 0 ? '+' : ''}${b.kpis.momentumPct}%`;
  const L: string[] = [];
  L.push(`🧠 <b>Daily Intel Brief</b> — <b>${esc(b.scope.label)}</b>`);
  L.push(`<i>📅 ${new Date(b.scope.generatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</i>`);
  L.push('');
  L.push(`${g} <b>Risk ${b.riskIndex.score}/100</b> · <i>${esc(b.riskIndex.grade)}</i>`);
  L.push(`📊 Active <b>${b.kpis.active}</b> · Critical <b>${b.kpis.critical}</b> · SLA breach <b>${b.kpis.slaBreached}</b>`);
  L.push(`📈 7-din <b>${b.kpis.filed7}</b> (${mo} WoW) · Resolution <b>${b.kpis.resolutionRate}%</b>`);

  if (b.warnings.length > 0) {
    L.push('');
    L.push('⚠️ <b>Warnings</b>');
    const wl = b.warnings.slice(0, 4).map(w => `• <b>${esc(w.title)}</b> — ${esc(w.detail)}`).join('\n');
    L.push(`<blockquote expandable>${wl}</blockquote>`);
  }

  if (b.hotspots.length > 0 && b.hotspots[0].risk > 0) {
    const h = b.hotspots[0];
    L.push('');
    L.push(`🔥 <b>Top hotspot:</b> ${esc(h.name)} <i>(${h.active} active${h.critical ? `, ${h.critical} critical` : ''})</i>`);
  }

  if (b.quickWins.length > 0) {
    const q = b.quickWins[0];
    // Tappable deep-link → opens the ticket tracker for this complaint in the app.
    const url = `https://wb-grievance-portal.vercel.app/?ticket=${encodeURIComponent(q.ticketNo)}`;
    L.push(`🎯 <b>Today ka quick win:</b> <a href="${url}">${esc(q.ticketNo)}</a> — ${esc(q.issue.slice(0, 60))} <i>(${q.daysOld}d old)</i>`);
  }

  if (b.benchmark?.percentile !== null && b.benchmark?.percentile !== undefined) {
    L.push(`🏆 Peer rank: better than <b>${b.benchmark.percentile}%</b> <i>(${esc(b.benchmark.label)})</i>`);
  }

  L.push('');
  L.push('<i>JanSunwai Intelligence · scope-locked brief</i>');
  return L.join('\n');
}
