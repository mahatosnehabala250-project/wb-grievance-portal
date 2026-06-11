import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { getUserListScope } from '@/lib/rbac';

// GET /api/users/list — assignable users for complaint assignment dropdowns.
// SCOPED: each actor only sees users inside their own jurisdiction
// (previously this leaked the full state-wide officer list to any login).
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  try {
    const scope = await getUserListScope(payload);

    // KARYAKARTA/OFFICER can't manage users → empty assignable list
    if ((scope.where as Record<string, unknown>).id === '__none__') {
      return NextResponse.json({ users: [] });
    }

    const where: Record<string, unknown> = {
      ...scope.where,
      isActive: true,
      role: { in: ['BLOCK', 'DISTRICT', 'STATE'] },
    };

    let users = await db.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        block: true,
        district: true,
        role_level: true,
        constituency: true,
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });

    if (scope.postFilter) {
      users = users.filter(scope.postFilter);
    }

    return NextResponse.json({ users });
  } catch (error) {
    console.error('User list error:', error);
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  }
}
