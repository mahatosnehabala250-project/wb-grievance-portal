import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { notifyN8NStatusChange, notifyN8NAssignment } from '@/lib/n8n-webhook';

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

// PATCH /api/complaints/[id] — update status/resolution/assignment
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

    // Log activities
    const actorName = payload.username || 'System';
    const actorId = payload.userId || null;

    if (status && status !== complaint.status) {
      const statusLabels: Record<string, string> = {
        OPEN: 'Open', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved', REJECTED: 'Rejected',
      };
      await db.activityLog.create({
        data: {
          complaintId: id,
          action: `STATUS_CHANGED`,
          description: `Status changed from ${statusLabels[complaint.status] || complaint.status} to ${statusLabels[status] || status}`,
          actorId,
          actorName,
          metadata: JSON.stringify({ from: complaint.status, to: status }),
        },
      });

      // If resolved, create a RESOLVED activity too
      if (status === 'RESOLVED') {
        await db.activityLog.create({
          data: {
            complaintId: id,
            action: 'RESOLVED',
            description: resolution ? `Resolved with note: ${resolution}` : 'Complaint marked as resolved',
            actorId,
            actorName,
          },
        });
      }

      // Fire-and-forget: notify n8n of status change
      notifyN8NStatusChange(id, status);
    }

    if (assignedToId !== undefined && assignedToId !== complaint.assignedToId) {
      if (assignedToId) {
        // Look up the assigned user's name
        const assignedUser = await db.user.findUnique({ where: { id: assignedToId }, select: { name: true } });
        const assignedName = assignedUser?.name || 'Unknown User';
        await db.activityLog.create({
          data: {
            complaintId: id,
            action: 'ASSIGNED',
            description: `Assigned to ${assignedName}`,
            actorId,
            actorName,
            metadata: JSON.stringify({ assignedToId }),
          },
        });

        // Fire-and-forget: notify n8n of assignment
        notifyN8NAssignment(id, assignedToId);
      } else if (complaint.assignedToId) {
        await db.activityLog.create({
          data: {
            complaintId: id,
            action: 'UNASSIGNED',
            description: 'Assignment removed',
            actorId,
            actorName,
          },
        });
      }
    }

    return NextResponse.json({ complaint: updated, success: true });
  } catch (error) {
    console.error('Update complaint error:', error);
    return NextResponse.json({ error: 'Failed to update complaint' }, { status: 500 });
  }
}
