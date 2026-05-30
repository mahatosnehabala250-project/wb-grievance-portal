/**
 * Trace ID extraction + propagation helpers (task 25.2).
 *
 * Every n8n HTTP-tool node stamps `X-Trace-Id: <trace_id>` on outbound requests
 * (Design §v1.1.8). Vercel route handlers read it back so all DB writes and
 * structured logs for that request carry the same `trace_id`, enabling the
 * `GET /api/trace/[id]` timeline view (task 25.5).
 *
 * Header names are case-insensitive per HTTP semantics. The standard `Headers`
 * object handles this for us; for a plain object we scan keys case-insensitively.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.8 Trace IDs
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 27.3, 27.4
 */

import { uuidv7, isUuid7 } from './uuid7';

/** Accepted header sources. */
export type HeaderSource = Headers | Record<string, string> | Request;

const TRACE_HEADER = 'x-trace-id';
/** Canonical capitalization for outbound headers. */
const TRACE_HEADER_OUT = 'X-Trace-Id';

/**
 * Read a header value case-insensitively from any supported source.
 * Returns null when the header is absent.
 */
function readHeader(source: HeaderSource, name: string): string | null {
  // `Request` — delegate to its Headers.
  if (typeof Request !== 'undefined' && source instanceof Request) {
    return source.headers.get(name);
  }

  // `Headers` — `.get()` is already case-insensitive.
  if (typeof Headers !== 'undefined' && source instanceof Headers) {
    return source.get(name);
  }

  // Plain object — scan keys case-insensitively.
  const lower = name.toLowerCase();
  const obj = source as Record<string, string>;
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lower) {
      const v = obj[key];
      return v == null ? null : String(v);
    }
  }
  return null;
}

/**
 * Extract the inbound `X-Trace-Id` header value.
 *
 * Returns the trimmed header value if present (regardless of format — callers
 * that require a strict UUIDv7 can validate with `isUuid7`), or `null` when the
 * header is missing or blank.
 *
 * Use {@link extractOrCreateTraceId} instead when you need a guaranteed id at a
 * pipeline entry point (it mints a fresh UUIDv7 on miss per Design §v1.1.8).
 *
 * @param headers A `Headers`, plain header object, or `Request`.
 */
export function extractTraceId(headers: HeaderSource): string | null {
  const raw = readHeader(headers, TRACE_HEADER);
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extract a valid `X-Trace-Id`, or generate a fresh UUIDv7 when it is missing
 * or malformed. This matches the Design §v1.1.8 route-handler contract:
 *
 *   const h = req.headers.get('X-Trace-Id');
 *   return h && isUuid7(h) ? h : uuid7();
 *
 * Always returns a usable trace id. Use this at request entry points where a
 * downstream write requires a non-null `trace_id`.
 */
export function extractOrCreateTraceId(headers: HeaderSource): string {
  const existing = extractTraceId(headers);
  return existing && isUuid7(existing) ? existing : uuidv7();
}

/**
 * Build an outbound headers object that carries the given `trace_id`.
 *
 * Copies any provided base headers (case-insensitively dropping a pre-existing
 * trace header so we don't emit duplicates) and sets the canonical
 * `X-Trace-Id` key. Returns a fresh plain object suitable for `fetch`.
 *
 * @param headers  Optional base headers to merge (`Headers` or plain object).
 * @param traceId  The trace id to attach.
 */
export function withTraceId(
  headers: Headers | Record<string, string> | undefined,
  traceId: string,
): Record<string, string> {
  const out: Record<string, string> = {};

  if (headers) {
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      headers.forEach((value, key) => {
        if (key.toLowerCase() !== TRACE_HEADER) out[key] = value;
      });
    } else {
      for (const [key, value] of Object.entries(headers as Record<string, string>)) {
        if (key.toLowerCase() !== TRACE_HEADER) out[key] = String(value);
      }
    }
  }

  out[TRACE_HEADER_OUT] = traceId;
  return out;
}
