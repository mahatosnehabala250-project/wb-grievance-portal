import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/privacy/erase — DPDP Act 2023 Right to Erasure (n8n internal, P0).
 *
 * When a citizen requests "delete my data" (e.g. types "মুছে দিন" / "delete my data"),
 * the WhatsApp agent (JS-01) calls this. It anonymises the citizen's PII across
 * complaints, conversation_sessions, blood_requests and blood_donors via the
 * `erase_citizen_data` Postgres RPC, marks consent withdrawn, and records the
 * erasure in pii_audit_log.
 *
 * NOTE: this anonymises (scrubs identifiers) rather than hard-deleting rows, so
 * grievance audit/SLA integrity is preserved while the citizen's personal data
 * is removed — the standard approach for government record systems under DPDP.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET.
 *
 * Body: { phone: string (required) }
 * Response: { ok: true, data: { complaints, sessions, blood_requests, donors } }
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get('x-n8n-secret');
    const expected = process.env.N8N_WEBHOOK_SECRET;
    if (!expected || secret !== expected) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const phone = body && typeof body === 'object' ? (body as Record<string, unknown>).phone : undefined;
    if (typeof phone !== 'string' || phone.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'phone is required and must be a string' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data, error } = await supabase.rpc('erase_citizen_data', { p_phone: phone });

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Failed to erase citizen data', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error('[privacy/erase] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
