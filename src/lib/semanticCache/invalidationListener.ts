/**
 * Semantic Cache — cache invalidation listener (task 24.4).
 *
 * The automatic counterpart to the manual `POST /api/cache/invalidate` admin
 * route. When underlying data changes (e.g. a complaint is INSERTed/UPDATEd, so
 * a previously cached "no such ticket" answer is now stale), a Postgres trigger
 * emits a `LISTEN/NOTIFY` event and this listener drops the matching
 * `query_cache` rows so the next query recomputes a fresh response
 * (Design §v1.1.7 "Cache invalidation on writes", Req 26.4).
 *
 * ─── How it fits together ────────────────────────────────────────────────────
 * The NOTIFY side already ships in migration
 * `20260201_007_triggers_and_functions.sql`:
 *
 *   trg_complaint_cache_invalidate  (BEFORE INSERT OR UPDATE ON complaints)
 *     → PERFORM pg_notify('cache_invalidate', json_build_object(
 *           'category',      'ticket_status',
 *           'ticket_number', COALESCE(NEW.ticket_number, OLD.ticket_number)
 *         )::text);
 *
 * This module is the LISTEN side the design calls "a small Vercel cron / n8n
 * listener". It:
 *   1. subscribes to the `cache_invalidate` channel (`LISTEN cache_invalidate`),
 *   2. parses each notification payload `{ category, ticket_number }`,
 *   3. maps the design-named category to the shipped column value, and
 *   4. runs the scoped `DELETE FROM query_cache …`.
 *
 * ─── Design-vs-migration schema note (IMPORTANT) ─────────────────────────────
 * The trigger emits the DESIGN category name `ticket_status`, but the ACTUAL
 * shipped `query_cache.category` CHECK constraint
 * (`20260201_003_handoff_guardrail_cache.sql`) only accepts
 * `status | scheme | help`. A literal `DELETE … WHERE category = 'ticket_status'`
 * would therefore match ZERO rows. This module maps the design name to the
 * stored value via {@link CATEGORY_ALIASES} — the same design-name↔column-value
 * reconciliation already documented in `src/lib/semanticCache/lookup.ts`,
 * `src/lib/semanticCache/write.ts`, and `src/app/api/cache/invalidate/route.ts`.
 *
 * The match scope mirrors the manual invalidate route: a ticket number is
 * matched against BOTH the cached `response` and the original `query_text`
 * (the design pseudocode only matches `response::text`; matching `query_text`
 * too is strictly additive and keeps the automatic and manual paths consistent).
 *
 * The DB connection is INJECTED (a pg-style client exposing `query` and the
 * notification event surface) so the parse/map/delete logic is unit-testable
 * against an in-memory mock without a live Postgres `LISTEN/NOTIFY` channel —
 * following the injectable-client convention used across the semantic cache and
 * router modules.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.7 Semantic Cache (Cache invalidation on writes)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 26 (26.4, 26.5)
 * @see supabase/migrations/20260201_007_triggers_and_functions.sql — trg_complaint_cache_invalidate (NOTIFY side)
 * @see supabase/migrations/20260201_003_handoff_guardrail_cache.sql — query_cache DDL
 * @see src/app/api/cache/invalidate/route.ts — manual admin counterpart
 */

import type { Category, DbQueryResult } from './lookup';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * The Postgres `LISTEN/NOTIFY` channel name emitted by
 * `trg_complaint_cache_invalidate` (migration `20260201_007`). The listener
 * subscribes with `LISTEN cache_invalidate`.
 */
export const CHANNEL = 'cache_invalidate';

const TABLE = 'query_cache';

/**
 * Map a design / notification category name to the value actually stored in
 * `query_cache.category`. The trigger emits design names (`ticket_status`),
 * while the shipped CHECK constraint accepts only `status | scheme | help`.
 * Direct column values are also accepted (identity) so a payload that already
 * uses the migration value still resolves.
 */
export const CATEGORY_ALIASES: Record<string, Category> = {
  // design names → migration values
  ticket_status: 'status',
  scheme_info: 'scheme',
  help_list: 'help',
  // migration values → themselves (idempotent)
  status: 'status',
  scheme: 'scheme',
  help: 'help',
};

