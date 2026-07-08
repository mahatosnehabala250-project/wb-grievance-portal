import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/handoffs
 *
 * Admin-only list of the human-handoff queue (companion to claim/release/
 * resolve, which existed without any way to SEE the queue). Powers the
 * Handoffs & Consent view.
 *
 * Query params:
 *   status  — 'pending' | 'claimed' | 'resolved' | 'all' (default 'all')
 *   limit   — max rows (default 50, cap 200)
 *
 * Response: { ok, data: { handoffs: Row[], counts: { pending, claimed, resolved } } }
 * Rows include claimed_by_name resolved from the users table.
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
    const status = (searchParams.get('status') || 'all').toLowerCase();
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200);

    let query = supabase
      .from('human_handoff_queue')
      .select('id, session_id, reason, snapshot, claimed_by, claimed_at, resolved_at, resolution_notes, status, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status !== 'all') query = query.eq('status', status);

    const { data: rows, error } = await query;
    if (error) {
      console.error('[handoffs GET] Query error:', error);
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list handoffs', details: error.message } },
        { status: 500 }
      );
    }

    // Status counts for the tab badges (single grouped scan).
    const { data: countRows, error: countError } = await supabase
      .from('human_handoff_queue')
      .select('status');
    if (countError) {
      console.warn('[handoffs GET] Count error:', countError);
    }
    const counts = { pending: 0, claimed: 0, resolved: 0 };
    for (const r of countRows || []) {
      if (r.status in counts) counts[r.status as keyof typeof counts]++;
    }

    // Resolve claimed_by user ids → display names.
    const claimerIds = [...new Set((rows || []).map((r) => r.claimed_by).filter(Boolean))] as string[];
    const nameById: Record<string, string> = {};
    if (claimerIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, name, username')
        .in('id', claimerIds);
      for (const u of users || []) nameById[u.id] = u.name || u.username;
    }

    const handoffs = (rows || []).map((r) => ({
      ...r,
      claimed_by_name: r.claimed_by ? nameById[r.claimed_by] || r.claimed_by : null,
    }));

    return NextResponse.json({ ok: true, data: { handoffs, counts } });
  } catch (error) {
    console.error('[handoffs GET] Error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
