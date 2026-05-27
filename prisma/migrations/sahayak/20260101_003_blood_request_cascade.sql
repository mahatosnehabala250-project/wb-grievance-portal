-- =============================================================================
-- Migration: 20260101_003_blood_request_cascade.sql
-- Spec:     sahayak-multi-agent-router
-- Task:     1.3 — extend blood_requests and blood_donor_responses for the
--                 4-tier donor cascade engine (JS-15B).
--
-- Requirements: 5.7, 6.1, 6.7, 18.8, 18.9
--   - 5.7  Cascade tier tracking on blood_requests
--   - 6.1  Race-safe donor acceptance (donors_confirmed_count <= units_needed)
--   - 6.7  Standby vs accepted vs declined response_status enum
--   - 18.8 CHECK constraint chk_confirmed_le_needed (DB-enforced invariant)
--   - 18.9 response_status enum with CHECK constraint
-- Design refs: §Data Models, §Notable Invariants, §SQL DDL
--
-- Idempotency:
--   - Columns added with ADD COLUMN IF NOT EXISTS.
--   - Constraints recreated via DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT
--     (PostgreSQL does not support ADD CONSTRAINT IF NOT EXISTS for CHECK).
--   - Indexes created with CREATE INDEX IF NOT EXISTS.
--   - Table-existence guards (DO $$ ... IF EXISTS ... END $$) so this file
--     can be re-run safely even if blood_requests / blood_donor_responses
--     have not yet been created by JS-15 v1.
--
-- !! CRITICAL INVARIANT !!
--   chk_confirmed_le_needed (donors_confirmed_count <= units_needed) is the
--   last-line-of-defence guarantee against over-acceptance in the donor
--   cascade. It must hold under BOTH:
--     v1   — pg_advisory_xact_lock + SELECT ... FOR UPDATE serialization
--     v1.1 — single optimistic conditional UPDATE (no advisory lock)
--   If a race ever slips past the application layer, this CHECK rejects the
--   offending UPDATE and Property 3 (race-safe acceptance) holds.
-- =============================================================================

-- ============ blood_requests: cascade + urgency columns ======================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'blood_requests'
  ) THEN
    -- Additive columns (idempotent).
    ALTER TABLE blood_requests
      ADD COLUMN IF NOT EXISTS cascade_tier           integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS donors_confirmed_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS donors_standby_count   integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS urgency                text    NOT NULL DEFAULT 'routine';

    -- Urgency value enum (named constraint so we can rebuild it idempotently).
    ALTER TABLE blood_requests
      DROP CONSTRAINT IF EXISTS chk_blood_requests_urgency;
    ALTER TABLE blood_requests
      ADD CONSTRAINT chk_blood_requests_urgency
      CHECK (urgency IN ('critical', 'urgent', 'routine'));

    -- !!! Race-safe acceptance invariant — DO NOT REMOVE !!!
    -- Last-line-of-defence for both v1 (advisory lock) and v1.1 (optimistic
    -- conditional UPDATE) cascade-acceptance paths. See header note.
    ALTER TABLE blood_requests
      DROP CONSTRAINT IF EXISTS chk_confirmed_le_needed;
    ALTER TABLE blood_requests
      ADD CONSTRAINT chk_confirmed_le_needed
      CHECK (donors_confirmed_count <= units_needed);
  END IF;
END $$;

-- ============ blood_donor_responses: response_status enum ===================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'blood_donor_responses'
  ) THEN
    -- Additive column. Left nullable so existing rows do not violate the
    -- enum until back-filled; new cascade rows always insert with
    -- response_status = 'pending' (see JS-15B / donor-respond endpoint).
    ALTER TABLE blood_donor_responses
      ADD COLUMN IF NOT EXISTS response_status text;

    -- Enum CHECK (named, idempotent). NULL is permitted by SQL CHECK semantics
    -- (UNKNOWN does not violate), so legacy rows pre-back-fill stay valid.
    ALTER TABLE blood_donor_responses
      DROP CONSTRAINT IF EXISTS chk_blood_donor_responses_status;
    ALTER TABLE blood_donor_responses
      ADD CONSTRAINT chk_blood_donor_responses_status
      CHECK (
        response_status IS NULL
        OR response_status IN ('pending', 'accepted', 'standby', 'declined', 'expired', 'donated')
      );

    -- Hot path index: donor-respond endpoint and cascade engine both filter
    -- by (blood_request_id, response_status) when reconciling tiers.
    CREATE INDEX IF NOT EXISTS idx_responses_request_status
      ON blood_donor_responses (blood_request_id, response_status);
  END IF;
END $$;
