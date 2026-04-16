import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// PATCH /api/complaints/[id]/escalate — escalate complaint urgency
const URGENCY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

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

  // Only allow escalation for OPEN or IN_PROGRESS complaints
  if (complaint.status !== 'OPEN' && complaint.status !== 'IN_PROGRESS') {
    return NextResponse.json({ error: 'Can only escalate open or in-progress complaints' }, { status: 400 });
  }

  const currentIdx = URGENCY_LEVELS.indexOf(complaint.urgency as typeof URGENCY_LEVELS[number]);
  if (currentIdx === -1) {
    return NextResponse.json({ error: 'Invalid current urgency level' }, { status: 400 });
  }

  // Already at maximum urgency
  if (currentIdx === URGENCY_LEVELS.length - 1) {
    return NextResponse.json({ error: 'Complaint is already at CRITICAL urgency' }, { status: 400 });
  }

  const newUrgency = URGENCY_LEVELS[currentIdx + 1];
  const actorName = payload.username || 'System';
  const actorId = payload.userId || null;

  const updated = await db.complaint.update({
    where: { id },
    data: { urgency: newUrgency },
  });

  // Log escalation activity
  await db.activityLog.create({
    data: {
      complaintId: id,
      action: 'ESCALATED',
      description: `Escalated from ${complaint.urgency} to ${newUrgency} by ${actorName}`,
      actorId,
      actorName,
      metadata: JSON.stringify({ from: complaint.urgency, to: newUrgency }),
    },
  });

  return NextResponse.json({
    complaint: updated,
    success: true,
    previousUrgency: complaint.urgency,
    newUrgency,
  });
}
