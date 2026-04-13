import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/ticket/:ticketNo — citizen-facing ticket lookup
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketNo: string }> }
) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const { ticketNo } = await params;

  try {
    const complaint = await db.complaint.findUnique({
      where: { ticketNo: ticketNo.toUpperCase() },
      select: {
        id: true,
        ticketNo: true,
        citizenName: true,
        category: true,
        block: true,
        district: true,
        urgency: true,
        status: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!complaint) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Calculate days since filing
    const daysOld = Math.floor((Date.now() - complaint.createdAt.getTime()) / (1000 * 60 * 60 * 24));

    // Get latest activity for current status
    const latestActivity = await db.activityLog.findFirst({
      where: { complaintId: complaint.id || '' },
      orderBy: { createdAt: 'desc' },
      select: { action: true, description: true, createdAt: true },
    });

    return NextResponse.json({
      ticket: {
        ...complaint,
        daysOld,
        lastUpdated: latestActivity
          ? { action: latestActivity.action, description: latestActivity.description, at: latestActivity.createdAt }
          : null,
      },
    });
  } catch (error) {
    console.error('Ticket lookup error:', error);
    return NextResponse.json({ error: 'Failed to lookup ticket' }, { status: 500 });
  }
}
