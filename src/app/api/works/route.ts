export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import type { JWTPayload } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';
import {
  financialYear, summarise, WORK_STATUSES, WORK_CATEGORIES, FUND_SOURCES,
} from '@/lib/works';

/**
 * /api/works — development works and the fund behind them.
 *
 * The constituency fund lives in a register and a spreadsheet on somebody's
 * laptop, so "how much is left this year" takes a phone call. This answers it,
 * and keeps the four amounts apart — estimated, sanctioned, released, spent —
 * because they diverge for months and adding the wrong pair tells an MLA they
 * have money they do not have.
 *
 * GET   ?fy=&status=&block=&q=  — works in scope plus the fund summary
 * POST  { title, ... }          — record a work
 * PATCH { id, ... }             — move it along, or correct the amounts
 * PUT   { financialYear, allocatedAmount } — set the year's allocation
 *
 * Scope reuses getComplaintScopeFilter, as the visits and letters registers do.
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

function ownGeography(u: JWTPayload) {
  return {
    assembly_constituency: u.constituency || null,
    district: u.district || null,
    block: u.block && u.block.toUpperCase() !== 'ALL' ? u.block : null,
  };
}

async function auth(request: NextRequest): Promise<JWTPayload | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}

/** Only the seat holder sets how much money the year has. */
function canSetAllocation(p: JWTPayload): boolean {
  return p.role === 'ADMIN' || ['MP', 'MLA', 'DISTRICT_ADMIN'].includes(p.role_level || '');
}

