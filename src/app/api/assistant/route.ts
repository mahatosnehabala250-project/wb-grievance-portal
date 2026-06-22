export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { runAssistant, assistantEnabled, type ChatMsg } from '@/lib/assistant/agent';

/**
 * POST /api/assistant — the role-aware voice/command assistant ("Saathi").
 * Body: { messages: [{role:'user'|'assistant', content}] }  (or { message, history })
 *
 * Auth = the caller's JWT. Tools execute server-side with that JWT, so every
 * data read is scope-locked to the user's jurisdiction (getComplaintScopeFilter).
 * Returns { data: { answer, navigate?, proposedActions[], usedTools[] } }.
 */
export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    if (!assistantEnabled()) {
      return NextResponse.json({ error: 'Assistant not configured — set DEEPSEEK_API_KEY', enabled: false }, { status: 200 });
    }

    const body = await request.json().catch(() => ({}));
    let history: ChatMsg[] = [];
    if (Array.isArray(body.messages)) {
      history = body.messages
        .filter((m: unknown): m is ChatMsg => !!m && typeof (m as ChatMsg).content === 'string' && ((m as ChatMsg).role === 'user' || (m as ChatMsg).role === 'assistant'))
        .map((m: ChatMsg) => ({ role: m.role, content: String(m.content).slice(0, 800) }));
    } else if (typeof body.message === 'string') {
      const prior = Array.isArray(body.history) ? body.history : [];
      history = [...prior, { role: 'user', content: body.message }]
        .filter((m: unknown): m is ChatMsg => !!m && typeof (m as ChatMsg).content === 'string')
        .map((m: ChatMsg) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 800) }));
    }
    if (!history.length) return NextResponse.json({ error: 'message required' }, { status: 400 });

    const origin = new URL(request.url).origin;
    const result = await runAssistant(history, { payload, token, origin });
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('Assistant error:', err);
    return NextResponse.json({ error: 'Assistant failed' }, { status: 500 });
  }
}
