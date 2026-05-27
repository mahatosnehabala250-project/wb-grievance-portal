-- ============================================================================
-- Migration: 20260101_002_blood_donor_medical.sql
-- Spec     : sahayak-multi-agent-router
-- Purpose  : Create `blood_donors` table (if not present) with all fields from
--            the design ER diagram, then ensure medical-eligibility columns,
--            gender CHECK constraint, and partial lookup index exist.
--
-- Requirements:
--   8.1  : blood_donors SHALL gain date_of_birth, weight_kg, deferral_until,
--           deferral_reason, permanently_deferred, permanent_deferral_reason
--           (stored encrypted as permanent_deferral_reason_enc bytea),
--           last_donation_type, total_offers_accepted, donations_this_year.
--   18.4 : Schema migration extending blood_donors per Req 8.1.
--
-- Design refs: §Data Models — blood_donors ER, §SQL DDL.
--
-- Idempotency:
--   - CREATE TABLE uses IF NOT EXISTS.
--   - ADD COLUMN uses IF NOT EXISTS.
--   - CHECK constraints are dropped then re-added (Postgres lacks
--     ADD CONSTRAINT IF NOT EXISTS).
--   - CREATE INDEX uses IF NOT EXISTS.
-- ============================================================================

-- pgcrypto needed for permanent_deferral_reason_enc (pgp_sym_encrypt/decrypt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Step 1: Create blood_donors table if it does not exist.
-- All columns from the design ER diagram are included.
-- ============================================================================
CREATE TABLE IF NOT EXISTS blood_donors (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                         text NOT NULL,
  name                          text NOT NULL,
  gender                        text,
  date_of_birth                 date,
  weight_kg                     integer,
  blood_group                   text NOT NULL,
  district                      text NOT NULL,
  block                         text,
  last_donated_date             date,
  last_donation_type            text,
  next_eligible_date            date,
  deferral_until                date,
  deferral_reason               text,
  permanently_deferred          boolean NOT NULL DEFAULT false,
  permanent_deferral_reason_enc bytea,
  is_available                  boolean NOT NULL DEFAULT true,
  is_paused                     boolean NOT NULL DEFAULT false,
  total_donations               integer NOT NULL DEFAULT 0,
  total_offers_accepted         integer NOT NULL DEFAULT 0,
  donations_this_year           integer NOT NULL DEFAULT 0,
  auth_user_id                  uuid,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- Step 2: If the table already existed but is missing medical columns, add them.
-- Uses ADD COLUMN IF NOT EXISTS for safe re-runs.
-- ============================================================================
ALTER TABLE blood_donors
  ADD COLUMN IF NOT EXISTS date_of_birth                 date,
  ADD COLUMN IF NOT EXISTS weight_kg                     integer,
  ADD COLUMN IF NOT EXISTS deferral_until                date,
  ADD COLUMN IF NOT EXISTS deferral_reason               text,
  ADD COLUMN IF NOT EXISTS permanently_deferred          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS permanent_deferral_reason_enc bytea,
  ADD COLUMN IF NOT EXISTS last_donation_type            text,
  ADD COLUMN IF NOT EXISTS total_offers_accepted         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS donations_this_year           integer NOT NULL DEFAULT 0;

-- ============================================================================
-- Step 3: CHECK constraints
-- ============================================================================

-- 3a. weight_kg must be between 30 and 200 (or NULL)
ALTER TABLE blood_donors DROP CONSTRAINT IF EXISTS chk_donor_weight_kg;
ALTER TABLE blood_donors
  ADD CONSTRAINT chk_donor_weight_kg
  CHECK (weight_kg IS NULL OR (weight_kg >= 30 AND weight_kg <= 200));

-- 3b. last_donation_type must be one of the allowed enum values (or NULL)
ALTER TABLE blood_donors DROP CONSTRAINT IF EXISTS chk_donor_last_donation_type;
ALTER TABLE blood_donors
  ADD CONSTRAINT chk_donor_last_donation_type
  CHECK (last_donation_type IS NULL OR last_donation_type IN (
    'whole_blood', 'platelets', 'plasma', 'double_red'
  ));

-- 3c. Gender CHECK constraint on existing gender column
ALTER TABLE blood_donors DROP CONSTRAINT IF EXISTS chk_donor_gender;
ALTER TABLE blood_donors
  ADD CONSTRAINT chk_donor_gender
  CHECK (gender IS NULL OR gender IN ('male', 'female', 'other'));

-- ============================================================================
-- Step 4: Partial index for find_matching_donors RPC
-- Filters out unavailable and permanently-deferred donors at the index level.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_donors_lookup
  ON blood_donors (
    blood_group,
    district,
    block,
    next_eligible_date,
    is_paused,
    permanently_deferred
  )
  WHERE is_available = true AND permanently_deferred = false;

-- ============================================================================
-- Step 5: Auto-update updated_at trigger (idempotent)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_blood_donors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blood_donors_updated_at ON blood_donors;
CREATE TRIGGER trg_blood_donors_updated_at
  BEFORE UPDATE ON blood_donors
  FOR EACH ROW
  EXECUTE FUNCTION update_blood_donors_updated_at();
