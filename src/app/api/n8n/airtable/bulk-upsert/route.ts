import { NextRequest, NextResponse } from 'next/server';

// POST /api/n8n/airtable/bulk-upsert — Push complaints to Airtable (WB-08)
// For now just logs and returns success (Airtable not connected yet)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { complaints } = body;

    if (!complaints || !Array.isArray(complaints)) {
      return NextResponse.json(
        { error: 'complaints array is required' },
        { status: 400 }
      );
    }

    // Log for audit trail
    console.log(`[n8n:airtable] Bulk upsert — ${complaints.length} complaints`);
    console.log(`[n8n:airtable] Airtable not configured yet. Complaints logged but not pushed.`);

    return NextResponse.json({
      success: true,
      stub: true,
      message: `${complaints.length} complaints logged for Airtable (not configured)`,
      requested: complaints.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[n8n] Airtable bulk upsert error:', error);
    return NextResponse.json(
      { error: 'Failed to bulk upsert complaints', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
