import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { computeIntelligenceBrief } from '@/lib/intelligence';

/**
 * GET /api/intelligence/brief — role-adaptive intelligence brief.
 * Computation lives in src/lib/intelligence.ts (shared with the 7AM
 * Telegram push cron). Scope is enforced inside computeIntelligenceBrief
 * via getComplaintScopeFilter — same boundary as /api/complaints.
 */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const data = await computeIntelligenceBrief(payload);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Intelligence brief error:', error);
    return NextResponse.json({ error: 'Failed to generate intelligence brief' }, { status: 500 });
  }
}
