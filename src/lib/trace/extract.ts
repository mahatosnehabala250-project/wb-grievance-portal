/**
 * Trace ID extraction + propagation helpers (task 25.2).
 *
 * Every n8n HTTP-tool node stamps `X-Trace-Id: <trace_id>` on outbound requests
 * (Design §v1.1.8). Vercel `/api/*` route handlers read it back so all DB writes
 * and structured logs for that request carry the same `trace_id`, enabling the
 * `GET /api/trace/[id]` timeline view (task 25.5).
 *
 * The canonical contract (Design §v1.1.8 / Req 27.3, 27.4):
 *
 *   export function extractTraceId(req: Request): string {
 *     const h = req.headers.get('X-Trace-Id');
 *     return h && isUuid7(h) ? h : uuid7();
 *   }
 *
 * i.e. read the inbound header; if present and a valid UUIDv7, reuse it so the
 * trace is continuous; otherwise mint a fresh `uuid7()` so the request still has
 * a usable id. `extractTraceId` therefore always returns a string.
 *
 * Header names are case-insensitive per HTTP semantics. The standard `Headers`
 * object handles this for us; for a plain object we scan keys case-insensitively.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.8 Trace IDs
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 27.3, 27.4
 */

import { uuid7, isUuid7 } from './uuid7';

/** Accepted header sources: a `Request`, a `Headers`, or a plain header map. */
export type HeaderSource = Request | Headers | Record<string, string>;

/** Inbound header name (lowercased for case-insensitive comparison). */
const TRACE_HEADER = 'x-trace-id';
/** Canonical capitalization for outbound headers. */
const TRACE_HEADER_OUT = 'X-Trace-Id';

/**
 * Read a header value case-insensitively from any supported source.
 * Returns null when the header is absent.
 */
function readHeader(source: HeaderSource, name: string): string | null {
  // `Request` — delegate to its Headers (`.get()` is case-insensitive).
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
 * Extract the trace id for an inbound request, generating one if needed.
 *
 * Reads the `X-Trace-Id` header; if it is present and a valid UUIDv7 the value
 * is reused (so the trace stays continuous across the n8n → Vercel hop), and a
 * fresh `uuid7()` is minted otherwise. Always returns a usable trace id.
 *
 * Matches the Design §v1.1.8 route-handler contract `extractTraceId(req: Request)`.
 * Also accepts a `Headers` instance or a plain header map for convenience and
 * testability — these are non-breaking supersets of the documented signature.
 *
 * @param source A `Request`, `Headers`, or plain header object.
 */
export function extractTraceId(source: HeaderSource): string {
  const raw = readHeader(source, TRACE_HEADER);
  const h = raw == null ? null : raw.trim();
  return h && isUuid7(h) ? h : uuid7();
}

/**
 * Back-compat alias for {@link extractTraceId}. The "extract or create" semantics
 * are now the default behavior of `extractTraceId` itself (per Design §v1.1.8),
 * so this simply forwards. Retained so callers referencing either name compile.
 */
export const extractOrCreateTraceId = extractTraceId;

/**
 * Build an outbound headers object that carries the given `trace_id`.
 *
 * Copies any provided base headers (case-insensitively dropping a pre-existing
 * trace header so we don't emit duplicates) and sets the canonical
 * `X-Trace-Id` key. Returns a fresh plain object suitable for `fetch`.
 *
 * Used by HTTP-tool callers (task 25.3) to propagate the trace id downstream.
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
