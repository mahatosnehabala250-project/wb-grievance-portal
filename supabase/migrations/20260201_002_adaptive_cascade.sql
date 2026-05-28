-- ============================================================================
-- Migration: 20260201_002_adaptive_cascade.sql
-- Spec:      sahayak-multi-agent-router (task 17.2) — v1.1 batch
-- Purpose:   Adaptive contextual-bandit cascade tables for the Donor Cascade
--            Engine: policies, outcomes, audit trail, and donor fairness columns.
--
-- Requirements covered:
--   34.5  cascade_outcomes table (bandit training data)
--   34.6  cascade_policies table (tier sizes, wait times, Thompson sampling)
--   34.7  cascade_policy_audit table (change audit trail)
--   34.8  blood_donors.last_invited_at, invitations_last_30d (fairness)
--   23.1  Cascade engine reads from cascade_policies
--   23.2  Default rows match v1 Req 5 schedule
--   23.5  Donor fairness columns for anti-burnout penalty
--
-- Design sections: §v1.1.4, §Adaptive Cascade, §Bandit Math
--
-- Idempotency: all DDL is guarded by IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
--              Safe to re-run without error.
-- ============================================================================

BEGIN;

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. cascade_policies table
--    Stores per-(urgency, hour_bucket, district, blood_group) tier configuration.
--    Thompson sampling posteriors (alpha, beta) live here for the bandit trainer.
--    UNIQUE constraint ensures one active policy per feature combination.
-- ============================================================================
CREATE TABLE IF NOT EXISTS cascade_policies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  urgency         text NOT NULL,
  hour_bucket     int NOT NULL CHECK (hour_bucket >= 0 AND hour_bucket <= 23),
  district        text,
  blood_group     text,
  tier_1_count    int NOT NULL DEFAULT 3,
  tier_2_count    int NOT NULL DEFAULT 5,
  tier_3_count    int NOT NULL DEFAULT 10,
  wait_1_minutes  int NOT NULL DEFAULT 30,
  wait_2_minutes  int NOT NULL DEFAULT 60,
  wait_3_minutes  int NOT NULL DEFAULT 360,
  alpha           float NOT NULL DEFAULT 1.0,
  beta            float NOT NULL DEFAULT 1.0,
  source          text NOT NULL DEFAULT 'default' CHECK (source IN ('default', 'bandit', 'manual')),
  weight          numeric NOT NULL DEFAULT 1.0,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

-- Unique constraint for policy resolution (most-specific-first lookup)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_cascade_policies_scope'
  ) THEN
    ALTER TABLE cascade_policies
      ADD CONSTRAINT uq_cascade_policies_scope
      UNIQUE (urgency, hour_bucket, district, blood_group);
  END IF;
END $$;

-- Add wait_3_minutes if table already existed without it
ALTER TABLE cascade_policies
  ADD COLUMN IF NOT EXISTS wait_3_minutes int NOT NULL DEFAULT 360;

-- ============================================================================
-- 2. cascade_outcomes table
--    Bandit training data — one row per completed cascade, recording the
--    context features and observed outcome for the nightly trainer.
-- ============================================================================
CREATE TABLE IF NOT EXISTS cascade_outcomes (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id                   uuid REFERENCES cascade_policies(id),
  blood_request_id            uuid REFERENCES blood_requests(id),
  urgency                     text,
  tier_reached                int,
  time_to_fulfill_minutes     int,
  donors_notified             int,
  donors_accepted             int,
  success                     boolean,
  created_at                  timestamptz NOT NULL DEFAULT NOW()
);

-- Add policy_id if table already existed without it
ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS policy_id uuid REFERENCES cascade_policies(id);

-- Add tier_reached if table already existed without it
ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS tier_reached int;

-- ============================================================================
-- 3. cascade_policy_audit table
--    Immutable audit trail for every policy change (created, updated by bandit,
--    manually overridden by admin).
-- ============================================================================
CREATE TABLE IF NOT EXISTS cascade_policy_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id   uuid REFERENCES cascade_policies(id),
  action      text NOT NULL CHECK (action IN ('created', 'updated', 'manual_override')),
  old_values  jsonb,
  new_values  jsonb,
  actor       text,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. blood_donors — fairness columns for anti-burnout penalty (Req 23.5, 34.8)
-- ============================================================================
ALTER TABLE blood_donors
  ADD COLUMN IF NOT EXISTS last_invited_at timestamptz;

ALTER TABLE blood_donors
  ADD COLUMN IF NOT EXISTS invitations_last_30d int NOT NULL DEFAULT 0;

-- ============================================================================
-- 5. Indexes for efficient lookups
-- ============================================================================

-- Policy resolution: lookup by urgency + district + blood_group
CREATE INDEX IF NOT EXISTS idx_cascade_policies_lookup
  ON cascade_policies (urgency, hour_bucket, district, blood_group);

-- Outcome queries: by policy_id (for bandit trainer aggregation)
CREATE INDEX IF NOT EXISTS idx_cascade_outcomes_policy
  ON cascade_outcomes (policy_id);

-- Outcome queries: by blood_request_id (for per-request outcome retrieval)
CREATE INDEX IF NOT EXISTS idx_cascade_outcomes_request
  ON cascade_outcomes (blood_request_id);

-- Audit trail: by policy_id for history retrieval
CREATE INDEX IF NOT EXISTS idx_cascade_policy_audit_policy
  ON cascade_policy_audit (policy_id);

-- Donor fairness: last_invited_at for recency penalty calculation
CREATE INDEX IF NOT EXISTS idx_blood_donors_last_invited
  ON blood_donors (last_invited_at)
  WHERE last_invited_at IS NOT NULL;

