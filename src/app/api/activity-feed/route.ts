import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

// GET /api/activity-feed — Returns latest activity logs + webhook stats
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get('limit');
  const sinceParam = searchParams.get('since');

  const limit = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 200);
  const since = sinceParam ? new Date(sinceParam) : undefined;

  // Build where clause for role-based filtering
  const complaintWhere: Record<string, unknown> = {};
  if (payload.role === 'BLOCK') complaintWhere.block = payload.block;
  else if (payload.role === 'DISTRICT') complaintWhere.district = payload.block;

  // Build activity log where
  const activityWhere: Record<string, unknown> = {};
  if (since) activityWhere.createdAt = { gte: since };

  // Fetch activity logs joined with complaint
  const activities = await db.activityLog.findMany({
    where: {
      ...activityWhere,
      complaint: complaintWhere as Record<string, string>,
    },
    include: {
      complaint: {
        select: {
          ticketNo: true,
          source: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // Webhook stats: complaints where source = 'WHATSAPP'
  const webhookWhere: Record<string, unknown> = { source: 'WHATSAPP' };
  if (payload.role === 'BLOCK') webhookWhere.block = payload.block;
  else if (payload.role === 'DISTRICT') webhookWhere.district = payload.block;

  const webhookCount = await db.complaint.count({
    where: webhookWhere,
  });

  // Last webhook timestamp
  const lastWebhookComplaint = await db.complaint.findFirst({
    where: webhookWhere,
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  const lastWebhookTimestamp = lastWebhookComplaint?.createdAt?.toISOString() || null;

  // Complaints this hour
  const oneHourAgo = new Date();
  oneHourAgo.setHours(oneHourAgo.getHours() - 1);

  const hourWhere: Record<string, unknown> = {
    createdAt: { gte: oneHourAgo },
  };
  if (payload.role === 'BLOCK') hourWhere.block = payload.block;
  else if (payload.role === 'DISTRICT') hourWhere.district = payload.block;

  const complaintsThisHour = await db.complaint.count({
    where: hourWhere,
  });

  // Source breakdown
  const sourceData = await db.complaint.groupBy({
    by: ['source'],
    where: complaintWhere,
    _count: { id: true },
  });

  const sourceBreakdown = sourceData.map((s) => ({
    source: s.source,
    count: s._count.id,
  }));

  // Recent webhook payloads (last 5 WHATSAPP complaints)
  const recentWebhooks = await db.complaint.findMany({
    where: webhookWhere,
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      ticketNo: true,
      citizenName: true,
      phone: true,
      issue: true,
      category: true,
      block: true,
      district: true,
      createdAt: true,
    },
  });

  // Active webhooks per minute (last 10 minutes)
  const tenMinutesAgo = new Date();
  tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10);

  const recentWebhookCount = await db.complaint.count({
    where: {
      ...webhookWhere,
      createdAt: { gte: tenMinutesAgo },
    },
  });
  const webhooksPerMinute = Math.round(recentWebhookCount / 10 * 10) / 10;

  return NextResponse.json({
    activities: activities.map((a) => ({
      id: a.id,
      complaintId: a.complaintId,
      action: a.action,
      description: a.description,
      actorName: a.actorName,
      metadata: a.metadata,
      createdAt: a.createdAt.toISOString(),
      ticketNo: a.complaint.ticketNo,
      source: a.complaint.source,
    })),
    webhookCount,
    lastWebhookTimestamp,
    complaintsThisHour,
    sourceBreakdown,
    recentWebhooks,
    webhooksPerMinute,
  });
}
