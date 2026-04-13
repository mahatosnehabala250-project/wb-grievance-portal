import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// POST /api/integrations/airtable-webhook
// Real-time webhook endpoint for Airtable→Portal sync.
// Called by n8n (or Airtable automation) when a record changes in Airtable.
//
// Expected request body:
// {
//   "ticketNo": "WB-01001",     // Required — unique identifier
//   "status": "RESOLVED",        // Optional — new status
//   "resolution": "Fixed...",    // Optional — resolution text
//   "urgency": "HIGH",           // Optional — new urgency level
//   "category": "Water Supply",  // Optional — new category
//   "airtableRecordId": "recXXX" // Optional — Airtable record ID
// }
//
// Behavior:
//   1. Look up complaint by ticketNo
//   2. If found → UPDATE only the provided fields
//   3. If not found → return 404 with a clear message
//   4. Optionally create an ActivityLog entry for the change
// ---------------------------------------------------------------------------

/** Whitelist of fields that can be updated via webhook */
const UPDATABLE_FIELDS = ['status', 'resolution', 'urgency', 'category', 'airtableRecordId'] as const;

/** Valid status values */
const VALID_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'];

/** Valid urgency values */
const VALID_URGENCIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ---- Validate required fields ----
    const { ticketNo } = body;

    if (!ticketNo || typeof ticketNo !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing or invalid "ticketNo" field. It is required and must be a string.',
        },
        { status: 400 }
      );
    }

    // ---- Look up existing complaint ----
    const existing = await db.complaint.findUnique({
      where: { ticketNo },
    });

    if (!existing) {
      return NextResponse.json(
        {
          success: false,
          error: `No complaint found with ticket number "${ticketNo}".`,
          suggestion: 'Use GET /api/integrations/airtable-sync to pull all records from Airtable first.',
        },
        { status: 404 }
      );
    }

    // ---- Build update data from provided fields ----
    const updateData: Record<string, unknown> = {};
    const changes: string[] = [];

    if (body.status !== undefined) {
      const status = String(body.status).toUpperCase();
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid status "${body.status}". Must be one of: ${VALID_STATUSES.join(', ')}`,
          },
          { status: 400 }
        );
      }
      if (status !== existing.status) {
        updateData.status = status;
        changes.push(`status: ${existing.status} → ${status}`);
      }
    }

    if (body.resolution !== undefined) {
      const resolution = String(body.resolution);
      if (resolution !== existing.resolution) {
        updateData.resolution = resolution;
        changes.push(`resolution updated`);
      }
    }

    if (body.urgency !== undefined) {
      const urgency = String(body.urgency).toUpperCase();
      if (!VALID_URGENCIES.includes(urgency)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid urgency "${body.urgency}". Must be one of: ${VALID_URGENCIES.join(', ')}`,
          },
          { status: 400 }
        );
      }
      if (urgency !== existing.urgency) {
        updateData.urgency = urgency;
        changes.push(`urgency: ${existing.urgency} → ${urgency}`);
      }
    }

    if (body.category !== undefined) {
      const category = String(body.category);
      if (category !== existing.category) {
        updateData.category = category;
        changes.push(`category: ${existing.category} → ${category}`);
      }
    }

    if (body.airtableRecordId !== undefined) {
      const airtableRecordId = String(body.airtableRecordId);
      if (airtableRecordId !== existing.airtableRecordId) {
        updateData.airtableRecordId = airtableRecordId;
        changes.push(`airtableRecordId updated`);
      }
    }

    // ---- No changes detected ----
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({
        success: true,
        updated: false,
        ticketNo,
        message: 'No changes detected. Complaint is already up to date.',
      });
    }

    // ---- Apply update ----
    const updated = await db.complaint.update({
      where: { ticketNo },
      data: updateData,
    });

    // ---- Create an activity log entry for the webhook update ----
    if (changes.length > 0) {
      try {
        await db.activityLog.create({
          data: {
            complaintId: existing.id,
            action: body.status ? 'STATUS_CHANGED' : 'UPDATED',
            description: `Airtable webhook sync: ${changes.join('; ')}`,
            actorName: 'Airtable Webhook',
            metadata: JSON.stringify({
              source: 'airtable-webhook',
              previousStatus: existing.status,
              newStatus: body.status,
              changes,
            }),
          },
        });
      } catch {
        // Activity log creation is non-critical — don't fail the webhook
        console.warn(`Failed to create activity log for ${ticketNo}`);
      }
    }

    return NextResponse.json({
      success: true,
      updated: true,
      ticketNo: updated.ticketNo,
      changes,
      message: `Complaint ${ticketNo} updated from Airtable webhook.`,
    });
  } catch (error) {
    console.error('Airtable webhook error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process Airtable webhook';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
