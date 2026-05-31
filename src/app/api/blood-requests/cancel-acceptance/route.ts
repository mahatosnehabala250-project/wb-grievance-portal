import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { withIdempotency } from '@/lib/idempotency/middleware';

/**
 * POST /api/blood-requests/cancel-acceptance
 *
 * Called when a confirmed donor cancels their acceptance OR the seeker
 * rejects a donor within the 15-min confirmation window.
 *
 * v1.1 (task 29.2): Replaced the v1 advisory-lock standby-promotion path with
 * a `SELECT ... FOR UPDATE SKIP LOCKED` CTE pattern per Design §v1.1.12 / Req 31.6.
 *
 * The SKIP LOCKED approach prevents double-promotion under concurrent cancellations:
 * each concurrent transaction locks a DIFFERENT standby row (the second transaction
 * skips the already-locked row and takes the next one). This is safer than the v1
 * advisory lock because:
 *   - The advisory lock serialised ALL cancellations for the same request, creating
 *     a bottleneck and a 5-second timeout risk under high concurrency.
 *   - SKIP LOCKED lets concurrent cancellations proceed in parallel, each promoting
 *     a distinct standby donor, which is the correct behaviour when multiple donors
 *     cancel simultaneously (e.g., two confirmed donors cancel at the same time for
 *     a request with two standby donors).
 *
 * Under the transaction, the route:
 *   1. Marks the donor's response as 'declined' (SELECT FOR UPDATE to lock the row)
 *   2. Decrements donors_confirmed_count
 *   3. Atomically finds + locks the highest-priority standby via FOR UPDATE SKIP LOCKED CTE
 *   4. Promotes them to 'accepted' and increments confirmed / decrements standby
 *   5. Fires a WhatsApp notification to the promoted donor
 *
 * Wrapped with idempotency middleware (Req 28.1–28.4): an optional
 * `Idempotency-Key` header dedupes retries for 24 hours.
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
 *
 * Requirements: 6.6, 28.1–28.4, 31.6 — Design §Property 8, §v1.1.12
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';

const ENDPOINT = '/api/blood-requests/cancel-acceptance';

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
  return withIdempotency(
    request,
    ENDPOINT,
    () => handleCancelAcceptance(request),
    pool,
  );
}

async function handleCancelAcceptance(request: NextRequest): Promise<Response> {
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

    // ─── Transaction with FOR UPDATE SKIP LOCKED standby promotion (v1.1, Req 31.6) ───
    //
    // No advisory lock is acquired. Instead:
    //   - The cancelled donor's response row is locked with SELECT FOR UPDATE before
    //     the UPDATE, preventing a concurrent cancel of the same donor from racing.
    //   - The standby promotion uses a CTE with FOR UPDATE SKIP LOCKED so that two
    //     concurrent cancellations each grab a DIFFERENT standby row atomically.
    //     If no unlocked standby exists (all are being promoted by concurrent txns),
    //     the CTE returns zero rows and no promotion happens — correct behaviour.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Step 1: Lock + mark the donor's response as 'declined'.
      // The SELECT FOR UPDATE ensures two concurrent cancels of the same donor
      // don't both see 'accepted' and both try to decrement.
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

      // Step 2: Decrement donors_confirmed_count.
      await client.query(
        `UPDATE blood_requests
         SET donors_confirmed_count = donors_confirmed_count - 1
         WHERE id = $1`,
        [blood_request_id]
      );

      // Step 3 + 4: Atomically find and promote the highest-priority standby donor
      // using FOR UPDATE SKIP LOCKED (v1.1, Req 31.6 / Design §v1.1.12).
      //
      // The CTE selects the single highest-priority standby row (earliest responded_at
      // = FIFO, matching the v1 ordering) and locks it with SKIP LOCKED so that a
      // concurrent cancellation transaction skips this row and picks the next one.
      // The outer UPDATE promotes the locked row to 'accepted' in the same statement.
      //
      // If no unlocked standby row exists (all standbys are already being promoted by
      // concurrent transactions), the CTE returns zero rows and no promotion occurs —
      // which is the correct outcome (no double-promotion).
      const promoteResult = await client.query(
        `WITH candidate AS (
           SELECT id, donor_id
           FROM blood_donor_responses
           WHERE blood_request_id = $1
             AND response_status = 'standby'
           ORDER BY responded_at ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE blood_donor_responses bdr
         SET response_status = 'accepted'
         FROM candidate
         WHERE bdr.id = candidate.id
         RETURNING candidate.donor_id AS promoted_donor_id`,
        [blood_request_id]
      );

      let promotedDonorId: string | null = null;
      let promotedDonorPhone: string | null = null;

      if (promoteResult.rows.length > 0) {
        promotedDonorId = promoteResult.rows[0].promoted_donor_id;

        // Step 5: Update blood_requests counters (increment confirmed, decrement standby).
        await client.query(
          `UPDATE blood_requests
           SET donors_confirmed_count = donors_confirmed_count + 1,
               donors_standby_count = donors_standby_count - 1
           WHERE id = $1`,
          [blood_request_id]
        );

        // Fetch promoted donor's phone for notification.
        const donorResult = await client.query(
          `SELECT phone FROM blood_donors WHERE id = $1`,
          [promotedDonorId]
        );

        if (donorResult.rows.length > 0) {
          promotedDonorPhone = donorResult.rows[0].phone;
        }
      }

      // Step 6: COMMIT
      await client.query('COMMIT');

      // Step 7: Fire-and-forget WhatsApp notification to promoted donor.
      if (promotedDonorId && promotedDonorPhone) {
        notifyPromotedDonor(promotedDonorId, promotedDonorPhone, blood_request_id).catch(() => {});
      }

      // Build response — same envelope shape as v1.
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
      // Rollback on any error.
      await client.query('ROLLBACK').catch(() => {});

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
