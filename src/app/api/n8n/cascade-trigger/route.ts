import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createTraceLogger } from '@/lib/trace/logger';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/n8n/cascade-trigger
 *
 * Called by n8n workflows (JS-15) to kick off the JS-15B Donor Cascade Engine
 * for a given blood request.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET env var.
 *
 * Request body:
 * {
 *   blood_request_id: string (uuid, required)
 * }
 *
 * Logic:
 * 1. Validate X-N8N-SECRET
 * 2. Read blood_requests row: SELECT cascade_tier, urgency FROM blood_requests WHERE id = $1
 * 3. If cascade_tier > 0: return idempotent no-op (already cascading)
 * 4. If cascade_tier === 0: UPDATE blood_requests SET cascade_tier = 1 WHERE id = $1
 * 5. Trigger JS-15B workflow via HTTP POST to its webhook URL (fire-and-forget)
 *
 * Response: { ok: true, data: { blood_request_id, cascade_tier, triggered: boolean } }
 *
 * Requirements: 5.5, 5.9 — Design §API Endpoint Contracts
 */
export async function POST(request: NextRequest) {
  // Trace logger: binds the request's trace_id (X-Trace-Id header or fresh
  // uuid7) once, so every log line below carries it (Req 27.4, Design §v1.1.8).
  const log = createTraceLogger(request, { route: '/api/n8n/cascade-trigger' });
  try {
    // ─── Auth: verify n8n webhook secret ───
    const secret = request.headers.get('x-n8n-secret');
    const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // ─── Parse body ───
    const body = await request.json();
    const { blood_request_id } = body;

    // ─── Validation ───
    if (!blood_request_id || typeof blood_request_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'blood_request_id is required and must be a string' },
        { status: 400 }
      );
    }

    // UUID format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(blood_request_id)) {
      return NextResponse.json(
        { ok: false, error: 'blood_request_id must be a valid UUID' },
        { status: 400 }
      );
    }

    // ─── Read blood_requests row ───
    const { data: bloodRequest, error: fetchError } = await supabase
      .from('blood_requests')
      .select('id, cascade_tier, urgency')
      .eq('id', blood_request_id)
      .single();

    if (fetchError || !bloodRequest) {
      return NextResponse.json(
        { ok: false, error: 'Blood request not found', details: fetchError?.message },
        { status: 404 }
      );
    }

    // ─── Idempotency check: if cascade_tier > 0, already cascading ───
    if (bloodRequest.cascade_tier > 0) {
      return NextResponse.json({
        ok: true,
        data: {
          already_cascading: true,
          blood_request_id,
          cascade_tier: bloodRequest.cascade_tier,
          triggered: false,
        },
      });
    }

    // ─── Update cascade_tier to 1 ───
    const { error: updateError } = await supabase
      .from('blood_requests')
      .update({ cascade_tier: 1 })
      .eq('id', blood_request_id);

    if (updateError) {
      log.error('cascade_tier_update_failed', { blood_request_id, err: updateError.message });
      return NextResponse.json(
        { ok: false, error: 'Failed to update cascade tier', details: updateError.message },
        { status: 500 }
      );
    }

    // ─── Fire-and-forget: trigger JS-15B webhook ───
    const js15bWebhookUrl = process.env.JS15B_WEBHOOK_URL;

    if (js15bWebhookUrl) {
      // Fire-and-forget — do not await the response
      fetch(js15bWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blood_request_id,
          urgency: bloodRequest.urgency,
          cascade_tier: 1,
        }),
      }).catch((err) => {
        log.error('js15b_webhook_failed', { blood_request_id, err });
      });
    } else {
      log.warn('js15b_webhook_url_missing', { blood_request_id });
    }

    // ─── Return success ───
    log.info('cascade_triggered', {
      blood_request_id,
      cascade_tier: 1,
      triggered: !!js15bWebhookUrl,
    });
    return NextResponse.json({
      ok: true,
      data: {
        blood_request_id,
        cascade_tier: 1,
        triggered: !!js15bWebhookUrl,
      },
    });
  } catch (error) {
    log.error('cascade_trigger_error', { err: error });
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
