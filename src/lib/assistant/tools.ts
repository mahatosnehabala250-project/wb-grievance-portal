/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Assistant tools — the "hands" of the voice assistant (Saathi).
 *
 * Every READ tool executes server-side using the caller's JWT and the SAME
 * scope-locked logic the UI uses (getComplaintScopeFilter / existing routes),
 * so the model can never see data outside the user's jurisdiction. NAVIGATE and
 * WRITE tools are NOT executed here — the agent loop captures them as a client
 * directive / a proposed action that the human confirms (writes then run through
 * the existing audited routes).
 *
 * PRIVACY: tool results NEVER include citizen name or phone — only ticket-level
 * facts (ticketNo, category, status, area, age) the user can already see. Same
 * posture as the existing Chief-of-Staff advisor. Aggregate-only (DPDP/ECI).
 */

import { JWTPayload, getComplaintScopeFilter } from '@/lib/jwt';
import { canMutateComplaints, complaintInScope } from '@/lib/rbac';
import { db } from '@/lib/db';
import { computeIntelligenceBrief } from '@/lib/intelligence';
import { NAV_DESTINATIONS, WRITE_TOOL_NAMES } from './shared';

export interface ToolCtx {
  payload: JWTPayload;
  token: string;
  origin: string;
}

type ToolDef = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };

// Navigation destinations + write-tool names live in ./shared (client-safe); re-export.
export { NAV_DESTINATIONS, WRITE_TOOL_NAMES };

// ── helpers ──
const cap = (s: string, n: number) => (s && s.length > n ? s.slice(0, n) + '…' : s);
// Normalise an area name so "Manbazar 1" / "Manbazar I" / "Manbazar-I" all match.
const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5' };
// Minimal Devanagari/Bengali → Latin phonetic map: spoken place names get
// transcribed in Hindi/Bengali script but the DB stores Latin names, so we
// transliterate before matching (e.g. "बालিগুমা"/"বালিগুমা" → "baliguma").
const INDIC: Record<string, string> = {
  'अ':'a','आ':'a','इ':'i','ई':'i','उ':'u','ऊ':'u','ऋ':'ri','ए':'e','ऐ':'ai','ओ':'o','औ':'au',
  'ा':'a','ि':'i','ी':'i','ु':'u','ू':'u','ृ':'ri','े':'e','ै':'ai','ो':'o','ौ':'au','ं':'n','ँ':'n','ः':'h','्':'',
  'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng','च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'n','ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th','द':'d','ध':'dh','न':'n','प':'p','फ':'ph','ब':'b','भ':'bh','म':'m','य':'y','र':'r','ल':'l','ळ':'l','व':'v','श':'sh','ष':'sh','स':'s','ह':'h','ड़':'r','ढ़':'rh','क़':'q','ज़':'z','फ़':'f',
  'অ':'o','আ':'a','ই':'i','ঈ':'i','উ':'u','ঊ':'u','ঋ':'ri','এ':'e','ঐ':'oi','ও':'o','ঔ':'ou',
  'া':'a','ি':'i','ী':'i','ু':'u','ূ':'u','ৃ':'ri','ে':'e','ৈ':'oi','ো':'o','ৌ':'ou','ং':'ng','ঁ':'n','ঃ':'h','্':'',
  'ক':'k','খ':'kh','গ':'g','ঘ':'gh','ঙ':'ng','চ':'ch','ছ':'chh','জ':'j','ঝ':'jh','ঞ':'n','ট':'t','ঠ':'th','ড':'d','ঢ':'dh','ণ':'n','ত':'t','থ':'th','দ':'d','ধ':'dh','ন':'n','প':'p','ফ':'ph','ব':'b','ভ':'bh','ম':'m','য':'j','র':'r','ল':'l','শ':'sh','ষ':'sh','স':'s','হ':'h','ড়':'r','ঢ়':'rh','য়':'y','ৎ':'t',
};
const translit = (s: string) => { let o = ''; for (const ch of String(s || '')) o += (INDIC[ch] !== undefined ? INDIC[ch] : ch); return o; };
// Normalise + transliterate + collapse repeated letters (so vowel-length differences
// like "baligumaa" vs "baliguma" still match).
const normArea = (s: string) => translit(s).toLowerCase().replace(/[-_]/g, ' ').replace(/\b(i{1,3}|iv|v)\b/g, (m) => ROMAN[m] || m).replace(/[^a-z0-9]+/g, ' ').trim().replace(/(.)\1+/g, '$1');
const areaMatch = (field: unknown, target: string) => { if (!field || !target) return false; const n = normArea(String(field)); return n.includes(target) || (n.length >= 3 && target.includes(n)); };

