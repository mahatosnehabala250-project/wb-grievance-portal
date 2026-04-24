import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const [summaryRes, alertsRes, runsRes] = await Promise.all([
      supabase.rpc('get_intelligence_summary'),
      supabase.from('intelligence_alerts').select('*').eq('status', 'ACTIVE').order('severity', { ascending: false }).limit(20),
      supabase.from('intelligence_runs').select('run_at,alerts_generated,status,duration_ms').order('run_at', { ascending: false }).limit(3),
    ]);

    return NextResponse.json({
      summary: summaryRes.data || {},
      alerts: alertsRes.data || [],
      runs: runsRes.data || [],
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load intelligence data' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const { id, action } = await request.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (action === 'acknowledge') { updates.status = 'ACKNOWLEDGED'; updates.acknowledged_by = payload.username; updates.acknowledged_at = new Date().toISOString(); }
    else if (action === 'resolve') { updates.status = 'RESOLVED'; updates.resolved_at = new Date().toISOString(); }
    else if (action === 'false_positive') { updates.status = 'FALSE_POSITIVE'; }

    const { error } = await supabase.from('intelligence_alerts').update(updates).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update alert' }, { status: 500 });
  }
}
