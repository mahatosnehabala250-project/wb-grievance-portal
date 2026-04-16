import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/complaints/[id]/comments — returns comments for a complaint
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  const { id } = await params;

  // Verify complaint exists
  const complaint = await db.complaint.findUnique({ where: { id } });
  if (!complaint) {
    return NextResponse.json({ error: 'Complaint not found' }, { status: 404 });
  }

  try {
    const comments = await db.comment.findMany({
      where: { complaintId: id },
      select: {
        id: true,
        content: true,
        actorName: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ comments });
  } catch (error) {
    console.error('Failed to fetch comments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}

// POST /api/complaints/[id]/comments — add a comment to a complaint
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  const { id } = await params;

  // Verify complaint exists
  const complaint = await db.complaint.findUnique({ where: { id } });
  if (!complaint) {
    return NextResponse.json({ error: 'Complaint not found' }, { status: 404 });
  }

  // Role-based permission check
  if (payload.role === 'BLOCK' && complaint.block !== payload.block) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  if (payload.role === 'DISTRICT' && complaint.district !== payload.block) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const content = (body.content || '').trim();

    if (!content) {
      return NextResponse.json(
        { error: 'Comment content is required' },
        { status: 400 }
      );
    }

    if (content.length > 2000) {
      return NextResponse.json(
        { error: 'Comment content is too long (max 2000 characters)' },
        { status: 400 }
      );
    }

    const actorId = payload.userId || null;
    const actorName = payload.name || payload.username || 'System';

    // Create the comment
    const comment = await db.comment.create({
      data: {
        content,
        complaintId: id,
        actorId,
        actorName,
      },
    });

    // Create activity log entry
    await db.activityLog.create({
      data: {
        complaintId: id,
        action: 'COMMENT',
        description: `Comment added by ${actorName}`,
        actorId,
        actorName,
      },
    });

    return NextResponse.json(
      {
        success: true,
        comment: {
          id: comment.id,
          content: comment.content,
          actorName: comment.actorName,
          createdAt: comment.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to add comment:', error);
    return NextResponse.json(
      { error: 'Failed to add comment' },
      { status: 500 }
    );
  }
}
