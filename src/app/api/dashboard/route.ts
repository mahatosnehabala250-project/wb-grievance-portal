import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/dashboard — role-based dashboard statistics
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  // Build where clause based on role
  const where: Record<string, unknown> = {};
  if (payload.role === 'BLOCK') where.block = payload.location;
  else if (payload.role === 'DISTRICT') where.district = payload.location;

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

  const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

  const stats = {
    total, open, inProgress, resolved, rejected, critical,
    todayComplaints, todayResolved, resolutionRate,
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
    name: g[groupByField],
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
    const key = g[groupByField];
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

  // ─── Critical Complaints ───
  const criticalComplaints = await db.complaint.findMany({
    where: { ...where, urgency: 'CRITICAL', status: { in: ['OPEN', 'IN_PROGRESS'] } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  return NextResponse.json({
    stats,
    byCategory,
    byGroup: byGroupWithStatus,
    groupByField,
    monthlyTrend,
    byUrgency,
    recent,
    criticalComplaints,
    userRole: payload.role,
    userLocation: payload.location,
  });
}
