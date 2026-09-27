import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthUser } from '@/lib/jwt';
import { hasDistrictWideScope } from '@/lib/rbac';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/home/district — the district president's home: every seat in the
 * district side by side, and the oldest open complaints across all of them.
 *
 * A district account is pinned to its own district; only ADMIN/STATE may pass
 * ?district=. An MLA (role DISTRICT + role_level MLA) is refused by
 * hasDistrictWideScope, so a single seat never sees its neighbours.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasDistrictWideScope(user)) {
    return NextResponse.json({ error: 'District access required' }, { status: 403 });
  }

  const isAdmin = user.role === 'ADMIN' || user.role === 'STATE';
  let district = user.district || user.block || '';
  if (isAdmin) district = request.nextUrl.searchParams.get('district') || 'Purulia';
  if (!district || !/^[A-Za-z .-]{2,60}$/.test(district)) {
    return NextResponse.json({ error: 'No district set on this account' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('home_district', {
    p_district: district,
    p_show_demo: process.env.SHOW_DEMO_COMPLAINTS === 'true',
    p_show_test: process.env.SHOW_TEST_COMPLAINTS === 'true',
  });
  if (error) {
    console.error('[home/district]', error);
    return NextResponse.json({ error: 'Could not load the district' }, { status: 500 });
  }
  return NextResponse.json({ data });
}
