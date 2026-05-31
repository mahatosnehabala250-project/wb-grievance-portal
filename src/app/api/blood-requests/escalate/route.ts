import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { withIdempotency } from '@/lib/idempotency/middleware';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// pg Pool used exclusively for the idempotency middleware DB client.
const idempotencyPool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';

const ENDPOINT = '/api/blood-requests/escalate';

/**
 * POST /api/blood-requests/escalate
 *
 * Admin-only endpoint to manually escalate a blood request.
 *
 * Modes:
 * - `next_tier`: Increments `cascade_tier` and triggers JS-15B re-entry
 *   for the next batch of donor notifications.
 * - `sos`: Sets urgency to 'critical', resets cascade_tier to 1, and
 *   triggers JS-15 SOS fan-out to all matching donors in the district.
 *
 * Wrapped with idempotency middleware (Req 28.1–28.4): an optional
 * `Idempotency-Key` header dedupes retries for 24 hours.
 *
 * Auth: Admin JWT (Bearer token).
 *
 * Request body:
 * {
 *   blood_request_id: string (uuid),
 *   mode: "next_tier" | "sos"
 * }
 *
 * Response: { ok: true, data: { blood_request_id, new_cascade_tier, mode } }
 *
 * Requirements: 16.4, 28.1–28.4 — Design §API Endpoint Contracts
 */
export async function POST(request: NextRequest) {
  return withIdempotency(
    request,
    ENDPOINT,
    () => handleEscalate(request),
    idempotencyPool,
  );
}

async function handleEscalate(request: NextRequest): Promise<Response> {
  try {
    // ─── Auth: admin JWT ───
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { ok: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    if (payload.role !== 'ADMIN') {
      return NextResponse.json(
        { ok: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    // ─── Parse body ───
    let body: { blood_request_id?: string; mode?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { blood_request_id, mode } = body;

    // ─── Validation ───
    if (!blood_request_id || typeof blood_request_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'blood_request_id is required' },
        { status: 400 }
      );
    }

    if (!mode || !['next_tier', 'sos'].includes(mode)) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'mode must be "next_tier" or "sos"' },
        { status: 400 }
      );
    }

    // ─── Verify blood request exists ───
    const { data: existingRequest, error: fetchError } = await supabase
      .from('blood_requests')
      .select('id, cascade_tier, urgency')
      .eq('id', blood_request_id)
      .single();

    if (fetchError || !existingRequest) {
      return NextResponse.json(
        { ok: false, error: 'NOT_FOUND', message: 'Blood request not found' },
        { status: 404 }
      );
    }

    let newCascadeTier: number;

    if (mode === 'next_tier') {
      // ─── next_tier: increment cascade_tier and trigger JS-15B re-entry ───
      newCascadeTier = (existingRequest.cascade_tier || 0) + 1;

      const { error: updateError } = await supabase
        .from('blood_requests')
        .update({ cascade_tier: newCascadeTier })
        .eq('id', blood_request_id);

      if (updateError) {
        console.error('[blood-requests/escalate] Update error:', updateError);
        return NextResponse.json(
          { ok: false, error: 'Failed to update blood request', details: updateError.message },
          { status: 500 }
        );
      }

      // Trigger JS-15B cascade re-entry via internal API
      triggerCascade(blood_request_id);

    } else {
      // ─── sos: set urgency to critical, reset cascade_tier to 1, trigger SOS fan-out ───
      newCascadeTier = 1;

      const { error: updateError } = await supabase
        .from('blood_requests')
        .update({ urgency: 'critical', cascade_tier: newCascadeTier })
        .eq('id', blood_request_id);

      if (updateError) {
        console.error('[blood-requests/escalate] SOS update error:', updateError);
        return NextResponse.json(
          { ok: false, error: 'Failed to update blood request', details: updateError.message },
          { status: 500 }
        );
      }

      // Trigger JS-15 SOS fan-out via n8n webhook
      triggerSOSFanOut(blood_request_id);
    }

    // ─── Audit log to activity_logs ───
    const { error: logError } = await supabase
      .from('activity_logs')
      .insert({
        complaintId: null,
        action: 'BLOOD_ESCALATION',
        description: `Admin escalated blood request to ${mode}`,
        actorId: payload.userId,
        actorName: payload.username,
      });

    if (logError) {
      // Non-blocking — log but don't fail the request
      console.error('[blood-requests/escalate] Audit log error:', logError);
    }

    return NextResponse.json({
      ok: true,
      data: {
        blood_request_id,
        new_cascade_tier: newCascadeTier,
        mode,
      },
    });
  } catch (error) {
    console.error('[blood-requests/escalate] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Fire-and-forget: trigger JS-15B cascade re-entry for next_tier mode.
 * Posts to the internal /api/n8n/cascade-trigger endpoint.
 */
function triggerCascade(blood_request_id: string): void {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  fetch(`${baseUrl}/api/n8n/cascade-trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-n8n-secret': process.env.N8N_WEBHOOK_SECRET || '',
    },
    body: JSON.stringify({ blood_request_id }),
  }).catch((err) => {
    console.warn('[blood-requests/escalate] Failed to trigger cascade:', err);
  });
}

/**
 * Fire-and-forget: trigger JS-15 SOS fan-out via n8n webhook.
 * Sends to the n8n webhook URL for the SOS cascade path.
 */
function triggerSOSFanOut(blood_request_id: string): void {
  if (!N8N_WEBHOOK_URL) {
    console.warn('[blood-requests/escalate] N8N_WEBHOOK_URL not configured — skipping SOS trigger');
    return;
  }

  const url = `${N8N_WEBHOOK_URL.replace(/\/+$/, '')}/blood-sos-fanout`;

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blood_request_id,
      urgency: 'critical',
      timestamp: new Date().toISOString(),
      source: 'admin_sos_escalation',
    }),
  }).catch((err) => {
    console.warn('[blood-requests/escalate] Failed to trigger SOS fan-out:', err);
  });
}
