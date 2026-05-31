import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { withIdempotency } from '@/lib/idempotency/middleware';

/**
 * POST /api/blood-requests/donor-respond
 *
 * Called by the Blood Agent (n8n) when a donor responds HAAN or NAHI
 * to a pending blood request notification.
 *
 * v1.1 SOS fairness queue (Req 31.5, Design §v1.1.12):
 * When the blood request is SOS (urgency='critical' AND units_needed >= 5),
 * HAAN responses are enqueued into `donor_response_queue` (FIFO) instead of
 * being processed inline. The SOS queue drainer cron
 * (`/api/cron/sos-queue-drainer`) processes them in received_at order using
 * FOR UPDATE SKIP LOCKED, preserving fairness across concurrent accepts.
 *
 * Non-SOS requests continue to use the v1.1 conditional UPDATE path (task 29.1).
 *
 * Uses raw pg with advisory locks for race-safe acceptance (Req 6).
 * Supabase REST API doesn't support advisory locks or multi-statement
 * transactions, so this endpoint uses DATABASE_URL directly.
 *
 * Wrapped with idempotency middleware (Req 28.1–28.4): an optional
 * `Idempotency-Key` header dedupes retries for 24 hours.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET env var.
 *
 * Request body:
 * {
 *   donor_id: string (uuid),
 *   blood_request_id: string (uuid),
 *   response: "HAAN" | "NAHI",
 *   trace_id?: string (uuid, optional — propagated from n8n X-Trace-Id)
 * }
 *
 * Response:
 * - HAAN accepted:  { ok: true, data: { response_status: "accepted", next_step: "pre_screening" } }
 * - HAAN standby:   { ok: true, data: { response_status: "standby", next_step: "thank_you" } }
 * - HAAN SOS queued:{ ok: true, data: { response_status: "queued", next_step: "sos_queue" } }
 * - NAHI:           { ok: true, data: { response_status: "declined" } }
 * - Lock timeout:   { ok: false, error: "LOCK_TIMEOUT", message: "...", retryAfterMs: 250 } (503)
 *
 * Requirements: 4.4, 4.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 28.1–28.4, 31.5
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

const ENDPOINT = '/api/blood-requests/donor-respond';

/**
 * SOS threshold: requests with urgency='critical' AND units_needed >= 5
 * are routed through the donor_response_queue for FIFO fairness ordering.
 * Req 31.5, Design §v1.1.12.
 */
const SOS_UNITS_THRESHOLD = 5;

export async function POST(request: NextRequest) {
  return withIdempotency(
    request,
    ENDPOINT,
    () => handleDonorRespond(request),
    pool,
  );
}

