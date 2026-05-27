import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

/**
 * POST /api/blood-requests/donor-respond
 *
 * Called by the Blood Agent (n8n) when a donor responds HAAN or NAHI
 * to a pending blood request notification.
 *
 * Uses raw pg with advisory locks for race-safe acceptance (Req 6).
 * Supabase REST API doesn't support advisory locks or multi-statement
 * transactions, so this endpoint uses DATABASE_URL directly.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET env var.
 *
 * Request body:
 * {
 *   donor_id: string (uuid),
 *   blood_request_id: string (uuid),
 *   response: "HAAN" | "NAHI"
 * }
 *
 * Response:
 * - HAAN accepted: { ok: true, data: { response_status: "accepted", next_step: "pre_screening" } }
 * - HAAN standby:  { ok: true, data: { response_status: "standby", next_step: "thank_you" } }
 * - NAHI:          { ok: true, data: { response_status: "declined" } }
 * - Lock timeout:  { ok: false, error: "LOCK_TIMEOUT", message: "...", retryAfterMs: 250 } (503)
 *
 * Requirements: 4.4, 4.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

export async function POST(request: NextRequest) {
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
    const { donor_id, blood_request_id, response } = body;

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

    // ─── HAAN path — advisory-lock acceptance (race-safe) ───
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");

      // Acquire advisory lock keyed on blood_request_id (hashtext for int4 key)
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1::text))',
        [blood_request_id]
      );

      // Read current state under lock
      const reqResult = await client.query(
        'SELECT donors_confirmed_count, units_needed FROM blood_requests WHERE id = $1 FOR UPDATE',
        [blood_request_id]
      );

      if (reqResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { ok: false, error: 'NOT_FOUND', message: 'Blood request not found' },
          { status: 404 }
        );
      }

      const { donors_confirmed_count, units_needed } = reqResult.rows[0];
      let responseStatus: 'accepted' | 'standby';

      if (donors_confirmed_count < units_needed) {
        // Under cap → accept and increment confirmed count
        responseStatus = 'accepted';
        await client.query(
          `UPDATE blood_requests
           SET donors_confirmed_count = donors_confirmed_count + 1
           WHERE id = $1`,
          [blood_request_id]
        );
      } else {
        // Cap reached → standby and increment standby count
        responseStatus = 'standby';
        await client.query(
          `UPDATE blood_requests
           SET donors_standby_count = donors_standby_count + 1
           WHERE id = $1`,
          [blood_request_id]
        );
      }

      // Mark the donor response
      await client.query(
        `UPDATE blood_donor_responses
         SET response_status = $1, responded_at = NOW()
         WHERE blood_request_id = $2 AND donor_id = $3`,
        [responseStatus, blood_request_id, donor_id]
      );

      // Always increment total_offers_accepted for the responder (Req 6.5)
      await client.query(
        `UPDATE blood_donors
         SET total_offers_accepted = total_offers_accepted + 1
         WHERE id = $1`,
        [donor_id]
      );

      await client.query('COMMIT');

      // Build response
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
      // Rollback on any error
      await client.query('ROLLBACK').catch(() => {});

      // Check for lock timeout (Postgres error code 55P03)
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
