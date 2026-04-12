import { NextRequest, NextResponse } from 'next/server';

// POST /api/integrations/airtable-test — Test Airtable connectivity
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

    // Make a GET request to Airtable API to verify credentials
    const url = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}?maxRecords=1`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401) {
      return NextResponse.json(
        { success: false, error: 'Invalid API token. Please check your Airtable personal access token.' },
        { status: 400 }
      );
    }

    if (response.status === 404) {
      return NextResponse.json(
        { success: false, error: 'Base or table not found. Please verify your base ID and table name.' },
        { status: 400 }
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      return NextResponse.json(
        { success: false, error: `Airtable API error (${response.status}): ${errorBody}` },
        { status: 400 }
      );
    }

    const data = await response.json();

    // Extract field names from the schema
    const fieldNames: string[] = [];
    if (data.records && data.records.length > 0) {
      fieldNames.push(...Object.keys(data.records[0].fields));
    }

    return NextResponse.json({
      success: true,
      records: data.records || [],
      fieldNames,
      message: `Airtable connection successful. Table "${tableName}" is accessible with ${data.records?.length ?? 0} record(s) found.`,
    });
  } catch (error) {
    console.error('Airtable test error:', error);
    const message = error instanceof Error ? error.message : 'Failed to connect to Airtable';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
