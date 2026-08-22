export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';
import { buildHouseholds, householdKey, normVillage, type HouseholdSource } from '@/lib/household';

/**
 * GET /api/households — the MLA's family ledger.
 *
 * Every complaint grouped into the household that filed it (phone first,
 * normalised name+village second — see src/lib/household.ts), each family
 * carrying its own history: how many cases, how many still open, what it
 * asks about, whether it confirmed the work was done.
 *
 * Each household also carries the booths its village maps to, from
 * polling_stations. A village with one booth resolves exactly; with two or
 * three it is a shortlist the karyakarta confirms on his next visit — the
 * question he can answer in one tap, so the app asks him instead of guessing.
 *
 * Scoped exactly like /api/complaints (getComplaintScopeFilter, through the
 * same db adapter, so every role's filter shape — including karyakarta
 * village lists — translates the same way it does everywhere else).
 * RLS on polling_stations has no policies, so reading it needs the
 * service-role client, as in /api/booths.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  try {
    const where = getComplaintScopeFilter(payload);

    // take: 5000 beats PostgREST's silent 1,000-row ceiling — a seat's whole
    // history must be in memory before households can be grouped from it.
    const complaintRows = (await db.complaint.findMany({
      where,
      select: {
        id: true,
        ticketNo: true,
        citizenName: true,
        phone: true,
        village: true,
        gp_name: true,
        block: true,
        status: true,
        category: true,
        satisfactionRating: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    })) as unknown as HouseholdSource[];

    const { households, ungrouped } = buildHouseholds(complaintRows);

    /**
     * Exact booths the field has already confirmed. The assignment alert
     * offers each village's shortlist as buttons; a worker's tap lands in
     * activity_logs as BOOTH_CONFIRMED. Latest confirmation per household
     * wins — the shortlist below is the fallback until someone taps.
     */
    const keyByComplaintId = new Map<string, string>();
    const allIds: string[] = [];
    for (const r of complaintRows as (HouseholdSource & { id?: string })[]) {
      if (!r.id) continue;
      const k = householdKey(r);
      if (k) {
        keyByComplaintId.set(String(r.id), k);
        allIds.push(String(r.id));
      }
    }
    const confirmedBooth = new Map<string, string>();
    for (let i = 0; i < allIds.length; i += 100) {
      const { data: logs } = await supabase
        .from('activity_logs')
        .select('complaintId, metadata')
        .eq('action', 'BOOTH_CONFIRMED')
        .in('complaintId', allIds.slice(i, i + 100))
        .order('createdAt', { ascending: false })
        .range(0, 999);
      for (const log of logs || []) {
        const key = keyByComplaintId.get(String(log.complaintId));
        if (!key || confirmedBooth.has(key)) continue;
        try {
          const meta = JSON.parse(String(log.metadata || '{}'));
          if (meta.boothNo) confirmedBooth.set(key, String(meta.boothNo));
        } catch { /* a malformed row must not sink the ledger */ }
      }
    }


    // Booth shortlists for every village that appears in the ledger.
    //
    // Complaints carry LGD spellings, polling_stations ECI ones ("Majura" vs
    // "Majuramura"), and their village_code spaces barely overlap (5 of 42
    // in Purulia), so names are matched in two passes: exact first, then
    // containment either way for the suffix-heavy ECI forms (-pur, -dih,
    // -mur). Multi-match is fine — that is a shortlist the worker confirms
    // with one tap. Page past PostgREST's 1,000-row ceiling: 2,802 booths.
    const villages = new Set(households.map((h) => normVillage(h.village)).filter(Boolean));
    const boothByVillage = new Map<string, { ps_no: string; booth: string }[]>();
    if (villages.size) {
      const boothList: { ps_no: unknown; ps_name: unknown; v1: string; v2: string }[] = [];
      for (let off = 0; off < 4000; off += 1000) {
        const { data: page } = await supabase
          .from('polling_stations')
          .select('ps_no, ps_name, village_name, village_raw')
          .range(off, off + 999);
        if (!page?.length) break;
        for (const b of page) {
          boothList.push({
            ps_no: b.ps_no,
            ps_name: b.ps_name,
            v1: normVillage(b.village_name as string).replace(/[\s-]/g, ''),
            v2: normVillage(b.village_raw as string).replace(/[\s-]/g, ''),
          });
        }
        if (page.length < 1000) break;
      }
      const compact = (s: string | null | undefined) =>
        String(s ?? '').trim().toLowerCase().replace(/[\s-]/g, '');
      const seen = new Set<string>();
      for (const v of villages) {
        const vc = compact(v);
        if (!vc || seen.has(vc)) continue;
        seen.add(vc);
        let hits = boothList.filter((b) => b.v1 === vc || b.v2 === vc);
        if (!hits.length) {
          hits = boothList.filter(
            (b) =>
              (vc.length >= 4 && b.v1.length >= 4 && (b.v1.includes(vc) || vc.includes(b.v1))) ||
              (vc.length >= 4 && b.v2.length >= 4 && (b.v2.includes(vc) || vc.includes(b.v2))),
          );
        }
        const list = hits
          .filter((x, i, arr) => arr.findIndex((y) => y.ps_no === x.ps_no) === i)
          .slice(0, 4)
          .map((b) => ({ ps_no: String(b.ps_no), booth: String(b.ps_name || '').slice(0, 60) }));
        if (list.length) boothByVillage.set(v, list);
      }
    }

    /**
     * Field surveys, stitched by the same key the survey was filed under.
     * Newest per household wins; a missing table (migration not yet applied)
     * simply reads as "no surveys yet" rather than sinking the ledger.
     */
    const { data: surveyRows, error: surveyErr } = await supabase
      .from('household_surveys')
      .select('household_key, voters_count, leaning, booth_no, created_at')
      .order('created_at', { ascending: false })
      .range(0, 4999);
    const surveyByKey = new Map<string, { voters: number | null; leaning: string | null; booth: string | null; at: string }>();
    if (!surveyErr && surveyRows) {
      for (const s of surveyRows) {
        const k = String(s.household_key || '');
        if (!k || surveyByKey.has(k)) continue;
        surveyByKey.set(k, {
          voters: s.voters_count ?? null,
          leaning: s.leaning ?? null,
          booth: s.booth_no ?? null,
          at: String(s.created_at || ''),
        });
      }
    }

    const out = households.map((h) => {
      // boothByVillage is keyed by normVillage, but matching above ran on
      // compacted (space/hyphen-stripped) forms; look up with the same fold.
      const key = normVillage(h.village);
      const cands = boothByVillage.get(key) ||
        boothByVillage.get(key.replace(/[\s-]/g, '')) || [];
      const survey = surveyByKey.get(h.key) || null;
      return {
        ...h,
        confirmedBooth: confirmedBooth.get(h.key) || survey?.booth || null,
        votersCount: survey?.voters ?? null,
        leaning: survey?.leaning ?? null,
        lastSurveyAt: survey?.at || null,
        boothCandidates: cands.slice(0, 4),
      };
    });

    const summary = {
      households: out.length,
      ungrouped,
      withPhone: out.filter((h) => h.phone).length,
      multiCase: out.filter((h) => h.total > 1).length,
      rated: out.filter((h) => h.ratings.length > 0).length,
      surveyed: out.filter((h) => h.lastSurveyAt).length,
      leaningPositive: out.filter((h) => h.leaning === 'POSITIVE').length,
      boothConfirmed: out.filter((h) => h.confirmedBooth).length,
      boothResolved: out.filter((h) => h.confirmedBooth || h.boothCandidates.length === 1).length,
    };

    return NextResponse.json({ households: out, summary });
  } catch (error) {
    console.error('[households] error:', error);
    return NextResponse.json({ error: 'Failed to build households' }, { status: 500 });
  }
}
