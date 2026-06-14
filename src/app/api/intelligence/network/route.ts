export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { computeNetwork } from '@/lib/intelligence';

/**
 * GET /api/intelligence/network — Network Intelligence (Level 8).
 * Scope-locked inside computeNetwork. Returns the REAL organisational/escalation
 * tree (load + unresolved% + anger) with weakest-link detection, a thin clearly-
 * caveated issue co-occurrence panel, and honest "not enough data / not connected"
 * gaps for cascade graphs + competitor watch. Aggregate-only.
 */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const data = await computeNetwork(payload);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Network error:', error);
    return NextResponse.json({ error: 'Failed to generate network intelligence' }, { status: 500 });
  }
}
