export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { computeFusion } from '@/lib/intelligence';

/**
 * GET /api/intelligence/fusion — Data Fusion / Entity Ontology (Level 7).
 * Scope-locked inside computeFusion via getComplaintScopeFilter (reuses
 * computeIntelligenceBrief). Fuses ONLY real signals; missing external sources
 * are returned as labeled "not connected" placeholders, never fabricated.
 */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const data = await computeFusion(payload);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Fusion error:', error);
    return NextResponse.json({ error: 'Failed to generate fusion profile' }, { status: 500 });
  }
}
