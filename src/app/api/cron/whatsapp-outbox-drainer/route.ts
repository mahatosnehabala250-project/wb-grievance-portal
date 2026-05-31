import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

/**
 * GET /api/cron/whatsapp-outbox-drainer   (Vercel Cron)
 *
 * WhatsApp Outbox Drainer (task 26.5, Req 28.8 / 28.9 / 29.5 / 29.6, Design
 * §v1.1.9 + §v1.1.10). The `whatsapp_outbox` table buffers outbound WhatsApp
 * messages so the system can absorb traffic spikes and survive a WhatsApp
 * circuit-breaker fallback: when `circuit_state.whatsapp = 'open'`, the send
 * wrapper (task 27.6) writes replies to `whatsapp_outbox` with
 * `status = 'pending'` instead of calling the Cloud API. This cron drains those
 * buffered rows in FIFO order, sends them through the WhatsApp Cloud API, and
 * records attempt accounting so a permanently failing message eventually stops
 * retrying.
 *
 * ─── Schedule ────────────────────────────────────────────────────────────────
 * Registered in `vercel.json` `crons` to run every minute:
 *   { "path": "/api/cron/whatsapp-outbox-drainer", "schedule": "* * * * *" }
 * Design §v1.1.9 sketches a 5-second tick, but Vercel Cron's minimum granularity
 * is one minute, so this is the closest achievable cadence. Per-tick draining is
 * still correct because backpressure (the `scheduled_at` column) and the
 * circuit-breaker fallback tolerate minute-level latency, and each tick drains a
 * bounded burst (see DRAIN_LIMIT below).
 *
 * ─── Auth ──────────────────────────────────────────────────────────────────
 * Same fail-closed bearer check as `/api/cron/idempotency-cleanup`: Vercel
 * attaches `Authorization: Bearer ${CRON_SECRET}` to cron invocations. If
 * `CRON_SECRET` is unset, or the bearer does not match, the route refuses to run
 * (so it cannot be triggered from the public internet).
 *
 * ─── Concurrency / double-send safety (Req 28.8) ─────────────────────────────
 * Rows are claimed with `SELECT ... FOR UPDATE SKIP LOCKED` inside a single
 * transaction. The row locks are held for the duration of each send, so a second
 * concurrent drainer invocation skips the locked rows and can never pick the same
 * message — preventing double-sends across overlapping ticks. Delivery is
 * at-least-once (a crash after the Cloud API call but before COMMIT rolls the row
 * back to `pending` for a later retry), which matches the design's
 * `sendWA(row).catch(() => markRetry(row.id))` semantics.
 *
 * ─── Token-bucket pacing (Req 28.8) ──────────────────────────────────────────
 * Design caps account-wide sends at 1000 msg/s (BURST = 1000). A Vercel cron tick
 * is stateless, so the bucket cannot carry across invocations; instead each tick
 * drains at most `DRAIN_LIMIT` rows (the per-tick burst budget). Because ticks are
 * spaced ≥ 60 s apart and `DRAIN_LIMIT` ≤ the 1000-message one-second burst, the
 * effective rate stays well under the provider cap. `DRAIN_LIMIT` is also bounded
 * by the function's 30 s `maxDuration`. Tune via `OUTBOX_DRAIN_LIMIT`.
 *
 * ─── queue_wait_ms (Req 28.9 / 34.4) ─────────────────────────────────────────
 * When a buffered row carries a `trace_id`, the drainer fills
 * `agent_invocations.queue_wait_ms = now - created_at` exactly once per trace
 * (guarded by `queue_wait_ms IS NULL`), recording how long the reply waited in the
 * queue before it was actually sent.
 *
 * ─── Design-vs-migration schema note (IMPORTANT) ─────────────────────────────
 * Design §v1.1.9 pseudocode targets an idealized table
 * `(id, phone, payload, status['sending'], next_retry_at, created_at)`. The
 * ACTUALLY shipped schema
 * (`supabase/migrations/20260201_004_idempotency_outbox_promptversions.sql`) is
 * `(id, recipient_phone, message_body, status[pending|sent|failed|expired],
 * attempts, max_attempts, last_attempt_at, error_message, scheduled_at,
 * created_at, trace_id)` with a supporting index
 * `idx_whatsapp_outbox_status_scheduled (status, scheduled_at)`. This route is
 * written against the REAL schema (the same decision `/api/cron/idempotency-cleanup`
 * documents): `phone → recipient_phone`, `payload → message_body`,
 * `next_retry_at → scheduled_at`. The CHECK constraint has no intermediate
 * `'sending'` status, so claimed rows stay locked (not status-flipped) for the
 * duration of the send, and a retriable failure leaves the row `'pending'` with
 * `scheduled_at` pushed forward for back-off pacing.
 *
 * Response: { ok: true, data: { claimed, sent, failed, retried } }
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.9, §v1.1.10
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 28.8, 28.9, 29.5, 29.6
 * @see supabase/migrations/20260201_004_idempotency_outbox_promptversions.sql — whatsapp_outbox DDL
 */

export const runtime = 'nodejs';
// Never serve a cached response for a cron mutation.
export const dynamic = 'force-dynamic';

