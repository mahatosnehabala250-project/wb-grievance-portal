import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — list all schemes
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const { data, error } = await supabase
    .from('scheme_knowledge')
    .select('id,name,category,source_type,source_file,is_active,last_synced_at,added_by,valid_until')
    .order('last_synced_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ schemes: data });
}

// POST — upload PDF text or manual scheme, trigger JS-10
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload || !['ADMIN', 'STATE'].includes(payload.role))
    return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 });

  const body = await request.json();
  const { source_type, source_name, text_content, source_url } = body;

  if (!text_content || text_content.trim().length < 50)
    return NextResponse.json({ error: 'text_content too short' }, { status: 400 });

  // Trigger JS-10 webhook
  const webhookRes = await fetch(
    'https://n8n.srv1347095.hstgr.cloud/webhook/js-knowledge-sync',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_type: source_type || 'MANUAL',
        source_name: source_name || 'admin-upload',
        source_url: source_url || null,
        text_content,
        triggered_by: payload.username || payload.role,
      }),
    }
  );

  if (!webhookRes.ok) {
    return NextResponse.json({ error: 'Failed to trigger sync workflow' }, { status: 500 });
  }

  return NextResponse.json({ success: true, message: 'Scheme sync triggered. Processing in background.' });
}

// DELETE — deactivate a scheme
export async function DELETE(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'ADMIN')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await request.json();
  const { error } = await supabase
    .from('scheme_knowledge')
    .update({ is_active: false })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
