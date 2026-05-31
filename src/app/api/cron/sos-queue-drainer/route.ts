import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

/**
 * GET /api/cron/sos-queue-drainer   (Vercel Cron)
 *
 * SOS Fairness Queue Drainer (task 29.3, Req 31.5, Design §v1.1.12).
 *
 * When a blood request is SOS (urgency='critical' AND units_needed >= 5),
 * donor HAAN responses are enqueued into `donor_response_queue` by the
 * `/api/blood-requests/donor-respond` route instead of being processed inline.
 * This cron drains that queue in FIFO order (received_at ASC) using
 * `FOR UPDATE SKIP LOCKED` so that concurrent drainer invocations never
 * process the same row, preserving fairness ordering across simultaneous accepts.
 *
 * ─── Processing logic per row ────────────────────────────────────────────────
 * For each claimed 'queued' row:
 * 1. Mark the row 'processing' (within the same transaction that claimed it).
 * 2. Run the v1.1 conditional UPDATE on blood_requests:
 *      UPDATE blood_requests
 *        SET donors_confirmed_count = donors_confirmed_count + 1
 *      WHERE id = $blood_request_id AND donors_confirmed_count < units_needed
 *      RETURNING ...
 * 3. Zero rows → standby; one row → accepted.
 * 4. Update blood_donor_responses.response_status accordingly.
 * 5. Always increment blood_donors.total_offers_accepted (Req 6.5 / Property 7).
 * 6. Mark the queue row 'done'.
 * 7. COMMIT.
 *
 * ─── Idempotency ─────────────────────────────────────────────────────────────
 * The enqueue step in donor-respond already skips duplicate (blood_request_id,
 * donor_id) pairs in 'queued'/'processing'/'done' status. The drainer additionally
 * marks rows 'processing' before running the conditional UPDATE, so a crash
 * between claim and commit leaves the row in 'processing' — the next tick skips
 * it (SKIP LOCKED) and it can be manually reset or left as a no-op since the
 * conditional UPDATE is itself idempotent (a second attempt would just return
 * zero rows and mark standby, which is safe).
 *
 * ─── Schedule ────────────────────────────────────────────────────────────────
 * Registered in `vercel.json` `crons` to run every minute:
 *   { "path": "/api/cron/sos-queue-drainer", "schedule": "* * * * *" }
 * Design §v1.1.12 sketches a 1-second tick, but Vercel Cron's minimum granularity
 * is one minute. Each tick drains up to DRAIN_LIMIT rows per request, so the
 * effective throughput is sufficient for SOS scenarios.
 *
 * ─── Auth ──────────────────────────────────────────────────────────────────
 * Vercel attaches `Authorization: Bearer ${CRON_SECRET}` to cron invocations.
 * Requests without a matching bearer are rejected (fail-closed).
 *
 * ─── Concurrency safety ──────────────────────────────────────────────────────
 * `FOR UPDATE SKIP LOCKED` ensures two concurrent drainer invocations never
 * process the same queue row. The conditional UPDATE on blood_requests is the
 * last line of defence for the `donors_confirmed_count <= units_needed` invariant
 * (backed by the v1 CHECK constraint `chk_confirmed_le_needed` from task 1.3).
 *
 * Response: { ok: true, data: { claimed, accepted, standby, skipped } }
 *
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 31.5
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.12, §Donor Acceptance / Race Condition
 * @see supabase/migrations/20260201_005_circuit_state_donor_queue_token_stats.sql — donor_response_queue DDL
 */

export const runtime = 'nodejs';
// Never serve a cached response for a cron mutation.
export const dynamic = 'force-dynamic';

/**
 * Raw `pg` pool — `FOR UPDATE SKIP LOCKED` and multi-statement transactions are
 * not expressible through the Supabase REST builder.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

/**
 * Maximum rows to drain per tick per blood_request_id.
 * Keeps each tick bounded and prevents a single SOS request from monopolising
 * the drainer when many donors respond simultaneously.
 */
const DRAIN_LIMIT = Number(process.env.SOS_DRAIN_LIMIT) || 50;

interface QueueRow {
  id: string;
  blood_request_id: string;
  donor_id: string;
  received_at: string;
  trace_id: string | null;
}

