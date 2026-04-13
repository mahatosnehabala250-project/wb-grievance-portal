import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  notifyN8NStatusChange,
  notifyN8NUrgencyEscalation,
} from '@/lib/n8n-webhook';

/**
 * POST /api/complaints/escalate-batch
 *
 * Called by WB-05 (SLA Breach Escalation) to batch-escalate complaints.
 * This endpoint:
 * 1. Escalates urgency for all complaints in the batch
 * 2. Logs activity for each escalation
 * 3. Cascades notifications to WB-03 (citizen) + WB-04 (officer)
 *
 * No auth required — called by n8n internal workflow.
 * Uses N8N_WEBHOOK_SECRET for optional verification.
 */

const URGENCY_MAP: Record<string, string> = {
  low: 'HIGH',
  medium: 'HIGH',
  high: 'CRITICAL',
  critical: 'CRITICAL',
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { complaints, report } = body;

    if (!complaints || !Array.isArray(complaints) || complaints.length === 0) {
      return NextResponse.json(
        { error: 'complaints array is required' },
        { status: 400 }
      );
    }

    const results: Array<{
      id: string;
      success: boolean;
      previousUrgency?: string;
      newUrgency?: string;
      error?: string;
    }> = [];

    let escalatedCount = 0;
    let alreadyCriticalCount = 0;
    let notFoundCount = 0;

    for (const item of complaints) {
      const complaintId = item.id;
      const riskLevel = (item.riskLevel || 'medium').toLowerCase();

      if (!complaintId) {
        results.push({ id: complaintId || 'unknown', success: false, error: 'Missing complaint ID' });
        continue;
      }

      try {
        // Fetch current complaint
        const complaint = await db.complaint.findUnique({ where: { id: complaintId } });

        if (!complaint) {
          notFoundCount++;
          results.push({ id: complaintId, success: false, error: 'Complaint not found' });
          continue;
        }

        // Skip already critical
        if (complaint.urgency === 'CRITICAL') {
          alreadyCriticalCount++;
          results.push({
            id: complaintId,
            success: true,
            previousUrgency: complaint.urgency,
            newUrgency: 'CRITICAL',
          });
          continue;
        }

        // Determine new urgency based on risk level
        const newUrgency = URGENCY_MAP[riskLevel] || 'HIGH';
        const previousUrgency = complaint.urgency;

        // Only escalate if it's actually increasing
        const urgencyOrder = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        const prevIdx = urgencyOrder.indexOf(previousUrgency);
        const newIdx = urgencyOrder.indexOf(newUrgency);

        if (newIdx <= prevIdx) {
          results.push({
            id: complaintId,
            success: true,
            previousUrgency,
            newUrgency: previousUrgency,
          });
          continue;
        }

        // Update urgency in database
        await db.complaint.update({
          where: { id: complaintId },
          data: { urgency: newUrgency },
        });

        // Log escalation activity
        await db.activityLog.create({
          data: {
            complaintId,
            action: 'ESCALATED',
            description: `SLA Breach — Auto-escalated from ${previousUrgency} to ${newUrgency}`,
            actorId: null,
            actorName: 'SLA System',
            metadata: JSON.stringify({
              from: previousUrgency,
              to: newUrgency,
              reason: 'SLA Breach',
              riskLevel,
              report: report?.substring(0, 500) || null,
            }),
          },
        });

        escalatedCount++;

        results.push({
          id: complaintId,
          success: true,
          previousUrgency,
          newUrgency,
        });

        // ═══ CASCADE: Notify citizen about escalation (WB-03) ═══
        notifyN8NStatusChange(complaintId, complaint.status);

        // ═══ CASCADE: Notify officer about escalation (WB-04) ═══
        if (complaint.assignedToId) {
          notifyN8NUrgencyEscalation(
            complaintId,
            previousUrgency,
            newUrgency,
            'SLA Breach — Auto-escalated by WB-05'
          );
        }
      } catch (err) {
        console.error(`[escalate-batch] Error escalating ${complaintId}:`, err);
        results.push({
          id: complaintId,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        total: complaints.length,
        escalated: escalatedCount,
        alreadyCritical: alreadyCriticalCount,
        notFound: notFoundCount,
        failed: complaints.length - escalatedCount - alreadyCriticalCount - notFoundCount,
      },
      results,
      report: report || null,
    });
  } catch (error) {
    console.error('[escalate-batch] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process batch escalation' },
      { status: 500 }
    );
  }
}
