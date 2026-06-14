import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/map/risk — scope-locked geospatial risk data per block (Level 5).
 *
 * Returns one row per block within the caller's jurisdiction with a composite
 * RISK score and AVG ANGER (from complaint_nlp), so the map can render a
 * Palantir-style heatmap. Scope is enforced server-side via
 * getComplaintScopeFilter — same boundary as /api/complaints.
 *
 * Aggregate-only: block-level counts + scores. No individual-citizen data.
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

const ACTIVE = new Set(['OPEN', 'IN_PROGRESS', 'REGISTERED', 'ASSIGNED']);
const SLA_DAYS: Record<string, number> = { CRITICAL: 0.25, HIGH: 1, MEDIUM: 3, LOW: 7 };

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const where = getComplaintScopeFilter(payload);
    const complaints: C[] = await db.complaint.findMany({ where, orderBy: { createdAt: 'desc' }, take: 3000 });

    // Anger per complaint id (from NLP enrichment)
    const ids = complaints.map(c => str(c, 'id')).filter(Boolean);
    const angerById = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase
        .from('complaint_nlp')
        .select('complaint_id, anger_score')
        .in('complaint_id', ids.slice(i, i + 200));
      for (const r of (data || []) as C[]) {
        const a = typeof r.anger_score === 'number' ? r.anger_score : 0;
        angerById.set(str(r, 'complaint_id'), a);
      }
    }

    const now = Date.now();
    type Blk = {
      district: string; block: string; constituency: string | null;
      total: number; active: number; resolved: number; critical: number; slaBreached: number;
      angerSum: number; angerN: number; cats: Record<string, number>;
    };
    const blocks: Record<string, Blk> = {};

    for (const c of complaints) {
      const block = str(c, 'block');
      if (!block) continue;
      const district = str(c, 'district');
      const key = `${district}||${block}`;
      if (!blocks[key]) blocks[key] = {
        district, block,
        constituency: str(c, 'assembly_constituency', 'assemblyConstituency', 'constituency') || null,
        total: 0, active: 0, resolved: 0, critical: 0, slaBreached: 0, angerSum: 0, angerN: 0, cats: {},
      };
      const b = blocks[key];
      b.total++;
      const status = str(c, 'status');
      const urgency = str(c, 'urgency');
      const isActive = ACTIVE.has(status);
      if (isActive) b.active++;
      if (status === 'RESOLVED') b.resolved++;
      if (urgency === 'CRITICAL' && isActive) b.critical++;
      const created = dt(c.createdAt);
      if (isActive && created && now - created.getTime() > (SLA_DAYS[urgency] || 3) * 86400000) b.slaBreached++;
      const cat = (str(c, 'category') || 'OTHER').toUpperCase();
      b.cats[cat] = (b.cats[cat] || 0) + 1;
      const anger = angerById.get(str(c, 'id'));
      if (anger !== undefined) { b.angerSum += anger; b.angerN++; }
    }

    const out = Object.values(blocks).map(b => {
      const activeRatio = b.total ? b.active / b.total : 0;
      const slaRatio = b.active ? b.slaBreached / b.active : 0;
      const avgAnger = b.angerN ? Math.round(b.angerSum / b.angerN) : null;
      const risk = Math.round(
        activeRatio * 35 + slaRatio * 25 + Math.min(1, b.critical / 3) * 20 + (avgAnger !== null ? avgAnger / 100 : 0) * 20
      );
      return {
        district: b.district, block: b.block, constituency: b.constituency,
        total: b.total, active: b.active, resolved: b.resolved, critical: b.critical, slaBreached: b.slaBreached,
        resolutionRate: b.total ? Math.round((b.resolved / b.total) * 100) : 0,
        avgAnger, angerRated: b.angerN, risk, cats: b.cats,
      };
    }).sort((a, b) => b.risk - a.risk);

    return NextResponse.json({ data: out, scope: { level: payload.role_level || payload.role } });
  } catch (err) {
    console.error('Map risk error:', err);
    return NextResponse.json({ error: 'Failed to load risk map' }, { status: 500 });
  }
}
