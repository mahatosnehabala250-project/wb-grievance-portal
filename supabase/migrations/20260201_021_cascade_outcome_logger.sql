-- ============================================================================
-- Migration: 20260201_021_cascade_outcome_logger.sql
-- Spec:      sahayak-multi-agent-router (task 21.5) — Cascade Outcome Logger
-- Purpose:   Add the canonical bandit-training columns to `cascade_outcomes`
--            required by the Outcome Logger (POST /api/cascade/log-outcome),
--            the Policy Resolver cold-start count (task 21.1), and the nightly
--            Bandit Trainer (task 21.6).
--
-- Why this migration exists:
--   The v1.1 batch migration 20260201_002_adaptive_cascade.sql created
--   `cascade_outcomes` with an earlier column set
--   (policy_id, tier_reached, time_to_fulfill_minutes, donors_notified,
--    donors_accepted, success). Requirement 18.5 / 23.4 and design §v1.1.4
--   specify the bandit feature/outcome shape:
--     (district, blood_group, urgency, hour_of_day, day_of_week, tier_size,
--      wait_minutes, time_to_first_accept_minutes, total_accepted, total_invited)
--   This migration adds the missing canonical columns ADDITIVELY so both the
--   legacy and the canonical consumers keep working (zero-downtime).
--
-- Requirements covered:
--   18.5  cascade_outcomes canonical bandit-training columns
--   23.4  Outcome features (district, blood_group, urgency, hour_of_day,
--         day_of_week) + action (tier_size, wait_minutes) + reward inputs
--         (time_to_first_accept_minutes, total_accepted, total_invited)
--
-- Design sections: §v1.1.4 Adaptive Donor Cascade, §Data Models
--
-- Idempotency: all DDL is guarded by ADD COLUMN IF NOT EXISTS / IF NOT EXISTS.
--              Safe to re-run without error. Additive only — no data loss.
-- DISTINCT filename: uses sequence _021 (ties to task 21) to avoid colliding
--                    with concurrently-authored cascade migrations (21.1/21.2).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Canonical bandit-training feature + outcome columns (Req 18.5, 23.4)
--    All nullable so existing rows (if any) and partial logs remain valid.
-- ----------------------------------------------------------------------------

-- Context features (the bandit "arm" key) ----------------------------------
ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS district text;

ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS blood_group text;

ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS hour_of_day int;

ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS day_of_week int;

-- Action taken (tier size + wait used for the resolved policy) --------------
ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS tier_size int;

ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS wait_minutes int;

-- Observed reward inputs -----------------------------------------------------
ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS time_to_first_accept_minutes int;

ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS total_accepted int;

ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS total_invited int;

-- ----------------------------------------------------------------------------
-- 2. Value-range CHECK constraints (guarded — only added once)
--    hour_of_day in [0,23]; day_of_week in [0,6] (Postgres DOW: 0=Sunday).
--    Non-negative counts. NULLs always allowed (partial / legacy rows).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_cascade_outcomes_hour_of_day'
  ) THEN
    ALTER TABLE cascade_outcomes
      ADD CONSTRAINT chk_cascade_outcomes_hour_of_day
      CHECK (hour_of_day IS NULL OR (hour_of_day >= 0 AND hour_of_day <= 23));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_cascade_outcomes_day_of_week'
  ) THEN
    ALTER TABLE cascade_outcomes
      ADD CONSTRAINT chk_cascade_outcomes_day_of_week
      CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_cascade_outcomes_nonneg'
  ) THEN
    ALTER TABLE cascade_outcomes
      ADD CONSTRAINT chk_cascade_outcomes_nonneg
      CHECK (
        (tier_size IS NULL OR tier_size >= 0)
        AND (wait_minutes IS NULL OR wait_minutes >= 0)
        AND (time_to_first_accept_minutes IS NULL OR time_to_first_accept_minutes >= 0)
        AND (total_accepted IS NULL OR total_accepted >= 0)
        AND (total_invited IS NULL OR total_invited >= 0)
      );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Index supporting the Policy Resolver cold-start count (task 21.1)
--    SELECT count(*) FROM cascade_outcomes
--      WHERE urgency = $1 AND district = $2 AND blood_group = $3
--        AND hour_of_day / 4 = $4
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cascade_outcomes_features
  ON cascade_outcomes (urgency, district, blood_group, hour_of_day);

COMMIT;