/**
 * Scoped DELETE run on each invalidation event.
 *
 * Params: $1 = category (migration value), $2 = match term (ticket number).
 * The match term is compared case-insensitively against both the cached
 * `response` and the original `query_text`, matching the manual invalidate
 * route's ticket filter. `response` is already a `text` column in the shipped
 * schema, so no `::text` cast is needed.
 */
const DELETE_BY_MATCH_SQL = `DELETE FROM ${TABLE}
 WHERE category = $1
   AND (response ILIKE '%' || $2 || '%' OR query_text ILIKE '%' || $2 || '%')`;

/**
 * Category-wide DELETE used when a notification carries a category but no match
 * term (e.g. a bulk "scheme content changed" invalidation). Params: $1 =
 * category (migration value).
 */
const DELETE_BY_CATEGORY_SQL = `DELETE FROM ${TABLE} WHERE category = $1`;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Result of a DELETE: node-postgres surfaces the affected count as `rowCount`. */
export interface DbDeleteResult {
  rowCount?: number | null;
  rows?: unknown[];
}

/**
 * Minimal pg-style client used to run the DELETE. Structurally compatible with
 * node-postgres `Client`/`Pool` (`query(text, params)` → `{ rowCount, rows }`).
 */
export interface InvalidateDbClient {
  query(sql: string, params?: unknown[]): Promise<DbDeleteResult>;
}

/** Parsed, normalized form of a `cache_invalidate` notification payload. */
export interface InvalidatePayload {
  /** Stored `query_cache.category` value after alias mapping. */
  category: Category;
  /**
   * Optional match term (the affected ticket number). When present the DELETE
   * is scoped to rows mentioning it; when absent the whole category is dropped.
   */
  match?: string;
}

/**
 * A single `cache_invalidate` notification as delivered by node-postgres'
 * `'notification'` event (`{ channel, payload }`).
 */
export interface CacheInvalidateNotification {
  channel: string;
  payload?: string;
}

/**
 * Notification-capable client surface for {@link startCacheInvalidationListener}.
 * Adds the event registration + `connect`/`end` lifecycle on top of `query`.
 * Matches node-postgres `Client`. (A `Pool` is unsuitable for `LISTEN` because
 * notifications are bound to a single backend connection.)
 */
export interface ListenClient extends InvalidateDbClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  on(
    event: 'notification',
    listener: (msg: CacheInvalidateNotification) => void,
  ): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

// ─── Payload parsing + category normalization ────────────────────────────────

/**
 * Normalize a raw category string from a notification payload to a stored
 * {@link Category} via {@link CATEGORY_ALIASES}. Returns `null` for an
 * unknown / unmapped value so the caller can skip it instead of issuing a
 * DELETE that matches nothing (or, worse, a malformed one).
 */
export function normalizeCategory(raw: unknown): Category | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  return CATEGORY_ALIASES[key] ?? null;
}

/**
 * Parse a raw `cache_invalidate` NOTIFY payload (a JSON string) into a
 * normalized {@link InvalidatePayload}.
 *
 * Tolerant by design — a malformed, non-JSON, or category-less payload returns
 * `null` rather than throwing, so one bad event can never crash the listener
 * loop. The trigger emits `{ "category": "ticket_status", "ticket_number": … }`;
 * `ticket_number` may be JSON `null` (when both NEW and OLD ticket numbers are
 * null), in which case the result has no `match` and the caller falls back to a
 * category-wide invalidation decision.
 *
 * `ticket_number` and the generic aliases `match` / `session_id` are accepted as
 * the match term, easing reuse by other future NOTIFY sources.
 */
export function parseInvalidatePayload(raw: unknown): InvalidatePayload | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const category = normalizeCategory(obj.category);
  if (!category) return null;

  const matchRaw = obj.ticket_number ?? obj.match ?? obj.session_id;
  const match =
    typeof matchRaw === 'string' && matchRaw.trim() !== ''
      ? matchRaw.trim()
      : undefined;

  return match ? { category, match } : { category };
}

// ─── Invalidation ────────────────────────────────────────────────────────────

/**
 * Run the scoped DELETE for one already-parsed invalidation payload and return
 * the number of `query_cache` rows removed.
 *
 * - With a `match` term: drop rows of `category` whose `response` OR
 *   `query_text` mentions the term (the stale-ticket case).
 * - Without a `match` term: drop every row of `category` (a category-wide
 *   invalidation).
 *
 * Always parameterized — the match term is never string-concatenated into SQL.
 */
