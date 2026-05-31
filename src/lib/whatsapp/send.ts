/**
 * WhatsApp Cloud API send helper with circuit-breaker outbox fallback
 * (task 27.2 + task 27.6, Req 29.1 / 29.5 / 29.6).
 *
 * Single canonical entry-point for all outbound WhatsApp messages from the
 * Vercel route handlers. The call is wrapped with the `whatsapp` circuit
 * breaker from `src/lib/breaker/breaker.ts`.
 *
 * Degradation path (Design §v1.1.10, Req 29.5 / 29.6):
 *   1. Check `circuit_state.whatsapp` via {@link withBreaker}.
 *   2. If the breaker is **open** → INSERT into `whatsapp_outbox` with
 *      `status='pending'` and return `{ ok: true, queued: true }`.
 *   3. If the breaker is **closed / half_open** → call the Cloud API directly.
 *   4. On API failure → the breaker records the failure (and opens once the
 *      threshold is reached), then falls back to the outbox so the message is
 *      never silently dropped.
 *
 * The Outbox Drainer cron (`/api/cron/whatsapp-outbox-drainer`) drains the
 * queue in FIFO order once the breaker transitions back to closed (Req 29.6).
 *
 * The DB client is injectable (`deps.db`) so the outbox fallback is testable
 * without a live database. The fetch transport is injectable (`deps.fetchImpl`)
 * so the Cloud API call is testable without a live WhatsApp account.
 *
 * Message body shapes:
 *   The `messageBody` parameter accepts any JSON-serialisable value. The helper
 *   normalises the shorthand `{ type: 'text', text: '<string>' }` to the Cloud
 *   API's `text: { body: '<string>' }` shape (same normalisation as the outbox
 *   drainer's `buildOutboundPayload`).
 *
 * Return value:
 *   `{ ok: true }` — message sent directly via the Cloud API.
 *   `{ ok: true, queued: true }` — message queued in `whatsapp_outbox`
 *     (breaker open OR API failure fallback).
 *   `{ ok: false, error: string }` — send failed AND outbox insert also failed
 *     (extremely unlikely; logged for observability).
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.10 Circuit Breakers
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 29.1, 29.5, 29.6
 * @see src/app/api/cron/whatsapp-outbox-drainer/route.ts — outbox drainer
 */

import { withBreaker, isBreakerOpenError, type BreakerStore } from '../breaker/breaker';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal pg-style DB client for the outbox fallback. */
export interface SendDbClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Injectable dependencies for {@link sendWA}. */
export interface SendWADeps {
  /**
   * Injectable breaker store for the `whatsapp` circuit breaker (Req 29.1).
   * Defaults to the lazy Supabase-backed store from `src/lib/breaker/breaker.ts`.
   */
  breakerStore?: BreakerStore;
  /**
   * Injectable pg-style DB client for the outbox fallback (Req 29.5).
   * When omitted, the helper lazily creates a `pg.Pool` from `DATABASE_URL`.
   */
  db?: SendDbClient;
  /** Transport override for unit tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Per-send timeout in ms. Defaults to {@link DEFAULT_SEND_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** Result of {@link sendWA}. */
export type SendWAResult =
  | { ok: true; queued?: boolean }
  | { ok: false; error: string };

// ─── Constants ────────────────────────────────────────────────────────────────

/** WhatsApp Cloud API (Graph) version — matches the n8n JS-01v2 `Send Reply` node. */
const GRAPH_VERSION = 'v21.0';

/** Per-send timeout so a hung call cannot block the reply path. */
const DEFAULT_SEND_TIMEOUT_MS = 10_000;

// ─── Payload normalisation ────────────────────────────────────────────────────

/**
 * Build the WhatsApp Cloud API request body from a stored `messageBody`.
 *
 * Normalises the shorthand `{ type: 'text', text: '<string>' }` to the Cloud
 * API's `text: { body: '<string>' }` shape. Mirrors `buildOutboundPayload` in
 * the outbox drainer so both paths produce identical wire payloads.
 */
export function buildPayload(
  recipientPhone: string,
  messageBody: unknown,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipientPhone,
  };

  if (messageBody && typeof messageBody === 'object' && !Array.isArray(messageBody)) {
    const mb = { ...(messageBody as Record<string, unknown>) };
    // Normalise shorthand `{ type:'text', text:'hello' }` → `text:{ body:'hello' }`.
    if (mb.type === 'text' && typeof mb.text === 'string') {
      mb.text = { body: mb.text };
    }
    // Bare `text` string without a type → plain text message.
    if (!mb.type && typeof mb.text === 'string') {
      mb.type = 'text';
      mb.text = { body: mb.text };
    }
    return { ...base, ...mb };
  }