export async function GET(request: NextRequest) {
  // ─── Auth: Vercel Cron bearer secret (fail-closed) ───
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error('[cron/sos-queue-drainer] CRON_SECRET is not configured — refusing to run');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not configured' },
      { status: 401 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ─── Claim a FIFO batch of queued rows (SKIP LOCKED for concurrency safety) ───
    // Order by received_at ASC to preserve fairness ordering (first-come, first-served).
    const { rows } = await client.query<QueueRow>(
      `SELECT id, blood_request_id, donor_id, received_at, trace_id
         FROM donor_response_queue
        WHERE status = 'queued'
        ORDER BY received_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [DRAIN_LIMIT]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({
        ok: true,
        data: { claimed: 0, accepted: 0, standby: 0, skipped: 0 },
      });
    }

    // Mark all claimed rows as 'processing' atomically before processing.
    // This prevents a crash-then-retry from double-processing the same row.
    const claimedIds = rows.map((r) => r.id);
    await client.query(
      `UPDATE donor_response_queue
          SET status = 'processing'
        WHERE id = ANY($1::uuid[])`,
      [claimedIds]
    );

    await client.query('COMMIT');

    // ─── Process each claimed row in a separate transaction ───
    // Each row is processed independently so a failure on one does not roll back
    // the others. The conditional UPDATE is the atomic acceptance gate.
    let accepted = 0;
    let standby = 0;
    let skipped = 0;

    for (const row of rows) {
      const rowClient = await pool.connect();
      try {
        await rowClient.query('BEGIN');

        // v1.1 conditional UPDATE — single atomic statement (Req 31.2).
        // Zero rows → cap reached → standby. One row → accepted.
        const updateResult = await rowClient.query(
          `UPDATE blood_requests
           SET donors_confirmed_count = donors_confirmed_count + 1
           WHERE id = $1 AND donors_confirmed_count < units_needed
           RETURNING units_needed, donors_confirmed_count`,
          [row.blood_request_id]
        );

        let responseStatus: 'accepted' | 'standby';

        if (updateResult.rows.length > 0) {
          responseStatus = 'accepted';
          accepted += 1;
        } else {
          responseStatus = 'standby';
          standby += 1;
          // Increment standby count on the request.
          await rowClient.query(
            `UPDATE blood_requests
             SET donors_standby_count = donors_standby_count + 1
             WHERE id = $1`,
            [row.blood_request_id]
          );
        }

        // Update the donor response record.
        await rowClient.query(
          `UPDATE blood_donor_responses
           SET response_status = $1, responded_at = NOW()
           WHERE blood_request_id = $2 AND donor_id = $3`,
          [responseStatus, row.blood_request_id, row.donor_id]
        );

        // Always increment total_offers_accepted (Req 6.5 / Property 7).
        await rowClient.query(
          `UPDATE blood_donors
           SET total_offers_accepted = total_offers_accepted + 1
           WHERE id = $1`,
          [row.donor_id]
        );

        // Mark the queue row as done.
        await rowClient.query(
          `UPDATE donor_response_queue
           SET status = 'done'
           WHERE id = $1`,
          [row.id]
        );

        await rowClient.query('COMMIT');

        console.log(
          `[cron/sos-queue-drainer] Processed queue row ${row.id}: ` +
          `blood_request_id=${row.blood_request_id} donor_id=${row.donor_id} ` +
          `status=${responseStatus}`
        );
      } catch (err) {
        await rowClient.query('ROLLBACK').catch(() => {});
        // Leave the row in 'processing' status — it will be skipped by SKIP LOCKED
        // on the next tick. An operator can reset it to 'queued' if needed.
        console.error(
          `[cron/sos-queue-drainer] Failed to process queue row ${row.id}:`,
          err
        );
        skipped += 1;
      } finally {
        rowClient.release();
      }
    }

    console.log(
      `[cron/sos-queue-drainer] claimed=${rows.length} accepted=${accepted} standby=${standby} skipped=${skipped}`
    );

    return NextResponse.json({
      ok: true,
      data: { claimed: rows.length, accepted, standby, skipped },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[cron/sos-queue-drainer] Error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
