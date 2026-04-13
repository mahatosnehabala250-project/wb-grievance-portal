import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { notifyN8NStatusChange } from '@/lib/n8n-webhook';

// POST /api/webhook/complaint — Webhook for n8n to push complaints
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { citizenName, phone, issue, category, block, district, urgency, description } = body;

    if (!issue || !category || !block || !district) {
      return NextResponse.json(
        { error: 'issue, category, block, and district are required' },
        { status: 400 }
      );
    }

    // Generate ticket number
    const count = await db.complaint.count();
    const ticketNo = `WB-${String(1000 + count + 1).padStart(5, '0')}`;

    const complaint = await db.complaint.create({
      data: {
        ticketNo,
        citizenName: citizenName || null,
        phone: phone || null,
        issue: issue || '',
        category: category || 'General',
        block: block,
        district: district,
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

    // Fire-and-forget: notify n8n of new complaint (for downstream workflows)
    notifyN8NStatusChange(complaint.id, complaint.status);

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
