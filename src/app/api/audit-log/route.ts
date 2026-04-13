import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/audit-log — fetch activity log entries (admin only)
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  // Admin only
  if (payload.role !== 'ADMIN' && payload.role !== 'STATE') {
    return NextResponse.json({ error: 'Access denied. Admin or State role required.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const action = searchParams.get('action') || '';

  const where: Record<string, unknown> = {};
  if (action) {
    where.action = action;
  }

  const [entries, total] = await Promise.all([
    db.activityLog.findMany({
      where,
      include: {
        complaint: {
          select: { ticketNo: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.activityLog.count({ where }),
  ]);

  const formatted = entries.map((e) => ({
    id: e.id,
    complaintId: e.complaintId,
    ticketNo: e.complaint.ticketNo,
    action: e.action,
    description: e.description,
    actorName: e.actorName,
    createdAt: e.createdAt.toISOString(),
  }));

  return NextResponse.json({
    entries: formatted,
    total,
    limit,
    offset,
  });
}
