import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';

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

  try {

  // Scope-lock to the user's jurisdiction (governance role_level aware).
  const scopeFilter = getComplaintScopeFilter(payload);
  const complaintWhere: Record<string, unknown> = { ...scopeFilter };

  // Build activity log where
  const activityWhere: Record<string, unknown> = {};
  if (since) activityWhere.createdAt = { gte: since };

  // Scope the feed by resolving the complaints first.
  //
  // This used to pass `complaint: { … }` as a nested relation filter, which the
  // Supabase REST adapter does not translate — it went out as an equality test
  // against a column named "complaint", Postgres rejected it, and the route
  // threw on every request. Nothing caught it either, so the 500 arrived with an
  // empty body and the live monitor showed nothing with no clue why.
  //
  // An unscoped caller (admin) needs no id list at all; anyone else gets one.
  let scopedComplaintIds: string[] | null = null;
  if (Object.keys(complaintWhere).length > 0) {
    const scoped = await db.complaint.findMany({
      where: complaintWhere,
      select: { id: true },
    });
    const ids = scoped.map((c) => c.id as string);
    scopedComplaintIds = ids;
    // No complaints in scope means no activity in scope — say so without
    // running a query whose `in ()` would be empty.
    if (ids.length === 0) {
      return NextResponse.json({ activities: [], webhookStats: null, scoped: true });
    }
  }

  const activities = await db.activityLog.findMany({
    where: {
      ...activityWhere,
      ...(scopedComplaintIds ? { complaintId: { in: scopedComplaintIds } } : {}),
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
  const webhookWhere: Record<string, unknown> = { source: 'WHATSAPP', ...scopeFilter };

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
    ...scopeFilter,
  };

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
      ticketNo: a.complaint?.ticketNo ?? null,
      source: a.complaint?.source ?? null,
    })),
    webhookCount,
    lastWebhookTimestamp,
    complaintsThisHour,
    sourceBreakdown,
    recentWebhooks,
    webhooksPerMinute,
  });
  } catch (error) {
    console.error('[activity-feed] error:', error);
    return NextResponse.json({ error: 'Failed to load the activity feed' }, { status: 500 });
  }
}
