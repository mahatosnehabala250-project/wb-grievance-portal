import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/users/list — fetch users for assignment dropdown
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  // Fetch active users (excluding ADMIN) that could handle complaints
  const users = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: ['BLOCK', 'DISTRICT', 'STATE'] },
    },
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      location: true,
      district: true,
    },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });

  return NextResponse.json({ users });
}
