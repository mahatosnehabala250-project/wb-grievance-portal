export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import { computeIntelligenceBrief } from '@/lib/intelligence';
import { buildContext, askAdvisor, advisorEnabled, NlpContext } from '@/lib/advisor';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/intelligence/advisor — AI Chief-of-Staff.
 * Body: { question: string }
 *
 * Builds a scope-locked factual context (intelligence brief + NLP aggregates
 * for the caller's jurisdiction ONLY) and asks DeepSeek to answer with citations.
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

async function buildNlpContext(scopedComplaints: C[]): Promise<NlpContext | null> {
  const byId = new Map<string, C>();
  for (const c of scopedComplaints) byId.set(str(c, 'id'), c);
  const ids = [...byId.keys()];
  if (ids.length === 0) return null;

  const rows: C[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from('complaint_nlp')
      .select('complaint_id, anger_score, emotion, root_cause, root_cause_key, entities')
      .in('complaint_id', ids.slice(i, i + 200));
    if (data) rows.push(...(data as unknown as C[]));
  }
  if (rows.length === 0) return null;

  const clusters: Record<string, { rootCause: string; count: number; villages: Set<string>; angerSum: number }> = {};
  const areaAnger: Record<string, { sum: number; n: number }> = {};
  const entityFreq: Record<string, number> = {};
  const entityType: Record<string, string> = {};

  for (const n of rows) {
    const c = byId.get(str(n, 'complaint_id'));
    if (!c) continue;
    const anger = typeof n.anger_score === 'number' ? n.anger_score : 0;
    const key = str(n, 'root_cause_key') || 'unknown';
    if (!clusters[key]) clusters[key] = { rootCause: str(n, 'root_cause') || key, count: 0, villages: new Set(), angerSum: 0 };
    clusters[key].count++;
    const v = str(c, 'village'); if (v) clusters[key].villages.add(v);
    clusters[key].angerSum += anger;
    const area = str(c, 'village') || str(c, 'block') || 'Unknown';
    if (!areaAnger[area]) areaAnger[area] = { sum: 0, n: 0 };
    areaAnger[area].sum += anger; areaAnger[area].n++;
    const ent = (n.entities || {}) as Record<string, unknown>;
    for (const grp of ['officers', 'schemes', 'infrastructure'] as const) {
      const list = Array.isArray(ent[grp]) ? (ent[grp] as unknown[]) : [];
      for (const e of list) {
        if (typeof e !== 'string' || !e.trim()) continue;
        entityFreq[e.trim()] = (entityFreq[e.trim()] || 0) + 1;
        entityType[e.trim()] = grp;
      }
    }
  }

  return {
    clusters: Object.values(clusters).filter(c => c.count >= 2)
      .map(c => ({ rootCause: c.rootCause, count: c.count, villages: [...c.villages].slice(0, 4), avgAnger: Math.round(c.angerSum / c.count) }))
      .sort((a, b) => b.count - a.count).slice(0, 6),
    angerHotspots: Object.entries(areaAnger).map(([name, a]) => ({ name, avgAnger: Math.round(a.sum / a.n), count: a.n }))
      .sort((a, b) => b.avgAnger - a.avgAnger).slice(0, 6),
    entityWatch: Object.entries(entityFreq).filter(([, n]) => n >= 2)
      .map(([name, count]) => ({ type: entityType[name] || 'entity', name, count }))
      .sort((a, b) => b.count - a.count).slice(0, 6),
  };
}

export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    if (!advisorEnabled()) {
      return NextResponse.json({ error: 'Advisor not configured — set DEEPSEEK_API_KEY', enabled: false }, { status: 200 });
    }

    const { question } = await request.json();
    if (!question || typeof question !== 'string' || !question.trim()) {
      return NextResponse.json({ error: 'question required' }, { status: 400 });
    }
    if (question.length > 500) {
      return NextResponse.json({ error: 'question too long' }, { status: 400 });
    }

    // Scope-locked facts
    const brief = await computeIntelligenceBrief(payload);
    const scoped: C[] = await db.complaint.findMany({
      where: getComplaintScopeFilter(payload),
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const nlp = await buildNlpContext(scoped);
    const context = buildContext(brief, nlp);

    const answer = await askAdvisor(question.trim(), context);
    if (!answer) {
      return NextResponse.json({ error: 'Advisor could not answer right now' }, { status: 502 });
    }

    return NextResponse.json({ data: { answer, scope: brief.scope.label } });
  } catch (err) {
    console.error('Advisor error:', err);
    return NextResponse.json({ error: 'Advisor failed' }, { status: 500 });
  }
}
