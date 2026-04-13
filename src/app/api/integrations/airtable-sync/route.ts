import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ============================================================================
// BIDIRECTIONAL AIRTABLE SYNC
// ============================================================================
// POST — Portal → Airtable: Push all local complaints to Airtable (UPSERT)
// GET  — Airtable → Portal: Pull all Airtable records into local DB (UPSERT)
//
// The airtableRecordId field on each Complaint tracks the mapping between
// portal records and Airtable records, enabling true bidirectional sync.
// ============================================================================

/** Timeout for all Airtable API calls (10 seconds) */
const AIRTABLE_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// POST /api/integrations/airtable-sync
// Portal → Airtable: Sync all complaints from the portal to Airtable.
// Uses UPSERT logic — records with an existing airtableRecordId are updated,
// new records are created. The airtableRecordId is stored after each sync.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, baseId, tableName } = body;

    if (!token || !baseId || !tableName) {
      return NextResponse.json(
        { success: false, error: 'token, baseId, and tableName are required' },
        { status: 400 }
      );
    }

    // Fetch all complaints from local DB
    const complaints = await db.complaint.findMany({
      orderBy: { createdAt: 'desc' },
    });

    if (complaints.length === 0) {
      return NextResponse.json({
        success: true,
        synced: 0,
        failed: 0,
        message: 'No complaints found in the local database to sync.',
      });
    }

    const baseUrl = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}`;

    // ---- Phase 1: UPSERT records to Airtable ----
    // For each complaint:
    //   - If it already has an airtableRecordId → PATCH (update) that record
    //   - Otherwise → POST (create) a new record, then save the returned ID
    const BATCH_SIZE = 10;
    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors: string[] = [];

    // Separate complaints into "to create" (no airtableRecordId) and "to update" (has airtableRecordId)
    const toCreate: typeof complaints = [];
    const toUpdate: typeof complaints = [];

    for (const c of complaints) {
      if (c.airtableRecordId) {
        toUpdate.push(c);
      } else {
        toCreate.push(c);
      }
    }

    // Helper: build Airtable fields from a complaint
    function buildFields(c: (typeof complaints)[number]) {
      return {
        'Ticket Number': c.ticketNo,
        'Citizen Name': c.citizenName || '',
        'Phone': c.phone || '',
        'Issue Description': c.issue,
        'Category': c.category,
        'Block': c.block,
        'District': c.district,
        'Urgency': c.urgency,
        'Status': c.status,
        'Resolution': c.resolution || '',
        'Source': c.source,
        'Created At': c.createdAt.toISOString(),
        'Updated At': c.updatedAt.toISOString(),
      };
    }

    // --- Create new records (batch) ---
    for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
      const batch = toCreate.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;

      try {
        const response = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            records: batch.map((c) => ({ fields: buildFields(c) })),
          }),
          signal: AbortSignal.timeout(AIRTABLE_TIMEOUT_MS),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          errors.push(`CREATE Batch ${batchNum}: ${response.status} - ${errorBody}`);
          failed += batch.length;
        } else {
          const data = await response.json();
          const returnedRecords = data.records ?? [];
          const successCount = returnedRecords.length;

          // Save the Airtable record IDs back to our database
          for (let j = 0; j < returnedRecords.length; j++) {
            const airtableId = returnedRecords[j].id;
            const localId = batch[j].id;
            if (airtableId && localId) {
              await db.complaint.update({
                where: { id: localId },
                data: { airtableRecordId: airtableId },
              }).catch((updateErr) => {
                const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
                errors.push(`Failed to save airtableRecordId for ${batch[j].ticketNo}: ${msg}`);
              });
            }
          }

          created += successCount;
          failed += batch.length - successCount;
        }
      } catch (batchError) {
        const msg = batchError instanceof Error ? batchError.message : 'Unknown error';
        errors.push(`CREATE Batch ${batchNum}: ${msg}`);
        failed += batch.length;
      }
    }

    // --- Update existing records (one-by-one via PATCH, since Airtable batch update requires IDs in URL) ---
    for (const c of toUpdate) {
      try {
        const response = await fetch(`${baseUrl}/${encodeURIComponent(c.airtableRecordId!)}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: buildFields(c) }),
          signal: AbortSignal.timeout(AIRTABLE_TIMEOUT_MS),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          errors.push(`UPDATE ${c.ticketNo} (${c.airtableRecordId}): ${response.status} - ${errorBody}`);
          failed++;
        } else {
          updated++;
        }
      } catch (updateErr) {
        const msg = updateErr instanceof Error ? updateErr.message : 'Unknown error';
        errors.push(`UPDATE ${c.ticketNo}: ${msg}`);
        failed++;
      }
    }

    const synced = created + updated;

    return NextResponse.json({
      success: failed === 0,
      created,
      updated,
      synced,
      failed,
      total: complaints.length,
      errors: errors.length > 0 ? errors : undefined,
      message:
        failed === 0
          ? `Successfully synced ${synced} complaints to Airtable (${created} created, ${updated} updated).`
          : `Synced ${synced} complaints (${created} created, ${updated} updated). ${failed} failed.`,
    });
  } catch (error) {
    console.error('Airtable sync error:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync to Airtable';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/integrations/airtable-sync?token=xxx&baseId=xxx&tableName=xxx
// Airtable → Portal: Fetch ALL records from Airtable and upsert into portal.
// Handles Airtable pagination (max 100 records per page).
// For each Airtable record:
//   - If a complaint with matching ticketNo exists → UPDATE status, resolution, urgency, etc.
//   - If no matching ticketNo → CREATE a new complaint in the portal
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token') || process.env.AIRTABLE_TOKEN;
    const baseId = searchParams.get('baseId') || process.env.AIRTABLE_BASE_ID;
    const tableName = searchParams.get('tableName') || process.env.AIRTABLE_TABLE_NAME;

    if (!token || !baseId || !tableName) {
      return NextResponse.json(
        { success: false, error: 'token, baseId, and tableName are required (via query params or env vars)' },
        { status: 400 }
      );
    }

    const baseUrl = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}`;

    // ---- Fetch all records from Airtable with pagination ----
    const allAirtableRecords: Array<{
      id: string;
      fields: Record<string, unknown>;
      createdTime: string;
    }> = [];
    let offset: string | undefined;

    do {
      const url = offset ? `${baseUrl}?offset=${encodeURIComponent(offset)}` : baseUrl;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(AIRTABLE_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return NextResponse.json(
          {
            success: false,
            error: `Airtable API error: ${response.status}`,
            details: errorBody,
          },
          { status: response.status as 400 }
        );
      }

      const data = await response.json();
      if (data.records && Array.isArray(data.records)) {
        allAirtableRecords.push(...data.records);
      }
      offset = data.offset;
    } while (offset);

    if (allAirtableRecords.length === 0) {
      return NextResponse.json({
        success: true,
        created: 0,
        updated: 0,
        failed: 0,
        total: 0,
        message: 'No records found in Airtable table.',
      });
    }

    // ---- Upsert each record into the portal database ----
    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Helper: safely extract a string or nested object from Airtable fields
    // Airtable may return linked records as arrays of objects or plain strings
    function extractString(value: unknown): string | null {
      if (value == null) return null;
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) {
        const first = value[0];
        if (typeof first === 'string') return first;
        if (first && typeof first === 'object' && 'name' in first) return String(first.name);
        if (first && typeof first === 'object' && 'id' in first) return String(first.id);
        return String(first);
      }
      if (typeof value === 'object' && 'name' in (value as object)) {
        return String((value as { name: string }).name);
      }
      return String(value);
    }

    for (const record of allAirtableRecords) {
      const fields = record.fields;
      const airtableId = record.id;

      // Extract ticket number — this is the unique identifier for matching
      const ticketNo = extractString(fields['Ticket Number']);
      if (!ticketNo) {
        errors.push(`Record ${airtableId}: missing "Ticket Number" field, skipping.`);
        failedCount++;
        continue;
      }

      try {
        // Check if a complaint with this ticketNo already exists
        const existing = await db.complaint.findUnique({
          where: { ticketNo },
        });

        // Extract fields from Airtable record
        const status = extractString(fields['Status']) || 'OPEN';
        const urgency = extractString(fields['Urgency']) || 'MEDIUM';
        const category = extractString(fields['Category']) || 'General';
        const resolution = extractString(fields['Resolution']) || undefined;
        const citizenName = extractString(fields['Citizen Name']) || undefined;
        const phone = extractString(fields['Phone']) || undefined;
        const issue = extractString(fields['Issue Description']) || '';
        const block = extractString(fields['Block']) || '';
        const district = extractString(fields['District']) || '';
        const source = extractString(fields['Source']) || 'MANUAL';

        if (existing) {
          // ---- UPDATE: Sync changes from Airtable back to portal ----
          // Only update fields that are typically managed in Airtable
          await db.complaint.update({
            where: { ticketNo },
            data: {
              status,
              urgency,
              category,
              resolution: resolution || existing.resolution,
              citizenName: citizenName || existing.citizenName,
              phone: phone || existing.phone,
              issue: issue || existing.issue,
              block: block || existing.block,
              district: district || existing.district,
              source: source || existing.source,
              airtableRecordId: airtableId,
            },
          });
          updatedCount++;
        } else {
          // ---- CREATE: New complaint from Airtable ----
          await db.complaint.create({
            data: {
              ticketNo,
              citizenName,
              phone,
              issue,
              category,
              block,
              district,
              urgency,
              status,
              resolution,
              source,
              airtableRecordId: airtableId,
            },
          });
          createdCount++;
        }
      } catch (recordError) {
        const msg = recordError instanceof Error ? recordError.message : 'Unknown error';
        errors.push(`Record ${airtableId} (${ticketNo}): ${msg}`);
        failedCount++;
      }
    }

    const synced = createdCount + updatedCount;

    return NextResponse.json({
      success: failedCount === 0,
      created: createdCount,
      updated: updatedCount,
      failed: failedCount,
      total: allAirtableRecords.length,
      errors: errors.length > 0 ? errors : undefined,
      message:
        failedCount === 0
          ? `Successfully synced ${synced} records from Airtable (${createdCount} created, ${updatedCount} updated).`
          : `Synced ${synced} records from Airtable (${createdCount} created, ${updatedCount} updated). ${failedCount} failed.`,
    });
  } catch (error) {
    console.error('Airtable pull sync error:', error);
    const message = error instanceof Error ? error.message : 'Failed to pull from Airtable';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
