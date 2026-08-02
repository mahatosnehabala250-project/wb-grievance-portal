export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import type { JWTPayload } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';
import { safeSearchTerm } from '@/lib/search-term';
import { LETTER_WATCH_DAYS, LETTER_OVERDUE_DAYS } from '@/lib/letter-templates';

/**
 * /api/letters — the issued-letters register.
 *
 * After complaint follow-up, paper is the office's biggest output: forwarding
 * letters to the BDO, recommendations for a scheme, reminders on letters that
 * got no reply. They were typed one at a time with no record kept, so nobody
 * could answer "have we already written for this family?".
 *
 * GET   ?status=&type=&q=&complaintId=  — the register, newest first
 * POST  { subject, body, ... }          — save a draft or issue directly
 * PATCH { id, status?, ... }            — edit, or mark as issued
 *
 * Scope reuses getComplaintScopeFilter, exactly as /api/visits does: letters
 * carry the same assembly_constituency / district / block_norm columns as
 * complaints, so there is no second RBAC path that can drift from the first.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AnyRecord = Record<string, unknown>;

const ALLOWED_STATUS = ['DRAFT', 'ISSUED', 'REPLIED', 'CANCELLED'];

/** Geography the caller's own account is pinned to — a letter is filed there. */
function ownGeography(u: JWTPayload) {
  return {
    assembly_constituency: u.constituency || null,
    district: u.district || null,
    block: u.block && u.block.toUpperCase() !== 'ALL' ? u.block : null,
  };
}

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
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const complaintId = searchParams.get('complaintId');
    const q = safeSearchTerm(searchParams.get('q'));

    let query = supabase.from('letters').select('*');
    query = applyScope(query, payload);

    if (status) query = query.eq('status', status);
    if (type) query = query.eq('letter_type', type);
    if (complaintId) query = query.eq('complaint_id', complaintId);
    if (q) {
      query = query.or(
        `letter_no.ilike.%${q}%,subject.ilike.%${q}%,citizen_name.ilike.%${q}%,` +
        `recipient_name.ilike.%${q}%,recipient_designation.ilike.%${q}%,citizen_village.ilike.%${q}%`
      );
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(300);
    if (error) throw error;

    const rows = (data || []) as AnyRecord[];
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      const s = String(r.status || 'DRAFT');
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    // The question the office actually asks on a Monday: what got no reply?
    // Answered here rather than left to the client, so the same number appears
    // wherever it is shown.
    const awaiting = rows.filter((r) => r.status === 'ISSUED');
    const ageInDays = (r: AnyRecord) => {
      const issued = r.issued_at || r.created_at;
      if (!issued) return 0;
      return Math.floor((Date.now() - new Date(String(issued)).getTime()) / 86400_000);
    };
    const ages = awaiting.map(ageInDays);

    return NextResponse.json({
      letters: rows,
      counts,
      total: rows.length,
      awaitingReply: {
        count: awaiting.length,
        // Thresholds are stated once, here, so the list and the badge cannot
        // disagree about what "overdue" means.
        watchAfterDays: LETTER_WATCH_DAYS,
        overdueAfterDays: LETTER_OVERDUE_DAYS,
        overdue: ages.filter((d) => d >= LETTER_OVERDUE_DAYS).length,
        oldestDays: ages.length ? Math.max(...ages) : 0,
      },
    });
  } catch (error) {
    console.error('[letters] GET error:', error);
    return NextResponse.json({ error: 'Failed to load the letter register' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const payload = await auth(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (payload.role_level === 'KARYAKARTA') {
    return NextResponse.json({ error: 'Your role cannot issue letters' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const subject = String(body.subject || '').trim();
    const text = String(body.body || '').trim();
    if (!subject) return NextResponse.json({ error: 'Subject is required' }, { status: 400 });
    if (!text) return NextResponse.json({ error: 'Letter body is required' }, { status: 400 });

    const status = ALLOWED_STATUS.includes(body.status) ? body.status : 'DRAFT';

    // Geography comes from the account, never the request body — a letter
    // cannot be filed into someone else's constituency.
    const row = {
      letter_type: String(body.letterType || 'FORWARDING').slice(0, 40),
      recipient_name: body.recipientName ? String(body.recipientName).slice(0, 160) : null,
      recipient_designation: body.recipientDesignation ? String(body.recipientDesignation).slice(0, 160) : null,
      recipient_office: body.recipientOffice ? String(body.recipientOffice).slice(0, 200) : null,
      subject: subject.slice(0, 400),
      body: text.slice(0, 20000),
      citizen_name: body.citizenName ? String(body.citizenName).slice(0, 120) : null,
      citizen_phone: body.citizenPhone ? String(body.citizenPhone).replace(/\D/g, '').slice(0, 15) : null,
      citizen_village: body.citizenVillage ? String(body.citizenVillage).slice(0, 120) : null,
      complaint_id: body.complaintId || null,
      visit_id: body.visitId || null,
      status,
      issued_at: status === 'ISSUED' ? new Date().toISOString() : null,
      issued_by: status === 'ISSUED' ? (payload.username || payload.userId || null) : null,
      created_by: payload.username || payload.userId || null,
      ...ownGeography(payload),
    };

    const { data, error } = await supabase.from('letters').insert(row).select('*').single();
    if (error) throw error;
    return NextResponse.json({ success: true, letter: data });
  } catch (error) {
    console.error('[letters] POST error:', error);
    return NextResponse.json({ error: 'Failed to save the letter' }, { status: 500 });
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
    let check = supabase.from('letters').select('id, status');
    check = applyScope(check, payload);
    const { data: found, error: findErr } = await check.eq('id', id).maybeSingle();
    if (findErr) throw findErr;
    if (!found) return NextResponse.json({ error: 'Letter not found in your jurisdiction' }, { status: 404 });

    const patch: AnyRecord = {};
    if (body.status) {
      if (!ALLOWED_STATUS.includes(body.status)) {
        return NextResponse.json({ error: `status must be one of ${ALLOWED_STATUS.join(', ')}` }, { status: 400 });
      }
      patch.status = body.status;
      if (body.status === 'ISSUED') {
        patch.issued_at = new Date().toISOString();
        patch.issued_by = payload.username || payload.userId || null;
      }
      // Marking a reply stamps today unless the office knows the actual date —
      // a reply that arrived last week should age from last week, not from the
      // moment somebody got round to recording it.
      if (body.status === 'REPLIED' && body.repliedAt === undefined) {
        patch.replied_at = new Date().toISOString().slice(0, 10);
      }
    }
    if (body.repliedAt !== undefined) patch.replied_at = body.repliedAt || null;
    if (body.replyNote !== undefined) patch.reply_note = body.replyNote ? String(body.replyNote).slice(0, 2000) : null;
    if (body.subject !== undefined) patch.subject = String(body.subject).slice(0, 400);
    if (body.body !== undefined) patch.body = String(body.body).slice(0, 20000);
    if (body.recipientName !== undefined) patch.recipient_name = body.recipientName ? String(body.recipientName).slice(0, 160) : null;
    if (body.recipientDesignation !== undefined) patch.recipient_designation = body.recipientDesignation ? String(body.recipientDesignation).slice(0, 160) : null;
    if (body.recipientOffice !== undefined) patch.recipient_office = body.recipientOffice ? String(body.recipientOffice).slice(0, 200) : null;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data, error } = await supabase.from('letters').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ success: true, letter: data });
  } catch (error) {
    console.error('[letters] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update the letter' }, { status: 500 });
  }
}
