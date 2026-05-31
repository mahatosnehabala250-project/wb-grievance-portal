/**
 * Idempotency middleware (task 26.1).
 *
 * Wraps an external-effect Next.js route handler so that a retried request
 * carrying the same `Idempotency-Key` header returns the SAME stored response
 * instead of re-executing the side effect (Design §v1.1.9, Req 28.1–28.4).
 *
 * Behaviour contract:
 *   - No `Idempotency-Key` header  → the header is optional; the handler runs
 *     normally and nothing is deduped (Design §v1.1.9 "no header => no dedupe").
 *   - First call for `(key, endpoint)` → run the handler, persist
 *     `{ response_status, response_body, expires_at = now()+24h }`, return it.
 *   - Replay (same key+endpoint, SAME request body) → return the stored
 *     response without re-running the handler / side effect (Req 28.3).
 *   - Conflict (same key+endpoint, DIFFERENT request body) → HTTP 409 with
 *     error code `IDEMPOTENCY_KEY_CONFLICT` (Req 28.4).
 *
 * ─── Design-vs-migration schema mismatch (IMPORTANT) ─────────────────────────
 * The design pseudocode (§v1.1.9) sketches a single `response_hash` text column
 * holding `requestHash + '|' + JSON.stringify(resp)`. The ACTUAL shipped table
 * in migration `20260201_004_idempotency_outbox_promptversions.sql` is:
 *
 *   idempotency_keys (
 *     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     key             text NOT NULL,
 *     endpoint        text NOT NULL,
 *     response_status int,                       -- HTTP status of the stored response
 *     response_body   jsonb,                     -- stored response envelope
 *     created_at      timestamptz NOT NULL DEFAULT now(),
 *     expires_at      timestamptz NOT NULL,      -- created_at + 24h (Req 28.2 / 34.12)
 *     UNIQUE (key, endpoint)                     -- uq_idempotency_key_endpoint
 *   )
 *
 * This module is written against the REAL migration schema: it stores the
 * captured HTTP status in `response_status` and a small JSON envelope in
 * `response_body` (jsonb). Because the migration has no dedicated request-hash
 * column, the envelope embeds the request fingerprint so replay-vs-conflict can
 * be decided (Req 28.3 / 28.4):
 *
 *   response_body = { "request_hash": "<sha256 hex>", "body_text": "<raw resp text>" }
 *
 * `body_text` is the exact original response text, so a replay is byte-identical
 * to the first response (the byte-equality leg of Property 28, task 26.6).
 *
 * ─── Injectable DB client (repo convention) ──────────────────────────────────
 * The pg-style DB client is INJECTED (`query(sql, params) => { rows }`) so the
 * middleware is unit-testable against an in-memory mock without a live DB,
 * mirroring `src/lib/router/cache.ts`, `src/lib/rateLimit/check.ts`, and
 * `src/lib/semanticCache/lookup.ts`. A pg-style client (rather than the Supabase
 * builder) is used because the atomic `INSERT ... ON CONFLICT ... DO UPDATE ...
 * WHERE ... RETURNING` claim is not expressible cleanly through the builder.
 *
 * ─── Transient 5xx are NOT cached (intentional refinement) ───────────────────
 * The design pseudocode persists every handler response unconditionally. This
 * module deliberately skips persisting responses with status >= 500: a 5xx is a
 * transient/server failure where the side effect most likely did NOT complete,
 * and the whole point of a client retry is to get past it. Caching a 5xx would
 * pin the client to a permanent failure for 24h, contradicting NFR Reliability.
 * 2xx and deterministic 4xx (e.g. validation) responses are persisted as normal.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.9 Idempotency, Rate Limiting, Backpressure
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 28.1, 28.2, 28.3, 28.4
 * @see supabase/migrations/20260201_004_idempotency_outbox_promptversions.sql — idempotency_keys DDL
 */

import { createHash } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single row returned by a DB query (node-postgres `{ rows }` shape). */
export interface DbQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
}

/**
 * Minimal injectable DB client surface.
 *
 * Matches the node-postgres `Pool`/`Client` shape (`query(text, params)`
 * resolving to `{ rows }`). Production call sites inject the real `pg` client
 * (or pool); tests inject a lightweight mock. Declared structurally so any
 * object exposing a compatible `query` method satisfies it.
 */
export interface DbClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<DbQueryResult<Row>>;
}

