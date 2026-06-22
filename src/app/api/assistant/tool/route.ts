export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { executeReadTool, READ_TOOL_NAMES } from '@/lib/assistant/tools';

/**
 * POST /api/assistant/tool — execute ONE read tool for a Gemini Live session.
 * The browser forwards the model's function call here; we run it server-side with
 * the caller's JWT so it stays scope-locked (getComplaintScopeFilter). Only READ
 * tools are allowed here — navigate/write are handled client-side (write = confirm).
 * Body: { name, args } → { result }.
 */
export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const { name, args } = await request.json().catch(() => ({}));
    if (!name || !READ_TOOL_NAMES.has(name)) {
      return NextResponse.json({ result: { error: 'tool not allowed' } });
    }
    const origin = new URL(request.url).origin;
    const result = await executeReadTool(name, args || {}, { payload, token, origin });
    return NextResponse.json({ result });
  } catch (err) {
    console.error('assistant tool error:', err);
    return NextResponse.json({ result: { error: 'tool failed' } });
  }
}
