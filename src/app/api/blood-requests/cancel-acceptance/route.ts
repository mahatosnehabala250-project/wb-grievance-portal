import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

/**
 * POST /api/blood-requests/cancel-acceptance
 *
 * Called when a confirmed donor cancels their acceptance OR the seeker
 * rejects a donor within the 15-min confirmation window.
 *
 * Uses the same advisory-lock pattern as donor-respond for race safety.
 * Under the lock, the route:
 *   1. Marks the donor's response as 'declined'
 *   2. Decrements donors_confirmed_count
 *   3. Finds the highest-priority standby donor (earliest responded_at)
 *   4. Promotes them to 'accepted' and increments confirmed / decrements standby
 *   5. Fires a WhatsApp notification to the promoted donor
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET env var.
 *
 * Request body:
 * {
 *   donor_id: string (uuid) — the donor being cancelled/rejected
 *   blood_request_id: string (uuid)
 *   reason: "cancel" | "seeker_reject"
 * }
 *
 * Response:
 * - Success: { ok: true, data: { cancelled_donor_id, promoted_donor_id?, promoted_donor_phone? } }
 * - Lock timeout: { ok: false, error: "LOCK_TIMEOUT", message: "...", retryAfterMs: 250 } (503)
 *
 * Requirements: 6.6 — Design §Property 8
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';

/**
 * Fire-and-forget WhatsApp notification to the promoted donor.
 * Uses the n8n webhook to trigger the notification workflow.
 * Errors are logged but never thrown.
 */
async function notifyPromotedDonor(
  donorId: string,
  donorPhone: string,
  bloodRequestId: string
): Promise<void> {
  if (!N8N_WEBHOOK_URL) {
    console.warn('[cancel-acceptance] N8N_WEBHOOK_URL not configured — skipping notification');
    return;
  }

  const url = `${N8N_WEBHOOK_URL.replace(/\/+$/, '')}/notify-donor-promoted`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        donor_id: donorId,
        donor_phone: donorPhone,
        blood_request_id: bloodRequestId,
        message: 'Bhai, abhi aap ki zaroorat hai! Kripya hospital pohuncho.',
        timestamp: new Date().toISOString(),
        source: 'standby_promotion',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(
        `[cancel-acceptance] Non-OK response from notification webhook: ${response.status} ${response.statusText}`
      );
    } else {
      console.log(`[cancel-acceptance] ✅ Notified promoted donor ${donorId}`);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.warn(`[cancel-acceptance] Notification timeout for donor ${donorId}`);
    } else {
      console.warn(`[cancel-acceptance] Notification error for donor ${donorId}:`, error);
    }
  }
}

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
    const { donor_id, blood_request_id, reason } = body;

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

    if (!reason || !['cancel', 'seeker_reject'].includes(reason)) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'reason must be "cancel" or "seeker_reject"' },
        { status: 400 }
      );
    }

    // ─── Advisory-lock transaction for race-safe standby promotion ───
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");

      // Acquire advisory lock keyed on blood_request_id (same lock as donor-respond)
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1::text))',
        [blood_request_id]
      );

      // Step 2: Mark the donor's response as 'declined'
      const cancelResult = await client.query(
        `UPDATE blood_donor_responses
         SET response_status = 'declined'
         WHERE donor_id = $1
           AND blood_request_id = $2
           AND response_status = 'accepted'
         RETURNING id`,
        [donor_id, blood_request_id]
      );

      if (cancelResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { ok: false, error: 'NOT_FOUND', message: 'No accepted response found for this donor and request' },
          { status: 404 }
        );
      }

      // Step 3: Decrement donors_confirmed_count
      await client.query(
        `UPDATE blood_requests
         SET donors_confirmed_count = donors_confirmed_count - 1
         WHERE id = $1`,
        [blood_request_id]
      );

      // Step 4: Find highest-priority standby donor (earliest responded_at = FIFO)
      const standbyResult = await client.query(
        `SELECT donor_id
         FROM blood_donor_responses
         WHERE blood_request_id = $1
           AND response_status = 'standby'
         ORDER BY responded_at ASC
         LIMIT 1`,
        [blood_request_id]
      );

      let promotedDonorId: string | null = null;
      let promotedDonorPhone: string | null = null;

      if (standbyResult.rows.length > 0) {
        promotedDonorId = standbyResult.rows[0].donor_id;

        // Step 5: Promote standby donor to accepted
        await client.query(
          `UPDATE blood_donor_responses
           SET response_status = 'accepted'
           WHERE donor_id = $1
             AND blood_request_id = $2
             AND response_status = 'standby'`,
          [promotedDonorId, blood_request_id]
        );

        // Step 6: Update blood_requests counters (increment confirmed, decrement standby)
        await client.query(
          `UPDATE blood_requests
           SET donors_confirmed_count = donors_confirmed_count + 1,
               donors_standby_count = donors_standby_count - 1
           WHERE id = $1`,
          [blood_request_id]
        );

        // Fetch promoted donor's phone for notification
        const donorResult = await client.query(
          `SELECT phone FROM blood_donors WHERE id = $1`,
          [promotedDonorId]
        );

        if (donorResult.rows.length > 0) {
          promotedDonorPhone = donorResult.rows[0].phone;
        }
      }

      // Step 7: COMMIT
      await client.query('COMMIT');

      // Step 8: Fire-and-forget WhatsApp notification to promoted donor
      if (promotedDonorId && promotedDonorPhone) {
        notifyPromotedDonor(promotedDonorId, promotedDonorPhone, blood_request_id).catch(() => {});
      }

      // Build response
      const data: {
        cancelled_donor_id: string;
        promoted_donor_id?: string;
        promoted_donor_phone?: string;
      } = {
        cancelled_donor_id: donor_id,
      };

      if (promotedDonorId) {
        data.promoted_donor_id = promotedDonorId;
      }
      if (promotedDonorPhone) {
        data.promoted_donor_phone = promotedDonorPhone;
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

      console.error('[blood-requests/cancel-acceptance] Transaction error:', err);
      return NextResponse.json(
        { ok: false, error: 'Internal server error' },
        { status: 500 }
      );
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[blood-requests/cancel-acceptance] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
