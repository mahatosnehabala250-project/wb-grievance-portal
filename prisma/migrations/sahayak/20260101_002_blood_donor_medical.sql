-- ============================================================================
-- Migration: 20260101_002_blood_donor_medical.sql
-- Spec     : sahayak-multi-agent-router
-- Purpose  : Extend `blood_donors` with medical-eligibility columns required
--            by the Rakta Sahayak (JS-15) cooldown / screening / cascade
--            pipeline, plus a gender CHECK constraint and a partial index
--            optimised for `find_matching_donors` lookups.
--
-- Requirements:
--   - 8.1  : `blood_donors` SHALL gain date_of_birth, weight_kg, deferral_until,
--            deferral_reason, permanently_deferred, permanent_deferral_reason
--            (stored encrypted as `permanent_deferral_reason_enc`),
--            last_donation_type, total_offers_accepted, donations_this_year.
--   - 18.4 : Schema migration that extends `blood_donors` per Req 8.1.
--
-- Design refs : §Data Models — `blood_donors`, §SQL DDL.
--
-- Idempotency :
--   - All ADD COLUMN clauses use `IF NOT EXISTS`.
--   - The `chk_donor_gender` constraint is dropped (if present) and re-added,
--     because PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS` form.
--   - The partial index uses `CREATE INDEX IF NOT EXISTS`.
--
-- Pre-requisite :
--   The `blood_donors` table is owned by JS-15 Rakta Sahayak, which is a
--   sibling spec and is NOT defined in this repository's current Prisma
--   schema. The whole body is therefore wrapped in an existence guard so
--   this file is safe to run against any environment: it applies the
--   medical-eligibility extension when the table is present and emits a
--   NOTICE no-op when it isn't.
-- ============================================================================

-- pgcrypto is required because `permanent_deferral_reason_enc` is written
-- through `pgp_sym_encrypt(...)` and read through `pgp_sym_decrypt(...)` by
-- the donor-portal API layer (see Req 8 §Medical Compliance).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   information_schema.tables
    WHERE  table_schema = 'public'
      AND  table_name   = 'blood_donors'
  ) THEN
    RAISE NOTICE
      'blood_donors table not found — skip (provided by JS-15 Rakta Sahayak; '
      'this migration is a no-op until that schema is deployed).';
    RETURN;
  END IF;

  -- --------------------------------------------------------------------------
  -- 1. Medical-eligibility columns (Req 8.1)
  -- --------------------------------------------------------------------------
  EXECUTE $ddl$
    ALTER TABLE blood_donors
      ADD COLUMN IF NOT EXISTS date_of_birth                 date,
      ADD COLUMN IF NOT EXISTS weight_kg                     integer
        CHECK (weight_kg IS NULL OR weight_kg BETWEEN 30 AND 200),
      ADD COLUMN IF NOT EXISTS deferral_until                date,
      ADD COLUMN IF NOT EXISTS deferral_reason               text,
      ADD COLUMN IF NOT EXISTS permanently_deferred          boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS permanent_deferral_reason_enc bytea,
      ADD COLUMN IF NOT EXISTS last_donation_type            text
        CHECK (last_donation_type IN ('whole_blood','platelets','plasma','double_red')),
      ADD COLUMN IF NOT EXISTS total_offers_accepted         integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS donations_this_year           integer NOT NULL DEFAULT 0
  $ddl$;

  -- --------------------------------------------------------------------------
  -- 2. Gender CHECK constraint on the pre-existing `gender` column.
  --    Drop-then-add for idempotency (Postgres lacks ADD CONSTRAINT IF NOT EXISTS).
  -- --------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'blood_donors'
      AND  column_name  = 'gender'
  ) THEN
    EXECUTE 'ALTER TABLE blood_donors DROP CONSTRAINT IF EXISTS chk_donor_gender';
    -- NULL gender values are implicitly allowed by SQL CHECK semantics
    -- (NULL → UNKNOWN, which never fails the constraint).
    EXECUTE $chk$
      ALTER TABLE blood_donors
        ADD CONSTRAINT chk_donor_gender
        CHECK (gender IN ('male','female','other'))
    $chk$;
  ELSE
    RAISE NOTICE
      'blood_donors.gender column not found — chk_donor_gender constraint skipped.';
  END IF;

  -- --------------------------------------------------------------------------
  -- 3. Partial lookup index for `find_matching_donors` RPC (Req 8.5, design
  --    §Data Models). Filters out paused / permanently-deferred donors at
  --    the index level, keeping the planner on an index scan even at scale.
  -- --------------------------------------------------------------------------
  EXECUTE $idx$
    CREATE INDEX IF NOT EXISTS idx_donors_lookup
      ON blood_donors (
        blood_group,
        district,
        block,
        next_eligible_date,
        is_paused,
        permanently_deferred
      )
      WHERE is_available = true AND permanently_deferred = false
  $idx$;

  RAISE NOTICE 'blood_donors medical-eligibility migration applied.';
END
$migration$;