/**
 * Raw `pg` pool — `FOR UPDATE SKIP LOCKED` and multi-statement transactions are
 * not expressible through the Supabase REST builder, so this route uses
 * DATABASE_URL directly, exactly like `/api/blood-requests/donor-respond`.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

/** Per-tick burst budget (token-bucket approximation). Tunable via env. */
const DRAIN_LIMIT = Number(process.env.OUTBOX_DRAIN_LIMIT) || 100;
/** Per-message Cloud API timeout so a hung send cannot hold row locks forever. */
const SEND_TIMEOUT_MS = 10_000;
/** WhatsApp Cloud API (Graph) version — matches the n8n JS-01v2 `Send Reply` node. */
const GRAPH_VERSION = 'v21.0';
/** Cap exponential-ish back-off so a stuck row keeps retrying at a sane cadence. */
const MAX_BACKOFF_SEC = 300;

interface ClaimedRow {
  id: string;
  recipient_phone: string;
  message_body: unknown;
  attempts: number;
  max_attempts: number;
  trace_id: string | null;
  created_at: string;
}

/**
 * Build the WhatsApp Cloud API request body from a stored `message_body`.
 *
 * `message_body` shapes in this repo are not fully consistent (e.g.
 * `/api/handoffs/resolve` stores `{ type: 'text', text: '<string>' }`, while the
 * Cloud API expects `text: { body: '<string>' }`). This normalizer accepts both
 * and always produces a valid `messages` payload.
 */
export function buildOutboundPayload(
  recipientPhone: string,
  messageBody: unknown
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipientPhone,
  };

  if (messageBody && typeof messageBody === 'object' && !Array.isArray(messageBody)) {
    const mb = { ...(messageBody as Record<string, unknown>) };
    // Normalize the shorthand `{ type:'text', text:'hello' }` → `text:{ body:'hello' }`.
    if (mb.type === 'text' && typeof mb.text === 'string') {
      mb.text = { body: mb.text };
    }
    // If a bare `text` string was stored without a type, treat it as a text message.
    if (!mb.type && typeof mb.text === 'string') {
      mb.type = 'text';
      mb.text = { body: mb.text };
    }
    return { ...base, ...mb };
  }

  // Fallback: a primitive/empty body becomes a plain text message.
  return { ...base, type: 'text', text: { body: String(messageBody ?? '') } };
}

/** Send one buffered message via the WhatsApp Cloud API. Never throws. */
async function sendWhatsApp(
  recipientPhone: string,
  messageBody: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildOutboundPayload(recipientPhone, messageBody)),
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `WhatsApp API ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'send failed' };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  // ─── Auth: Vercel Cron bearer secret (fail-closed) ───
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error('[cron/whatsapp-outbox-drainer] CRON_SECRET is not configured — refusing to run');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not configured' },
      { status: 401 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // ─── Fail-closed on missing WhatsApp credentials ───
  // Don't claim rows (and burn their attempt budget) when we cannot possibly send.
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
    console.error('[cron/whatsapp-outbox-drainer] WhatsApp credentials not configured — refusing to drain');
    return NextResponse.json(
      { ok: false, error: 'WhatsApp credentials not configured' },
      { status: 503 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ─── Claim a FIFO batch of due rows (index-backed, double-send-safe) ───
    const { rows } = await client.query<ClaimedRow>(
      `SELECT id, recipient_phone, message_body, attempts, max_attempts, trace_id, created_at
         FROM whatsapp_outbox
        WHERE status = 'pending' AND scheduled_at <= now()
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [DRAIN_LIMIT]
    );

    let sent = 0;
    let failed = 0;
    let retried = 0;

    for (const row of rows) {
      const result = await sendWhatsApp(row.recipient_phone, row.message_body);
      const attempts = (row.attempts ?? 0) + 1;
      const maxAttempts = row.max_attempts ?? 3;

      if (result.ok) {
        await client.query(
          `UPDATE whatsapp_outbox
              SET status = 'sent', attempts = $1, last_attempt_at = now(), error_message = NULL
            WHERE id = $2`,
          [attempts, row.id]
        );
        sent += 1;

        // Req 28.9 / 34.4: record queue wait once per trace.
        if (row.trace_id) {
          const waitMs = Date.now() - new Date(row.created_at).getTime();
          await client.query(
            `UPDATE agent_invocations
                SET queue_wait_ms = $1
              WHERE trace_id = $2 AND queue_wait_ms IS NULL`,
            [waitMs, row.trace_id]
          );
        }
      } else if (attempts >= maxAttempts) {
        // Exhausted retries → terminal failure.
        await client.query(
          `UPDATE whatsapp_outbox
              SET status = 'failed', attempts = $1, last_attempt_at = now(), error_message = $2
            WHERE id = $3`,
          [attempts, result.error, row.id]
        );
        failed += 1;
      } else {
        // Retriable failure → stay 'pending', push scheduled_at forward for back-off.
        const backoffSec = Math.min(MAX_BACKOFF_SEC, attempts * 30);
        await client.query(
          `UPDATE whatsapp_outbox
              SET attempts = $1,
                  last_attempt_at = now(),
                  error_message = $2,
                  scheduled_at = now() + make_interval(secs => $3)
            WHERE id = $4`,
          [attempts, result.error, backoffSec, row.id]
        );
        retried += 1;
      }
    }

    await client.query('COMMIT');

    console.log(
      `[cron/whatsapp-outbox-drainer] claimed=${rows.length} sent=${sent} failed=${failed} retried=${retried}`
    );

    return NextResponse.json({
      ok: true,
      data: { claimed: rows.length, sent, failed, retried },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[cron/whatsapp-outbox-drainer] Error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
