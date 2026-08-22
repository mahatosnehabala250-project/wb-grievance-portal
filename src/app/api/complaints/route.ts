import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import { generateTicketNo } from '@/lib/ticket-no';

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
  const slaBreach = searchParams.get('slaBreach'); // 'true' for open/in-progress >7 days old
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  // Build where clause based on role
  const where: Record<string, unknown> = {};

  // Governance scope is enforced LAST (see end of this block) so query params
  // below cannot broaden a scoped user's visibility.

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

  // SLA Breach filter: open/in-progress complaints older than 7 days
  if (slaBreach === 'true') {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    where.status = { in: ['OPEN', 'IN_PROGRESS'] };
    const existingDateFilter = (where.createdAt && typeof where.createdAt === 'object' ? where.createdAt : {}) as Record<string, unknown>;
    existingDateFilter.lte = sevenDaysAgo;
    where.createdAt = existingDateFilter;
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

  // ── Enforce governance scope LAST — a scoped user can never widen their
  //    own visibility through query params (block/district/etc.) ──
  Object.assign(where, getComplaintScopeFilter(payload));

  const [complaints, total, open, inProgress, resolved] = await Promise.all([
    db.complaint.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.complaint.count({ where }),
    // Status counts answer to the same filters the table does, not to the
    // page — the summary pills sit beside a global "Total" figure and used to
    // count only the fifteen rows on screen, so "Resolved 9" sat under
    // "Total 42" while the real answer was 35. Three tiny counts on an
    // already-running query beat one number that is quietly wrong.
    db.complaint.count({ where: { ...where, status: 'OPEN' } }),
    db.complaint.count({ where: { ...where, status: 'IN_PROGRESS' } }),
    db.complaint.count({ where: { ...where, status: 'RESOLVED' } }),
  ]);

  return NextResponse.json({
    complaints,
    statusCounts: { open, inProgress, resolved },
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
    if (payload.role === 'BLOCK' && block !== payload.block) {
      return NextResponse.json(
        { error: 'You can only create complaints for your assigned block' },
        { status: 403 }
      );
    }

    const ticketNo = await generateTicketNo(district);

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
