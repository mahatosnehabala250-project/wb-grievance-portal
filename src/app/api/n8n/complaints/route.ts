import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/n8n/complaints — Public complaints query for n8n workflows (no auth)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status');
    const assigned = searchParams.get('assigned');
    const slaBreach = searchParams.get('slaBreach');
    const dateFrom = searchParams.get('dateFrom');
    const limit = parseInt(searchParams.get('limit') || '50');
    const urgency = searchParams.get('urgency');
    const category = searchParams.get('category');
    const district = searchParams.get('district');
    const block = searchParams.get('block');

    const where: Record<string, unknown> = {};

    // Status filter — comma-separated list
    if (statusParam) {
      const statuses = statusParam.split(',').map(s => s.trim().toUpperCase());
      if (statuses.length === 1) {
        where.status = statuses[0];
      } else if (statuses.length > 1) {
        where.status = { in: statuses };
      }
    }

    // Assigned filter
    if (assigned === 'assigned') {
      where.assignedToId = { not: null };
    } else if (assigned === 'unassigned') {
      where.assignedToId = null;
    }

    // Urgency filter
    if (urgency) {
      where.urgency = urgency.toUpperCase();
    }

    // Category filter
    if (category) {
      where.category = category;
    }

    // District filter
    if (district) {
      where.district = district;
    }

    // Block filter
    if (block) {
      where.block = block;
    }

    // Date range filter
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      where.createdAt = { ...(where.createdAt as Record<string, unknown> || {}), gte: fromDate };
    }

    // SLA Breach filter: open/in-progress complaints older than 7 days
    if (slaBreach === 'true') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      sevenDaysAgo.setHours(0, 0, 0, 0);
      where.status = { in: ['OPEN', 'IN_PROGRESS'] };
      const existingDateFilter = (where.createdAt && typeof where.createdAt === 'object'
        ? where.createdAt : {}) as Record<string, unknown>;
      existingDateFilter.lte = sevenDaysAgo;
      where.createdAt = existingDateFilter;
    }

    const [complaints, total] = await Promise.all([
      db.complaint.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 500), // Cap at 500 to prevent abuse
      }),
      db.complaint.count({ where }),
    ]);

    return NextResponse.json({
      complaints,
      total,
      limit,
      returned: complaints.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[n8n] Complaints query error:', error);
    return NextResponse.json(
      { error: 'Failed to query complaints', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
