-- ============================================================================
-- Migration: 20260201_022_donor_invitation_counter.sql
-- Spec:      sahayak-multi-agent-router (task 21.4) — v1.1 batch
-- Purpose:   Donor-fairness invitation accounting for the Adaptive Donor
--            Cascade (Req 23). Two deliverables:
--              1. AFTER INSERT trigger on cascade_notifications that bumps
--                 blood_donors.last_invited_at and increments
--                 invitations_last_30d for the notified donor (anti-burnout).
--              2. Nightly recompute function decrement_30d_invitations() that
--                 brings invitations_last_30d back in line with the true count
--                 of cascade_notifications inside the trailing 30-day window.
--
-- Requirements covered:
--   23.5  blood_donors.last_invited_at / invitations_last_30d are updated
--         whenever a cascade_notifications row is inserted for that donor; a
--         nightly job ages invitations out of the 30-day window.
--
-- Design sections: §v1.1.4 (adaptive cascade / donor fairness).
--
-- ─── Relationship to migration 20260201_007 (task 17.7) ─────────────────────
-- Migration 007 first declared trg_fn_donor_invitation_counter(),
-- the trg_donor_invitation_counter trigger, and decrement_30d_invitations().
-- This migration is the authoritative task-21.4 deliverable and REFINES the
-- trigger function so the recency stamp uses the notified row's own timestamp
-- (NEW.notified_at) instead of a fresh now(). For ordinary cascade inserts the
-- two are identical because cascade_notifications.notified_at defaults to NOW()
-- (see 20260101_005), but NEW.notified_at is strictly more correct: if a row is
-- ever inserted or backfilled with an explicit notified_at, last_invited_at
-- tracks the actual notification time rather than the moment the row hit the DB.
-- It does NOT overwrite 007 — everything here is CREATE OR REPLACE / DROP ...
-- IF EXISTS so the two migrations compose and either ordering converges to this
-- definition. Safe to re-run.
--
-- Dependencies (must already exist):
--   - blood_donors.last_invited_at, blood_donors.invitations_last_30d
--     (added in migration 20260201_002 / task 17.2).
--   - cascade_notifications (id, blood_request_id, donor_id, tier, notified_at,
--     responded_at, response) from migration 20260101_005, with
--     notified_at timestamptz NOT NULL DEFAULT NOW().
--
-- Idempotency:
--   - Functions use CREATE OR REPLACE FUNCTION (return signatures unchanged).
--   - Trigger uses DROP TRIGGER IF EXISTS before CREATE TRIGGER.
--   - Safe to re-run without error.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. trg_donor_invitation_counter
--    Fires AFTER INSERT on cascade_notifications. For the notified donor
--    (NEW.donor_id) it stamps blood_donors.last_invited_at = NEW.notified_at
--    and increments invitations_last_30d by 1. These two columns feed the
--    anti-burnout recency_penalty in the v1.1.4 fairness ranker (Req 23.5, 23.6).
--
--    Why NEW.notified_at (not now()): the stamp records WHEN the donor was
--    notified, which is exactly the value carried on the row being inserted.
--    For ordinary inserts notified_at == now() (column default), so this is a
--    no-op refinement of 007; for explicit/backfilled notified_at it is the
--    correct recency anchor for the GREATEST(0, 30 - days_since_last_invited)
--    term of the recency penalty.
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_fn_donor_invitation_counter()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE blood_donors
  SET last_invited_at      = NEW.notified_at,
      invitations_last_30d = invitations_last_30d + 1
  WHERE id = NEW.donor_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_fn_donor_invitation_counter() IS
  'Trigger function for trg_donor_invitation_counter. On each new '
  'cascade_notifications row, stamps blood_donors.last_invited_at = '
  'NEW.notified_at and increments invitations_last_30d for the notified donor '
  '(anti-burnout fairness). (Req 23.5; Design §v1.1.4; task 21.4 refines 17.7)';

-- Attach the trigger to cascade_notifications (idempotent: drop first).
DROP TRIGGER IF EXISTS trg_donor_invitation_counter ON cascade_notifications;
CREATE TRIGGER trg_donor_invitation_counter
  AFTER INSERT ON cascade_notifications
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_donor_invitation_counter();

-- ============================================================================
-- 2. decrement_30d_invitations()
--    Nightly cron job. The trigger above only ever increments the counter, so
--    invitations age out of the 30-day window silently. This function recomputes
--    every donor's invitations_last_30d as the actual count of their
--    cascade_notifications with notified_at > now() - interval '30 days'
--    (the spec's `count(*) ... where donor_id = ... and notified_at > now() -
--    interval '30 days'`), thereby decrementing invitations that have aged past
--    the window.
--
--    Implementation notes:
--      - A LEFT JOIN drives the recompute FROM blood_donors so that donors whose
--        recent count has dropped to zero are also reset (a plain INNER JOIN on
--        cascade_notifications would never touch them, leaving stale > 0 counts).
--      - The `IS DISTINCT FROM` guard writes only rows whose value actually
--        changed, keeping nightly WAL churn proportional to real change.
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
  'Nightly job. Recomputes blood_donors.invitations_last_30d per donor from the '
  'count of cascade_notifications with notified_at within the last 30 days, so '
  'invitations that age past the window are decremented. Only writes rows whose '
  'value actually changed. (Req 23.5; Design §v1.1.4; task 21.4)';

COMMIT;
