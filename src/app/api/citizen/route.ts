export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import type { JWTPayload } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';
import { normalisePhone } from '@/lib/outreach';

/**
 * /api/citizen?phone= — everything this office already knows about one person.
 *
 * Complaints, visits and letters all carry a phone number and were never joined
 * on it, so the office had no way to answer the question every walk-in asks:
 * "I came last month." Somebody would search complaints, then search visits,
 * and still not see the whole thread.
 *
 * Scoped exactly like the complaints list — a person's assembled history is the
 * last thing that should cross a jurisdiction, so each source is filtered by
 * getComplaintScopeFilter rather than trusted because the phone matched.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AnyRecord = Record<string, unknown>;

interface Filterable {
  eq(column: string, value: unknown): Filterable;
  in(column: string, values: unknown[]): Filterable;
}
function applyScope<T>(query: T, payload: JWTPayload): T {
  const where = getComplaintScopeFilter(payload) as AnyRecord;
  let q = query as unknown as Filterable;
  for (const [key, value] of Object.entries(where)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && 'in' in (value as AnyRecord)) {
      q = q.in(key, (value as { in: unknown[] }).in);
    } else {
      q = q.eq(key, value);
    }
  }
  return q as unknown as T;
}

/**
 * Phones are stored inconsistently — 9876543210, 919876543210, +91 98765 43210
 * all mean one person. Matching on the last ten digits is what makes the three
 * sources line up at all.
 */
const tail = (p: string) => `%${normalisePhone(p)}`;

export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const raw = request.nextUrl.searchParams.get('phone') || '';
  const phone = normalisePhone(raw);
  if (phone.length < 10) {
    return NextResponse.json({ error: 'A ten-digit phone number is required' }, { status: 400 });
  }

  try {
    const like = tail(phone);

    let cq = supabase.from('complaints')
      .select('id, "ticketNo", "citizenName", issue, category, status, village, block, "createdAt"')
      .like('phone', like);
    cq = applyScope(cq, payload) as typeof cq;

    let vq = supabase.from('office_visits')
      .select('id, token_no, visitor_name, purpose, promised, promised_by_date, status, village, arrived_at')
      .like('phone', like);
    vq = applyScope(vq, payload) as typeof vq;

    let lq = supabase.from('letters')
      .select('id, letter_no, subject, recipient_designation, status, issued_at, replied_at, created_at')
      .like('citizen_phone', like);
    lq = applyScope(lq, payload) as typeof lq;

    const [complaints, visits, letters, tg, consent, optout] = await Promise.all([
      cq.order('createdAt', { ascending: false }).limit(50),
      vq.order('arrived_at', { ascending: false }).limit(50),
      lq.order('created_at', { ascending: false }).limit(50),
      supabase.from('citizen_telegram_links').select('phone').eq('is_active', true).like('phone', like).limit(1),
      supabase.from('citizen_consent').select('consent_given').like('phone', like).limit(1),
      supabase.from('outreach_optouts').select('phone').like('phone', like).limit(1),
    ]);

    const cRows = (complaints.data || []) as AnyRecord[];
    const vRows = (visits.data || []) as AnyRecord[];
    const lRows = (letters.data || []) as AnyRecord[];

    // The name the office should greet them by: the most recent one recorded.
    const name =
      (cRows[0]?.citizenName as string) ||
      (vRows[0]?.visitor_name as string) ||
      null;

    const dates = [
      ...cRows.map((c) => c.createdAt),
      ...vRows.map((v) => v.arrived_at),
    ].filter(Boolean).map((d) => new Date(String(d)).getTime());

    return NextResponse.json({
      phone,
      name,
      known: cRows.length + vRows.length + lRows.length > 0,
      firstSeen: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
      lastSeen: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
      counts: {
        complaints: cRows.length,
        open: cRows.filter((c) => c.status !== 'RESOLVED' && c.status !== 'REJECTED').length,
        visits: vRows.length,
        letters: lRows.length,
      },
      // What the office can and may do next, answered here so no screen has to
      // work it out from three separate lookups.
      reachable: {
        telegram: Boolean(tg.data && tg.data.length),
        broadcastConsent: Boolean(consent.data?.[0]?.consent_given),
        optedOut: Boolean(optout.data && optout.data.length),
      },
      complaints: cRows,
      visits: vRows,
      letters: lRows,
    });
  } catch (error) {
    console.error('[citizen] GET error:', error);
    return NextResponse.json({ error: 'Failed to load the citizen history' }, { status: 500 });
  }
}
