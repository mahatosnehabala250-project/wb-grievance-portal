export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { computeOperations } from '@/lib/intelligence';

/**
 * GET /api/intelligence/operations — Autonomous Operations / Action Queue (Level 10).
 * Scope-locked inside computeOperations (reuses getComplaintScopeFilter). Returns a
 * PROPOSAL queue of one-tap actions, each bound to a real ticket id + a real execute
 * route. Read-only endpoint: actual execution happens when the user approves and the
 * existing (audited, scope-checked) complaint route runs. Aggregate-only, honest gaps.
 */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const data = await computeOperations(payload);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Operations error:', error);
    return NextResponse.json({ error: 'Failed to generate operations queue' }, { status: 500 });
  }
}
