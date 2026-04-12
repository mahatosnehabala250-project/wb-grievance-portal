import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST /api/integrations/test-webhook — Test webhook by creating a mock complaint
export async function POST() {
  try {
    // Generate ticket number using the same pattern as the webhook
    const count = await db.complaint.count();
    const ticketNo = `WB-${String(1000 + count + 1).padStart(5, '0')}`;

    // Create mock complaint directly in the database
    const complaint = await db.complaint.create({
      data: {
        ticketNo,
        citizenName: 'Test Citizen',
        phone: '+919876543210',
        issue: 'This is a test complaint from the webhook integration test panel.',
        category: 'Water Supply',
        block: 'Krishnanagar',
        district: 'Nadia',
        urgency: 'MEDIUM',
        description: 'Automated test complaint for webhook integration verification.',
        source: 'WEBHOOK_TEST',
        status: 'OPEN',
      },
    });

    // Create an ActivityLog entry with action 'CREATED' and Integration Test reference
    await db.activityLog.create({
      data: {
        complaintId: complaint.id,
        action: 'CREATED',
        description: 'Complaint filed by Test Citizen — Integration Test',
        actorId: null,
        actorName: 'Integration Test',
      },
    });

    return NextResponse.json(
      {
        success: true,
        ticketNo: complaint.ticketNo,
        id: complaint.id,
        message: `Test complaint ${complaint.ticketNo} created successfully via webhook integration test.`,
        timestamp: new Date().toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Test webhook error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create test complaint';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
