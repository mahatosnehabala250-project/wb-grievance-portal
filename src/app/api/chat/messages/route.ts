export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!verifyToken(token)) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    const phone = req.nextUrl.searchParams.get('phone');
    if (!phone) return NextResponse.json({ error: 'Phone required' }, { status: 400 });
    const { data, error } = await supabase.rpc('get_chat_history', { p_phone: phone });
    if (error) throw error;
    return NextResponse.json({ messages: data || [] });
  } catch (e) {
    return NextResponse.json({ messages: [] });
  }
}
