import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

function getWeekBounds(weekOffset: number = 0) {
  const now = new Date();
  // Get current day of week (0=Sun, 1=Mon, ..., 6=Sat)
  const currentDay = now.getDay();
  // Calculate Monday of current week (or target week)
  const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset + (weekOffset * 7));
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// GET /api/reports/weekly — weekly summary report
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const weekParam = parseInt(searchParams.get('week') || '0', 10);
  const { start, end } = getWeekBounds(weekParam);

  try {
    // Build where clause based on role
    const baseWhere: Record<string, unknown> = {
      createdAt: { gte: start, lte: end },
    };
    if (payload.role === 'BLOCK') {
      baseWhere.block = payload.block;
    } else if (payload.role === 'DISTRICT') {
      baseWhere.district = payload.block;
    }

    // 1. Total new complaints this week
    const totalNew = await db.complaint.count({ where: baseWhere });

    // 2. Total resolved this week (from activity log)
    const resolvedWhere: Record<string, unknown> = {
      action: 'RESOLVED',
      createdAt: { gte: start, lte: end },
    };
    const totalResolved = await db.activityLog.count({ where: resolvedWhere });

    // 3. Total escalated this week
    const escalatedWhere: Record<string, unknown> = {
      action: 'ESCALATED',
      createdAt: { gte: start, lte: end },
    };
    const totalEscalated = await db.activityLog.count({ where: escalatedWhere });

    // 4. Average resolution days (complaints resolved this week)
    const resolvedActivities = await db.activityLog.findMany({
      where: {
        action: 'RESOLVED',
        createdAt: { gte: start, lte: end },
      },
      select: { complaintId: true },
      distinct: ['complaintId'],
    });

    let avgResolutionDays: number | null = null;
    if (resolvedActivities.length > 0) {
      const resolvedComplaints = await db.complaint.findMany({
        where: { id: { in: resolvedActivities.map(a => a.complaintId) } },
        select: { id: true, createdAt: true },
      });

      const resolutionLogs = await db.activityLog.findMany({
        where: {
          action: 'RESOLVED',
          complaintId: { in: resolvedActivities.map(a => a.complaintId) },
        },
        select: { complaintId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      // For each complaint, find the first RESOLVED log
      const firstResolutionMap = new Map<string, Date>();
      for (const log of resolutionLogs) {
        if (!firstResolutionMap.has(log.complaintId)) {
          firstResolutionMap.set(log.complaintId, log.createdAt);
        }
      }

      let totalDays = 0;
      let count = 0;
      for (const comp of resolvedComplaints) {
        const resolvedAt = firstResolutionMap.get(comp.id);
        if (resolvedAt) {
          const diffMs = resolvedAt.getTime() - comp.createdAt.getTime();
          const diffDays = diffMs / (1000 * 60 * 60 * 24);
          totalDays += diffDays;
          count++;
        }
      }
      avgResolutionDays = count > 0 ? Math.round((totalDays / count) * 10) / 10 : null;
    }

    // 5. Top 5 categories this week
    const topCategories = await db.complaint.groupBy({
      by: ['category'],
      where: baseWhere,
      _count: { category: true },
      orderBy: { _count: { category: 'desc' } },
      take: 5,
    });

    // 6. Top 5 blocks this week
    const topBlocks = await db.complaint.groupBy({
      by: ['block'],
      where: baseWhere,
      _count: { block: true },
      orderBy: { _count: { block: 'desc' } },
      take: 5,
    });

    // 7. SLA breach count (open/in-progress complaints older than 7 days, created this week or before)
    const slaBreachWhere: Record<string, unknown> = {
      status: { in: ['OPEN', 'IN_PROGRESS'] },
      createdAt: { lte: end },
    };
    if (payload.role === 'BLOCK') {
      slaBreachWhere.block = payload.block;
    } else if (payload.role === 'DISTRICT') {
      slaBreachWhere.district = payload.block;
    }
    const allOpenComplaints = await db.complaint.findMany({
      where: slaBreachWhere,
      select: { id: true, createdAt: true },
    });
    const slaBreachCount = allOpenComplaints.filter(c => {
      const daysOld = (Date.now() - c.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      return daysOld > 7;
    }).length;

    // 8. Daily trend (7 days)
    const dailyTrend: { day: string; date: string; newCount: number; resolvedCount: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(start);
      dayStart.setDate(start.getDate() + i);
      dayStart.setHours(0, 0, 0, 0);

      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const dayWhere: Record<string, unknown> = {
        createdAt: { gte: dayStart, lte: dayEnd },
      };
      if (payload.role === 'BLOCK') dayWhere.block = payload.block;
      else if (payload.role === 'DISTRICT') dayWhere.district = payload.block;

      const [newCount, resolvedCountResult] = await Promise.all([
        db.complaint.count({ where: dayWhere }),
        db.activityLog.count({
          where: {
            action: 'RESOLVED',
            createdAt: { gte: dayStart, lte: dayEnd },
          },
        }),
      ]);

      dailyTrend.push({
        day: DAY_LABELS[i],
        date: dayStart.toISOString().split('T')[0],
        newCount,
        resolvedCount: resolvedCountResult,
      });
    }

    return NextResponse.json({
      report: {
        weekStart: start.toISOString(),
        weekEnd: end.toISOString(),
        totalNew,
        totalResolved,
        totalEscalated,
        avgResolutionDays,
        topCategories: topCategories.map(c => ({
          category: c.category,
          count: c._count.category,
        })),
        topBlocks: topBlocks.map(b => ({
          block: b.block,
          count: b._count.block,
        })),
        slaBreachCount,
        dailyTrend,
      },
    });
  } catch (error) {
    console.error('Failed to generate weekly report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
