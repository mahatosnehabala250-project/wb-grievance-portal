/**
 * UUIDv7 generator (task 25.1).
 *
 * One `trace_id` is assigned per inbound WhatsApp message at the top of the
 * pipeline and propagated through every log table so a full request can be
 * reconstructed (Design §v1.1.8). We use UUIDv7 — a time-ordered UUID — rather
 * than UUIDv4 because the 48-bit millisecond timestamp prefix makes IDs sort
 * lexicographically by creation time, so the per-trace timeline view is a plain
 * `ORDER BY trace_id, created_at` with no extra sort key.
 *
 * Layout (RFC 9562 §5.7):
 *   - bits   0..47  : unix timestamp in milliseconds (big-endian)
 *   - bits  48..51  : version (0b0111 = 7)
 *   - bits  52..63  : rand_a (12 bits)
 *   - bits  64..65  : variant (0b10)
 *   - bits  66..127 : rand_b (62 bits)
 *
 * Pure, dependency-free. Uses Web Crypto `crypto.getRandomValues` when present
 * (browser, edge, modern Node) and falls back to `Math.random` only if no CSPRNG
 * is available (never the case in supported runtimes — the fallback exists so the
 * function cannot throw).
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.8 Trace IDs
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 27.1
 */

/** Lowercase canonical 8-4-4-4-12 UUID with version 7 + RFC 4122 variant. */
const UUID7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Fill a Uint8Array with cryptographically-strong random bytes.
 * Falls back to Math.random only when no CSPRNG is reachable.
 */
function randomBytes(out: Uint8Array): Uint8Array {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    g.crypto.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

/** Hex lookup table for fast byte → 2-char hex conversion. */
const HEX: string[] = [];
for (let i = 0; i < 256; i++) HEX.push((i + 0x100).toString(16).slice(1));

/**
 * Generate a new UUIDv7 string.
 *
 * Always returns a valid, lowercase, canonically-formatted UUIDv7. Successive
 * calls within the same millisecond differ only in their random bits but remain
 * correctly ordered relative to calls in earlier/later milliseconds.
 *
 * @param now Injectable timestamp in ms (defaults to `Date.now()`) for tests.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);

  // 48-bit timestamp (ms) into bytes 0..5, big-endian.
  // Use Math.floor + division to stay safe above the 32-bit boundary.
  const ts = Math.max(0, Math.floor(now));
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;

  // Random bits for the remaining 10 bytes.
  const rand = randomBytes(new Uint8Array(10));
  for (let i = 0; i < 10; i++) bytes[6 + i] = rand[i];

  // Set version (7) in the high nibble of byte 6.
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Set variant (0b10xxxxxx) in the two high bits of byte 8.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  // Format as 8-4-4-4-12.
  const h = bytes;
  return (
    HEX[h[0]] + HEX[h[1]] + HEX[h[2]] + HEX[h[3]] +
    '-' +
    HEX[h[4]] + HEX[h[5]] +
    '-' +
    HEX[h[6]] + HEX[h[7]] +
    '-' +
    HEX[h[8]] + HEX[h[9]] +
    '-' +
    HEX[h[10]] + HEX[h[11]] + HEX[h[12]] + HEX[h[13]] + HEX[h[14]] + HEX[h[15]]
  );
}

/**
 * Validate that a string is a well-formed UUIDv7 (version nibble = 7 and a
 * valid RFC 4122 variant). Used as a guard in route handlers before trusting
 * an inbound `X-Trace-Id` header (Design §v1.1.8).
 */
export function isUuid7(s: string): boolean {
  return typeof s === 'string' && UUID7_RE.test(s);
}

/**
 * Design alias — Design §v1.1.8 names the generator `uuid7`.
 * Kept as a named export so spec code referencing either name compiles.
 */
export const uuid7 = uuidv7;
