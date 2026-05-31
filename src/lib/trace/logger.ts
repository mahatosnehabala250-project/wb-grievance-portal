/**
 * Trace-aware structured logger (task 25.4).
 *
 * Req 27.4 / Design §v1.1.8: every Vercel `/api/*` route handler must include the
 * request's `trace_id` in its structured log lines so a single inbound WhatsApp
 * message can be reconstructed end-to-end across every n8n → Vercel hop (alongside
 * the per-trace DB columns and the `GET /api/trace/[id]` timeline view).
 *
 * Rather than editing every route by hand (dozens of files, high collision risk
 * with concurrently-running tasks), handlers adopt a single shared helper that:
 *   1. pulls the `trace_id` once via {@link extractTraceId} (reusing a valid
 *      inbound `X-Trace-Id`, or minting a fresh `uuid7()` on miss), and
 *   2. emits a consistent one-line JSON record that always carries `trace_id`.
 *
 * One-line adoption pattern for any route handler:
 *
 * ```ts
 * import { createTraceLogger } from '@/lib/trace/logger';
 *
 * export async function POST(request: Request) {
 *   const log = createTraceLogger(request, { route: '/api/foo' });
 *   // ...use `log.traceId` for every DB insert for this request...
 *   try {
 *     log.info('foo_done', { id });
 *     return Response.json({ ok: true, data: { id } });
 *   } catch (err) {
 *     log.error('foo_failed', { err });
 *     return Response.json({ ok: false }, { status: 500 });
 *   }
 * }
 * ```
 *
 * The logger binds `trace_id` ONCE at creation — calling `extractTraceId` per log
 * line would mint a different id on every call when no header is present, breaking
 * the trace. Reuse the returned logger (and its `.traceId`) for the whole request.
 *
 * Output is a JSON string per line written to the level-appropriate `console`
 * method, e.g.:
 *
 * ```json
 * {"ts":"2025-01-01T00:00:00.000Z","level":"info","route":"/api/n8n/cascade-trigger","event":"cascade_triggered","trace_id":"0193...","blood_request_id":"..."}
 * ```
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.8 Trace IDs
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 27.4
 */

import { extractTraceId, type HeaderSource } from './extract';
import { isUuid7 } from './uuid7';

/** Structured log severities, mapped to the matching `console` method. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Arbitrary structured fields merged into a log record (must be JSON-safe-ish). */
export type LogFields = Record<string, unknown>;

/** Options for {@link createTraceLogger}. */
export interface TraceLoggerOptions {
  /** Route path included in every line, e.g. `'/api/n8n/cascade-trigger'`. */
  route?: string;
  /**
   * Explicit `trace_id` override. When a valid UUIDv7 is supplied it wins over
   * the inbound header — useful for routes (e.g. `/api/routing/log`) where the
   * canonical id arrives in the request body rather than the header.
   */
  traceId?: string;
  /** Base fields merged into every record this logger emits. */
  base?: LogFields;
}

/**
 * A request-scoped structured logger. Every method writes a single JSON line
 * that includes the bound `trace_id`. Use {@link traceId} for DB writes so logs
 * and rows share the same id.
 */
export interface TraceLogger {
  /** The `trace_id` bound to this logger for the lifetime of the request. */
  readonly traceId: string;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Derive a child logger that merges additional persistent base fields. */
  child(extra: LogFields): TraceLogger;
}

/** Map a level to the most appropriate console method, with safe fallbacks. */
function consoleFor(level: LogLevel): (msg: string) => void {
  /* eslint-disable no-console */
  switch (level) {
    case 'error':
      return (m) => (console.error ?? console.log)(m);
    case 'warn':
      return (m) => (console.warn ?? console.log)(m);
    case 'debug':
      return (m) => (console.debug ?? console.log)(m);
    case 'info':
    default:
      return (m) => (console.info ?? console.log)(m);
  }
  /* eslint-enable no-console */
}

/**
 * Normalize a field value so the record is JSON-serializable. `Error` instances
 * are expanded to `{ name, message }` (stack omitted to avoid leaking internals
 * / bloating logs); everything else is passed through and `JSON.stringify`'d.
 */
function normalizeField(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}

/** Build and write one structured JSON log line. */
function emit(
  level: LogLevel,
  event: string,
  traceId: string,
  route: string | undefined,
  base: LogFields,
  fields: LogFields | undefined,
): void {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    ...(route ? { route } : {}),
    event,
    // `trace_id` is the contract field name (Req 27.4) — keep it canonical and
    // place it before caller fields so it can't be accidentally shadowed.
    trace_id: traceId,
  };

  for (const [k, v] of Object.entries(base)) record[k] = normalizeField(v);
  if (fields) {
    for (const [k, v] of Object.entries(fields)) record[k] = normalizeField(v);
  }

  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    // Circular/unserializable payload — fall back to a minimal safe record.
    line = JSON.stringify({
      ts: record.ts,
      level,
      ...(route ? { route } : {}),
      event,
      trace_id: traceId,
      log_error: 'unserializable_fields',
    });
  }

  consoleFor(level)(line);
}

/**
 * Create a request-scoped {@link TraceLogger}.
 *
 * Resolves the `trace_id` once (header via {@link extractTraceId}, unless a valid
 * `options.traceId` override is provided) and returns a logger whose every line
 * carries that id. Accepts a `Request`, `Headers`, or plain header map.
 *
 * @param source  The inbound request / headers (for `X-Trace-Id`).
 * @param options Route name, explicit trace id, and/or base fields.
 */
export function createTraceLogger(
  source: HeaderSource,
  options: TraceLoggerOptions = {},
): TraceLogger {
  const traceId =
    options.traceId && isUuid7(options.traceId)
      ? options.traceId
      : extractTraceId(source);
  const route = options.route;
  const base: LogFields = { ...(options.base ?? {}) };

  return {
    traceId,
    debug: (event, fields) => emit('debug', event, traceId, route, base, fields),
    info: (event, fields) => emit('info', event, traceId, route, base, fields),
    warn: (event, fields) => emit('warn', event, traceId, route, base, fields),
    error: (event, fields) => emit('error', event, traceId, route, base, fields),
    child(extra: LogFields): TraceLogger {
      // Reuse the already-resolved id so the child shares the same trace.
      return createTraceLogger(source, {
        route,
        traceId,
        base: { ...base, ...extra },
      });
    },
  };
}

/**
 * One-shot structured log when you don't want to keep a logger around. Prefer
 * {@link createTraceLogger} inside a handler so the id is resolved once and
 * shared with DB writes; this convenience form is for incidental call sites.
 *
 * @returns the `trace_id` that was logged (handy for follow-up DB writes).
 */
export function logWithTrace(
  source: HeaderSource,
  level: LogLevel,
  event: string,
  fields?: LogFields,
  options: Pick<TraceLoggerOptions, 'route' | 'traceId'> = {},
): string {
  const log = createTraceLogger(source, options);
  log[level](event, fields);
  return log.traceId;
}
