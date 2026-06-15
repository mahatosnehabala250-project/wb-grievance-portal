import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import { canMutateComplaints } from '@/lib/rbac';

// PATCH /api/complaints/bulk — bulk status update
export async function PATCH(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  // Role gate: KARYAKARTA is read-only
  if (!canMutateComplaints(payload)) {
    return NextResponse.json({ error: 'Your role cannot modify complaints' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { ids, status, resolution } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }
    if (!status || !['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: 'Valid status is required' }, { status: 400 });
    }

    // Scope-lock (governance role_level aware): updateMany only touches rows
    // inside the actor's jurisdiction, ANDed with the requested ids.
    const where: Record<string, unknown> = { id: { in: ids }, ...getComplaintScopeFilter(payload) };

    const result = await db.complaint.updateMany({
      where,
      data: {
        status,
        ...(resolution ? { resolution } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      updated: result.count,
      requested: ids.length,
    });
  } catch (error) {
    console.error('Bulk update error:', error);
    return NextResponse.json({ error: 'Failed to update complaints' }, { status: 500 });
  }
}
