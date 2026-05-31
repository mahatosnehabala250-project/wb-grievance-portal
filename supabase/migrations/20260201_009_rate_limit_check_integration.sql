-- ============================================================================
-- Migration: 20260201_009_rate_limit_check_integration.sql
-- Spec:      sahayak-multi-agent-router (task 26.4) — v1.1 batch
-- Purpose:   Ship the rate-limit backing table + index and re-affirm the
--            `rate_limit_check(...)` stored function so the per-phone rate
--            limiter (Design §v1.1.9, Req 28.5) is self-contained and works on
--            a fresh database.
--
--            The function body itself was first declared by task 17.7
--            (migration 20260201_007_triggers_and_functions.sql). That
--            migration, however, depends on the `intake_rate_limits` table
--            "from the v1 schema" already existing. No v1.1 migration in this
--            repo actually CREATES that table — it is only asserted to exist by
--            tests/migrations/v1_1_smoke.sql. On a fresh environment (CI, a new
--            Supabase project, local SQLite-free pg) the table can be missing,
--            which makes `rate_limit_check` fail at call time with
--            "relation \"intake_rate_limits\" does not exist".
--
--            This migration closes that gap WITHOUT colliding with task 17.7:
--              1. CREATE TABLE IF NOT EXISTS intake_rate_limits — matches the
--                 (phone, scope, created_at) shape the function reads/writes.
--              2. A composite index on (phone, scope, created_at) so the
--                 sliding-window DELETE/COUNT inside rate_limit_check is
--                 index-backed under load (Property 29 fairness, NFR latency).
--              3. CREATE OR REPLACE the function (byte-identical to 17.7) so
--                 this migration is also valid as a standalone bootstrap and is
--                 safe to run before OR after 007 — last writer wins, same body.
--
-- Requirements covered:
--   28.5  Per-phone rate-limit buckets (wa_inbound / blood_request_create /
--         otp_request), enforced by the caller passing p_limit / p_window.
--   28.6  HTTP 429 + Retry-After on threshold breach (enforced in the app layer
--         by src/lib/rateLimit/check.ts; this migration provides the primitive).
--
-- Design sections: §v1.1.9 (idempotency, rate limiting, backpressure).
--
-- Idempotency / safety:
--   - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
--   - CREATE OR REPLACE FUNCTION (no DROP — preserves any existing GRANTs).
--   - No data is modified or deleted. Safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. intake_rate_limits — append-only event log backing the sliding window.
--
--    One row per allowed event. `rate_limit_check` evicts rows older than the
--    window and counts what remains for (phone, scope). The v1 schema used the
--    same (phone, scope, created_at) shape; this CREATE IF NOT EXISTS is a
--    no-op where the v1 table already exists and a bootstrap everywhere else.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_rate_limits (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone      text        NOT NULL,
  scope      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE intake_rate_limits IS
  'Append-only event log for the per-phone sliding-window rate limiter. One '
  'row per allowed (phone, scope) event; rate_limit_check evicts rows older '
  'than the window and counts the remainder. (Req 28.5; Design §v1.1.9)';

-- ----------------------------------------------------------------------------
-- 2. Sliding-window lookup index.
--
--    rate_limit_check runs, per call, a DELETE ... WHERE phone=? AND scope=?
--    AND created_at < cutoff, then a COUNT(*) WHERE phone=? AND scope=?. A
--    composite (phone, scope, created_at) index serves both the equality
--    predicate and the created_at range/eviction without a table scan.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_intake_rate_limits_phone_scope_created
  ON intake_rate_limits (phone, scope, created_at);

-- ----------------------------------------------------------------------------
-- 3. rate_limit_check(p_phone, p_scope, p_limit, p_window)
--
--    Re-affirmed here (byte-identical to migration 20260201_007 / task 17.7)
--    so this migration is a valid standalone bootstrap of the rate limiter and
--    is order-independent w.r.t. 007 (CREATE OR REPLACE: same body, last writer
--    wins). Returns true (and records the event) when under the limit within
--    the last p_window seconds for (p_phone, p_scope); false otherwise.
--
--    Atomicity: pg_advisory_xact_lock(hashtext(phone || ':' || scope))
--    serializes concurrent checks for the same (phone, scope) within the
--    transaction, closing the check-then-insert race. Lock auto-releases at
--    COMMIT.
--
--    Buckets (Req 28.5), supplied by the caller via p_limit / p_window:
--      wa_inbound            — 30 messages per 5 minutes (300 s) per phone.
--      blood_request_create  — 5 per 24 hours (86400 s) per phone.
--      otp_request           — 10 per 1 hour (3600 s) per phone.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_limit_check(
  p_phone   text,
  p_scope   text,
  p_limit   int,
  p_window  int               -- window size in seconds
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  -- Serialize concurrent checks for this (phone, scope) for the txn lifetime.
  PERFORM pg_advisory_xact_lock(hashtext(p_phone || ':' || p_scope));

  -- Evict events that have aged out of the sliding window.
  DELETE FROM intake_rate_limits
   WHERE phone = p_phone
     AND scope = p_scope
     AND created_at < NOW() - (p_window || ' seconds')::interval;

  -- Count what remains inside the window.
  SELECT COUNT(*) INTO v_count
    FROM intake_rate_limits
   WHERE phone = p_phone
     AND scope = p_scope;

  -- At or over the limit → reject without recording.
  IF v_count >= p_limit THEN
    RETURN false;
  END IF;

  -- Under the limit → record this event and allow.
  INSERT INTO intake_rate_limits (phone, scope, created_at)
  VALUES (p_phone, p_scope, NOW());

  RETURN true;
END;
$$;

COMMENT ON FUNCTION rate_limit_check(text, text, int, int) IS
  'Atomic per-phone sliding-window rate limiter. Returns true and records the '
  'event if under p_limit within the last p_window seconds for (p_phone, '
  'p_scope); returns false otherwise. Uses pg_advisory_xact_lock for '
  'check-then-insert atomicity. (Req 28.5; Design §v1.1.9)';

COMMIT;
