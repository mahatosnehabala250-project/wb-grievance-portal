import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/complaints/check-duplicate  (n8n internal — Complaint Agent tool)
 *
 * Checks whether a similar complaint already exists for this phone within a
 * recent time window (default 72h), so the agent can avoid duplicate filings.
 * Wraps the `check_duplicate_complaint` Postgres function when available and
 * falls back to a direct table query.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET.
 *
 * Body: { phone: string, issue?: string, window_hours?: number }
 * Response:
 *   { ok: true, data: { duplicate: boolean, ticket_no?: string } }
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get('x-n8n-secret');
    if (!process.env.N8N_WEBHOOK_SECRET || secret !== process.env.N8N_WEBHOOK_SECRET) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    const issue = typeof body?.issue === 'string' ? body.issue.trim() : '';
    const windowHours = Number.isFinite(body?.window_hours) ? Number(body.window_hours) : 72;
    if (!phone) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'phone is required' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Prefer the dedicated RPC if present.
    const rpc = await supabase.rpc('check_duplicate_complaint', {
      p_phone: phone,
      p_issue: issue,
      p_window_hours: windowHours,
    });
    if (!rpc.error && rpc.data !== null && rpc.data !== undefined) {
      // RPC may return a boolean or a row; normalize.
      const isDup = typeof rpc.data === 'boolean' ? rpc.data : Boolean(rpc.data);
      return NextResponse.json({ ok: true, data: { duplicate: isDup } });
    }

    // Fallback: direct query over recent complaints for this phone.
    const sinceIso = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
    const { data, error } = await supabase
      .from('complaints')
      .select('ticket_no, created_at')
      .eq('phone', phone)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Failed to check duplicate', details: error.message },
        { status: 500 }
      );
    }

    if (data && data.length > 0) {
      return NextResponse.json({ ok: true, data: { duplicate: true, ticket_no: data[0].ticket_no } });
    }
    return NextResponse.json({ ok: true, data: { duplicate: false } });
  } catch (error) {
    console.error('[complaints/check-duplicate] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
