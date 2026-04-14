import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/n8n/stats — Public dashboard stats for n8n (WB-06)
// Returns same stats as dashboard but without auth
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    // Build optional date filter
    const where: Record<string, unknown> = {};
    if (fromParam) {
      const fromDate = new Date(fromParam);
      fromDate.setHours(0, 0, 0, 0);
      where.createdAt = { ...(where.createdAt as Record<string, unknown> || {}), gte: fromDate };
    }
    if (toParam) {
      const toDate = new Date(toParam);
      toDate.setHours(23, 59, 59, 999);
      where.createdAt = { ...(where.createdAt as Record<string, unknown> || {}), lte: toDate };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Single query — compute all KPIs in-memory
    const allComplaints = await db.complaint.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    let total = 0, open = 0, inProgress = 0, resolved = 0, rejected = 0, critical = 0;
    let todayComplaints = 0, slaBreaches = 0;
    const categoryMap: Record<string, number> = {};
    const districtMap: Record<string, number> = {};

    for (const c of allComplaints) {
      total++;
      if (c.status === 'OPEN') open++;
      if (c.status === 'IN_PROGRESS') inProgress++;
      if (c.status === 'RESOLVED') resolved++;
      if (c.status === 'REJECTED') rejected++;
      if (c.urgency === 'CRITICAL') critical++;

      if (c.createdAt >= today) todayComplaints++;

      // SLA breaches: open/in-progress > 7 days
      if ((c.status === 'OPEN' || c.status === 'IN_PROGRESS') && c.createdAt < sevenDaysAgo) {
        slaBreaches++;
      }

      // Category breakdown
      categoryMap[c.category] = (categoryMap[c.category] || 0) + 1;

      // District breakdown
      districtMap[c.district] = (districtMap[c.district] || 0) + 1;
    }

    const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;
    const byCategory = Object.entries(categoryMap)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
    const byDistrict = Object.entries(districtMap)
      .map(([district, count]) => ({ district, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      stats: {
        total,
        open,
        inProgress,
        resolved,
        rejected,
        critical,
        todayComplaints,
        resolutionRate,
        slaBreaches,
      },
      byCategory,
      byDistrict,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[n8n] Stats query error:', error);
    return NextResponse.json(
      { error: 'Failed to load stats', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