-- ============================================================================
-- 6. Seed cascade_policies with default rows matching v1 Req 5 schedule
--    Urgency schedules from Requirement 5:
--      routine:  Tier 1 (top 3) immediately; Tier 2 (next 5) after 30 min;
--                Tier 3 (next 10) after 2 hours; wait_3 = 6 hours
--      urgent:   Tier 1 (top 5) immediately; Tier 2 (next 10) after 15 min;
--                Tier 3 (next 20) after 1 hour; wait_3 = not used (2 tiers)
--      critical: All matching donors simultaneously (large tiers, no wait)
--
--    6 hour_buckets per urgency (0, 4, 8, 12, 16, 20)
--    district=NULL, blood_group=NULL → universal fallback rows
-- ============================================================================

-- Routine urgency — 6 hour buckets
INSERT INTO cascade_policies (urgency, hour_bucket, district, blood_group, tier_1_count, tier_2_count, tier_3_count, wait_1_minutes, wait_2_minutes, wait_3_minutes, source)
VALUES
  ('routine', 0,  NULL, NULL, 3, 5, 10, 30, 120, 360, 'default'),
  ('routine', 4,  NULL, NULL, 3, 5, 10, 30, 120, 360, 'default'),
  ('routine', 8,  NULL, NULL, 3, 5, 10, 30, 120, 360, 'default'),
  ('routine', 12, NULL, NULL, 3, 5, 10, 30, 120, 360, 'default'),
  ('routine', 16, NULL, NULL, 3, 5, 10, 30, 120, 360, 'default'),
  ('routine', 20, NULL, NULL, 3, 5, 10, 30, 120, 360, 'default')
ON CONFLICT (urgency, hour_bucket, district, blood_group) DO NOTHING;

-- Urgent urgency — 6 hour buckets
INSERT INTO cascade_policies (urgency, hour_bucket, district, blood_group, tier_1_count, tier_2_count, tier_3_count, wait_1_minutes, wait_2_minutes, wait_3_minutes, source)
VALUES
  ('urgent', 0,  NULL, NULL, 5, 10, 20, 15, 60, 120, 'default'),
  ('urgent', 4,  NULL, NULL, 5, 10, 20, 15, 60, 120, 'default'),
  ('urgent', 8,  NULL, NULL, 5, 10, 20, 15, 60, 120, 'default'),
  ('urgent', 12, NULL, NULL, 5, 10, 20, 15, 60, 120, 'default'),
  ('urgent', 16, NULL, NULL, 5, 10, 20, 15, 60, 120, 'default'),
  ('urgent', 20, NULL, NULL, 5, 10, 20, 15, 60, 120, 'default')
ON CONFLICT (urgency, hour_bucket, district, blood_group) DO NOTHING;

-- Critical urgency — 6 hour buckets (all donors simultaneously, minimal waits)
INSERT INTO cascade_policies (urgency, hour_bucket, district, blood_group, tier_1_count, tier_2_count, tier_3_count, wait_1_minutes, wait_2_minutes, wait_3_minutes, source)
VALUES
  ('critical', 0,  NULL, NULL, 50, 50, 50, 0, 30, 60, 'default'),
  ('critical', 4,  NULL, NULL, 50, 50, 50, 0, 30, 60, 'default'),
  ('critical', 8,  NULL, NULL, 50, 50, 50, 0, 30, 60, 'default'),
  ('critical', 12, NULL, NULL, 50, 50, 50, 0, 30, 60, 'default'),
  ('critical', 16, NULL, NULL, 50, 50, 50, 0, 30, 60, 'default'),
  ('critical', 20, NULL, NULL, 50, 50, 50, 0, 30, 60, 'default')
ON CONFLICT (urgency, hour_bucket, district, blood_group) DO NOTHING;

-- ============================================================================
-- 7. RLS policies (Req 34.15)
--    Service role: full access for cascade engine and bandit trainer.
--    Admin role: read access for dashboard.
--    Authenticated (donor): no direct access to policy/outcome tables.
-- ============================================================================

ALTER TABLE cascade_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE cascade_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cascade_policy_audit ENABLE ROW LEVEL SECURITY;

-- cascade_policies RLS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cascade_policies' AND policyname = 'cascade_policies_service_all'
  ) THEN
    CREATE POLICY cascade_policies_service_all ON cascade_policies
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cascade_policies' AND policyname = 'cascade_policies_admin_read'
  ) THEN
    CREATE POLICY cascade_policies_admin_read ON cascade_policies
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM auth.users
          WHERE auth.users.id = auth.uid()
          AND auth.users.raw_user_meta_data->>'role' = 'admin'
        )
      );
  END IF;
END $$;

-- cascade_outcomes RLS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cascade_outcomes' AND policyname = 'cascade_outcomes_service_all'
  ) THEN
    CREATE POLICY cascade_outcomes_service_all ON cascade_outcomes
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cascade_outcomes' AND policyname = 'cascade_outcomes_admin_read'
  ) THEN
    CREATE POLICY cascade_outcomes_admin_read ON cascade_outcomes
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM auth.users
          WHERE auth.users.id = auth.uid()
          AND auth.users.raw_user_meta_data->>'role' = 'admin'
        )
      );
  END IF;
END $$;

-- cascade_policy_audit RLS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cascade_policy_audit' AND policyname = 'cascade_policy_audit_service_all'
  ) THEN
    CREATE POLICY cascade_policy_audit_service_all ON cascade_policy_audit
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cascade_policy_audit' AND policyname = 'cascade_policy_audit_admin_read'
  ) THEN
    CREATE POLICY cascade_policy_audit_admin_read ON cascade_policy_audit
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM auth.users
          WHERE auth.users.id = auth.uid()
          AND auth.users.raw_user_meta_data->>'role' = 'admin'
        )
      );
  END IF;
END $$;

COMMIT;
