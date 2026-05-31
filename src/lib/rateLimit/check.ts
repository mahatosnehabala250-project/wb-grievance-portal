/**
 * Per-phone rate limiting — integration helper (task 26.4).
 *
 * A thin, self-contained wrapper around the Postgres-side `rate_limit_check`
 * stored function (declared in task 17.7 / migration `20260201_007`, re-affirmed
 * with its backing table in `20260201_009`). The stored function is the single
 * source of truth for the sliding-window algorithm and its `pg_advisory_xact_lock`
 * atomicity (Design §v1.1.9); this module only:
 *
 *   1. Calls the function with the right `(phone, scope, limit, window)` bucket.
 *   2. Translates the boolean result into the HTTP / WhatsApp responses the
 *      design mandates — HTTP 429 + `Retry-After: <window_seconds>` (Req 28.6)
 *      and the trilingual WhatsApp "please wait" reply (Req 28.7).
 *
 * ─── Why a helper module (not edits to existing routes) ──────────────────────
 * The three integration points named in task 26.4 are owned by other concurrent
 * tasks and, in this codebase, do not all exist yet under the design's names
 * (`/api/donor/auth/request-otp` ships as `send-otp`; there is no
 * `/api/blood-requests/create`; the WhatsApp inbound parse lives in the n8n
 * JS-01v2 Code Node). The idempotency middleware (task 26.1,
 * `src/lib/idempotency/middleware.ts`) is also still in progress. To keep this
 * task self-contained and avoid colliding with files those tasks own, the
 * enforcement logic lives here as a reusable helper. Each call site wires it in
 * with a single line — see {@link RATE_LIMIT_BUCKETS} and the "Integration
 * points" note below.
 *
 * ─── Integration points (Design §v1.1.9, task 26.4) ─────────────────────────
 *   • `/api/donor/auth/request-otp` (ships as `send-otp`):
 *       const ok = await checkRateLimit(phone, 'otp_request', { db });
 *       if (!ok.allowed) return rateLimitHttpResponse(ok);   // 429 + Retry-After
 *   • `/api/blood-requests/create`:
 *       const ok = await checkRateLimit(phone, 'blood_request_create', { db });
 *       if (!ok.allowed) return rateLimitHttpResponse(ok);
 *   • WhatsApp inbound parse step (n8n JS-01v2 Code Node / intake route):
 *       const ok = await checkRateLimit(phone, 'wa_inbound', { db });
 *       if (!ok.allowed) sendWA(phone, rateLimitWhatsAppReply(session.language));
 *
 * The DB client is INJECTED (pg-style `query(sql, params) => { rows }`) so the
 * helper is unit-testable against an in-memory mock without a live DB —
 * following the injectable-client convention in `src/lib/router/cache.ts` and
 * `src/lib/semanticCache/lookup.ts`. Call sites that already hold a `pg.Pool`
 * (the convention in `src/app/api/blood-requests/donor-respond/route.ts`) pass
 * it straight through.
 *
 * Fail-open posture: this is an anti-abuse guard, not a correctness gate. If the
 * `rate_limit_check` call itself errors (DB blip, missing table on a partially
 * migrated env), {@link checkRateLimit} returns `allowed: true` so a limiter
 * fault never blocks a legitimate citizen request (NFR Reliability). The error
 * is surfaced on the result for logging.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.9 Idempotency, Rate Limiting, Backpressure
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 28.5, 28.6, 28.7
 * @see supabase/migrations/20260201_007_triggers_and_functions.sql — rate_limit_check DDL
 * @see supabase/migrations/20260201_009_rate_limit_check_integration.sql — table + index + re-affirm
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The named rate-limit scopes (Design §v1.1.9, Req 28.5). Matches the `p_scope`
 * values the stored function is documented for; used as the `intake_rate_limits.scope`
 * discriminator so each bucket counts independently per phone.
 */
export type RateLimitScope = 'wa_inbound' | 'blood_request_create' | 'otp_request';

/** Session language for the trilingual WhatsApp reply (Req 28.7). */
export type RateLimitLanguage = 'en' | 'hi' | 'bn';

/** A `(limit, windowSeconds)` bucket definition. */
export interface RateLimitBucket {
  /** Max allowed events within the window. */
  limit: number;
  /** Sliding-window size in seconds (also the `Retry-After` value, Req 28.6). */
  windowSeconds: number;
}

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

/** Outcome of a rate-limit check. */
export interface RateLimitResult {
  /** True when the call is under the limit (and was recorded). */
  allowed: boolean;
  /** The scope that was checked. */
  scope: RateLimitScope;
  /**
   * Seconds the caller should wait before retrying — the bucket's window size
   * (Req 28.6). Always present so callers can set `Retry-After` uniformly;
   * meaningful only when `allowed` is false.
   */
  retryAfterSeconds: number;
  /**
   * Set when the underlying `rate_limit_check` call threw. The check fails open
   * (`allowed: true`) in that case; this carries the error for logging.
   */
  error?: unknown;
}

