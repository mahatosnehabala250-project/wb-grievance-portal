import { NextRequest, NextResponse } from 'next/server';
import { n8nSecretOk } from '@/lib/n8nAuth';

// POST /api/n8n/airtable/sync-analysis — Sync AI analysis to Airtable (WB-07). Requires X-N8N-SECRET.
export async function POST(request: NextRequest) {
  if (!n8nSecretOk(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    const { complaintId, analysis } = body;

    if (!complaintId || !analysis) {
      return NextResponse.json(
        { error: 'complaintId and analysis are required' },
        { status: 400 }
      );
    }

    // Log for audit trail
    console.log(`[n8n:airtable] Syncing AI analysis for complaint: ${complaintId}`);
    console.log(`[n8n:airtable] Analysis: ${JSON.stringify(analysis).substring(0, 500)}`);
    console.log(`[n8n:airtable] Airtable not configured yet. Analysis logged but not synced.`);

    return NextResponse.json({
      success: true,
      stub: true,
      message: 'AI analysis logged successfully (Airtable not configured)',
      complaintId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[n8n] Airtable sync analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to sync analysis', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
