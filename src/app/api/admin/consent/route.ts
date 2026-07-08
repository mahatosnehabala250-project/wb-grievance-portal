import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/admin/consent
 *
 * Admin-only DPDP consent registry view. The citizen-facing consent flow
 * (/api/consent, n8n-secret auth) records rows in `citizen_consent` via the
 * `record_consent` RPC; this endpoint lets an admin audit those rows in the
 * portal (Handoffs & Consent view).
 *
 * Query params:
 *   phone — optional substring filter
 *   limit — max rows (default 50, cap 200)
 *
 * Response: { ok, data: { consents: Row[], stats: { total, active, withdrawn } } }
 */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 401 });
    }
    if (payload.role !== 'ADMIN') {
      return NextResponse.json({ ok: false, error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const phone = (searchParams.get('phone') || '').trim();
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200);

    let query = supabase
      .from('citizen_consent')
      .select('phone, consent_given, consent_text_version, given_at, withdrawn_at')
      .order('given_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (phone) query = query.ilike('phone', `%${phone}%`);

    const { data: consents, error } = await query;
    if (error) {
      console.error('[admin/consent] Query error:', error);
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list consents', details: error.message } },
        { status: 500 }
      );
    }

    // Registry-wide stats (independent of the phone filter).
    const { data: allRows, error: statsError } = await supabase
      .from('citizen_consent')
      .select('consent_given');
    if (statsError) {
      console.warn('[admin/consent] Stats error:', statsError);
    }
    const total = (allRows || []).length;
    const active = (allRows || []).filter((r) => r.consent_given).length;

    return NextResponse.json({
      ok: true,
      data: {
        consents: consents || [],
        stats: { total, active, withdrawn: total - active },
      },
    });
  } catch (error) {
    console.error('[admin/consent] Error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
