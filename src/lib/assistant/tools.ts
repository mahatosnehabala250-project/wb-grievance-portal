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
      const a = args.area.trim();
      and.push({ OR: [{ block: { contains: a, mode: 'insensitive' } }, { village: { contains: a, mode: 'insensitive' } }, { gp_name: { contains: a, mode: 'insensitive' } }] });
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
