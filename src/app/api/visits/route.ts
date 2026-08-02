export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import type { JWTPayload } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';
import { safeSearchTerm } from '@/lib/search-term';

/**
 * /api/visits — the constituency office's walk-in register.
 *
 * People queue outside the office every morning; that queue lived in a paper
 * diary, so the product only ever saw the fraction of the day that arrived over
 * WhatsApp. This records who came, what they asked for, and what was promised.
 *
 * GET   ?date=&status=&q=   — today's register by default
 * POST  { visitorName, purpose, ... } — log an arrival
 * PATCH { id, status?, promised?, complaintId? } — move it along
 *
 * Scope reuses getComplaintScopeFilter: office_visits carries the same
 * assembly_constituency / district / block_norm columns as complaints, so an
 * MLA sees their own seat and a block coordinator their own block, with no
 * second RBAC path to keep in step.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AnyRecord = Record<string, unknown>;

/** Geography the caller's own account is pinned to — a visit is filed there. */
function ownGeography(u: JWTPayload) {
  return {
    assembly_constituency: u.constituency || null,
    district: u.district || null,
    block: u.block && u.block.toUpperCase() !== 'ALL' ? u.block : null,
  };
}

/**
 * Apply the complaint scope filter to a visits query.
 *
 * office_visits carries the same assembly_constituency / district / block_norm
 * columns as complaints, so the filter transfers verbatim and there is no second
 * RBAC path that can drift from the first.
 */
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

async function auth(request: NextRequest): Promise<JWTPayload | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(request: NextRequest) {
  const payload = await auth(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');           // YYYY-MM-DD; omitted = all recent
    const status = searchParams.get('status');
    const q = safeSearchTerm(searchParams.get('q'));

    let query = supabase.from('office_visits').select('*');
    query = applyScope(query, payload);

    if (date) {
      query = query.gte('arrived_at', `${date}T00:00:00Z`).lte('arrived_at', `${date}T23:59:59Z`);
    }
    if (status) query = query.eq('status', status);
    if (q) query = query.or(`visitor_name.ilike.%${q}%,phone.ilike.%${q}%,village.ilike.%${q}%,purpose.ilike.%${q}%`);

    const { data, error } = await query.order('arrived_at', { ascending: false }).limit(500);
    if (error) throw error;

    const rows = (data || []) as AnyRecord[];
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      const s = String(r.status || 'WAITING');
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({ visits: rows, counts, total: rows.length });
  } catch (error) {
    console.error('[visits] GET error:', error);
    return NextResponse.json({ error: 'Failed to load the visit register' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const payload = await auth(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (payload.role_level === 'KARYAKARTA') {
    return NextResponse.json({ error: 'Your role cannot log visits' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const visitorName = String(body.visitorName || '').trim();
    const purpose = String(body.purpose || '').trim();
    if (!visitorName) return NextResponse.json({ error: 'Visitor name is required' }, { status: 400 });
    if (!purpose) return NextResponse.json({ error: 'Purpose is required' }, { status: 400 });

    // Geography is taken from the account, never from the request — the same
    // rule validateNewUserScope applies, so a visit cannot be filed into
    // someone else's seat.
    const geo = ownGeography(payload);

    const row = {
      visitor_name: visitorName.slice(0, 120),
      phone: (body.phone ? String(body.phone).replace(/\D/g, '') : null)?.slice(0, 15) || null,
      village: body.village ? String(body.village).slice(0, 120) : null,
      gp_name: body.gpName ? String(body.gpName).slice(0, 120) : null,
      purpose: purpose.slice(0, 400),
      category: body.category ? String(body.category).slice(0, 40) : null,
      notes: body.notes ? String(body.notes).slice(0, 2000) : null,
      promised: body.promised ? String(body.promised).slice(0, 400) : null,
      promised_by_date: body.promisedByDate || null,
      scheduled_at: body.scheduledAt || null,
      met_by: body.metBy ? String(body.metBy).slice(0, 120) : null,
      created_by: payload.username || payload.userId || null,
      ...geo,
      ...(body.block ? { block: String(body.block).slice(0, 120) } : {}),
    };

    const { data, error } = await supabase.from('office_visits').insert(row).select('*').single();
    if (error) throw error;
    return NextResponse.json({ success: true, visit: data });
  } catch (error) {
    console.error('[visits] POST error:', error);
    return NextResponse.json({ error: 'Failed to log the visit' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const payload = await auth(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (payload.role_level === 'KARYAKARTA') {
    return NextResponse.json({ error: 'Your role has read-only access' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Re-read under the caller's scope so an id from another seat cannot be
    // patched by guessing it.
    let check = supabase.from('office_visits').select('id');
    check = applyScope(check, payload);
    const { data: found, error: findErr } = await check.eq('id', id).maybeSingle();
    if (findErr) throw findErr;
    if (!found) return NextResponse.json({ error: 'Visit not found in your jurisdiction' }, { status: 404 });

    const patch: AnyRecord = {};
    if (body.status) {
      const allowed = ['WAITING', 'IN_MEETING', 'DONE', 'REFERRED', 'NO_SHOW'];
      if (!allowed.includes(body.status)) {
        return NextResponse.json({ error: `status must be one of ${allowed.join(', ')}` }, { status: 400 });
      }
      patch.status = body.status;
      if (['DONE', 'REFERRED', 'NO_SHOW'].includes(body.status)) patch.closed_at = new Date().toISOString();
    }
    if (body.promised !== undefined) patch.promised = body.promised ? String(body.promised).slice(0, 400) : null;
    if (body.promisedByDate !== undefined) patch.promised_by_date = body.promisedByDate || null;
    if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).slice(0, 2000) : null;
    if (body.metBy !== undefined) patch.met_by = body.metBy ? String(body.metBy).slice(0, 120) : null;
    if (body.complaintId !== undefined) patch.complaint_id = body.complaintId || null;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data, error } = await supabase.from('office_visits').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ success: true, visit: data });
  } catch (error) {
    console.error('[visits] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update the visit' }, { status: 500 });
  }
}
