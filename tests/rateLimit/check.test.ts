// Unit tests for the per-phone rate-limit integration helper (task 26.4).
//
// These are pure / mock-DB tests — no live database. The sliding-window
// algorithm itself lives in the Postgres `rate_limit_check` stored function
// (migration 20260201_007/009) and is exercised end-to-end by the Property 29
// DB test (task 26.7); here we test the TypeScript wrapper's contract:
//   - it binds the correct bucket (limit, windowSeconds) per scope,
//   - it maps the boolean result to allowed/blocked,
//   - it fails OPEN on a DB error,
//   - the HTTP 429 helper carries Retry-After ≤ window (Req 28.6),
//   - the WhatsApp reply is trilingual with the mandated Hindi line (Req 28.7).

import { describe, it, expect, vi } from 'vitest';

import {
  checkRateLimit,
  rateLimitHttpResponse,
  rateLimitWhatsAppReply,
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_WA_REPLIES,
  RETRY_AFTER_HEADER,
  type DbClient,
  type RateLimitScope,
} from '../../src/lib/rateLimit/check';

// ─── Test helpers ──────────────────────────────────────────────────────────

/** A mock pg-style client that returns a fixed `allowed` value and records calls. */
function mockDb(allowed: boolean | null): {
  db: DbClient;
  calls: { sql: string; params?: unknown[] }[];
} {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const db: DbClient = {
    async query<Row>(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rows: [{ allowed } as unknown as Row] };
    },
  };
  return { db, calls };
}

// ─── checkRateLimit — result mapping ─────────────────────────────────────────

describe('checkRateLimit — boolean mapping', () => {
  it('returns allowed:true when the stored function returns true', async () => {
    const { db } = mockDb(true);
    const res = await checkRateLimit('+919876543210', 'otp_request', { db });
    expect(res.allowed).toBe(true);
    expect(res.scope).toBe('otp_request');
    expect(res.error).toBeUndefined();
  });

  it('returns allowed:false when the stored function returns false', async () => {
    const { db } = mockDb(false);
    const res = await checkRateLimit('+919876543210', 'wa_inbound', { db });
    expect(res.allowed).toBe(false);
  });

  it('fails open (allowed:true) when the row/value is NULL', async () => {
    const { db } = mockDb(null);
    const res = await checkRateLimit('+919876543210', 'blood_request_create', { db });
    expect(res.allowed).toBe(true);
  });
});

// ─── checkRateLimit — bucket binding (Req 28.5) ──────────────────────────────

describe('checkRateLimit — binds the canonical bucket per scope', () => {
  const cases: [RateLimitScope, number, number][] = [
    ['wa_inbound', 30, 300],
    ['blood_request_create', 5, 86_400],
    ['otp_request', 10, 3_600],
  ];

  for (const [scope, limit, windowSeconds] of cases) {
    it(`passes (phone, '${scope}', ${limit}, ${windowSeconds}) to rate_limit_check`, async () => {
      const { db, calls } = mockDb(true);
      const res = await checkRateLimit('+910000000000', scope, { db });

      expect(calls).toHaveLength(1);
      expect(calls[0].params).toEqual(['+910000000000', scope, limit, windowSeconds]);
      // Retry-After hint equals the bucket window (Req 28.6 / Property 29 bound).
      expect(res.retryAfterSeconds).toBe(windowSeconds);
      expect(RATE_LIMIT_BUCKETS[scope]).toEqual({ limit, windowSeconds });
    });
  }

  it('honors a bucket override', async () => {
    const { db, calls } = mockDb(true);
    await checkRateLimit('+910000000000', 'otp_request', {
      db,
      bucket: { limit: 1, windowSeconds: 60 },
    });
    expect(calls[0].params).toEqual(['+910000000000', 'otp_request', 1, 60]);
  });
});

// ─── checkRateLimit — fail-open on DB error ──────────────────────────────────

describe('checkRateLimit — fail-open on DB error', () => {
  it('returns allowed:true and surfaces the error when the query throws', async () => {
    const boom = new Error('relation "intake_rate_limits" does not exist');
    const db: DbClient = {
      query: vi.fn().mockRejectedValue(boom),
    };
    const res = await checkRateLimit('+919876543210', 'wa_inbound', { db });
    expect(res.allowed).toBe(true);
    expect(res.error).toBe(boom);
    // Retry hint still populated from the bucket so callers can log uniformly.
    expect(res.retryAfterSeconds).toBe(RATE_LIMIT_BUCKETS.wa_inbound.windowSeconds);
  });
});

// ─── rateLimitHttpResponse — 429 + Retry-After (Req 28.6) ────────────────────

describe('rateLimitHttpResponse — HTTP 429 with Retry-After', () => {
  it('returns 429 with Retry-After equal to the window (≤ window_seconds)', async () => {
    const res = rateLimitHttpResponse({
      allowed: false,
      scope: 'otp_request',
      retryAfterSeconds: 3_600,
    });

    expect(res.status).toBe(429);
    const retryAfter = res.headers.get(RETRY_AFTER_HEADER);
    expect(retryAfter).toBe('3600');
    // Property 29 bound: the hint must not exceed the bucket window.
    expect(Number(retryAfter)).toBeLessThanOrEqual(RATE_LIMIT_BUCKETS.otp_request.windowSeconds);

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('RATE_LIMITED');
    expect(body.scope).toBe('otp_request');
  });
});

// ─── rateLimitWhatsAppReply — trilingual (Req 28.7) ──────────────────────────

describe('rateLimitWhatsAppReply — trilingual reply', () => {
  it('returns the mandated Hindi line for hi', () => {
    expect(rateLimitWhatsAppReply('hi')).toBe('Aap thoda ruk kar bhejiye.');
  });

  it('returns the English line for en and the Bengali line for bn', () => {
    expect(rateLimitWhatsAppReply('en')).toBe(RATE_LIMIT_WA_REPLIES.en);
    expect(rateLimitWhatsAppReply('bn')).toBe(RATE_LIMIT_WA_REPLIES.bn);
  });

  it('falls back to English for unknown / missing languages', () => {
    expect(rateLimitWhatsAppReply('fr')).toBe(RATE_LIMIT_WA_REPLIES.en);
    expect(rateLimitWhatsAppReply(null)).toBe(RATE_LIMIT_WA_REPLIES.en);
    expect(rateLimitWhatsAppReply(undefined)).toBe(RATE_LIMIT_WA_REPLIES.en);
  });
});
