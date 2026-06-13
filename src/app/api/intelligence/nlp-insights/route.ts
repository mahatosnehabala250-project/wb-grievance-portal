import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';
import { nlpEnabled } from '@/lib/nlp/enrich';

/**
 * GET /api/intelligence/nlp-insights — NLP Brain aggregates, scope-locked.
 *
 * Reads the AI-enriched signal (complaint_nlp) for ONLY the complaints in the
 * caller's jurisdiction (same getComplaintScopeFilter boundary) and rolls it up:
 *   - Root-cause clusters: "8 complaints share ONE broken pump" → fix once, resolve many
 *   - Anger hotspots: sub-areas ranked by avg citizen anger (not just volume)
 *   - Entity watch: officers / schemes / infrastructure named repeatedly
 *   - Emotion mix + severity flags + coverage
 *
 * AGGREGATE ONLY — clusters and hotspots, never individual-citizen profiling.
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

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    // Scoped complaints (the security boundary)
    const where = getComplaintScopeFilter(payload);
    const complaints: C[] = await db.complaint.findMany({ where, orderBy: { createdAt: 'desc' }, take: 2000 });
    const byId = new Map<string, C>();
    for (const c of complaints) byId.set(str(c, 'id'), c);
    const ids = [...byId.keys()];

    if (ids.length === 0) {
      return NextResponse.json({ data: { enabled: nlpEnabled(), coverage: { total: 0, enriched: 0 }, clusters: [], angerHotspots: [], entityWatch: [], emotionMix: [], severityFlags: [] } });
    }

    // Pull NLP rows for these complaints (chunk the IN clause to be safe)
    const nlpRows: C[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data } = await supabase
        .from('complaint_nlp')
        .select('complaint_id, anger_score, emotion, root_cause, root_cause_key, entities, severity_flags')
        .in('complaint_id', chunk);
      if (data) nlpRows.push(...(data as unknown as C[]));
    }

    // ── Root-cause clusters ──
    const clusters: Record<string, {
      key: string; rootCause: string; count: number; villages: Set<string>;
      tickets: string[]; angerSum: number; angerN: number;
    }> = {};
    // ── Anger by sub-area ──
    const areaAnger: Record<string, { sum: number; n: number; max: number }> = {};
    // ── Entity frequency ──
    const entityFreq: Record<string, Record<string, number>> = { officers: {}, schemes: {}, infrastructure: {} };
    const emotionFreq: Record<string, number> = {};
    const flagFreq: Record<string, number> = {};

    const subAreaOf = (c: C): string => {
      const lvl = payload.role_level;
      if (lvl === 'MLA') return str(c, 'block') || 'Unknown';
      if (lvl === 'MP') return str(c, 'assembly_constituency', 'assemblyConstituency', 'constituency') || 'Unknown';
      if (lvl === 'DISTRICT_ADMIN' || payload.role === 'DISTRICT') return str(c, 'block') || 'Unknown';
      return str(c, 'village') || str(c, 'gp_name', 'gpName') || 'Unknown';
    };

    for (const n of nlpRows) {
      const c = byId.get(str(n, 'complaint_id'));
      if (!c) continue;
      const anger = typeof n.anger_score === 'number' ? n.anger_score : 0;
      const key = str(n, 'root_cause_key') || 'unknown';

      if (!clusters[key]) clusters[key] = { key, rootCause: str(n, 'root_cause') || key, count: 0, villages: new Set(), tickets: [], angerSum: 0, angerN: 0 };
      const cl = clusters[key];
      cl.count++;
      const village = str(c, 'village');
      if (village) cl.villages.add(village);
      if (cl.tickets.length < 6) cl.tickets.push(str(c, 'ticketNo'));
      cl.angerSum += anger; cl.angerN++;

      const area = subAreaOf(c);
      if (!areaAnger[area]) areaAnger[area] = { sum: 0, n: 0, max: 0 };
      areaAnger[area].sum += anger; areaAnger[area].n++; areaAnger[area].max = Math.max(areaAnger[area].max, anger);

      const ent = (n.entities || {}) as Record<string, unknown>;
      for (const grp of ['officers', 'schemes', 'infrastructure'] as const) {
        const list = Array.isArray(ent[grp]) ? (ent[grp] as unknown[]) : [];
        for (const e of list) {
          if (typeof e !== 'string' || !e.trim()) continue;
          const norm = e.trim();
          entityFreq[grp][norm] = (entityFreq[grp][norm] || 0) + 1;
        }
      }
      const emo = str(n, 'emotion') || 'neutral';
      emotionFreq[emo] = (emotionFreq[emo] || 0) + 1;
      const flags = Array.isArray(n.severity_flags) ? (n.severity_flags as unknown[]) : [];
      for (const f of flags) if (typeof f === 'string') flagFreq[f] = (flagFreq[f] || 0) + 1;
    }

    const clusterList = Object.values(clusters)
      .filter(c => c.count >= 2)
      .map(c => ({
        rootCause: c.rootCause,
        key: c.key,
        count: c.count,
        villages: [...c.villages].slice(0, 5),
        tickets: c.tickets,
        avgAnger: c.angerN ? Math.round(c.angerSum / c.angerN) : 0,
      }))
      .sort((a, b) => b.count - a.count || b.avgAnger - a.avgAnger)
      .slice(0, 10);

    const angerHotspots = Object.entries(areaAnger)
      .map(([name, a]) => ({ name, avgAnger: a.n ? Math.round(a.sum / a.n) : 0, peakAnger: a.max, count: a.n }))
      .sort((a, b) => b.avgAnger - a.avgAnger)
      .slice(0, 8);

    const entityWatch = (['infrastructure', 'schemes', 'officers'] as const).flatMap(grp =>
      Object.entries(entityFreq[grp])
        .filter(([, n]) => n >= 2)
        .map(([name, n]) => ({ type: grp, name, count: n }))
    ).sort((a, b) => b.count - a.count).slice(0, 10);

    const emotionMix = Object.entries(emotionFreq).map(([emotion, count]) => ({ emotion, count })).sort((a, b) => b.count - a.count);
    const severityFlags = Object.entries(flagFreq).map(([flag, count]) => ({ flag, count })).sort((a, b) => b.count - a.count);

    return NextResponse.json({
      data: {
        enabled: nlpEnabled(),
        coverage: { total: complaints.length, enriched: nlpRows.length },
        clusters: clusterList,
        angerHotspots,
        entityWatch,
        emotionMix,
        severityFlags,
      },
    });
  } catch (err) {
    console.error('NLP insights error:', err);
    return NextResponse.json({ error: 'Failed to load NLP insights' }, { status: 500 });
  }
}
