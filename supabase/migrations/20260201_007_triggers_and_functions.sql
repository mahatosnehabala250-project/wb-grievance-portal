-- ============================================================================
-- Migration: 20260201_007_triggers_and_functions.sql
-- Spec:      sahayak-multi-agent-router (task 17.7) — v1.1 batch
-- Purpose:   Triggers and stored functions for v1.1:
--              1. Donor invitation fairness counter trigger (anti-burnout).
--              2. Nightly recompute job for the 30-day invitation window.
--              3. Complaint cache-invalidation trigger (LISTEN/NOTIFY).
--              4. Atomic per-phone rate limiter stored function.
--
-- Requirements covered:
--   23.5  Donor fairness — last_invited_at / invitations_last_30d maintenance.
--   26.1  Semantic cache invalidation when a complaint is written.
--   28.5  Per-phone rate limiting buckets (wa_inbound / blood_request_create /
--         otp_request) via an atomic Postgres-side stored function.
--
-- Design sections: §v1.1.4 (adaptive cascade / donor fairness),
--                  §v1.1.7 (semantic cache + cache invalidation),
--                  §v1.1.9 (idempotency, rate limiting, backpressure).
--
-- Dependencies (must already exist):
--   - blood_donors.last_invited_at, blood_donors.invitations_last_30d
--     (added in migration 20260201_002 / task 17.2).
--   - cascade_notifications (id, blood_request_id, donor_id, tier, notified_at,
--     responded_at, response) from migration 20260101_005.
--   - complaints.ticket_number (v1 schema).
--   - intake_rate_limits (phone, scope, created_at) from the v1 schema.
--
-- Idempotency:
--   - Functions use CREATE OR REPLACE FUNCTION.
--   - Triggers use DROP TRIGGER IF EXISTS before CREATE TRIGGER.
--   - Safe to re-run without error.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. trg_donor_invitation_counter
--    Fires AFTER INSERT on cascade_notifications. For the notified donor
--    (NEW.donor_id) it stamps blood_donors.last_invited_at = now() and
--    increments invitations_last_30d by 1. These two columns feed the
--    anti-burnout fairness penalty in the adaptive cascade engine (Req 23.5).
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_fn_donor_invitation_counter()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE blood_donors
  SET last_invited_at      = NOW(),
      invitations_last_30d = invitations_last_30d + 1
  WHERE id = NEW.donor_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_fn_donor_invitation_counter() IS
  'Trigger function for trg_donor_invitation_counter. On each new '
  'cascade_notifications row, stamps blood_donors.last_invited_at = now() and '
  'increments invitations_last_30d for the notified donor (anti-burnout '
  'fairness). (Req 23.5; Design §v1.1.4)';

-- Attach the trigger to cascade_notifications (idempotent: drop first)
DROP TRIGGER IF EXISTS trg_donor_invitation_counter ON cascade_notifications;
CREATE TRIGGER trg_donor_invitation_counter
  AFTER INSERT ON cascade_notifications
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_donor_invitation_counter();

-- ============================================================================
-- 2. decrement_30d_invitations()
--    Nightly cron job. The trigger above only ever increments the counter, so
--    invitations age out of the 30-day window silently. This function brings
--    every donor's invitations_last_30d back in line with reality by
--    recomputing it from the actual cascade_notifications count where
--    notified_at > now() - interval '30 days'.
--
--    Implementation note: a LEFT JOIN drives the recompute from blood_donors so
--    that donors whose recent count has dropped to zero are also reset (a plain
--    INNER JOIN on cascade_notifications would never touch them). The
--    `IS DISTINCT FROM` guard means only rows that actually changed are
--    written, keeping nightly WAL churn proportional to real change.
-- ============================================================================
CREATE OR REPLACE FUNCTION decrement_30d_invitations()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE blood_donors bd
  SET invitations_last_30d = recomputed.cnt
  FROM (
    SELECT bd2.id AS donor_id,
           COUNT(cn.id) AS cnt
    FROM blood_donors bd2
    LEFT JOIN cascade_notifications cn
      ON cn.donor_id = bd2.id
     AND cn.notified_at > NOW() - INTERVAL '30 days'
    GROUP BY bd2.id
  ) AS recomputed
  WHERE bd.id = recomputed.donor_id
    AND bd.invitations_last_30d IS DISTINCT FROM recomputed.cnt;
END;
$$;

COMMENT ON FUNCTION decrement_30d_invitations() IS
  'Nightly job. Recomputes blood_donors.invitations_last_30d from the count of '
  'cascade_notifications with notified_at within the last 30 days, so '
  'invitations that age past the window are decremented. Only writes rows whose '
  'value actually changed. (Req 23.5; Design §v1.1.4)';

-- ============================================================================
-- 3. trg_complaint_cache_invalidate
--    Fires BEFORE INSERT OR UPDATE on complaints. Emits a LISTEN/NOTIFY event
--    on channel 'cache_invalidate' carrying the affected ticket_number so the
--    semantic query_cache listener can drop stale 'ticket_status' rows
--    (e.g. a previously cached "no such ticket" answer). (Req 26.1)
--
--    COALESCE(NEW.ticket_number, OLD.ticket_number): on INSERT, OLD is NULL so
--    NEW is used; on UPDATE both are present and NEW is used.
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_fn_complaint_cache_invalidate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('cache_invalidate', json_build_object(
    'category',      'ticket_status',
    'ticket_number', COALESCE(NEW.ticket_number, OLD.ticket_number)
  )::text);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_fn_complaint_cache_invalidate() IS
  'Trigger function for trg_complaint_cache_invalidate. Emits a pg_notify on '
  'channel cache_invalidate with the ticket_number whenever a complaint is '
  'inserted or updated, so the semantic cache listener can purge stale '
  'ticket_status entries. (Req 26.1; Design §v1.1.7)';

-- Attach the trigger to complaints (idempotent: drop first)
DROP TRIGGER IF EXISTS trg_complaint_cache_invalidate ON complaints;
CREATE TRIGGER trg_complaint_cache_invalidate
  BEFORE INSERT OR UPDATE ON complaints
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_complaint_cache_invalidate();

-- ============================================================================
-- 4. rate_limit_check(p_phone, p_scope, p_limit, p_window)
--    Postgres-side token-bucket rate limiter so we don't need Redis
--    (Design §v1.1.9). Returns true if the call is allowed (and records it),
--    false if the limit has been reached within the window.
--
--    Atomicity: pg_advisory_xact_lock(hashtext(phone || ':' || scope)) serializes
--    concurrent checks for the same (phone, scope) pair within the transaction,
--    preventing the check-then-insert race. The lock auto-releases at COMMIT.
--
--    Buckets (Req 28.5), enforced by the caller passing p_limit / p_window:
--      wa_inbound            — 30 messages per 5 minutes (300 s) per phone.
--      blood_request_create  — 5 per 24 hours (86400 s) per phone.
--      otp_request           — 10 per 1 hour (3600 s) per phone.
-- ============================================================================
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
