import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { complaintInScope, canMutateComplaints, allowedComplaintFields, userInManageScope } from '@/lib/rbac';
import { notifyN8NAssignment } from '@/lib/n8n-webhook';

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

  // Full-hierarchy scope check (MP/MLA/district/block/GP/karyakarta)
  if (!complaintInScope(payload, complaint)) {
    return NextResponse.json({ error: 'Access denied — outside your jurisdiction' }, { status: 403 });
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

  // 1) Geographic scope: the complaint must be inside the actor's jurisdiction
  if (!complaintInScope(payload, complaint)) {
    return NextResponse.json({ error: 'Access denied — outside your jurisdiction' }, { status: 403 });
  }
  // 2) Role gate
  if (!canMutateComplaints(payload)) {
    return NextResponse.json({ error: 'Your role cannot modify complaints' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { status, resolution, assignedToId, urgency } = body;

    // 3) Field gate. A karyakarta verifies on the ground, so they may close a
    //    complaint — but choosing the owning officer or the urgency is the
    //    office's judgement, not theirs. Refused explicitly rather than ignored,
    //    so a caller is never told a change succeeded when it did not.
    const allowed = allowedComplaintFields(payload);
    if (allowed) {
      const attempted = ['status', 'resolution', 'assignedToId', 'urgency']
        .filter((f) => body[f] !== undefined && !allowed.has(f));
      if (attempted.length) {
        return NextResponse.json(
          { error: `Your role cannot change: ${attempted.join(', ')}` },
          { status: 403 }
        );
      }
    }

    // 4) Assignment scope: assignee must be an active user inside the actor's
    //    own jurisdiction (an MLA cannot assign an officer from another AC)
    if (assignedToId) {
      const assignee = await db.user.findUnique({ where: { id: assignedToId } });
      if (!assignee || assignee.isActive === false) {
        return NextResponse.json({ error: 'Assignee not found or inactive' }, { status: 400 });
      }
      const assigneeInScope =
        payload.role === 'ADMIN' || payload.role === 'STATE' ||
        (await userInManageScope(payload, assignee as Record<string, unknown>)) ||
        // Officers may also assign to themselves
        assignedToId === payload.userId;
      if (!assigneeInScope) {
        return NextResponse.json({ error: 'Assignee is outside your jurisdiction' }, { status: 403 });
      }
    }

    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (resolution !== undefined) data.resolution = resolution;
    if (assignedToId !== undefined) data.assignedToId = assignedToId || null;
    if (urgency) data.urgency = urgency.toUpperCase();

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

    }

    // ═══ CASCADE: Urgency Change → WB-04 (Officer Escalation Alert) ═══
    if (urgency && urgency.toUpperCase() !== complaint.urgency) {
      const newUrgency = urgency.toUpperCase();
      const previousUrgency = complaint.urgency;
      const urgencyOrder = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      const prevIdx = urgencyOrder.indexOf(previousUrgency);
      const newIdx = urgencyOrder.indexOf(newUrgency);

      // Only notify if urgency is actually increasing (escalation)
      if (newIdx > prevIdx) {
        await db.activityLog.create({
          data: {
            complaintId: id,
            action: 'ESCALATED',
            description: `Urgency escalated from ${previousUrgency} to ${newUrgency}`,
            actorId,
            actorName,
            metadata: JSON.stringify({ from: previousUrgency, to: newUrgency }),
          },
        });

        // Fire-and-forget: notify officer about urgency escalation → WB-04
      }
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

        // Awaited: a fire-and-forget call here dies when the serverless
        // function freezes on response, so the worker was never told.
        await notifyN8NAssignment(id, assignedToId);
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
    console.error('Update complaint error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Failed to update complaint' }, { status: 500 });
  }
}
