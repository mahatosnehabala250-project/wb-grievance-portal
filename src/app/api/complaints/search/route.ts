import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/complaints/search
 *
 * Public endpoint for n8n workflows (WB-01 Check Duplicate) to search
 * existing complaints by phone and keywords.
 * No auth required — called by n8n internal workflow.
 *
 * Query params:
 *   phone - citizen phone number (WhatsApp number)
 *   keywords - text to search in issue/summary
 *   limit - max results (default 5)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone') || '';
    const keywords = searchParams.get('keywords') || '';
    const limit = parseInt(searchParams.get('limit') || '5', 10);

    if (!phone && !keywords) {
      return NextResponse.json({ error: 'phone or keywords required' }, { status: 400 });
    }

    // Build where clause
    const conditions: Record<string, unknown>[] = [];

    // Search by phone number (exact match or contains)
    if (phone) {
      conditions.push({ phone: { contains: phone.replace(/^\+/, '') } });
      conditions.push({ phone: { contains: phone } });
    }

    // Search by keywords in issue text
    if (keywords) {
      const words = keywords.split(/\s+/).filter(w => w.length > 2);
      if (words.length > 0) {
        for (const word of words.slice(0, 5)) {
          conditions.push({ issue: { contains: word } });
        }
      }
    }

    // Only search in recent complaints (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const complaints = await db.complaint.findMany({
      where: {
        OR: conditions,
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 20),
      select: {
        id: true,
        ticketNo: true,
        issue: true,
        status: true,
        urgency: true,
        category: true,
        block: true,
        district: true,
        phone: true,
        citizenName: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const isDuplicate = complaints.length > 0;

    return NextResponse.json({
      isDuplicate,
      count: complaints.length,
      complaints,
    });
  } catch (error) {
    console.error('[complaints/search] Error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
