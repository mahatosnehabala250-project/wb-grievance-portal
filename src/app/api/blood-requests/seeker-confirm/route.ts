import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/blood-requests/seeker-confirm  (n8n internal — Blood Agent tool)
 *
 * Called when the seeker confirms (or rejects) a matched donor (JS-01v2 →
 * "Blood: SeekerConfirm"). Wraps the `seeker_confirm_donor` Postgres function.
 * On confirm, the matched donor's response moves to CONFIRMED; on reject, the
 * next standby donor is promoted (handled by the RPC / downstream trigger).
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET.
 *
 * Body: { seeker_phone, confirmed: boolean }
 * Response: { ok: true, data: { confirmed, result } }
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get('x-n8n-secret');
    if (!process.env.N8N_WEBHOOK_SECRET || secret !== process.env.N8N_WEBHOOK_SECRET) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const seekerPhone =
      typeof body?.seeker_phone === 'string'
        ? body.seeker_phone.trim()
        : typeof body?.phone === 'string'
          ? (body.phone as string).trim()
          : '';
    // Accept boolean, or string "haan"/"yes"/"true".
    let confirmed: boolean;
    if (typeof body?.confirmed === 'boolean') confirmed = body.confirmed;
    else {
      const s = String(body?.confirmed ?? '').toLowerCase();
      confirmed = ['true', 'haan', 'yes', 'y', 'ha', 'হ্যাঁ', 'হ্যা'].includes(s);
    }

    if (!seekerPhone) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'seeker_phone is required' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const rpc = await supabase.rpc('seeker_confirm_donor', {
      p_seeker_phone: seekerPhone,
      p_confirmed: confirmed,
    });

    if (rpc.error) {
      return NextResponse.json(
        { ok: false, error: 'Failed to confirm', details: rpc.error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data: { confirmed, result: rpc.data ?? null } });
  } catch (error) {
    console.error('[blood-requests/seeker-confirm] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
