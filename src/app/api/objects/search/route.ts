import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthUser } from '@/lib/jwt';
import { seatsInScope } from '@/lib/rbac';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/objects/search?q=hura — seats, blocks, panchayats, villages, booths,
 * people and ticket numbers matching q, in English or Bengali, limited to the
 * seats this account may see.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = (request.nextUrl.searchParams.get('q') || '').normalize('NFC').trim().slice(0, 60);
  if (q.length < 2) return NextResponse.json({ results: [] });

  const seats = await seatsInScope(user);
  if (seats && seats.length === 0) return NextResponse.json({ results: [] });

  const { data, error } = await supabase.rpc('object_search', {
    p_q: q,
    p_seats: seats,
    p_show_demo: process.env.SHOW_DEMO_COMPLAINTS === 'true',
    p_show_test: process.env.SHOW_TEST_COMPLAINTS === 'true',
    p_limit: 5,
  });
  if (error) {
    console.error('[objects/search]', error);
    return NextResponse.json({ error: 'Search is not answering right now' }, { status: 500 });
  }
  return NextResponse.json({ results: data || [] });
}
