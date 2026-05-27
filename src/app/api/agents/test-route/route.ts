import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { decide, type SessionInput, type MessageInput } from '@/lib/router/ceoRouter';

/**
 * POST /api/agents/test-route
 *
 * Admin-only endpoint used by the CEORouterTester component on /dashboard/agents.
 * Accepts a sample message + session state and returns the CEO Router's decision
 * without any side effects (no DB writes, no n8n calls).
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md §API Endpoint Contracts
 * @see Requirements 15.3
 */
export async function POST(request: NextRequest) {
  // Auth: admin JWT only
  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 401 });
  }

  if (payload.role !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Admin access required' }, { status: 403 });
  }

  // Parse body
  let body: { message?: string; last_intent?: string; language?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate required field
  if (!body.message || typeof body.message !== 'string' || body.message.trim() === '') {
    return NextResponse.json({ ok: false, error: 'message is required' }, { status: 400 });
  }

  const language = (body.language as 'en' | 'hi' | 'bn') || 'hi';
  if (!['en', 'hi', 'bn'].includes(language)) {
    return NextResponse.json({ ok: false, error: 'language must be one of: en, hi, bn' }, { status: 400 });
  }

  const lastIntent = body.last_intent || 'idle';

  // Build synthetic session and message inputs
  const session: SessionInput = {
    last_intent: lastIntent,
    last_activity_at: new Date().toISOString(), // fresh session (not stale)
    language,
  };

  const messageInput: MessageInput = {
    text: body.message.toLowerCase(),
    original_text: body.message,
  };

  // Call the CEO Router
  const decision = decide(session, messageInput);

  return NextResponse.json({
    ok: true,
    data: {
      agent: decision.agent,
      reason: decision.reason,
      rules_evaluated: decision.rulesEvaluated,
    },
  });
}