/** The header surface needed off the request (a real `Request` satisfies it). */
export interface IdempotencyRequestHeaders {
  get(name: string): string | null;
}

/**
 * The minimal request surface the middleware reads.
 *
 * A standard Web `Request` (and Next.js `NextRequest`) satisfies this: it has
 * `method`, `headers.get`, `text()`, and `clone()`. When `clone` is present the
 * body is read from a clone so the wrapped handler can still consume the
 * original request stream. Tests can pass a plain object with just `method`,
 * `headers.get`, and `text()`.
 */
export interface IdempotencyRequest {
  method: string;
  headers: IdempotencyRequestHeaders;
  text(): Promise<string>;
  clone?(): IdempotencyRequest;
}

/** The JSON envelope persisted in `idempotency_keys.response_body` (jsonb). */
export interface StoredEnvelope {
  /** `sha256(method \n endpoint \n body)` of the original request. */
  request_hash: string;
  /** The exact original response body text (for byte-identical replay). */
  body_text: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** The client-supplied idempotency header (Design §v1.1.9, Req 28.1). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** TTL in hours for a stored key (Req 28.2 / 34.12 — `expires_at = created_at + 24h`). */
export const TTL_HOURS = 24;

/** Error code returned on a same-key / different-body conflict (Req 28.4). */
export const CONFLICT_ERROR_CODE = 'IDEMPOTENCY_KEY_CONFLICT';

/**
 * Responses with status >= this are NOT persisted, so transient server errors
 * stay retryable (see header doc). 500 == first 5xx code.
 */
export const PERSIST_MAX_STATUS = 500;

/** Marker header set on a replayed response (debugging / observability aid). */
export const REPLAY_HEADER = 'Idempotency-Replayed';

const TABLE = 'idempotency_keys';

/** Read a still-valid (non-expired) stored response for `(key, endpoint)`. */
const SELECT_SQL = `SELECT response_status, response_body
       FROM ${TABLE}
      WHERE key = $1 AND endpoint = $2 AND expires_at > now()`;

/**
 * Atomic claim. Inserts a fresh row, or refreshes an EXPIRED one (the
 * `WHERE expires_at <= now()` on the conflict path). `RETURNING key` lets the
 * caller detect whether it won the claim:
 *   - rows.length > 0 → we inserted (or refreshed an expired row) → we own it.
 *   - rows.length === 0 → a concurrent request already holds a still-valid row
 *     (the conflict-update WHERE was false) → the caller re-reads and replays
 *     the winner so both callers observe an identical response.
 */
const CLAIM_SQL = `INSERT INTO ${TABLE} (key, endpoint, response_status, response_body, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, now() + interval '${TTL_HOURS} hours')
     ON CONFLICT (key, endpoint) DO UPDATE
        SET response_status = EXCLUDED.response_status,
            response_body   = EXCLUDED.response_body,
            created_at      = now(),
            expires_at      = EXCLUDED.expires_at
      WHERE ${TABLE}.expires_at <= now()
  RETURNING key`;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wrap an external-effect handler with idempotency dedupe.
 *
 * @param req      The incoming request (reads `Idempotency-Key`, method, body).
 * @param endpoint Stable endpoint identifier, e.g. `/api/blood-requests/donor-respond`.
 *                 Part of the dedupe key and the request fingerprint.
 * @param handler  The wrapped route logic. Runs at most once per `(key, body)`.
 * @param db       Injected pg-style DB client.
 * @returns        The handler's response on a first call, or the stored response
 *                 on a replay, or a 409 on a key/body conflict.
 */
export async function withIdempotency(
  req: IdempotencyRequest,
  endpoint: string,
  handler: () => Promise<Response>,
  db: DbClient,
): Promise<Response> {
  const key = req.headers.get(IDEMPOTENCY_HEADER);

  // Optional header: no key → no dedupe, just run the handler (Design §v1.1.9).
  if (!key) {
    return handler();
  }

  const bodyText = await readBody(req);
  const requestHash = sha256Hex(`${req.method}\n${endpoint}\n${bodyText}`);

  // 1) Replay / conflict against any still-valid stored response (Req 28.3/28.4).
  const existing = await selectValidRow(db, key, endpoint);
  if (existing) {
    return replayOrConflict(existing, requestHash);
  }

  // 2) Fresh: run the wrapped handler exactly once.
  const resp = await handler();

  // Do not cache transient 5xx — they must stay retryable (NFR Reliability).
  if (resp.status >= PERSIST_MAX_STATUS) {
    return resp;
  }

  // 3) Capture the response without consuming the caller's stream.
  const respText = await safeCloneText(resp);
  const envelope: StoredEnvelope = { request_hash: requestHash, body_text: respText };

  // 4) Atomic claim (INSERT ... ON CONFLICT). RETURNING tells us if we won.
  const claim = await db.query<{ key: string }>(CLAIM_SQL, [
    key,
    endpoint,
    resp.status,
    JSON.stringify(envelope),
  ]);

  if (claim.rows.length === 0) {
    // A concurrent request beat us with a still-valid row. Replay theirs so
    // both callers see an identical response (idempotent under concurrency).
    const winner = await selectValidRow(db, key, endpoint);
    if (winner) {
      return replayOrConflict(winner, requestHash);
    }
    // Row vanished between statements (e.g. cleanup cron) — return our result.
  }

  return resp;
}

/**
 * Build the HTTP 409 response for a same-key / different-body conflict
 * (Req 28.4). Uses the project's `{ ok: false, error, message }` JSON envelope
 * (matching `src/lib/rateLimit/check.ts`).
 */
export function idempotencyConflictResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: CONFLICT_ERROR_CODE,
      message: 'Idempotency-Key reused with a different request body.',
    }),
    {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** `sha256` of `input` as lowercase hex. */
function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Read the request body as text from a CLONE when possible so the wrapped
 * handler can still consume the original request stream. Falls back to reading
 * the request directly (tests pass a plain `{ text() }` object). Never throws.
 */
async function readBody(req: IdempotencyRequest): Promise<string> {
  const source = typeof req.clone === 'function' ? req.clone() : req;
  try {
    return await source.text();
  } catch {
    return '';
  }
}

/**
 * Clone the handler's response and read its body text without disturbing the
 * stream returned to the caller. Falls back to an empty body if the clone/read
 * fails (so a body-read hiccup never breaks the request).
 */
async function safeCloneText(resp: Response): Promise<string> {
  try {
    return await resp.clone().text();
  } catch {
    return '';
  }
}

/** Fetch a still-valid stored row (or `null`). */
async function selectValidRow(
  db: DbClient,
  key: string,
  endpoint: string,
): Promise<{ response_status: unknown; response_body: unknown } | null> {
  const res = await db.query<{ response_status: unknown; response_body: unknown }>(SELECT_SQL, [
    key,
    endpoint,
  ]);
  return res.rows[0] ?? null;
}

/**
 * Decide between an exact replay (matching request fingerprint → Req 28.3) and
 * a 409 conflict (different fingerprint → Req 28.4) for an existing stored row.
 */
function replayOrConflict(
  row: { response_status: unknown; response_body: unknown },
  requestHash: string,
): Response {
  const env = coerceEnvelope(row.response_body);

  // Same key, different body → conflict (Req 28.4).
  if (env.request_hash !== requestHash) {
    return idempotencyConflictResponse();
  }

  // Exact replay — return the byte-identical stored response (Req 28.3).
  return new Response(env.body_text, {
    status: toStatus(row.response_status),
    headers: { 'Content-Type': 'application/json', [REPLAY_HEADER]: 'true' },
  });
}

/**
 * Coerce a jsonb `response_body` value (parsed object from node-pg, or a JSON
 * string from a non-parsing client) into a well-formed {@link StoredEnvelope}.
 */
function coerceEnvelope(value: unknown): StoredEnvelope {
  let obj: Record<string, unknown> = {};
  if (typeof value === 'string') {
    try {
      obj = JSON.parse(value) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  } else if (value && typeof value === 'object') {
    obj = value as Record<string, unknown>;
  }

  return {
    request_hash: typeof obj.request_hash === 'string' ? obj.request_hash : '',
    body_text: typeof obj.body_text === 'string' ? obj.body_text : '',
  };
}

/**
 * Coerce a stored `response_status` into a valid HTTP status code. node-pg
 * returns `int` as a number, but a non-parsing client may hand back a string.
 * Defaults to 200 for missing / out-of-range values.
 */
function toStatus(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(n) && n >= 100 && n <= 599) {
    return Math.trunc(n);
  }
  return 200;
}
