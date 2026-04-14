import { NextRequest, NextResponse } from 'next/server';

// POST /api/n8n/sms/send — SMS sending stub for n8n (WB-03)
// For now just logs and returns success (SMS gateway not configured yet)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { to, message } = body;

    if (!to || !message) {
      return NextResponse.json(
        { error: 'to (phone number) and message are required' },
        { status: 400 }
      );
    }

    // Log the SMS for audit trail
    console.log(`[n8n:sms] SMS stub — to: ${to}, message: "${message.substring(0, 100)}..."`);
    console.log(`[n8n:sms] SMS gateway not configured yet. Message logged but not sent.`);

    return NextResponse.json({
      success: true,
      stub: true,
      message: 'SMS logged successfully (gateway not configured)',
      to,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[n8n] SMS send error:', error);
    return NextResponse.json(
      { error: 'Failed to send SMS', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
