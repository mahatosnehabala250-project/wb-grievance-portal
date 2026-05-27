import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Routing decision row shape returned by the API. */
export interface RoutingDecisionRow {
  id: string;
  session_id: string;
  message_text: string | null;
  last_intent_before: string | null;
  agent_dispatched: string | null;
  reason: string | null;
  trace_id: string | null;
  created_at: string;
}

/**
 * Mask a phone number for non-admin contexts.
 * Keeps the first 3 and last 4 characters, replaces the middle with asterisks.
 * e.g. "+919876543210" → "+91****3210"
 */
function maskPhone(phone: string): string {
  if (!phone || phone.length <= 7) return phone;
  const prefix = phone.slice(0, 3);
  const suffix = phone.slice(-4);
  const maskedLength = phone.length - 7;
  return `${prefix}${'*'.repeat(maskedLength)}${suffix}`;
}

/**
 * GET /api/routing/decisions
 *
 * Lists routing decisions from the `routing_decisions` table with filters.
 * Admin users see full phone numbers; non-admin users see masked phones.
 *
 * Query params:
 *   agent   — filter by agent_dispatched (complaint/blood/donor/info/welcome)
 *   from    — ISO date string, filter created_at >= from
 *   to      — ISO date string, filter created_at <= to
 *   phone   — filter by session_id (exact match)
 *   intent  — filter by last_intent_before
 *   limit   — max results, default 50, cap at 200
 *
 * Returns: { ok: true, data: RoutingDecisionRow[], total: number }
 *
 * @see Requirements 13.2, 13.3, NFR Security
 */
export async function GET(request: NextRequest) {
  // ─── Auth: JWT required ───
  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 401 });
  }

  const isAdmin = payload.role === 'ADMIN';

  // ─── Parse query params ───
  const { searchParams } = new URL(request.url);
  const agent = searchParams.get('agent');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const phone = searchParams.get('phone');
  const intent = searchParams.get('intent');
  const limitParam = searchParams.get('limit');

  // Limit: default 50, cap at 200
  let limit = 50;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 200);
    }
  }

  // ─── Build Supabase query ───
  let query = supabase
    .from('routing_decisions')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(limit);

  // Apply filters
  if (agent) {
    query = query.eq('agent_dispatched', agent);
  }

  if (from) {
    query = query.gte('created_at', from);
  }

  if (to) {
    query = query.lte('created_at', to);
  }

  if (phone) {
    // Exact match on session_id (phone number)
    query = query.eq('session_id', phone);
  }

  if (intent) {
    query = query.eq('last_intent_before', intent);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error('[routing/decisions] Supabase query error:', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to fetch routing decisions' },
      { status: 500 }
    );
  }

  // ─── Phone masking for non-admin contexts ───
  const rows: RoutingDecisionRow[] = (data || []).map((row) => {
    if (!isAdmin && row.session_id) {
      return { ...row, session_id: maskPhone(row.session_id) };
    }
    return row;
  });

  return NextResponse.json({
    ok: true,
    data: rows,
    total: count ?? rows.length,
  });
}
