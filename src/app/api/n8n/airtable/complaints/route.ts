import { NextResponse } from 'next/server';

// GET /api/n8n/airtable/complaints — Get Airtable complaints (WB-08)
// Returns empty array for now (Airtable not configured)
export async function GET() {
  try {
    console.log('[n8n:airtable] Airtable complaints requested — returning empty array (not configured)');

    return NextResponse.json({
      complaints: [],
      total: 0,
      stub: true,
      message: 'Airtable not configured yet',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[n8n] Airtable complaints fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Airtable complaints', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