/** Options for {@link checkRateLimit}. */
export interface CheckRateLimitOptions {
  /** Injected pg-style DB client (required — there is no implicit global). */
  db: DbClient;
  /**
   * Override the bucket. Defaults to the canonical {@link RATE_LIMIT_BUCKETS}
   * entry for the scope. Useful for tests or per-deployment tuning.
   */
  bucket?: RateLimitBucket;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Canonical per-phone buckets (Design §v1.1.9, Req 28.5):
 *   wa_inbound            — 30 messages per 5 minutes (300 s).
 *   blood_request_create  — 5 per 24 hours (86400 s).
 *   otp_request           — 10 per 1 hour (3600 s).
 *
 * These are the `(p_limit, p_window)` arguments passed to `rate_limit_check`.
 */
export const RATE_LIMIT_BUCKETS: Record<RateLimitScope, RateLimitBucket> = {
  wa_inbound: { limit: 30, windowSeconds: 300 },
  blood_request_create: { limit: 5, windowSeconds: 86_400 },
  otp_request: { limit: 10, windowSeconds: 3_600 },
};

/**
 * Trilingual WhatsApp rate-limit replies, keyed by `session.language` (Req 28.7).
 * The Hindi line is the exact text mandated by Req 28.7; the English and Bengali
 * lines mirror the localized templates in Design §v1.1.9.
 */
export const RATE_LIMIT_WA_REPLIES: Record<RateLimitLanguage, string> = {
  en: 'Please wait a bit before sending again.',
  hi: 'Aap thoda ruk kar bhejiye.',
  bn: 'অনুগ্রহ করে একটু অপেক্ষা করে আবার পাঠান।',
};

/** Header name for the HTTP 429 retry hint (Req 28.6). */
export const RETRY_AFTER_HEADER = 'Retry-After';

/** Invoke the stored function: `SELECT rate_limit_check($1,$2,$3,$4) AS allowed`. */
const RATE_LIMIT_SQL = 'SELECT rate_limit_check($1, $2, $3, $4) AS allowed';

// ─── Core check ────────────────────────────────────────────────────────────

/**
 * Check (and, when allowed, record) one rate-limited event for `phone` under
 * `scope` by calling the Postgres `rate_limit_check` stored function.
 *
 * The stored function owns the sliding-window count + eviction and the
 * `pg_advisory_xact_lock` atomicity, so this helper is a single round-trip: it
 * binds the bucket's `(limit, windowSeconds)` and maps the boolean result.
 *
 * Fail-open: any error from the DB call yields `{ allowed: true, error }` so a
 * limiter fault never blocks a legitimate request (NFR Reliability).
 *
 * @param phone   Citizen phone (the limiter key; passed verbatim to the function).
 * @param scope   Which bucket to count against (Req 28.5).
 * @param options Injected `db` client and optional bucket override.
 */
export async function checkRateLimit(
  phone: string,
  scope: RateLimitScope,
  options: CheckRateLimitOptions,
): Promise<RateLimitResult> {
  const bucket = options.bucket ?? RATE_LIMIT_BUCKETS[scope];

  try {
    const res = await options.db.query<{ allowed: boolean | null }>(RATE_LIMIT_SQL, [
      phone,
      scope,
      bucket.limit,
      bucket.windowSeconds,
    ]);

    // Postgres returns a single row { allowed: boolean }. Coerce defensively:
    // a missing/NULL value is treated as allowed (fail-open).
    const raw = res.rows[0]?.allowed;
    const allowed = raw === null || raw === undefined ? true : Boolean(raw);

    return {
      allowed,
      scope,
      retryAfterSeconds: bucket.windowSeconds,
    };
  } catch (error) {
    // Fail open — the limiter must never take down a citizen-facing flow.
    return {
      allowed: true,
      scope,
      retryAfterSeconds: bucket.windowSeconds,
      error,
    };
  }
}

// ─── HTTP 429 helper (Req 28.6) ──────────────────────────────────────────────

/**
 * Build the standard HTTP 429 `Response` for a rejected HTTP API call, carrying
 * `Retry-After: <window_seconds>` (Req 28.6) and the project's `{ ok: false, error }`
 * JSON envelope (matching the donor/auth and cache routes).
 *
 * The `Retry-After` value is at most the bucket's window — satisfying the
 * Property 29 bound that the hint never exceeds `window_seconds`.
 *
 * @param result The rejected {@link RateLimitResult} from {@link checkRateLimit}.
 */
export function rateLimitHttpResponse(result: RateLimitResult): Response {
  const retryAfter = String(result.retryAfterSeconds);
  return new Response(
    JSON.stringify({
      ok: false,
      error: 'RATE_LIMITED',
      message: 'Rate limit exceeded. Please retry later.',
      scope: result.scope,
      retryAfterSeconds: result.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        [RETRY_AFTER_HEADER]: retryAfter,
      },
    },
  );
}

// ─── WhatsApp reply helper (Req 28.7) ────────────────────────────────────────

/**
 * Pick the trilingual WhatsApp "please wait" reply for the citizen's
 * `session.language` (Req 28.7). Unknown / missing languages fall back to
 * English. The Hindi line is the exact text required by Req 28.7.
 *
 * @param language The session language (`en | hi | bn`); anything else → `en`.
 */
export function rateLimitWhatsAppReply(language: string | null | undefined): string {
  const lang: RateLimitLanguage =
    language === 'hi' || language === 'bn' || language === 'en' ? language : 'en';
  return RATE_LIMIT_WA_REPLIES[lang];
}
