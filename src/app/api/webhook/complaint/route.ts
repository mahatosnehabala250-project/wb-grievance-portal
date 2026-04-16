import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { notifyN8NNewComplaint } from '@/lib/n8n-webhook';

// POST /api/webhook/complaint — Webhook for n8n to push complaints
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { citizenName, phone, issue, category, block, district, urgency, description, village, subdivision } = body;

    if (!issue || !category || !block || !district) {
      return NextResponse.json(
        { error: 'issue, category, block, and district are required' },
        { status: 400 }
      );
    }

    // Generate ticket number
    const count = await db.complaint.count();
    const ticketNo = `WB-${String(1000 + count + 1).padStart(5, '0')}`;

    // Auto-derive subdivision from district+block if not provided
    let finalSubdivision = subdivision || null;
    if (!finalSubdivision) {
      try {
        const { getSubdivision } = await import('@/lib/constants');
        finalSubdivision = getSubdivision(district, block);
      } catch { /* constants not available, leave null */ }
    }

    const complaint = await db.complaint.create({
      data: {
        ticketNo,
        citizenName: citizenName || null,
        phone: phone || null,
        issue: issue || '',
        category: category || 'General',
        block: block,
        district: district,
        village: village || null,
        subdivision: finalSubdivision,
        urgency: urgency?.toUpperCase() || 'MEDIUM',
        status: 'OPEN',
        description: description || null,
        source: 'WHATSAPP',
      },
    });

    // Create initial activity log
    await db.activityLog.create({
      data: {
        complaintId: complaint.id,
        action: 'CREATED',
        description: `Complaint filed${citizenName ? ` by ${citizenName}` : ''} (Source: WhatsApp)`,
        actorId: null,
        actorName: null,
      },
    });

    // ═══ CASCADE 1: Trigger WB-02 Auto-Assignment Engine ═══
    notifyN8NNewComplaint(complaint.id, {
      issue: complaint.issue,
      category: complaint.category,
      block: complaint.block,
      district: complaint.district,
      urgency: complaint.urgency,
    });

    return NextResponse.json({
      success: true,
      ticketNo: complaint.ticketNo,
      id: complaint.id,
      message: `Complaint ${complaint.ticketNo} registered successfully`,
    }, { status: 201 });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Failed to process complaint' },
      { status: 500 }
    );
  }
}
