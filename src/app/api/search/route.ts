import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/search?q=xxx — global search for command palette
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const q = request.nextUrl.searchParams.get('q');
  if (!q || q.trim().length < 1) {
    return NextResponse.json({ complaints: [], users: [] });
  }

  const query = q.trim();

  // Build role-based where for complaints
  const complaintWhere: Record<string, unknown> = {
    OR: [
      { ticketNo: { contains: query } },
      { citizenName: { contains: query } },
      { issue: { contains: query } },
      { phone: { contains: query } },
      { block: { contains: query } },
      { category: { contains: query } },
    ],
  };

  if (payload.role === 'BLOCK') {
    complaintWhere.block = payload.location;
  } else if (payload.role === 'DISTRICT') {
    complaintWhere.district = payload.location;
  }

  // Build role-based where for users (admin only)
  const userWhere: Record<string, unknown> = {};
  if (payload.role === 'ADMIN') {
    userWhere.OR = [
      { name: { contains: query } },
      { username: { contains: query } },
      { location: { contains: query } },
    ];
  }

  const [complaints, users] = await Promise.all([
    db.complaint.findMany({
      where: complaintWhere,
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        ticketNo: true,
        issue: true,
        status: true,
        urgency: true,
        citizenName: true,
        category: true,
        block: true,
        district: true,
        createdAt: true,
      },
    }),
    payload.role === 'ADMIN'
      ? db.user.findMany({
          where: userWhere,
          take: 5,
          select: { id: true, name: true, username: true, role: true, location: true, isActive: true },
        })
      : Promise.resolve([]),
  ]);

  return NextResponse.json({ complaints, users });
}