// ── Guarded text-to-SQL (ask_data) ──
// The LLM never sees the raw table: it can only query CTE `c` (already scope-
// filtered + PII-FREE — no name/phone/description) and `n` (AI signal). Plus
// SELECT-only + table-allowlist + blocklist + read-only wrap + LIMIT.
const SQL_COLS = 'id, "ticketNo" AS ticket, category, status, urgency, block, village, district, assembly_constituency AS ac, gp_code, "createdAt" AS created_at, "resolvedAt" AS resolved_at';

/** Build the scope predicate as SQL from the (column-allowlisted) scope filter. Values are escaped. */
function scopeToSql(payload: JWTPayload): string {
  const f = getComplaintScopeFilter(payload) as Record<string, any>;
  const allow = new Set(['assembly_constituency', 'parliamentary_constituency', 'district', 'block', 'gp_code', 'village']);
  const esc = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;
  const parts: string[] = [];
  for (const k of Object.keys(f)) {
    if (!allow.has(k)) continue;
    const val = f[k];
    if (val && typeof val === 'object' && Array.isArray(val.in)) parts.push(`${k} IN (${val.in.map(esc).join(', ') || "''"})`);
    else parts.push(`${k} = ${esc(val)}`);
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

/** Validate an LLM-generated inner SELECT. Returns cleaned SQL or null if unsafe. */
function validateInnerSql(sql: string): string | null {
  let s = (sql || '').trim().replace(/;+\s*$/g, '');
  if (!s || s.length > 1500) return null;
  if (/[;]/.test(s) || /--|\/\*|\*\//.test(s)) return null;       // no multi-stmt / comments
  const low = s.toLowerCase();
  if (!low.startsWith('select')) return null;
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|into|merge|call|vacuum|analyze|set|begin|commit|rollback|comment|reindex|do|lock|listen)\b/.test(low)) return null;
  if (/pg_|information_schema|pg_catalog|current_setting|current_user|session_user/.test(low)) return null;
  // every FROM/JOIN target must be c or n (subqueries `from (` are not captured → allowed)
  const re = /\b(?:from|join)\s+("?[a-zA-Z_][\w".]*"?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) { const id = m[1].replace(/"/g, '').toLowerCase(); if (id !== 'c' && id !== 'n') return null; }
  return s;
}

const DS_KEY = process.env.DEEPSEEK_API_KEY || '';
const DS_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DS_BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
async function genSql(question: string): Promise<string | null> {
  if (!DS_KEY) return null;
  const sys = `You write ONE PostgreSQL SELECT to answer a question about civic grievance complaints.
You may ONLY use these two already-provided tables (do NOT reference any other table or schema):
  c(id, ticket, category, status, urgency, block, village, district, ac, gp_code, created_at, resolved_at)  -- one row per complaint, already scoped to the user's area
  n(complaint_id, anger_score, emotion, root_cause, root_cause_key)  -- AI text signal; join with: n.complaint_id = c.id
RULES: SELECT only. Use only tables c and n. No semicolons, no comments, no INTO, no CTEs of your own, one statement. Prefer GROUP BY + counts + ORDER BY. status ∈ {OPEN,IN_PROGRESS,REGISTERED,ASSIGNED,RESOLVED,REJECTED}; urgency ∈ {CRITICAL,HIGH,MEDIUM,LOW}. Output ONLY the SQL.`;
  try {
    const res = await fetch(`${DS_BASE}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DS_KEY}` }, body: JSON.stringify({ model: DS_MODEL, temperature: 0, max_tokens: 400, messages: [{ role: 'system', content: sys }, { role: 'user', content: question }] }) });
    if (!res.ok) return null;
    const j = await res.json();
    const out = j?.choices?.[0]?.message?.content?.trim() || '';
    return out.replace(/```sql/gi, '').replace(/```/g, '').trim() || null;
  } catch { return null; }
}
const daysOld = (d: unknown) => {
  const t = d instanceof Date ? d.getTime() : typeof d === 'string' ? Date.parse(d) : NaN;
  return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 86400000));
};

