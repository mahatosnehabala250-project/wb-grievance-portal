import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/sessions/state?phone=<phone>
 *
 * Returns the conversation_sessions row for the given phone number.
 * Admin JWT auth required.
 *
 * Query params:
 *   phone - the session_id (phone number) to look up
 *
 * Response: { ok: true, data: ConversationSession | null }
 *
 * @see Requirement 14 — Frontend Session State Inspector
 */
export async function GET(request: NextRequest) {
  try {
    // ─── Auth: verify admin JWT via cookie or Authorization header ───
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '') || '';

    if (!token) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized — admin JWT required' },
        { status: 401 }
      );
    }

    // Verify the token with Supabase auth
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized — invalid or expired token' },
        { status: 401 }
      );
    }

    // Check admin role from user metadata
    const role = user.user_metadata?.role || user.app_metadata?.role;
    if (role !== 'admin' && role !== 'super_admin') {
      return NextResponse.json(
        { ok: false, error: 'Forbidden — admin access required' },
        { status: 403 }
      );
    }

    // ─── Parse query params ───
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');

    if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: 'phone query parameter is required' },
        { status: 400 }
      );
    }

    // ─── Query conversation_sessions ───
    const { data: session, error } = await supabase
      .from('conversation_sessions')
      .select('session_id, last_intent, active_agent, collected_data, language, last_activity_at, state, created_at')
      .eq('session_id', phone.trim())
      .maybeSingle();

    if (error) {
      console.error('[sessions/state] Supabase query error:', error);
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch session state', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: session || null,
    });
  } catch (error) {
    console.error('[sessions/state] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
