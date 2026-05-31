import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Consent endpoint — DPDP Act 2023 (n8n internal, Phase 1 P0).
 *
 * GET  /api/consent?phone=<phone>   → returns current consent status for the citizen.
 * POST /api/consent                  → records / withdraws consent.
 *
 * The WhatsApp agent (JS-01) calls these:
 *   • On first contact, GET to check if consent already exists.
 *   • After the citizen agrees to the one-line consent notice, POST { phone, given: true }.
 *   • If the citizen later says "remove my consent", POST { phone, given: false }.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET.
 *
 * POST body: { phone: string (required), given: boolean (required), version?: string }
 * Response:  { ok: true, data: { phone, consent_given, version } }
 *
 * Backed by the `record_consent` Postgres RPC + `citizen_consent` table
 * (migration phase1_dpdp_consent_audit_retention). Writes are audited in
 * pii_audit_log by the RPC itself.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function authOk(request: NextRequest): boolean {
  const secret = request.headers.get('x-n8n-secret');
  const expected = process.env.N8N_WEBHOOK_SECRET;
  return !!expected && secret === expected;
}

export async function GET(request: NextRequest) {
  try {
    if (!authOk(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const phone = request.nextUrl.searchParams.get('phone');
    if (!phone) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'phone query param is required' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data, error } = await supabase
      .from('citizen_consent')
      .select('phone, consent_given, consent_text_version, given_at, withdrawn_at')
      .eq('phone', phone)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Failed to read consent', details: error.message },
        { status: 500 }
      );
    }

    // No row → consent not yet captured.
    if (!data) {
      return NextResponse.json({ ok: true, data: { phone, consent_given: false, exists: false } });
    }

    return NextResponse.json({
      ok: true,
      data: {
        phone: data.phone,
        consent_given: data.consent_given,
        version: data.consent_text_version,
        given_at: data.given_at,
        withdrawn_at: data.withdrawn_at,
        exists: true,
      },
    });
  } catch (error) {
    console.error('[consent GET] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!authOk(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'request body must be a JSON object' },
        { status: 400 }
      );
    }

    const phone = (body as Record<string, unknown>).phone;
    const givenRaw = (body as Record<string, unknown>).given;
    const version = (body as Record<string, unknown>).version;

    if (typeof phone !== 'string' || phone.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'phone is required and must be a string' },
        { status: 400 }
      );
    }
    // Accept boolean or the strings "true"/"false" (n8n tool may send strings).
    const given = givenRaw === true || givenRaw === 'true';

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data, error } = await supabase.rpc('record_consent', {
      p_phone: phone,
      p_given: given,
      p_version: typeof version === 'string' && version ? version : 'v1',
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Failed to record consent', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error('[consent POST] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
