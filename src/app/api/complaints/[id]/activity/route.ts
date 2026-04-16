import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/complaints/[id]/activity — fetch activity log for a complaint
export async function GET(
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

  const activities = await db.activityLog.findMany({
    where: { complaintId: id },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ activities });
}
