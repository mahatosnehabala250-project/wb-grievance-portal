import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/complaints — list complaints (filtered by role)
export async function GET(request: NextRequest) {
  try {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const urgency = searchParams.get('urgency');
  const category = searchParams.get('category');
  const block = searchParams.get('block');
  const district = searchParams.get('district');
  const search = searchParams.get('search');
  const source = searchParams.get('source');
  const assigned = searchParams.get('assigned'); // 'assigned', 'unassigned', 'all'
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  // Build where clause based on role
  const where: Record<string, unknown> = {};

  if (payload.role === 'BLOCK') {
    where.block = payload.location;
  } else if (payload.role === 'DISTRICT') {
    where.district = payload.location;
  }
  // ADMIN and STATE see all

  if (status) where.status = status;
  if (urgency) where.urgency = urgency;
  if (category) where.category = category;
  if (block) where.block = block;
  if (district) where.district = district;
  if (source) where.source = source;

  // Assigned filter
  if (assigned === 'assigned') {
    where.assignedToId = { not: null };
  } else if (assigned === 'unassigned') {
    where.assignedToId = null;
  }

  // Date range filter
  if (dateFrom || dateTo) {
    const dateFilter: Record<string, unknown> = {};
    if (dateFrom) {
      dateFilter.gte = new Date(dateFrom);
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      dateFilter.lte = toDate;
    }
    where.createdAt = dateFilter;
  }

  if (search) {
    where.OR = [
      { citizenName: { contains: search } },
      { issue: { contains: search } },
      { ticketNo: { contains: search } },
      { phone: { contains: search } },
      { block: { contains: search } },
    ];
  }

  const [complaints, total] = await Promise.all([
    db.complaint.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.complaint.count({ where }),
  ]);

  return NextResponse.json({
    complaints,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
  } catch (error) {
    console.error('Complaints list error:', error);
    return NextResponse.json({ error: 'Failed to load complaints' }, { status: 500 });
  }
}

// POST /api/complaints — create manual complaint
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  try {
    const body = await request.json();
    const { citizenName, phone, issue, category, block, district, urgency, description } = body;

    if (!issue || !category || !block || !district) {
      return NextResponse.json(
        { error: 'issue, category, block, and district are required' },
        { status: 400 }
      );
    }

    // Block users can only create complaints for their block
    if (payload.role === 'BLOCK' && block !== payload.location) {
      return NextResponse.json(
        { error: 'You can only create complaints for your assigned block' },
        { status: 403 }
      );
    }

    const count = await db.complaint.count();
    const ticketNo = `WB-${String(1000 + count + 1).padStart(5, '0')}`;

    const complaint = await db.complaint.create({
      data: {
        ticketNo,
        citizenName: citizenName || null,
        phone: phone || null,
        issue,
        category,
        block,
        district,
        urgency: urgency?.toUpperCase() || 'MEDIUM',
        status: 'OPEN',
        description: description || null,
        source: 'MANUAL',
        assignedToId: payload.userId,
      },
    });

    // Create initial activity log
    await db.activityLog.create({
      data: {
        complaintId: complaint.id,
        action: 'CREATED',
        description: `Complaint filed${citizenName ? ` by ${citizenName}` : ''} (Source: Manual)`,
        actorId: payload.userId || null,
        actorName: payload.username || null,
      },
    });

    return NextResponse.json({ complaint, success: true }, { status: 201 });
  } catch (error) {
    console.error('Create complaint error:', error);
    return NextResponse.json({ error: 'Failed to create complaint' }, { status: 500 });
  }
}
