import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST /api/integrations/airtable-sync — Sync all complaints to Airtable
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

    // Transform each complaint to Airtable record format
    const records = complaints.map((c) => ({
      fields: {
        'Ticket Number': c.ticketNo,
        'Citizen Name': c.citizenName || '',
        'Phone': c.phone || '',
        'Issue Description': c.issue,
        'Category': { name: c.category },
        'Block': c.block,
        'District': c.district,
        'Urgency': { name: c.urgency },
        'Status': { name: c.status },
        'Source': { name: c.source },
        'Created At': c.createdAt.toISOString(),
        'Updated At': c.updatedAt.toISOString(),
      },
    }));

    // Send in batches of 10 using Airtable's batch create endpoint
    const batchSize = 10;
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    const url = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}`;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ records: batch }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${response.status} - ${errorBody}`);
          failed += batch.length;
        } else {
          const data = await response.json();
          const created = data.records?.length ?? batch.length;
          synced += created;
          failed += batch.length - created;
        }
      } catch (batchError) {
        const msg = batchError instanceof Error ? batchError.message : 'Unknown error';
        errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${msg}`);
        failed += batch.length;
      }
    }

    return NextResponse.json({
      success: failed === 0,
      synced,
      failed,
      total: complaints.length,
      errors: errors.length > 0 ? errors : undefined,
      message:
        failed === 0
          ? `Successfully synced ${synced} complaints to Airtable.`
          : `Synced ${synced} complaints. ${failed} failed.`,
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
