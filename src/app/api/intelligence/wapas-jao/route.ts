import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';

/**
 * GET /api/intelligence/wapas-jao — "Wapas Jao" visit briefs.
 *
 * The closed-loop politics feature: village-wise list of RESOLVED
 * complaints with citizen names, so the politician walks in saying
 * "Sumit ji, aapka paani ka kaam hua tha — kaisa chal raha hai?"
 *
 * Scope-locked via getComplaintScopeFilter (citizen names are already
 * visible to these users in ComplaintsView — this only re-groups data
 * they can access, it does NOT widen visibility).
 */

type C = Record<string, unknown>;
const str = (c: C, ...keys: string[]): string => {
  for (const k of keys) { const v = c[k]; if (typeof v === 'string' && v) return v; }
  return '';
};

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const where: Record<string, unknown> = {
      ...getComplaintScopeFilter(payload),
      status: 'RESOLVED',
    };

    const complaints: C[] = await db.complaint.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 1000,
    });

    // Group by village
    const villages: Record<string, {
      village: string;
      count: number;
      ratings: number[];
      items: Array<{
        ticketNo: string; citizenName: string; issue: string; category: string;
        resolution: string; rating: number | null; resolvedAt: string | null;
      }>;
    }> = {};

    for (const c of complaints) {
      const village = str(c, 'village') || str(c, 'gp_name', 'gpName') || 'Unknown';
      if (!villages[village]) villages[village] = { village, count: 0, ratings: [], items: [] };
      const v = villages[village];
      v.count++;
      const rating = typeof c.satisfactionRating === 'number' ? c.satisfactionRating : null;
      if (rating) v.ratings.push(rating);
      if (v.items.length < 20) {
        const resolvedAt = c.resolvedAt || c.updatedAt;
        v.items.push({
          ticketNo: str(c, 'ticketNo'),
          citizenName: str(c, 'citizenName') || 'Citizen',
          issue: str(c, 'issue'),
          category: str(c, 'category'),
          resolution: str(c, 'resolution'),
          rating,
          resolvedAt: resolvedAt instanceof Date ? resolvedAt.toISOString() : (typeof resolvedAt === 'string' ? resolvedAt : null),
        });
      }
    }

    const result = Object.values(villages)
      .map(v => ({
        village: v.village,
        count: v.count,
        avgRating: v.ratings.length
          ? Math.round((v.ratings.reduce((a, b) => a + b, 0) / v.ratings.length) * 10) / 10
          : null,
        items: v.items,
      }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({ data: { villages: result, totalResolved: complaints.length } });
  } catch (error) {
    console.error('Wapas Jao error:', error);
    return NextResponse.json({ error: 'Failed to build visit briefs' }, { status: 500 });
  }
}
