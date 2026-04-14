import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// PATCH /api/n8n/complaints/[id] — Public update for n8n workflows (no auth)
// Used by WB-02 to assign officers and update complaint fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verify complaint exists
    const complaint = await db.complaint.findUnique({ where: { id } });
    if (!complaint) {
      return NextResponse.json({ error: 'Complaint not found' }, { status: 404 });
    }

    const body = await request.json();
    const { status, assignedToId, urgency } = body;

    // Build update data
    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (assignedToId !== undefined) data.assignedToId = assignedToId || null;
    if (urgency) data.urgency = urgency.toUpperCase();

    // Skip update if nothing to change
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Perform update
    const updated = await db.complaint.update({
      where: { id },
      data,
    });

    // Create activity log entries for each change
    const actorName = 'n8n Workflow';
    const actorId = null;

    if (status && status !== complaint.status) {
      const statusLabels: Record<string, string> = {
        OPEN: 'Open', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved', REJECTED: 'Rejected',
      };
      await db.activityLog.create({
        data: {
          complaintId: id,
          action: 'STATUS_CHANGED',
          description: `Status changed from ${statusLabels[complaint.status] || complaint.status} to ${statusLabels[status] || status}`,
          actorId,
          actorName,
          metadata: JSON.stringify({ from: complaint.status, to: status, source: 'n8n' }),
        },
      });
    }

    if (assignedToId !== undefined && assignedToId !== complaint.assignedToId) {
      if (assignedToId) {
        const assignedUser = await db.user.findUnique({
          where: { id: assignedToId },
          select: { name: true },
        });
        const assignedName = assignedUser?.name || 'Unknown User';
        await db.activityLog.create({
          data: {
            complaintId: id,
            action: 'ASSIGNED',
            description: `Assigned to ${assignedName}`,
            actorId,
            actorName,
            metadata: JSON.stringify({ assignedToId, source: 'n8n' }),
          },
        });
      } else if (complaint.assignedToId) {
        await db.activityLog.create({
          data: {
            complaintId: id,
            action: 'UNASSIGNED',
            description: 'Assignment removed',
            actorId,
            actorName,
            metadata: JSON.stringify({ source: 'n8n' }),
          },
        });
      }
    }

    if (urgency && urgency.toUpperCase() !== complaint.urgency) {
      const newUrgency = urgency.toUpperCase();
      const previousUrgency = complaint.urgency;

      await db.activityLog.create({
        data: {
          complaintId: id,
          action: 'ESCALATED',
          description: `Urgency changed from ${previousUrgency} to ${newUrgency}`,
          actorId,
          actorName,
          metadata: JSON.stringify({ from: previousUrgency, to: newUrgency, source: 'n8n' }),
        },
      });
    }

    return NextResponse.json({
      success: true,
      complaint: updated,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[n8n] Complaint update error:', error);
    return NextResponse.json(
      { error: 'Failed to update complaint', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
