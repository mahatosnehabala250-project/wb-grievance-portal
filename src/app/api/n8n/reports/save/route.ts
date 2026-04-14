import { NextRequest, NextResponse } from 'next/server';

// POST /api/n8n/reports/save — Save daily report (WB-06)
// For now just logs and returns success (Airtable not connected yet)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { reportType, content, stats } = body;

    if (!reportType) {
      return NextResponse.json(
        { error: 'reportType is required' },
        { status: 400 }
      );
    }

    // Log the report for audit trail
    console.log(`[n8n:reports] Report saved — type: ${reportType}`);
    console.log(`[n8n:reports] Content length: ${JSON.stringify(content || {}).length} chars`);
    console.log(`[n8n:reports] Stats: ${JSON.stringify(stats || {})}`);
    console.log(`[n8n:reports] Airtable not connected yet. Report logged but not saved externally.`);

    return NextResponse.json({
      success: true,
      stub: true,
      message: 'Report logged successfully (Airtable not connected)',
      reportType,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[n8n] Report save error:', error);
    return NextResponse.json(
      { error: 'Failed to save report', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
