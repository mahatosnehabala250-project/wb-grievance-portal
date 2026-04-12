import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/dashboard — role-based dashboard statistics (supports date range filtering)
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    // Build where clause based on role
    const where: Record<string, unknown> = {};
    if (payload.role === 'BLOCK') where.block = payload.location;
    else if (payload.role === 'DISTRICT') where.district = payload.location;

    // ─── Date Range Filter ───
    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    const dateFilter: Record<string, unknown> = {};
    if (fromParam) {
      const fromDate = new Date(fromParam);
      fromDate.setHours(0, 0, 0, 0);
      dateFilter.gte = fromDate;
    }
    if (toParam) {
      const toDate = new Date(toParam);
      toDate.setHours(23, 59, 59, 999);
      dateFilter.lte = toDate;
    }
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter;
    }

    // ─── KPI Stats ───
    const [
      total,
      open,
      inProgress,
      resolved,
      rejected,
      critical,
      todayComplaints,
      todayResolved,
    ] = await Promise.all([
      db.complaint.count({ where }),
      db.complaint.count({ where: { ...where, status: 'OPEN' } }),
      db.complaint.count({ where: { ...where, status: 'IN_PROGRESS' } }),
      db.complaint.count({ where: { ...where, status: 'RESOLVED' } }),
      db.complaint.count({ where: { ...where, status: 'REJECTED' } }),
      db.complaint.count({ where: { ...where, urgency: 'CRITICAL' } }),
      db.complaint.count({
        where: {
          ...where,
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      db.complaint.count({
        where: {
          ...where,
          status: 'RESOLVED',
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    // ─── SLA Breaches (open complaints > 7 days old) ───
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Build a where clause without the date filter for SLA breaches (always count current state)
    const slaWhere: Record<string, unknown> = {};
    if (payload.role === 'BLOCK') slaWhere.block = payload.location;
    else if (payload.role === 'DISTRICT') slaWhere.district = payload.location;

    const slaBreaches = await db.complaint.count({
      where: {
        ...slaWhere,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        createdAt: { lt: sevenDaysAgo },
      },
    });

    const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

    // ─── Satisfaction Metrics ───
    const ratedComplaints = await db.complaint.findMany({
      where: {
        ...where,
        satisfactionRating: { not: null },
      },
      select: { satisfactionRating: true },
    });

    const ratedCount = ratedComplaints.length;
    const avgSatisfaction = ratedCount > 0
      ? Math.round((ratedComplaints.reduce((sum, c) => sum + (c.satisfactionRating || 0), 0) / ratedCount) * 10) / 10
      : null;

    // Satisfaction distribution (1-5)
    const satisfactionDistribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const c of ratedComplaints) {
      const key = String(c.satisfactionRating);
      if (satisfactionDistribution[key] !== undefined) {
        satisfactionDistribution[key]++;
      }
    }

    const stats = {
      total, open, inProgress, resolved, rejected, critical,
      todayComplaints, todayResolved, resolutionRate, slaBreaches,
      avgSatisfaction, ratedCount,
    };

    // ─── Complaints by Category ───
    const categoryData = await db.complaint.groupBy({
      by: ['category'],
      where,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });
    const byCategory = categoryData.map((c) => ({
      category: c.category,
      count: c._count.id,
    }));

    // ─── Complaints by Block / District ───
    const groupByField = payload.role === 'STATE' || payload.role === 'ADMIN'
      ? 'district'
      : 'block';

    const groupData = await db.complaint.groupBy({
      by: [groupByField],
      where,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    const byGroup = groupData.map((g) => ({
      name: g[groupByField] as string,
      count: g._count.id,
    }));

    // Also get status breakdown per group
    const groupStatusData = await db.complaint.groupBy({
      by: [groupByField, 'status'],
      where,
      _count: { id: true },
    });

    const groupMap: Record<string, Record<string, number>> = {};
    for (const g of groupStatusData) {
      const key = g[groupByField] as string;
      if (!groupMap[key]) groupMap[key] = {};
      groupMap[key][g.status] = g._count.id;
    }

    const byGroupWithStatus = byGroup.map((g) => ({
      name: g.name,
      count: g.count,
      open: groupMap[g.name]?.OPEN || 0,
      inProgress: groupMap[g.name]?.IN_PROGRESS || 0,
      resolved: groupMap[g.name]?.RESOLVED || 0,
      rejected: groupMap[g.name]?.REJECTED || 0,
    }));

    // ─── Monthly Trend (last 6 months) ───
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const recentComplaints = await db.complaint.findMany({
      where: { ...where, createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true, status: true },
    });

    const monthlyMap: Record<string, { open: number; inProgress: number; resolved: number; total: number }> = {};
    for (const c of recentComplaints) {
      const key = `${c.createdAt.getFullYear()}-${String(c.createdAt.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) monthlyMap[key] = { open: 0, inProgress: 0, resolved: 0, total: 0 };
      monthlyMap[key].total++;
      if (c.status === 'OPEN') monthlyMap[key].open++;
      else if (c.status === 'IN_PROGRESS') monthlyMap[key].inProgress++;
      else if (c.status === 'RESOLVED') monthlyMap[key].resolved++;
    }

    const monthlyTrend = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => {
        const d = new Date(month + '-15');
        return {
          month,
          label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
          ...data,
        };
      });

    // ─── Urgency Distribution ───
    const urgencyData = await db.complaint.groupBy({
      by: ['urgency'],
      where,
      _count: { id: true },
    });
    const byUrgency = urgencyData.map((u) => ({
      urgency: u.urgency,
      count: u._count.id,
    }));

    // ─── Recent Complaints (latest 10) ───
    const recent = await db.complaint.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // ─── Critical Complaints (sorted by oldest first = most urgent) ───
    const criticalComplaints = await db.complaint.findMany({
      where: { ...slaWhere, urgency: 'CRITICAL', status: { in: ['OPEN', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });

    // ─── Open Complaints sorted by oldest first (for SLA view) ───
    const openComplaints = await db.complaint.findMany({
      where: { ...slaWhere, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });

    return NextResponse.json({
      stats,
      satisfactionDistribution,
      byCategory,
      byGroup: byGroupWithStatus,
      groupByField,
      monthlyTrend,
      byUrgency,
      recent,
      criticalComplaints,
      openComplaints,
      userRole: payload.role,
      userLocation: payload.location,
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    return NextResponse.json(
      { error: 'Failed to load dashboard data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
