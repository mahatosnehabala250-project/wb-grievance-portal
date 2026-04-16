import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// PATCH /api/complaints/[id]/reopen — reopen a resolved/rejected complaint
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const { id } = await params;

  const complaint = await db.complaint.findUnique({ where: { id } });
  if (!complaint) {
    return NextResponse.json({ error: 'Complaint not found' }, { status: 404 });
  }

  // Check permission
  if (payload.role === 'BLOCK' && complaint.block !== payload.block) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  if (payload.role === 'DISTRICT' && complaint.district !== payload.block) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // Only allow reopening RESOLVED or REJECTED complaints
  if (complaint.status !== 'RESOLVED' && complaint.status !== 'REJECTED') {
    return NextResponse.json(
      { error: 'Can only reopen resolved or rejected complaints' },
      { status: 400 }
    );
  }

  const actorName = payload.name || payload.username || 'System';
  const actorId = payload.userId || null;

  const updated = await db.complaint.update({
    where: { id },
    data: { status: 'OPEN' },
  });

  // Log reopen activity
  await db.activityLog.create({
    data: {
      complaintId: id,
      action: 'REOPENED',
      description: `Complaint reopened by ${actorName}`,
      actorId,
      actorName,
      metadata: JSON.stringify({ previousStatus: complaint.status }),
    },
  });

  return NextResponse.json({
    complaint: updated,
    success: true,
    previousStatus: complaint.status,
  });
}
