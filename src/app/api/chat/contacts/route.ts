export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';
import { phonesInScope, phoneAllowed } from '@/lib/chat-scope';

/**
 * GET /api/chat/contacts — citizens who have messaged, within the caller's
 * jurisdiction.
 *
 * Two things were wrong here and both are worth naming, because they are easy
 * to reintroduce:
 *
 *   1. `verifyToken` is async, and the guard was written `if (!verifyToken(t))`.
 *      A Promise is always truthy, so the check never fired — any non-empty
 *      Authorization header was accepted. It must be awaited.
 *   2. `get_chat_list()` takes no jurisdiction argument and returns every
 *      citizen statewide, so even a valid MLA token read other seats' citizens.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AnyRecord = Record<string, unknown>;

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  try {
    const [{ data, error }, scope] = await Promise.all([
      supabase.rpc('get_chat_list'),
      phonesInScope(payload),
    ]);
    if (error) throw error;

    const all = (data || []) as AnyRecord[];
    const contacts = all.filter((c) => phoneAllowed(scope, String(c.phone || '')));

    return NextResponse.json({ contacts });
  } catch (e) {
    console.error('[chat/contacts] error:', e);
    // Never fall back to an unfiltered list: an error here must not become a
    // wider view than the caller is entitled to.
    return NextResponse.json({ error: 'Failed to load contacts' }, { status: 500 });
  }
}