  // Fallback: primitive / empty body → plain text message.
  return { ...base, type: 'text', text: { body: String(messageBody ?? '') } };
}

// ─── Outbox fallback ──────────────────────────────────────────────────────────

/**
 * Insert a message into `whatsapp_outbox` with `status='pending'`.
 *
 * Called when the `whatsapp` breaker is open (Req 29.5). The Outbox Drainer
 * cron drains the queue once the breaker closes (Req 29.6).
 */
async function enqueueOutbox(
  recipientPhone: string,
  messageBody: unknown,
  db: SendDbClient,
  traceId?: string,
): Promise<void> {
  await db.query(
    `INSERT INTO whatsapp_outbox
       (id, recipient_phone, message_body, status, attempts, max_attempts,
        scheduled_at, created_at${traceId ? ', trace_id' : ''})
     VALUES
       (gen_random_uuid(), $1, $2::jsonb, 'pending', 0, 3,
        now(), now()${traceId ? ', $3' : ''})`,
    traceId
      ? [recipientPhone, JSON.stringify(messageBody), traceId]
      : [recipientPhone, JSON.stringify(messageBody)],
  );
}

// ─── Lazy default DB client ───────────────────────────────────────────────────

let _defaultDb: SendDbClient | null = null;

function getDefaultDb(): SendDbClient {
  if (_defaultDb) return _defaultDb;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg') as typeof import('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
  });
  _defaultDb = {
    query: (sql, params) => pool.query(sql, params),
  };
  return _defaultDb;
}

/** Override the default DB client (test seam). Pass `null` to reset. */
export function setDefaultSendDb(db: SendDbClient | null): void {
  _defaultDb = db;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a WhatsApp message to `recipientPhone` via the Cloud API.
 *
 * The call is wrapped with the `whatsapp` circuit breaker (Req 29.1).
 *
 * Degradation paths (Req 29.5):
 *   - Breaker open → message queued in `whatsapp_outbox`, returns
 *     `{ ok: true, queued: true }`.
 *   - API failure → breaker records the failure (opens after threshold),
 *     message queued in `whatsapp_outbox`, returns `{ ok: true, queued: true }`.
 *
 * @param recipientPhone  E.164 phone number (e.g. `"919876543210"`).
 * @param messageBody     JSON-serialisable message body (text, template, etc.).
 * @param traceId         Optional trace ID propagated to `whatsapp_outbox.trace_id`.
 * @param deps            Injectable transport / breaker store / DB client.
 */
export async function sendWA(
  recipientPhone: string,
  messageBody: unknown,
  traceId?: string,
  deps: SendWADeps = {},
): Promise<SendWAResult> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
  const db = deps.db ?? getDefaultDb();

  try {
    // ── Circuit breaker: whatsapp (task 27.2, Req 29.1) ────────────────────
    await withBreaker(
      'whatsapp',
      async () => {
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        const token = process.env.WHATSAPP_ACCESS_TOKEN;

        if (!phoneNumberId || !token) {
          throw new Error(
            '[sendWA] WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN is not configured',
          );
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetchImpl(
            `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(buildPayload(recipientPhone, messageBody)),
              signal: controller.signal,
            },
          );

          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`WhatsApp API ${res.status}: ${text.slice(0, 300)}`);
          }
        } finally {
          clearTimeout(timer);
        }
      },
      { store: deps.breakerStore },
    );

    return { ok: true };
  } catch (err) {
    // ── Fallback to outbox for both breaker-open and API failure (Req 29.5) ─
    const isOpen = isBreakerOpenError(err);
    if (isOpen) {
      console.warn(
        `[sendWA] WhatsApp circuit breaker is open — queuing message for ${recipientPhone}`,
      );
    } else {
      // Real API failure — the breaker has already recorded it via withBreaker.
      const msg = err instanceof Error ? err.message : 'send failed';
      console.error(
        `[sendWA] Cloud API call failed for ${recipientPhone} — queuing in outbox: ${msg}`,
      );
    }

    try {
      await enqueueOutbox(recipientPhone, messageBody, db, traceId);
      return { ok: true, queued: true };
    } catch (outboxErr) {
      const msg = outboxErr instanceof Error ? outboxErr.message : 'outbox insert failed';
      console.error('[sendWA] outbox INSERT also failed:', msg);
      return { ok: false, error: `send_failed; outbox_failed: ${msg}` };
    }
  }
}
