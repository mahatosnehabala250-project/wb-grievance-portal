import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/complaints/validate-block  (n8n internal — Complaint Agent tool)
 *
 * Verifies that a block name exists in the West Bengal administrative hierarchy,
 * optionally scoped to a district. Called by the Complaint Agent after the user
 * supplies their block name (JS-01v2 → "Complaint: ValidateBlock").
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET.
 *
 * Body: { block: string, district?: string }
 * Response:
 *   - valid:   { ok: true, data: { valid: true, block, district } }
 *   - invalid: { ok: true, data: { valid: false, suggestions: string[] } }
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
    const block = typeof body?.block === 'string' ? body.block.trim() : '';
    const district = typeof body?.district === 'string' ? body.district.trim() : '';
    if (!block) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'block is required' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Case-insensitive exact match against valid_blocks (optionally scoped to district).
    let query = supabase.from('valid_blocks').select('block, district').ilike('block', block);
    if (district) query = query.ilike('district', district);
    const { data, error } = await query.limit(1);

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Failed to validate block', details: error.message },
        { status: 500 }
      );
    }

    if (data && data.length > 0) {
      return NextResponse.json({
        ok: true,
        data: { valid: true, block: data[0].block, district: data[0].district },
      });
    }

    // Not an exact match → offer fuzzy suggestions (prefix match within district if given).
    let suggestQuery = supabase.from('valid_blocks').select('block').ilike('block', `${block.slice(0, 3)}%`);
    if (district) suggestQuery = suggestQuery.ilike('district', district);
    const { data: suggestions } = await suggestQuery.limit(5);

    return NextResponse.json({
      ok: true,
      data: { valid: false, suggestions: (suggestions || []).map((r) => r.block) },
    });
  } catch (error) {
    console.error('[complaints/validate-block] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
