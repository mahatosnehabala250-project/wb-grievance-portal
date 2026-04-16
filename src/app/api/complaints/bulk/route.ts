import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// PATCH /api/complaints/bulk — bulk status update
export async function PATCH(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  try {
    const body = await request.json();
    const { ids, status, resolution } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }
    if (!status || !['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: 'Valid status is required' }, { status: 400 });
    }

    // Build where clause based on role
    const where: Record<string, unknown> = { id: { in: ids } };
    if (payload.role === 'BLOCK') {
      where.block = payload.block;
    } else if (payload.role === 'DISTRICT') {
      where.district = payload.block;
    }

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
