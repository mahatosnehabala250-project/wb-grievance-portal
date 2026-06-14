import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { computeForecast } from '@/lib/intelligence';

/**
 * GET /api/intelligence/forecast — Predictive Engine (Level 6).
 * Scope is enforced INSIDE computeForecast via getComplaintScopeFilter
 * (it reuses computeIntelligenceBrief) — same boundary as /api/complaints.
 * Honest by design: ranges + "not enough data" gating + caveats, never
 * fake-precision point forecasts. Aggregate-only.
 */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const data = await computeForecast(payload);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Forecast error:', error);
    return NextResponse.json({ error: 'Failed to generate forecast' }, { status: 500 });
  }
}
