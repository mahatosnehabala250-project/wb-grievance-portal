import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/complaints/[id]
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
  if (payload.role === 'BLOCK' && complaint.block !== payload.location) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  if (payload.role === 'DISTRICT' && complaint.district !== payload.location) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  return NextResponse.json({ complaint });
}

// PATCH /api/complaints/[id] — update status/resolution
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
  if (payload.role === 'BLOCK' && complaint.block !== payload.location) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  if (payload.role === 'DISTRICT' && complaint.district !== payload.location) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { status, resolution, assignedToId } = body;

    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (resolution !== undefined) data.resolution = resolution;
    if (assignedToId !== undefined) data.assignedToId = assignedToId || null;

    const updated = await db.complaint.update({
      where: { id },
      data,
    });

    return NextResponse.json({ complaint: updated, success: true });
  } catch (error) {
    console.error('Update complaint error:', error);
    return NextResponse.json({ error: 'Failed to update complaint' }, { status: 500 });
  }
}
