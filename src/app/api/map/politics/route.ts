import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/map/politics — the political overlay layer.
 *
 * Joins VERIFIED 2021 assembly results (election_results_ac — public ECI data)
 * with LIVE grievance load per AC (scope-locked complaints), and computes a
 * Battleground Index: how much each AC deserves attention NOW =
 * electoral tightness (inverse margin%) × unresolved grievance pressure.
 *
 * Election results are public record (no privacy issue). Complaint aggregates
 * are filtered by the caller's jurisdiction like everywhere else. Aggregate-only.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ACTIVE = new Set(['OPEN', 'IN_PROGRESS', 'REGISTERED', 'ASSIGNED']);

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    // Public election results (2021, verified)
    const { data: results, error } = await supabase
      .from('election_results_ac')
      .select('*')
      .eq('year', 2021);
    if (error || !results) return NextResponse.json({ error: 'No election data' }, { status: 500 });

    // Booth-level stats where Form-20 has been ingested (EVM votes; postal not
    // included). w/r = winner-party / runner-up-party candidate votes per booth.
    const { data: boothRows } = await supabase
      .from('election_results_booth')
      .select('ac, w, r')
      .eq('year', 2021);
    const boothStats: Record<string, { booths: number; winnerWon: number; runnerWon: number; razorThin: number }> = {};
    for (const b of (boothRows || []) as Array<{ ac: string; w: number | null; r: number | null }>) {
      if (b.w === null && b.r === null) continue;
      const s = boothStats[b.ac] || (boothStats[b.ac] = { booths: 0, winnerWon: 0, runnerWon: 0, razorThin: 0 });
      s.booths++;
      const w = b.w ?? 0, r = b.r ?? 0;
      if (w > r) s.winnerWon++; else if (r > w) s.runnerWon++;
      if (Math.abs(w - r) <= 25) s.razorThin++;
    }

    // Scope-locked live grievance aggregates per AC
    const rows: Array<Record<string, unknown>> = await db.complaint.findMany({
      where: getComplaintScopeFilter(payload),
      take: 5000,
      select: { assembly_constituency: true, status: true, urgency: true, category: true },
    });
    const byAc: Record<string, { total: number; active: number; critical: number; cats: Record<string, number> }> = {};
    for (const r of rows) {
      const ac = String(r.assembly_constituency || '');
      if (!ac) continue;
      const a = byAc[ac] || (byAc[ac] = { total: 0, active: 0, critical: 0, cats: {} });
      a.total++;
      const st = String(r.status || '');
      if (ACTIVE.has(st)) a.active++;
      if (r.urgency === 'CRITICAL' && ACTIVE.has(st)) a.critical++;
      const c = String(r.category || 'OTHER');
      a.cats[c] = (a.cats[c] || 0) + 1;
    }

    const maxActive = Math.max(1, ...Object.values(byAc).map((a) => a.active));
    const acs = (results as Array<Record<string, unknown>>).map((r) => {
      const ac = String(r.ac);
      const g = byAc[ac] || { total: 0, active: 0, critical: 0, cats: {} };
      const marginPct = Number(r.margin_pct) || 10;
      // Battleground Index 0-100: electoral tightness (60%) + live grievance pressure (40%).
      const tightness = Math.max(0, 1 - marginPct / 10);          // <=10% margin scales; 0.21% ≈ 0.98
      const pressure = g.active / maxActive;
      const battleground = Math.round((tightness * 0.6 + pressure * 0.4) * 100);
      const topCat = Object.entries(g.cats).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      return {
        ac,
        reservation: r.reservation,
        winner: r.winner, winnerParty: r.winner_party, winnerVotes: r.winner_votes,
        runnerUp: r.runnerup, runnerUpParty: r.runnerup_party, runnerUpVotes: r.runnerup_votes,
        margin: r.margin, marginPct,
        grievance: { total: g.total, active: g.active, critical: g.critical, topCategory: topCat },
        battleground,
        booths: boothStats[ac] || null,
      };
    }).sort((a, b) => b.battleground - a.battleground);

    return NextResponse.json({
      data: {
        year: 2021,
        source: 'ECI / Wikipedia (verified per-AC, June 2026)',
        acs,
        note: 'Election results are public record. Complaint numbers are limited to your jurisdiction. Aggregate-only — no individual voter data.',
      },
    });
  } catch (err) {
    console.error('politics layer error:', err);
    return NextResponse.json({ error: 'Failed to load political layer' }, { status: 500 });
  }
}