export async function invalidateCacheEntries(
  payload: InvalidatePayload,
  db: InvalidateDbClient,
): Promise<number> {
  const result = payload.match
    ? await db.query(DELETE_BY_MATCH_SQL, [payload.category, payload.match])
    : await db.query(DELETE_BY_CATEGORY_SQL, [payload.category]);

  return result.rowCount ?? 0;
}

/**
 * Handle one raw notification payload end-to-end: parse → map category →
 * DELETE. Returns the number of rows invalidated, or `0` when the payload is
 * unparseable / carries an unknown category (such events are skipped, never
 * fatal).
 *
 * This is the unit the listener loop calls for every `'notification'` event and
 * the seam most worth testing, since it covers the design-name→column-value
 * mapping and the scoped delete without needing a live channel.
 */
export async function handleNotification(
  rawPayload: unknown,
  db: InvalidateDbClient,
): Promise<number> {
  const payload = parseInvalidatePayload(rawPayload);
  if (!payload) return 0;
  return invalidateCacheEntries(payload, db);
}

// ─── Listener lifecycle ──────────────────────────────────────────────────────

/** Handle returned by {@link startCacheInvalidationListener} for teardown. */
export interface InvalidationListenerHandle {
  /** Unsubscribe (`UNLISTEN`) and close the underlying connection. */
  stop(): Promise<void>;
}

/** Options for {@link startCacheInvalidationListener}. */
export interface StartListenerOptions {
  /**
   * Pre-built notification-capable client. When omitted, a node-postgres
   * `Client` is created from `DATABASE_URL` / `DIRECT_URL` (lazy `require` so
   * importing this module has no side effects and stays test-friendly).
   */
  client?: ListenClient;
  /**
   * Invoked after each event with the rows removed (or the error). Defaults to
   * a structured `console` line. Lets callers wire in `trace_id`-aware logging.
   */
  onInvalidated?: (info: { payload?: string; deleted: number }) => void;
  /** Invoked on a connection-level error. Defaults to `console.error`. */
  onError?: (err: Error) => void;
}

/**
 * Start the long-lived `LISTEN cache_invalidate` subscription.
 *
 * Connects the client, registers `'notification'` / `'error'` handlers, and
 * issues `LISTEN cache_invalidate`. Each delivered notification is routed
 * through {@link handleNotification}. The returned handle's `stop()` runs
 * `UNLISTEN` and closes the connection.
 *
 * Intended to run as a small always-on listener process or to be invoked from a
 * Vercel cron / n8n trigger (Design §v1.1.7). The pure parse/map/delete seam
 * lives in {@link handleNotification} / {@link invalidateCacheEntries}; this
 * function only owns the connection + subscription lifecycle.
 */
export async function startCacheInvalidationListener(
  options: StartListenerOptions = {},
): Promise<InvalidationListenerHandle> {
  const client = options.client ?? createDefaultClient();
  const onInvalidated =
    options.onInvalidated ??
    (({ deleted }) =>
      // eslint-disable-next-line no-console
      console.log(`[cache-invalidate] removed ${deleted} query_cache row(s)`));
  const onError =
    options.onError ??
    ((err) =>
      // eslint-disable-next-line no-console
      console.error('[cache-invalidate] listener error:', err));

  client.on('error', onError);
  client.on('notification', (msg: CacheInvalidateNotification) => {
    if (msg.channel !== CHANNEL) return;
    // Fire-and-forget: a single bad event must not break the loop.
    handleNotification(msg.payload, client)
      .then((deleted) => onInvalidated({ payload: msg.payload, deleted }))
      .catch(onError);
  });

  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);

  return {
    async stop() {
      try {
        await client.query(`UNLISTEN ${CHANNEL}`);
      } finally {
        await client.end();
      }
    },
  };
}

/**
 * Build a node-postgres `Client` from `DATABASE_URL` / `DIRECT_URL`, mirroring
 * the connection-string convention in `src/app/api/cache/invalidate/route.ts`
 * and the cron routes. `require`d lazily so this module imports cleanly in test
 * environments that never start a real listener.
 */
function createDefaultClient(): ListenClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require('pg') as typeof import('pg');
  return new Client({
    connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
  }) as unknown as ListenClient;
}

// Re-export the shared cache types so listener consumers can import from one
// place (additive; mirrors write.ts re-exporting lookup.ts types).
export type { Category, DbQueryResult };
