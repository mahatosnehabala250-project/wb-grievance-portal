import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/complaints/[id]/comments — fetch all comments for a complaint
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

  const comments = await db.comment.findMany({
    where: { complaintId: id },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ comments });
}

// POST /api/complaints/[id]/comments — add a new comment
export async function POST(
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

  // Permission check
  if (payload.role === 'BLOCK' && complaint.block !== payload.location) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  if (payload.role === 'DISTRICT' && complaint.district !== payload.location) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const body = await request.json();
  const content = (body.content || '').trim();
  if (!content) {
    return NextResponse.json({ error: 'Comment content is required' }, { status: 400 });
  }
  if (content.length > 2000) {
    return NextResponse.json({ error: 'Comment too long (max 2000 chars)' }, { status: 400 });
  }

  const actorName = payload.username || 'System';
  const actorId = payload.userId || null;

  const comment = await db.comment.create({
    data: {
      complaintId: id,
      content,
      actorId,
      actorName,
    },
  });

  // Log activity
  await db.activityLog.create({
    data: {
      complaintId: id,
      action: 'COMMENTED',
      description: `${actorName} added a comment`,
      actorId,
      actorName,
    },
  });

  return NextResponse.json({ comment, success: true });
}
