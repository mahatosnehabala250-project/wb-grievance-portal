import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/leaderboard — officer performance rankings (admin only)
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  if (payload.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  try {
    // Get all non-admin active users
    const officers = await db.user.findMany({
      where: { role: { in: ['STATE', 'DISTRICT', 'BLOCK'] }, isActive: true },
      select: { id: true, username: true, name: true, role: true, location: true, district: true },
    });

    // Get complaint counts per assigned officer
    const assignedAgg = await db.complaint.groupBy({
      by: ['assignedToId'],
      where: { assignedToId: { not: null } },
      _count: { id: true },
    });

    const resolvedAgg = await db.complaint.groupBy({
      by: ['assignedToId'],
      where: { assignedToId: { not: null }, status: 'RESOLVED' },
      _count: { id: true },
    });

    const inProgressAgg = await db.complaint.groupBy({
      by: ['assignedToId'],
      where: { assignedToId: { not: null }, status: 'IN_PROGRESS' },
      _count: { id: true },
    });

    const assignedMap = new Map(assignedAgg.map(a => [a.assignedToId, a._count.id]));
    const resolvedMap = new Map(resolvedAgg.map(a => [a.assignedToId, a._count.id]));
    const inProgressMap = new Map(inProgressAgg.map(a => [a.assignedToId, a._count.id]));

    const leaderboard = officers.map(o => {
      const assigned = assignedMap.get(o.id) || 0;
      const resolved = resolvedMap.get(o.id) || 0;
      const inProgress = inProgressMap.get(o.id) || 0;
      const rate = assigned > 0 ? Math.round((resolved / assigned) * 100) : 0;
      return {
        id: o.id,
        username: o.username,
        name: o.name,
        role: o.role,
        location: o.location,
        district: o.district,
        assigned,
        resolved,
        inProgress,
        open: assigned - resolved - inProgress,
        resolutionRate: rate,
      };
    });

    // Sort: by resolution rate desc, then by total resolved desc
    leaderboard.sort((a, b) => b.resolutionRate - a.resolutionRate || b.resolved - a.resolved);

    return NextResponse.json({ leaderboard });
  } catch (error) {
    console.error('Leaderboard error:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}