const money = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function GET(request: NextRequest) {
  const payload = await auth(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy') || financialYear();
    const status = searchParams.get('status');
    const block = searchParams.get('block');
    const q = (searchParams.get('q') || '').trim();

    let query = supabase.from('dev_works').select('*').eq('financial_year', fy);
    query = applyScope(query, payload);
    if (status) query = query.eq('status', status);
    if (block) query = query.ilike('block', `%${block}%`);
    if (q) {
      query = query.or(
        `work_no.ilike.%${q}%,title.ilike.%${q}%,village.ilike.%${q}%,` +
        `gp_name.ilike.%${q}%,executing_agency.ilike.%${q}%`
      );
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    const works = (data || []) as AnyRecord[];

    // The allocation is per constituency; a block coordinator sees the works in
    // their block against the seat's total, which is the number their MLA quotes.
    const ac = payload.constituency || null;
    let allocated = 0;
    if (ac) {
      const { data: alloc } = await supabase
        .from('fund_allocations')
        .select('allocated_amount')
        .eq('assembly_constituency', ac)
        .eq('financial_year', fy);
      allocated = (alloc || []).reduce((s, a) => s + Number(a.allocated_amount || 0), 0);
    }

    const summary = summarise(
      works.map((w) => ({
        estimated_cost: w.estimated_cost as number | null,
        sanctioned_amount: w.sanctioned_amount as number | null,
        released_amount: w.released_amount as number | null,
        spent_amount: w.spent_amount as number | null,
        status: String(w.status || 'PROPOSED'),
      })),
      allocated
    );

    return NextResponse.json({
      works, summary, financialYear: fy,
      canSetAllocation: canSetAllocation(payload),
      allocationSet: allocated > 0,
    });
  } catch (error) {
    console.error('[works] GET error:', error);
    return NextResponse.json({ error: 'Failed to load works' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const payload = await auth(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (payload.role_level === 'KARYAKARTA') {
    return NextResponse.json({ error: 'Your role cannot record works' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const title = String(body.title || '').trim();
    if (!title) return NextResponse.json({ error: 'A title is required' }, { status: 400 });

    const status = (WORK_STATUSES as readonly string[]).includes(body.status) ? body.status : 'PROPOSED';
    const category = (WORK_CATEGORIES as readonly string[]).includes(body.category) ? body.category : 'OTHER';
    const fundSource = (FUND_SOURCES as readonly string[]).includes(body.fundSource) ? body.fundSource : 'MLA_LAD';

    const row = {
      title: title.slice(0, 300),
      description: body.description ? String(body.description).slice(0, 2000) : null,
      category,
      fund_source: fundSource,
      financial_year: String(body.financialYear || financialYear()).slice(0, 10),
      village: body.village ? String(body.village).slice(0, 120) : null,
      gp_name: body.gpName ? String(body.gpName).slice(0, 120) : null,
      estimated_cost: money(body.estimatedCost),
      sanctioned_amount: money(body.sanctionedAmount),
      released_amount: money(body.releasedAmount),
      spent_amount: money(body.spentAmount),
      status,
      executing_agency: body.executingAgency ? String(body.executingAgency).slice(0, 160) : null,
      beneficiaries_est: body.beneficiaries ? Math.max(0, parseInt(String(body.beneficiaries), 10) || 0) : null,
      proposed_date: body.proposedDate || null,
      sanctioned_date: body.sanctionedDate || null,
      started_date: body.startedDate || null,
      expected_completion: body.expectedCompletion || null,
      completed_date: body.completedDate || null,
      complaint_id: body.complaintId || null,
      notes: body.notes ? String(body.notes).slice(0, 2000) : null,
      created_by: payload.username || payload.userId || null,
      ...ownGeography(payload),
      // A block coordinator files into their own block; anyone above may name one.
      ...(body.block && !payload.block ? { block: String(body.block).slice(0, 120) } : {}),
    };

    const { data, error } = await supabase.from('dev_works').insert(row).select('*').single();
    if (error) throw error;
    return NextResponse.json({ success: true, work: data });
  } catch (error) {
    console.error('[works] POST error:', error);
    return NextResponse.json({ error: 'Failed to record the work' }, { status: 500 });
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

    // Re-read under scope so an id from another seat cannot be patched by guessing.
    let check = supabase.from('dev_works').select('id');
    check = applyScope(check, payload) as typeof check;
    const { data: found, error: fErr } = await check.eq('id', id).maybeSingle();
    if (fErr) throw fErr;
    if (!found) return NextResponse.json({ error: 'Work not found in your jurisdiction' }, { status: 404 });

    const patch: AnyRecord = {};
    if (body.status) {
      if (!(WORK_STATUSES as readonly string[]).includes(body.status)) {
        return NextResponse.json({ error: `status must be one of ${WORK_STATUSES.join(', ')}` }, { status: 400 });
      }
      patch.status = body.status;
      if (body.status === 'COMPLETED' && !body.completedDate) {
        patch.completed_date = new Date().toISOString().slice(0, 10);
      }
    }
    if (body.title !== undefined) patch.title = String(body.title).slice(0, 300);
    if (body.description !== undefined) patch.description = body.description ? String(body.description).slice(0, 2000) : null;
    if (body.estimatedCost !== undefined) patch.estimated_cost = money(body.estimatedCost);
    if (body.sanctionedAmount !== undefined) patch.sanctioned_amount = money(body.sanctionedAmount);
    if (body.releasedAmount !== undefined) patch.released_amount = money(body.releasedAmount);
    if (body.spentAmount !== undefined) patch.spent_amount = money(body.spentAmount);
    if (body.executingAgency !== undefined) patch.executing_agency = body.executingAgency ? String(body.executingAgency).slice(0, 160) : null;
    if (body.sanctionedDate !== undefined) patch.sanctioned_date = body.sanctionedDate || null;
    if (body.startedDate !== undefined) patch.started_date = body.startedDate || null;
    if (body.expectedCompletion !== undefined) patch.expected_completion = body.expectedCompletion || null;
    if (body.completedDate !== undefined) patch.completed_date = body.completedDate || null;
    if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).slice(0, 2000) : null;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data, error } = await supabase.from('dev_works').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ success: true, work: data });
  } catch (error) {
    console.error('[works] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update the work' }, { status: 500 });
  }
}

/** Set (or correct) how much the year has. */
export async function PUT(request: NextRequest) {
  const payload = await auth(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canSetAllocation(payload)) {
    return NextResponse.json({ error: 'Only the MLA, MP or district president can set the allocation' }, { status: 403 });
  }
  if (!payload.constituency) {
    return NextResponse.json({ error: 'Your account is not tied to a constituency' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const amount = money(body.allocatedAmount);
    if (amount === null) return NextResponse.json({ error: 'A valid amount is required' }, { status: 400 });

    const fy = String(body.financialYear || financialYear()).slice(0, 10);
    const fundSource = (FUND_SOURCES as readonly string[]).includes(body.fundSource) ? body.fundSource : 'MLA_LAD';

    const { data, error } = await supabase.from('fund_allocations').upsert({
      assembly_constituency: payload.constituency,
      district: payload.district || null,
      financial_year: fy,
      fund_source: fundSource,
      allocated_amount: amount,
      note: body.note ? String(body.note).slice(0, 400) : null,
      created_by: payload.username || payload.userId || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'assembly_constituency,financial_year,fund_source' }).select('*').single();
    if (error) throw error;

    return NextResponse.json({ success: true, allocation: data });
  } catch (error) {
    console.error('[works] PUT error:', error);
    return NextResponse.json({ error: 'Failed to set the allocation' }, { status: 500 });
  }
}
