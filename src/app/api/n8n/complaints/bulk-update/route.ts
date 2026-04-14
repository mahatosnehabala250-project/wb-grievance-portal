import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST /api/n8n/complaints/bulk-update — Bulk update from Airtable (WB-08)
// Accepts an array of complaints with id + fields to update
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { complaints } = body;

    if (!complaints || !Array.isArray(complaints) || complaints.length === 0) {
      return NextResponse.json(
        { error: 'complaints array is required and must not be empty' },
        { status: 400 }
      );
    }

    const results = {
      updated: 0,
      failed: 0,
      errors: [] as Array<{ id: string; error: string }>,
    };

    // Process each complaint update
    for (const item of complaints) {
      const { id, ...fields } = item;

      if (!id) {
        results.failed++;
        results.errors.push({ id: 'unknown', error: 'Missing complaint id' });
        continue;
      }

      try {
        // Build update data — only allow safe fields
        const data: Record<string, unknown> = {};
        const allowedFields = ['status', 'assignedToId', 'urgency', 'resolution', 'airtableRecordId'];

        for (const key of allowedFields) {
          if (fields[key] !== undefined) {
            if (key === 'urgency') {
              data[key] = String(fields[key]).toUpperCase();
            } else if (key === 'assignedToId') {
              data[key] = fields[key] || null;
            } else {
              data[key] = fields[key];
            }
          }
        }

        if (Object.keys(data).length === 0) {
          results.failed++;
          results.errors.push({ id, error: 'No updatable fields provided' });
          continue;
        }

        // Check if complaint exists
        const existing = await db.complaint.findUnique({ where: { id } });
        if (!existing) {
          results.failed++;
          results.errors.push({ id, error: 'Complaint not found' });
          continue;
        }

        // Perform update
        await db.complaint.update({ where: { id }, data });

        // Create activity log for tracked changes
        const actorName = 'n8n Workflow (Airtable Sync)';
        const changes: string[] = [];

        if (data.status && data.status !== existing.status) {
          const statusLabels: Record<string, string> = {
            OPEN: 'Open', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved', REJECTED: 'Rejected',
          };
          changes.push(
            `Status: ${statusLabels[existing.status] || existing.status} → ${statusLabels[data.status as string] || data.status}`
          );
        }

        if (data.assignedToId !== undefined && data.assignedToId !== existing.assignedToId) {
          if (data.assignedToId) {
            const user = await db.user.findUnique({
              where: { id: data.assignedToId as string },
              select: { name: true },
            });
            changes.push(`Assigned to: ${user?.name || 'Unknown'}`);
          } else {
            changes.push('Unassigned');
          }
        }

        if (data.urgency && data.urgency !== existing.urgency) {
          changes.push(`Urgency: ${existing.urgency} → ${data.urgency}`);
        }

        if (changes.length > 0) {
          await db.activityLog.create({
            data: {
              complaintId: id,
              action: 'STATUS_CHANGED',
              description: `Bulk update from Airtable: ${changes.join('; ')}`,
              actorName,
              metadata: JSON.stringify({ source: 'n8n-airtable-sync', fields: Object.keys(data) }),
            },
          });
        }

        results.updated++;
      } catch (itemError) {
        results.failed++;
        results.errors.push({
          id,
          error: itemError instanceof Error ? itemError.message : 'Update failed',
        });
      }
    }

    console.log(
      `[n8n:bulk-update] Processed ${complaints.length} complaints: ${results.updated} updated, ${results.failed} failed`
    );

    return NextResponse.json({
      success: true,
      updated: results.updated,
      failed: results.failed,
      total: complaints.length,
      errors: results.errors.length > 0 ? results.errors : undefined,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[n8n] Bulk update error:', error);
    return NextResponse.json(
      { error: 'Failed to bulk update complaints', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
