import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { n8nSecretOk } from '@/lib/n8nAuth';
import { generateTicketNo } from '@/lib/ticket-no';

// POST /api/webhook/complaint — Webhook for n8n to push complaints.
// SECURITY (2026-07-10 audit): fail-closed M2M gate. This legacy route inserts
// complaints with attacker-controlled PII and fires the notify cascade; the live
// bot uses /api/complaints/register (which is already gated). Require the shared
// secret so this can never be POSTed anonymously.
export async function POST(request: NextRequest) {
  if (!n8nSecretOk(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json();

    const { citizenName, phone, issue, category, block, district, urgency, description, village, subdivision } = body;

    if (!issue || !category || !block || !district) {
      return NextResponse.json(
        { error: 'issue, category, block, and district are required' },
        { status: 400 }
      );
    }

    const ticketNo = await generateTicketNo(district);

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