async function handleDonorRespond(request: NextRequest): Promise<Response> {
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
    const { donor_id, blood_request_id, response, trace_id } = body;

    // ─── Validation ───
    if (!donor_id || typeof donor_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'donor_id is required and must be a string' },
        { status: 400 }
      );
    }

    if (!blood_request_id || typeof blood_request_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'blood_request_id is required and must be a string' },
        { status: 400 }
      );
    }

    if (!response || !['HAAN', 'NAHI'].includes(response)) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'response must be HAAN or NAHI' },
        { status: 400 }
      );
    }

    // ─── NAHI path — simple decline, no lock needed ───
    if (response === 'NAHI') {
      const client = await pool.connect();
      try {
        await client.query(
          `UPDATE blood_donor_responses
           SET response_status = 'declined', responded_at = NOW()
           WHERE blood_request_id = $1 AND donor_id = $2`,
          [blood_request_id, donor_id]
        );
        return NextResponse.json({
          ok: true,
          data: { response_status: 'declined' },
        });
      } finally {
        client.release();
      }
    }

    // ─── HAAN path ───
    // Check if this is an SOS request (urgency='critical' AND units_needed >= SOS_UNITS_THRESHOLD).
    // SOS requests are enqueued into donor_response_queue for FIFO fairness ordering (Req 31.5).
    // Non-SOS requests use the v1.1 conditional UPDATE path inline.
    const client = await pool.connect();
    try {
      const reqResult = await client.query(
        `SELECT urgency, units_needed FROM blood_requests WHERE id = $1`,
        [blood_request_id]
      );

      if (reqResult.rows.length === 0) {
        return NextResponse.json(
          { ok: false, error: 'NOT_FOUND', message: 'Blood request not found' },
          { status: 404 }
        );
      }

      const { urgency, units_needed } = reqResult.rows[0];
      const isSos = urgency === 'critical' && units_needed >= SOS_UNITS_THRESHOLD;

      if (isSos) {
        // ─── SOS path: enqueue into donor_response_queue (Req 31.5) ───
        return await enqueueSosResponse(client, blood_request_id, donor_id, trace_id ?? null);
      } else {
        // ─── Non-SOS path: conditional UPDATE (v1.1, task 29.1) ───
        return await processHaanInline(client, blood_request_id, donor_id);
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[blood-requests/donor-respond] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Enqueue a HAAN response into donor_response_queue for SOS fairness ordering.
 * Idempotency-aware: skips if same (blood_request_id, donor_id) is already
 * in 'queued', 'processing', or 'done' status.
 *
 * Req 31.5, Design §v1.1.12.
 */
async function enqueueSosResponse(
  client: import('pg').PoolClient,
  blood_request_id: string,
  donor_id: string,
  trace_id: string | null
): Promise<Response> {
  try {
    // Idempotency check: skip if already enqueued or processed for this (request, donor) pair.
    const existing = await client.query(
      `SELECT id, status FROM donor_response_queue
       WHERE blood_request_id = $1 AND donor_id = $2
         AND status IN ('queued', 'processing', 'done')
       LIMIT 1`,
      [blood_request_id, donor_id]
    );

    if (existing.rows.length > 0) {
      const existingStatus = existing.rows[0].status;
      // Already in queue or processed — return appropriate response.
      if (existingStatus === 'done') {
        return NextResponse.json({
          ok: true,
          data: {
            response_status: 'queued',
            next_step: 'sos_queue',
            message: 'Aap ki response pehle se process ho chuki hai.',
          },
        });
      }
      return NextResponse.json({
        ok: true,
        data: {
          response_status: 'queued',
          next_step: 'sos_queue',
          message: 'Aap ki response queue mein hai. Thodi der mein process hogi.',
        },
      });
    }

    // Insert into donor_response_queue (FIFO by received_at = now()).
    await client.query(
      `INSERT INTO donor_response_queue (blood_request_id, donor_id, received_at, status, trace_id)
       VALUES ($1, $2, NOW(), 'queued', $3)`,
      [blood_request_id, donor_id, trace_id]
    );

    console.log(
      `[blood-requests/donor-respond] SOS enqueue: blood_request_id=${blood_request_id} donor_id=${donor_id}`
    );

    return NextResponse.json({
      ok: true,
      data: {
        response_status: 'queued',
        next_step: 'sos_queue',
        message: 'Aap ki response queue mein add ho gayi hai. Thodi der mein process hogi.',
      },
    });
  } catch (err) {
    console.error('[blood-requests/donor-respond] SOS enqueue error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Process a HAAN response inline using the v1.1 conditional UPDATE pattern.
 * Used for non-SOS requests (urgency != 'critical' OR units_needed < 5).
 *
 * Single conditional UPDATE: zero rows → standby, one row → accepted.
 * Always increments total_offers_accepted (Req 6.5 / Property 7).
 *
 * Req 31.2, 31.3, 31.4, Design §v1.1.12.
 */
async function processHaanInline(
  client: import('pg').PoolClient,
  blood_request_id: string,
  donor_id: string
): Promise<Response> {
  try {
    await client.query('BEGIN');

    // v1.1 conditional UPDATE — single atomic statement, no advisory lock.
    const updateResult = await client.query(
      `UPDATE blood_requests
       SET donors_confirmed_count = donors_confirmed_count + 1
       WHERE id = $1 AND donors_confirmed_count < units_needed
       RETURNING units_needed, donors_confirmed_count`,
      [blood_request_id]
    );

    let responseStatus: 'accepted' | 'standby';

    if (updateResult.rows.length > 0) {
      // Conditional UPDATE succeeded → accepted.
      responseStatus = 'accepted';
    } else {
      // Zero rows returned → cap already reached → standby.
      responseStatus = 'standby';
      await client.query(
        `UPDATE blood_requests
         SET donors_standby_count = donors_standby_count + 1
         WHERE id = $1`,
        [blood_request_id]
      );
    }

    // Mark the donor response.
    await client.query(
      `UPDATE blood_donor_responses
       SET response_status = $1, responded_at = NOW()
       WHERE blood_request_id = $2 AND donor_id = $3`,
      [responseStatus, blood_request_id, donor_id]
    );

    // Always increment total_offers_accepted for the responder (Req 6.5).
    await client.query(
      `UPDATE blood_donors
       SET total_offers_accepted = total_offers_accepted + 1
       WHERE id = $1`,
      [donor_id]
    );

    await client.query('COMMIT');

    const data: { response_status: string; next_step?: string; message?: string } = {
      response_status: responseStatus,
    };

    if (responseStatus === 'accepted') {
      data.next_step = 'pre_screening';
    } else {
      data.next_step = 'thank_you';
      data.message = 'Bahut shukriya bhai 🙏 — is request ke liye doosre donor ne already confirm kar diya hai.';
    }

    return NextResponse.json({ ok: true, data });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});

    // Check for lock timeout (Postgres error code 55P03) — kept for safety belt.
    const pgError = err as { code?: string };
    if (pgError.code === '55P03') {
      return NextResponse.json(
        {
          ok: false,
          error: 'LOCK_TIMEOUT',
          message: 'Request abhi process ho raha hai, ek minute mein try karein.',
          retryAfterMs: 250,
        },
        { status: 503 }
      );
    }

    console.error('[blood-requests/donor-respond] Transaction error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
