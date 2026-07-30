export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';
import { phonesInScope, phoneAllowed } from '@/lib/chat-scope';

/**
 * GET /api/chat/messages?phone= — one citizen's conversation.
 *
 * `phone` is caller-supplied, so this is the endpoint where a jurisdiction
 * check actually matters: without it, knowing a number was enough to read that
 * person's entire message history. The guard was also written
 * `if (!verifyToken(t))` — unawaited, therefore always passing. Both fixed.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const phone = req.nextUrl.searchParams.get('phone');
  if (!phone) return NextResponse.json({ error: 'Phone required' }, { status: 400 });

  try {
    const scope = await phonesInScope(payload);
    if (!phoneAllowed(scope, phone)) {
      return NextResponse.json(
        { error: 'This citizen is outside your jurisdiction' },
        { status: 403 }
      );
    }

    const { data, error } = await supabase.rpc('get_chat_history', { p_phone: phone });
    if (error) throw error;
    return NextResponse.json({ messages: data || [] });
  } catch (e) {
    console.error('[chat/messages] error:', e);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}
