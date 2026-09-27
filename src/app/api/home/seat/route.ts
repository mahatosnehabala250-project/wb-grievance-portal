import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthUser } from '@/lib/jwt';
import { canAccessAssembly } from '@/lib/rbac';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/home/seat?ac=Manbazar — one assembly seat's home: what has no owner,
 * what is assigned but not moving, what was filed twice, where it is open, and
 * who is carrying it. An MLA gets only their own seat; the district president,
 * MP and admin may open any seat canAccessAssembly allows.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ac = request.nextUrl.searchParams.get('ac') || user.constituency || '';
  if (!ac || !/^[A-Za-z .()-]{2,60}$/.test(ac)) {
    return NextResponse.json({ error: 'Choose a seat' }, { status: 400 });
  }
  if (!(await canAccessAssembly(user, ac))) {
    return NextResponse.json({ error: 'This seat is outside your area' }, { status: 403 });
  }

  const { data, error } = await supabase.rpc('home_seat', {
    p_ac: ac,
    p_show_demo: process.env.SHOW_DEMO_COMPLAINTS === 'true',
    p_show_test: process.env.SHOW_TEST_COMPLAINTS === 'true',
  });
  if (error) {
    console.error('[home/seat]', error);
    return NextResponse.json({ error: 'Could not load the seat' }, { status: 500 });
  }
  return NextResponse.json({ data });
}
