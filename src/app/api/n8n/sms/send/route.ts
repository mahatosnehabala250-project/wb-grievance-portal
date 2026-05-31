import { NextRequest, NextResponse } from 'next/server';
import { createTraceLogger } from '@/lib/trace/logger';

// POST /api/n8n/sms/send — SMS sending stub for n8n (WB-03)
// For now just logs and returns success (SMS gateway not configured yet)
export async function POST(request: NextRequest) {
  // Trace logger: carries the inbound X-Trace-Id (or a fresh uuid7) on every
  // line so outbound-send attempts are reconstructable (Req 27.4, Design §v1.1.8).
  const log = createTraceLogger(request, { route: '/api/n8n/sms/send' });
  try {
    const body = await request.json();
    const { to, message } = body;

    if (!to || !message) {
      return NextResponse.json(
        { error: 'to (phone number) and message are required' },
        { status: 400 }
      );
    }

    // Log the SMS for audit trail (trace-tagged; message body intentionally omitted).
    log.info('sms_stub_logged', {
      to,
      message_chars: String(message).length,
      gateway_configured: false,
    });

    return NextResponse.json({
      success: true,
      stub: true,
      message: 'SMS logged successfully (gateway not configured)',
      to,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error('sms_send_error', { err: error });
    return NextResponse.json(
      { error: 'Failed to send SMS', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
