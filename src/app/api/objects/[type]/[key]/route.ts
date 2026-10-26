import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthUser } from '@/lib/jwt';
import { seatsInScope } from '@/lib/rbac';
import { isObjectKey, isObjectType, OBJECT_NOUN } from '@/lib/objects';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/objects/village/330882 — one place or person with everything linked
 * to it: the trail above, what sits below, booths, team and complaints.
 * `district/home` opens the served district. Everything is limited to the
 * seats this account may see; a place outside them is refused, not trimmed.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; key: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { type, key: rawKey } = await params;
  let key = '';
  try { key = decodeURIComponent(rawKey).trim(); } catch { /* falls through to the check below */ }
  if (!isObjectType(type) || !isObjectKey(key)) {
    return NextResponse.json({ error: 'This address does not point to a place or person' }, { status: 400 });
  }

  const seats = await seatsInScope(user);
  if (seats && seats.length === 0) {
    return NextResponse.json({ error: 'No area is assigned to your account yet. Ask an admin to set your seat.' }, { status: 403 });
  }

  if (type === 'district' && key === 'home') {
    const { data } = await supabase.from('served_districts').select('district').order('added_at').limit(1);
    key = data?.[0]?.district || '';
    if (!key) return NextResponse.json({ error: 'No district is set up yet' }, { status: 404 });
  }

  const { data, error } = await supabase.rpc('object_view', {
    p_type: type,
    p_key: key,
    p_seats: seats,
    p_show_demo: process.env.SHOW_DEMO_COMPLAINTS === 'true',
    p_show_test: process.env.SHOW_TEST_COMPLAINTS === 'true',
  });
  if (error) {
    console.error('[objects]', type, error);
    return NextResponse.json({ error: `Could not load this ${OBJECT_NOUN[type].toLowerCase()}` }, { status: 500 });
  }
  if (data?.error === 'not_found') {
    return NextResponse.json({ error: `No ${OBJECT_NOUN[type].toLowerCase()} matches this address` }, { status: 404 });
  }
  if (data?.error === 'out_of_scope') {
    return NextResponse.json({ error: `This ${OBJECT_NOUN[type].toLowerCase()} is outside your area` }, { status: 403 });
  }
  return NextResponse.json({ data });
}
