-- ============================================================================
-- Migration: 20260101_008_rls_policies.sql
-- Spec:      sahayak-multi-agent-router (task 1.8)
-- Purpose:   Enable Row Level Security on new tables and define access policies.
--
-- Requirements covered:
--   18.13 : RLS policies for routing, invocation, donation, cascade, and
--           screening tables. Admin reads all; authenticated donors read own
--           rows in donation_history and screening_log.
--
-- Supabase conventions:
--   - service_role bypasses RLS by default — no explicit policies needed for
--     the n8n backend (which uses the service_role key for all inserts/updates).
--   - Authenticated donors access their own data via auth.uid() matched against
--     blood_donors.auth_user_id.
--   - Admin reads use auth.jwt() ->> 'role' = 'admin'.
--
-- Idempotency:
--   - ALTER TABLE ... ENABLE ROW LEVEL SECURITY is idempotent (no-op if
--     already enabled).
--   - Policies are dropped (IF EXISTS) before being re-created so re-runs
--     are safe.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Enable RLS on new tables
-- ============================================================================
ALTER TABLE routing_decisions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_invocations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE donation_history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cascade_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE screening_log         ENABLE ROW LEVEL SECURITY;

-- Also enable RLS on blood_donors and blood_requests (not covered by the
-- original supabase-migration.sql which only handled users, complaints, etc.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'blood_donors'
  ) THEN
    ALTER TABLE blood_donors ENABLE ROW LEVEL SECURITY;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'blood_requests'
  ) THEN
    ALTER TABLE blood_requests ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ============================================================================
-- 2. Admin read policies — admin role can SELECT all rows on all new tables
-- ============================================================================

-- routing_decisions
DROP POLICY IF EXISTS admin_read_routing ON routing_decisions;
CREATE POLICY admin_read_routing ON routing_decisions
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- agent_invocations
DROP POLICY IF EXISTS admin_read_invocations ON agent_invocations;
CREATE POLICY admin_read_invocations ON agent_invocations
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- donation_history
DROP POLICY IF EXISTS admin_read_history ON donation_history;
CREATE POLICY admin_read_history ON donation_history
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- cascade_notifications
DROP POLICY IF EXISTS admin_read_cascade ON cascade_notifications;
CREATE POLICY admin_read_cascade ON cascade_notifications
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- screening_log
DROP POLICY IF EXISTS admin_read_screening ON screening_log;
CREATE POLICY admin_read_screening ON screening_log
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- blood_donors (admin can read all donor records)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'blood_donors'
  ) THEN
    DROP POLICY IF EXISTS admin_read_donors ON blood_donors;
    CREATE POLICY admin_read_donors ON blood_donors
      FOR SELECT TO authenticated
      USING (auth.jwt() ->> 'role' = 'admin');
  END IF;
END $$;

-- blood_requests (admin can read all blood requests)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'blood_requests'
  ) THEN
    DROP POLICY IF EXISTS admin_read_blood_requests ON blood_requests;
    CREATE POLICY admin_read_blood_requests ON blood_requests
      FOR SELECT TO authenticated
      USING (auth.jwt() ->> 'role' = 'admin');
  END IF;
END $$;

-- ============================================================================
-- 3. Donor self-service policies — authenticated donors can read their own rows
--    Donor identity is resolved via: blood_donors.auth_user_id = auth.uid()
-- ============================================================================

-- donation_history: donor can read own donation records
DROP POLICY IF EXISTS donor_read_own_history ON donation_history;
CREATE POLICY donor_read_own_history ON donation_history
  FOR SELECT TO authenticated
  USING (
    donor_id = (
      SELECT id FROM blood_donors
       WHERE auth_user_id = auth.uid()
       LIMIT 1
    )
  );

-- screening_log: donor can read own screening records
DROP POLICY IF EXISTS donor_read_own_screening ON screening_log;
CREATE POLICY donor_read_own_screening ON screening_log
  FOR SELECT TO authenticated
  USING (
    donor_id = (
      SELECT id FROM blood_donors
       WHERE auth_user_id = auth.uid()
       LIMIT 1
    )
  );

-- blood_donors: donor can read their own profile
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'blood_donors'
  ) THEN
    DROP POLICY IF EXISTS donor_read_own_profile ON blood_donors;
    CREATE POLICY donor_read_own_profile ON blood_donors
      FOR SELECT TO authenticated
      USING (auth_user_id = auth.uid());
  END IF;
END $$;

-- ============================================================================
-- 4. Note on service_role access
--    In Supabase, the service_role key bypasses RLS entirely. The n8n backend
--    uses service_role for all INSERT/UPDATE operations on logging tables
--    (routing_decisions, agent_invocations, cascade_notifications, screening_log,
--    donation_history). No explicit policies are needed for these operations.
-- ============================================================================

COMMIT;
