import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/dashboard — role-based dashboard statistics (optimized for Supabase pooler)
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

    // ─── OPTIMIZED: Fetch all complaints at once instead of 15+ queries ───
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    // Single query to get all complaints (we only have 10-20 records)
    const allComplaints = await db.complaint.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // ─── Compute all KPIs from the single dataset (no extra DB queries) ───
    let total = 0, open = 0, inProgress = 0, resolved = 0, rejected = 0, critical = 0;
    let todayComplaints = 0, todayResolved = 0, slaBreaches = 0;
    const satisfactionRatings: number[] = [];
    const satisfactionDistribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    const categoryMap: Record<string, number> = {};
    const groupByField = payload.role === 'STATE' || payload.role === 'ADMIN' ? 'district' : 'block';
    const groupMap: Record<string, { count: number; open: number; inProgress: number; resolved: number; rejected: number }> = {};
    const urgencyMap: Record<string, number> = {};
    const monthlyMap: Record<string, { open: number; inProgress: number; resolved: number; total: number }> = {};

    const slaWhere: Record<string, unknown> = {};
    if (payload.role === 'BLOCK') slaWhere.block = payload.location;
    else if (payload.role === 'DISTRICT') slaWhere.district = payload.location;

    for (const c of allComplaints) {
      total++;
      if (c.status === 'OPEN') open++;
      if (c.status === 'IN_PROGRESS') inProgress++;
      if (c.status === 'RESOLVED') resolved++;
      if (c.status === 'REJECTED') rejected++;
      if (c.urgency === 'CRITICAL') critical++;

      // Today counts
      if (c.createdAt >= today) {
        todayComplaints++;
        if (c.status === 'RESOLVED') todayResolved++;
      }

      // SLA breaches
      const matchSla = (!slaWhere.block && !slaWhere.district) ||
        (slaWhere.block === c.block) || (slaWhere.district === c.district);
      if (matchSla && (c.status === 'OPEN' || c.status === 'IN_PROGRESS') && c.createdAt < sevenDaysAgo) {
        slaBreaches++;
      }

      // Satisfaction
      if (c.satisfactionRating) {
        satisfactionRatings.push(c.satisfactionRating);
        const key = String(c.satisfactionRating);
        if (satisfactionDistribution[key] !== undefined) satisfactionDistribution[key]++;
      }

      // Category
      categoryMap[c.category] = (categoryMap[c.category] || 0) + 1;

      // Group (district/block)
      const gKey = (c as Record<string, unknown>)[groupByField] as string;
      if (!groupMap[gKey]) groupMap[gKey] = { count: 0, open: 0, inProgress: 0, resolved: 0, rejected: 0 };
      groupMap[gKey].count++;
      if (c.status === 'OPEN') groupMap[gKey].open++;
      if (c.status === 'IN_PROGRESS') groupMap[gKey].inProgress++;
      if (c.status === 'RESOLVED') groupMap[gKey].resolved++;
      if (c.status === 'REJECTED') groupMap[gKey].rejected++;

      // Urgency
      urgencyMap[c.urgency] = (urgencyMap[c.urgency] || 0) + 1;

      // Monthly trend (only recent 6 months)
      if (c.createdAt >= sixMonthsAgo) {
        const monthKey = `${c.createdAt.getFullYear()}-${String(c.createdAt.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { open: 0, inProgress: 0, resolved: 0, total: 0 };
        monthlyMap[monthKey].total++;
        if (c.status === 'OPEN') monthlyMap[monthKey].open++;
        else if (c.status === 'IN_PROGRESS') monthlyMap[monthKey].inProgress++;
        else if (c.status === 'RESOLVED') monthlyMap[monthKey].resolved++;
      }
    }

    const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;
    const avgSatisfaction = satisfactionRatings.length > 0
      ? Math.round((satisfactionRatings.reduce((sum, r) => sum + r, 0) / satisfactionRatings.length) * 10) / 10
      : null;

    // Build response arrays
    const byCategory = Object.entries(categoryMap).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
    const byGroup = Object.entries(groupMap).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.count - a.count);
    const monthlyTrend = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => {
        const d = new Date(month + '-15');
        return { month, label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), ...data };
      });
    const byUrgency = Object.entries(urgencyMap).map(([urgency, count]) => ({ urgency, count }));

    const stats = { total, open, inProgress, resolved, rejected, critical, todayComplaints, todayResolved, resolutionRate, slaBreaches, avgSatisfaction, ratedCount: satisfactionRatings.length };

    // Recent and critical (already sorted by createdAt desc from query)
    const recent = allComplaints.slice(0, 10);
    const criticalComplaints = allComplaints.filter(c => c.urgency === 'CRITICAL' && (c.status === 'OPEN' || c.status === 'IN_PROGRESS')).slice(0, 5);
    const openComplaints = allComplaints.filter(c => c.status === 'OPEN').reverse().slice(0, 5);

    return NextResponse.json({
      stats,
      satisfactionDistribution,
      byCategory,
      byGroup,
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