/** Reuse an existing scope-locked API route as a tool (token carries the scope). */
async function callRoute(ctx: ToolCtx, path: string): Promise<any> {
  try {
    const r = await fetch(`${ctx.origin}${path}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      cache: 'no-store',
    });
    if (!r.ok) return { error: `route ${path} -> HTTP ${r.status}` };
    const j = await r.json();
    return j?.data ?? j;
  } catch (e) {
    return { error: `route ${path} failed: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}

// ── READ tool executors (scope-locked) ──
const READ_EXEC: Record<string, (args: any, ctx: ToolCtx) => Promise<any>> = {
  async get_overview(_args, ctx) {
    const b = await computeIntelligenceBrief(ctx.payload);
    return {
      scope: b.scope.label,
      riskIndex: { score: b.riskIndex.score, grade: b.riskIndex.grade, drivers: b.riskIndex.drivers.slice(0, 4) },
      kpis: {
        total: b.kpis.total, active: b.kpis.active, critical: b.kpis.critical, resolved: b.kpis.resolved,
        slaBreached: b.kpis.slaBreached, resolutionRate: b.kpis.resolutionRate,
        last7: b.kpis.filed7, momentumPct: b.kpis.momentumPct,
      },
      topHotspots: b.hotspots.slice(0, 6).map((h) => ({ name: h.name, active: h.active, critical: h.critical, risk: h.risk })),
      surges: b.categorySurges.slice(0, 4).map((s) => ({ category: s.category, pctChange: s.pctChange })),
      warnings: b.warnings.slice(0, 4).map((w) => ({ severity: w.severity, title: w.title })),
    };
  },

  async search_complaints(args, ctx) {
    const where: Record<string, unknown> = {};
    if (typeof args.status === 'string') where.status = args.status.toUpperCase();
    if (typeof args.urgency === 'string') where.urgency = args.urgency.toUpperCase();
    if (typeof args.category === 'string') where.category = args.category.toUpperCase();
    const and: any[] = [];
    if (typeof args.area === 'string' && args.area.trim()) {
      const a = normArea(args.area) || args.area.trim();
      and.push({ OR: [{ block: { contains: a, mode: 'insensitive' } }, { village: { contains: a, mode: 'insensitive' } }] });
    }
    if (typeof args.query === 'string' && args.query.trim()) {
      const q = args.query.trim();
      and.push({ OR: [{ description: { contains: q, mode: 'insensitive' } }, { ticketNo: { contains: q, mode: 'insensitive' } }] });
    }
    if (and.length) where.AND = and;
    // scope filter LAST — cannot be broadened by args
    Object.assign(where, getComplaintScopeFilter(ctx.payload));

    const limit = Math.min(20, Math.max(1, Number(args.limit) || 8));
    const rows: any[] = await db.complaint.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit });
    return {
      count: rows.length,
      complaints: rows.map((c) => ({
        ticketNo: c.ticketNo, status: c.status, urgency: c.urgency, category: c.category,
        area: c.village || c.block || c.district || '', daysOld: daysOld(c.createdAt),
        issue: cap(String(c.description || ''), 90),
      })),
    };
  },

  async get_complaint(args, ctx) {
    const ticketNo = String(args.ticketNo || '').trim();
    if (!ticketNo) return { error: 'ticketNo required' };
    const c: any = await db.complaint.findFirst({ where: { ticketNo: { equals: ticketNo, mode: 'insensitive' } } });
    if (!c) return { error: `No complaint ${ticketNo} found` };
    if (!complaintInScope(ctx.payload, c)) return { error: 'That ticket is outside your jurisdiction' };
    let assignedTo: string | null = null;
    if (c.assignedToId) {
      const u = await db.user.findUnique({ where: { id: c.assignedToId } }).catch(() => null);
      assignedTo = u?.name || null;
    }
    return {
      ticketNo: c.ticketNo, status: c.status, urgency: c.urgency, category: c.category,
      area: [c.village, c.block, c.district].filter(Boolean).join(', '),
      issue: cap(String(c.description || ''), 240), daysOld: daysOld(c.createdAt),
      assignedTo, resolution: c.resolution ? cap(String(c.resolution), 160) : null,
    };
  },

  async area_breakdown(args, ctx) {
    const area = String(args.area || '').trim();
    if (!area) return { error: 'area required' };
    const rows: any[] = await db.complaint.findMany({ where: getComplaintScopeFilter(ctx.payload), take: 3000, select: { block: true, village: true, category: true, status: true, urgency: true } });
    const target = normArea(area);
    if (!target) return { area, total: 0, note: 'Could not recognise that area name — try the Latin spelling (e.g. "Baliguma") instead.' };
    const matched = rows.filter((r) => areaMatch(r.block, target) || areaMatch(r.village, target));
    if (matched.length === 0) return { area, total: 0, note: 'No complaints in this area (or it is outside your scope).' };
    const byCat: Record<string, number> = {}; const byStatus: Record<string, number> = {};
    let active = 0, critical = 0;
    const ACTIVE_S = ['OPEN', 'IN_PROGRESS', 'REGISTERED', 'ASSIGNED'];
    for (const r of matched) {
      const c = String(r.category || 'OTHER'); byCat[c] = (byCat[c] || 0) + 1;
      const s = String(r.status || ''); byStatus[s] = (byStatus[s] || 0) + 1;
      if (ACTIVE_S.includes(s)) active++;
      if (r.urgency === 'CRITICAL') critical++;
    }
    const byCategory = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([category, count]) => ({ category, count }));
    return { area, total: matched.length, active, critical, topCategory: byCategory[0]?.category, byCategory, byStatus };
  },

  // General analytics primitive — covers the long tail of "count X by Y (filtered, time-bound)" questions.
  async query_complaints(args, ctx) {
    const groupBy = String(args.groupBy || 'category');
    const metric = String(args.metric || 'count');
    const timeRange = String(args.timeRange || 'all');
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
    const where: Record<string, unknown> = {};
    if (typeof args.status === 'string') where.status = args.status.toUpperCase();
    if (typeof args.urgency === 'string') where.urgency = args.urgency.toUpperCase();
    if (typeof args.category === 'string') where.category = args.category.toUpperCase();
    const days = timeRange === 'last7' ? 7 : timeRange === 'last30' ? 30 : timeRange === 'last90' ? 90 : 0;
    if (days > 0) where.createdAt = { gte: new Date(Date.now() - days * 86400000) };
    Object.assign(where, getComplaintScopeFilter(ctx.payload)); // scope LAST

    const rows: any[] = await db.complaint.findMany({ where, take: 4000, select: { block: true, village: true, district: true, assembly_constituency: true, category: true, status: true, urgency: true, createdAt: true } });
    let data = rows;
    if (typeof args.area === 'string' && args.area.trim()) { const t = normArea(args.area); data = t ? rows.filter((r) => areaMatch(r.block, t) || areaMatch(r.village, t)) : []; }

    const ACTIVE_S = ['OPEN', 'IN_PROGRESS', 'REGISTERED', 'ASSIGNED'];
    const inMetric = (r: any) => metric === 'active' ? ACTIVE_S.includes(String(r.status)) : metric === 'critical' ? r.urgency === 'CRITICAL' : metric === 'resolved' ? String(r.status) === 'RESOLVED' : true;
    const subGroupBy = typeof args.subGroupBy === 'string' ? args.subGroupBy : '';
    const dimOf = (r: any, g: string): string => {
      if (g === 'month') { const d = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt); return isNaN(d.getTime()) ? 'unknown' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
      if (!g || g === 'none') return 'total';
      const v = r[g]; return v ? String(v) : '—';
    };
    const keyOf = (r: any): string => { const a = dimOf(r, groupBy); const b = subGroupBy ? dimOf(r, subGroupBy) : ''; return b ? `${a} › ${b}` : a; };
    const agg: Record<string, number> = {};
    let total = 0;
    for (const r of data) { if (!inMetric(r)) continue; total++; const k = keyOf(r); agg[k] = (agg[k] || 0) + 1; }
    const monthSort = (groupBy === 'month' || subGroupBy === 'month') && !(groupBy !== 'month' && subGroupBy !== 'month');
    const groups = Object.entries(agg)
      .sort((a, b) => monthSort ? a[0].localeCompare(b[0]) : b[1] - a[1])
      .slice(0, limit).map(([key, value]) => ({ key, value }));
    return { groupBy, subGroupBy: subGroupBy || undefined, metric, timeRange, total, groups };
  },

  async ask_data(args, ctx) {
    const question = String(args.question || '').trim();
    if (!question) return { error: 'question required' };
    const inner0 = await genSql(question);
    if (!inner0) return { error: 'Could not generate a query right now.' };
    const inner = validateInnerSql(inner0);
    if (!inner) return { error: 'That query was not safe to run — rephrase, or use a specific tool.', attempted: inner0.slice(0, 160) };
    const scope = scopeToSql(ctx.payload);
    const sql = `WITH c AS (SELECT ${SQL_COLS} FROM complaints WHERE ${scope}), n AS (SELECT complaint_id, anger_score, emotion, root_cause, root_cause_key FROM complaint_nlp) SELECT * FROM ( ${inner} ) _q LIMIT 200`;
    try {
      const rows = (await db.$queryRawUnsafe(sql)) as any[];
      const clean = rows.slice(0, 50).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
      return { sql: inner, rowCount: rows.length, rows: clean };
    } catch (e) {
      return { error: 'Query failed — rephrase.', detail: e instanceof Error ? e.message.slice(0, 140) : 'unknown' };
    }
  },

  async top_hotspots(_args, ctx) {
    const b = await computeIntelligenceBrief(ctx.payload);
    return { by: b.scope.subAreaLabel, hotspots: b.hotspots.slice(0, 8).map((h) => ({ name: h.name, active: h.active, critical: h.critical, slaBreached: h.slaBreached, risk: h.risk })) };
  },

  async get_forecast(_args, ctx) {
    const d = await callRoute(ctx, '/api/intelligence/forecast');
    if (d?.error) return d;
    return { trajectory: d.trajectory, level: d.level, momentum: d.momentum, weeksOfHistory: d.weeksOfHistory, slaRisk: d.slaRisk?.counts, topAreas: (d.areaSignals || []).slice(0, 5), message: d.message };
  },

  async get_nlp_insights(_args, ctx) {
    const d = await callRoute(ctx, '/api/intelligence/nlp-insights');
    if (d?.error) return d;
    return { coverage: d.coverage, clusters: (d.clusters || []).slice(0, 8), angerHotspots: (d.angerHotspots || []).slice(0, 6), entityWatch: (d.entityWatch || []).slice(0, 8), severityFlags: d.severityFlags };
  },

  async get_priority_areas(_args, ctx) {
    const d = await callRoute(ctx, '/api/intelligence/fusion');
    if (d?.error) return d;
    return {
      grain: d.nodeGrain,
      areas: (d.nodes || []).slice(0, 8).map((n: any) => ({
        name: n.name, grade: n.priority?.grade, score: n.priority?.score,
        active: n.grievance?.active, anger: n.sentiment?.avgAnger, schemeFailPct: n.schemeGrievance?.pct,
        topCauses: (n.topCauses || []).slice(0, 3).map((c: any) => `${c.rootCause} (${c.count})`),
      })),
    };
  },

  async get_network(_args, ctx) {
    const d = await callRoute(ctx, '/api/intelligence/network');
    if (d?.error) return d;
    return { weakestLinks: (d.weakestLinks || []).slice(0, 8) };
  },

  async get_pending_actions(_args, ctx) {
    const d = await callRoute(ctx, '/api/intelligence/operations');
    if (d?.error) return d;
    return { proposed: d.stats?.proposed, items: (d.items || []).slice(0, 8).map((i: any) => ({ title: i.title, area: i.area, type: i.actionType, ticketNo: i.ticketNo, why: i.why })) };
  },

  async get_leaderboard(_args, ctx) {
    const d = await callRoute(ctx, '/api/leaderboard');
    if (d?.error) return d;
    const arr = Array.isArray(d) ? d : d.officers || d.leaderboard || [];
    return { officers: arr.slice(0, 10) };
  },

  async list_team(_args, ctx) {
    const d = await callRoute(ctx, '/api/users');
    if (d?.error) return d;
    const arr = Array.isArray(d) ? d : d.users || [];
    return { count: arr.length, team: arr.slice(0, 25).map((u: any) => ({ name: u.name, role: u.role_level || u.role, area: u.block || u.gp_name || u.constituency || '', active: u.isActive })) };
  },
};

