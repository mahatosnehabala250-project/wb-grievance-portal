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
import { createClient } from '@supabase/supabase-js';

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
  trend: Array<{ week: string; filed: number; resolved: number }>;
  categoryShare: Array<{ category: string; count: number; active: number; resolved: number }>;
  categorySurges: Array<{ category: string; current: number; previous: number; pctChange: number }>;
  hotspots: Array<{ name: string; total: number; active: number; critical: number; slaBreached: number; resolved: number; risk: number }>;
  sentiment: { distribution: Record<string, number>; avg: number | null; recentAvg: number | null; direction: string };
  officers: Array<{ name: string; total: number; resolved: number; active: number; score: number }>;
  benchmark: { label: string; peers: Array<{ name: string; total: number; resolved: number; resolutionRate: number; isSelf: boolean }>; percentile: number | null } | null;
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

const FC_SLA_DAYS: Record<string, number> = { CRITICAL: 0.25, HIGH: 1, MEDIUM: 3, LOW: 7 };

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
 * Telegram daily-brief formatting (HTML parse mode — Session 4 rule:
 * ALWAYS escape dynamic text for Telegram HTML)
 * ──────────────────────────────────────────────────────────────── */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const GRADE_EMOJI: Record<string, string> = {
  LOW: '🟢', GUARDED: '🟡', ELEVATED: '🟠', HIGH: '🔴', SEVERE: '🚨',
};

export function formatBriefForTelegram(b: IntelligenceBrief): string {
  const g = GRADE_EMOJI[b.riskIndex.grade] || '⚪';
  const lines: string[] = [];
  lines.push(`🧠 <b>Daily Intel Brief — ${esc(b.scope.label)}</b>`);
  lines.push(`📅 ${new Date(b.scope.generatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);
  lines.push('');
  lines.push(`${g} <b>Risk: ${b.riskIndex.score}/100 (${b.riskIndex.grade})</b>`);
  lines.push(`📊 Active: ${b.kpis.active} | Critical: ${b.kpis.critical} | SLA breach: ${b.kpis.slaBreached}`);
  lines.push(`📈 7-din intake: ${b.kpis.filed7} (${b.kpis.momentumPct >= 0 ? '+' : ''}${b.kpis.momentumPct}% WoW) | Resolution: ${b.kpis.resolutionRate}%`);

  if (b.warnings.length > 0) {
    lines.push('');
    lines.push('⚠️ <b>Warnings:</b>');
    for (const w of b.warnings.slice(0, 3)) {
      lines.push(`• ${esc(w.title)} — ${esc(w.detail)}`);
    }
  }

  if (b.hotspots.length > 0 && b.hotspots[0].risk > 0) {
    const h = b.hotspots[0];
    lines.push('');
    lines.push(`🔥 <b>Top hotspot:</b> ${esc(h.name)} (${h.active} active${h.critical ? `, ${h.critical} critical` : ''})`);
  }

  if (b.quickWins.length > 0) {
    const q = b.quickWins[0];
    lines.push(`🎯 <b>Aaj ka quick win:</b> ${esc(q.ticketNo)} — ${esc(q.issue.slice(0, 60))} (${q.daysOld}d old)`);
  }

  if (b.benchmark?.percentile !== null && b.benchmark?.percentile !== undefined) {
    lines.push(`🏆 Peer rank: better than ${b.benchmark.percentile}% (${esc(b.benchmark.label)})`);
  }

  lines.push('');
  lines.push('<i>JanSunwai Intelligence · scope-locked brief</i>');
  return lines.join('\n');
}
