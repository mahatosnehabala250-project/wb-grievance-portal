import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { complaintInScope } from '@/lib/rbac';

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
    // Fetch the full row so the scope check has every jurisdiction column,
    // then return only the citizen-facing fields below.
    const complaint = await db.complaint.findUnique({
      where: { ticketNo: ticketNo.toUpperCase() },
    });

    // 404 (not 403) for out-of-scope so we never confirm a ticket exists
    // outside the caller's jurisdiction.
    if (!complaint || !complaintInScope(payload, complaint as Record<string, unknown>)) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Calculate days since filing
    const createdAt = new Date(complaint.createdAt);
    const daysOld = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

    // Get latest activity for current status
    const latestActivity = await db.activityLog.findFirst({
      where: { complaintId: complaint.id || '' },
      orderBy: { createdAt: 'desc' },
      select: { action: true, description: true, createdAt: true },
    });

    // Return only the citizen-facing subset (never expose phone / raw internals).
    return NextResponse.json({
      ticket: {
        id: complaint.id,
        ticketNo: complaint.ticketNo,
        citizenName: complaint.citizenName,
        category: complaint.category,
        block: complaint.block,
        district: complaint.district,
        urgency: complaint.urgency,
        status: complaint.status,
        description: complaint.description,
        createdAt: complaint.createdAt,
        updatedAt: complaint.updatedAt,
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