export async function executeReadTool(name: string, args: any, ctx: ToolCtx): Promise<any> {
  const fn = READ_EXEC[name];
  if (!fn) return { error: `unknown tool ${name}` };
  try { return await fn(args || {}, ctx); }
  catch (e) { return { error: `${name} failed: ${e instanceof Error ? e.message : 'unknown'}` }; }
}

export const READ_TOOL_NAMES = new Set(Object.keys(READ_EXEC));

// ── Tool schemas (OpenAI function-calling format), role-filtered ──
export function getToolSchemas(payload: JWTPayload): ToolDef[] {
  const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDef => ({
    type: 'function', function: { name, description, parameters: { type: 'object', properties, required } },
  });

  const tools: ToolDef[] = [
    fn('get_overview', 'Headline KPIs + risk index + top hotspots + surges for the user\'s jurisdiction. Use for "summary / status / aaj kya situation hai".'),
    fn('search_complaints', 'Search complaints in the user\'s jurisdiction. Filters are optional.', {
      status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'REGISTERED', 'ASSIGNED', 'RESOLVED', 'REJECTED'] },
      urgency: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
      category: { type: 'string', description: 'e.g. WATER, ROAD, ELECTRICITY, HEALTH, RATION, PENSION' },
      area: { type: 'string', description: 'block / village / GP name to filter by' },
      query: { type: 'string', description: 'free text to match in issue or ticket number' },
      limit: { type: 'number', description: 'max rows (default 8, max 20)' },
    }),
    fn('get_complaint', 'Full details of one complaint by ticket number.', { ticketNo: { type: 'string' } }, ['ticketNo']),
    fn('area_breakdown', 'Total complaint count + top category + status split for ONE block/GP/village. Use for "X block/area mein kitni complaints / kaun si category sabse zyada".', { area: { type: 'string', description: 'block, GP, or village name (numeral-safe: "Manbazar 1" matches "Manbazar I")' } }, ['area']),
    fn('query_complaints', 'Flexible analytics over complaints in scope: count/active/critical/resolved grouped by a dimension, optionally filtered + time-bounded. Use for "category-wise / block-wise / month-wise kitni", trends, "is mahine", comparisons, leaderboards by area.', {
      groupBy: { type: 'string', enum: ['category', 'block', 'village', 'status', 'urgency', 'assembly_constituency', 'district', 'month', 'none'], description: 'primary dimension to group by' },
      subGroupBy: { type: 'string', enum: ['category', 'block', 'village', 'status', 'urgency', 'district', 'month'], description: 'optional second dimension for a cross-tab, e.g. block × category' },
      metric: { type: 'string', enum: ['count', 'active', 'critical', 'resolved'], description: 'what to measure (default count)' },
      status: { type: 'string' }, urgency: { type: 'string' }, category: { type: 'string' }, area: { type: 'string', description: 'optional block/village filter (numeral-safe)' },
      timeRange: { type: 'string', enum: ['last7', 'last30', 'last90', 'all'], description: 'time window (default all)' },
      limit: { type: 'number', description: 'top N groups (default 10)' },
    }, ['groupBy']),
    fn('ask_data', 'FALLBACK for open-ended data questions the other tools cannot answer (unusual cross-cuts, ratios, "which X has highest avg anger", multi-condition aggregates). Runs a SAFE read-only, scope-locked aggregate query. Use get_overview / query_complaints / area_breakdown / search_complaints FIRST; only use ask_data when they do not fit.', { question: { type: 'string', description: 'the exact data question in plain language' } }, ['question']),
    fn('top_hotspots', 'Ranked hotspot areas by active/critical/risk.'),
    fn('get_forecast', 'Volume trajectory + SLA-breach risk (early-warning).'),
    fn('get_nlp_insights', 'AI text intelligence: root-cause clusters, anger hotspots, recurring entities (the "Brain").'),
    fn('get_priority_areas', 'Per-area fused priority ranking: grievance + anger + scheme-failure (the "Entity 360").'),
    fn('get_network', 'Escalation chain weakest links — where backlog is stuck.'),
    fn('get_pending_actions', 'Proposed action queue (what to do today).'),
    fn('get_leaderboard', 'Officer performance ranking.'),
    fn('navigate', 'Open/navigate to a page in the app for the user. Use when they say "open / show / go to / kholo / dikhao <page>".', {
      destination: { type: 'string', enum: NAV_DESTINATIONS.map((d) => d.id), description: 'which page to open' },
    }, ['destination']),
  ];

  // team listing only for roles that may view users
  if (payload.role_level !== 'KARYAKARTA' && payload.role_level !== 'OFFICER') {
    tools.push(fn('list_team', 'List the team/officers under the user\'s jurisdiction.', { role: { type: 'string', description: 'optional role filter' } }));
  }

  // write tools only if the role may mutate complaints — model PROPOSES, human confirms
  if (canMutateComplaints(payload)) {
    tools.push(
      fn('assign_officer', 'Propose assigning an officer to a complaint (needs user confirmation before it runs).', { ticketNo: { type: 'string' }, officer: { type: 'string', description: 'officer name or id' } }, ['ticketNo', 'officer']),
      fn('update_status', 'Propose changing a complaint status / resolving it (needs user confirmation).', { ticketNo: { type: 'string' }, status: { type: 'string', enum: ['IN_PROGRESS', 'RESOLVED', 'REJECTED', 'OPEN'] }, resolutionNote: { type: 'string' } }, ['ticketNo', 'status']),
      fn('escalate_complaint', 'Propose escalating a complaint one urgency level (needs user confirmation).', { ticketNo: { type: 'string' } }, ['ticketNo']),
      fn('add_note', 'Propose adding an internal note/comment to a complaint (needs user confirmation).', { ticketNo: { type: 'string' }, note: { type: 'string', description: 'the note text' } }, ['ticketNo', 'note']),
      fn('reopen_complaint', 'Propose reopening a resolved/rejected complaint (needs user confirmation).', { ticketNo: { type: 'string' } }, ['ticketNo']),
    );
  }

  return tools;
}

// ── Gemini (Live) function declarations — convert OpenAI schemas → Gemini Schema ──
function toGeminiSchema(s: any): any {
  if (!s || typeof s !== 'object') return s;
  const o: any = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'type' && typeof v === 'string') o[k] = (v as string).toUpperCase();
    else if (k === 'properties' && v && typeof v === 'object') o[k] = Object.fromEntries(Object.entries(v as any).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    else if (k === 'items') o[k] = toGeminiSchema(v);
    else o[k] = v;
  }
  return o;
}

export function getGeminiToolDeclarations(payload: JWTPayload): Array<Record<string, unknown>> {
  return getToolSchemas(payload).map((t) => {
    const p = t.function.parameters as any;
    const hasProps = p && p.properties && Object.keys(p.properties).length > 0;
    return { name: t.function.name, description: t.function.description, ...(hasProps ? { parameters: toGeminiSchema(p) } : {}) };
  });
}
