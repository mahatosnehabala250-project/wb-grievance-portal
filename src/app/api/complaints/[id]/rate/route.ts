import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// PATCH /api/complaints/[id]/rate — rate a resolved complaint (1-5 stars)
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

  // Only allow rating RESOLVED complaints
  if (complaint.status !== 'RESOLVED') {
    return NextResponse.json(
      { error: 'Can only rate resolved complaints' },
      { status: 400 }
    );
  }

  // Parse request body
  let body: { rating?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { rating } = body;

  // Validate rating
  if (typeof rating !== 'number' || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return NextResponse.json(
      { error: 'Rating must be an integer between 1 and 5' },
      { status: 400 }
    );
  }

  const actorName = payload.name || payload.username || 'System';
  const actorId = payload.userId || null;

  const updated = await db.complaint.update({
    where: { id },
    data: { satisfactionRating: rating },
  });

  // Log rating activity
  await db.activityLog.create({
    data: {
      complaintId: id,
      action: 'RATED',
      description: `Rated ${rating}/5 stars`,
      actorId,
      actorName,
      metadata: JSON.stringify({ rating }),
    },
  });

  return NextResponse.json({
    complaint: updated,
    success: true,
    rating,
  });
}
