-- ============================================================================
-- Migration: 20260101_006_eligibility_function_and_trigger.sql
-- Spec     : sahayak-multi-agent-router
-- Purpose  : Create the `calculate_next_eligible_date` function, the
--            `trg_update_donor_after_donation` trigger on `donation_history`,
--            and the `reset_yearly_donations()` helper for annual cron reset.
--
-- Requirements:
--   8.3  : calculate_next_eligible_date(donor_id, donation_type, donated_date)
--           SHALL compute cooldowns: whole_blood Male=90d, Female=120d,
--           platelets=14d, plasma=14d, double_red=168d.
--   8.4  : trg_update_donor_after_donation SHALL fire AFTER INSERT on
--           donation_history, updating blood_donors.last_donated_date,
--           next_eligible_date, last_donation_type, total_donations, and
--           donations_this_year.
--   8.6  : Yearly donation caps enforced; reset_yearly_donations() zeroes
--           donations_this_year for all donors (called by annual cron).
--   18.10: calculate_next_eligible_date function SHALL exist per Req 8.3.
--   18.11: trg_update_donor_after_donation trigger SHALL exist per Req 8.4.
--
-- Design references:
--   - design.md §SQL DDL → calculate_next_eligible_date function
--   - design.md §SQL DDL → trg_update_donor_after_donation trigger
--   - design.md §Property 2 (cooldown correctness)
--   - design.md §Property 10 (donation trigger atomicity)
--   - design.md §Property 11 (yearly cap enforcement)
--   - ADR-005: Trigger-based donor update on donation insert
--   - ADR-006: Immutable donation_history with gender-based cooldown
--
-- Idempotency:
--   - Functions use CREATE OR REPLACE.
--   - Trigger uses DROP IF EXISTS + CREATE.
--   - All statements are safe to re-run.
-- ============================================================================

-- ============================================================================
-- Step 1: calculate_next_eligible_date function
-- ============================================================================
-- Computes the next eligible donation date based on the donor's gender
-- (looked up from blood_donors) and the donation type.
--
-- Cooldown rules (per NACO/NBTC guidelines + WHO recommendations):
--   whole_blood + male   → +90 days
--   whole_blood + female → +120 days
--   whole_blood + other  → +90 days (conservative default)
--   platelets            → +14 days
--   plasma               → +14 days
--   double_red           → +168 days (24 weeks)
--
-- Note: The function is marked STABLE (not IMMUTABLE) because it performs
-- a SELECT on blood_donors to look up gender. IMMUTABLE would be incorrect
-- since the result depends on mutable table data.
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_next_eligible_date(
  p_donor_id       uuid,
  p_donation_type  text,
  p_donated_date   date
) RETURNS date
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_gender text;
  v_days   integer;
BEGIN
  -- Look up the donor's gender from blood_donors
  SELECT gender INTO v_gender FROM blood_donors WHERE id = p_donor_id;

  -- Determine cooldown days based on donation type and gender
  v_days := CASE
    WHEN p_donation_type = 'whole_blood' AND v_gender = 'male'   THEN 90
    WHEN p_donation_type = 'whole_blood' AND v_gender = 'female' THEN 120
    WHEN p_donation_type = 'whole_blood'                          THEN 90   -- 'other' or NULL gender: conservative default
    WHEN p_donation_type = 'platelets'                            THEN 14
    WHEN p_donation_type = 'plasma'                               THEN 14
    WHEN p_donation_type = 'double_red'                           THEN 168
    ELSE 90  -- safe fallback for unknown donation types
  END;

  RETURN p_donated_date + v_days;
END;
$$;

COMMENT ON FUNCTION calculate_next_eligible_date(uuid, text, date) IS
  'Computes the next eligible donation date for a donor based on gender '
  '(looked up from blood_donors) and donation type. Cooldowns: '
  'whole_blood male=90d, female=120d; platelets=14d; plasma=14d; '
  'double_red=168d. (Req 8.3, 18.10; ADR-006)';

-- ============================================================================
-- Step 2: trg_fn_update_donor_after_donation trigger function
-- ============================================================================
-- Fires AFTER INSERT on donation_history. Updates the blood_donors row for
-- the donor with:
--   - last_donated_date    = the donated_date from the new history row
--   - last_donation_type   = the donation_type from the new history row
--   - next_eligible_date   = calculated via calculate_next_eligible_date()
--   - total_donations     += 1
--   - donations_this_year += 1 (only if donated_date is in the current year)
--   - updated_at           = NOW()
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_fn_update_donor_after_donation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_year_donated integer;
  v_year_now     integer;
  v_next_eligible date;
BEGIN
  -- Calculate the next eligible date using the cooldown function
  v_next_eligible := calculate_next_eligible_date(NEW.donor_id, NEW.donation_type, NEW.donated_date);

  -- Determine if the donation is in the current calendar year
  v_year_donated := EXTRACT(YEAR FROM NEW.donated_date)::int;
  v_year_now     := EXTRACT(YEAR FROM CURRENT_DATE)::int;

  -- Update the donor's record atomically
  UPDATE blood_donors
  SET last_donated_date    = NEW.donated_date,
      last_donation_type   = NEW.donation_type,
      next_eligible_date   = v_next_eligible,
      total_donations      = total_donations + 1,
      donations_this_year  = CASE
        WHEN v_year_donated = v_year_now THEN donations_this_year + 1
        ELSE donations_this_year
      END,
      updated_at           = NOW()
  WHERE id = NEW.donor_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_fn_update_donor_after_donation() IS
  'Trigger function for trg_update_donor_after_donation. Updates '
  'blood_donors with last_donated_date, last_donation_type, '
  'next_eligible_date, total_donations, and donations_this_year '
  '(incremented only if same calendar year). (Req 8.4, 18.11; ADR-005)';

-- Attach the trigger to donation_history (idempotent: drop first)
DROP TRIGGER IF EXISTS trg_update_donor_after_donation ON donation_history;
CREATE TRIGGER trg_update_donor_after_donation
  AFTER INSERT ON donation_history
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_update_donor_after_donation();

-- ============================================================================
-- Step 3: reset_yearly_donations() helper
-- ============================================================================
-- Called by an annual cron job (Supabase scheduled function or Vercel cron)
-- on January 1 to reset the donations_this_year counter for all donors.
--
-- Only updates rows where donations_this_year > 0 to minimize WAL writes
-- and avoid unnecessary trigger firings on the updated_at column.
-- ============================================================================
CREATE OR REPLACE FUNCTION reset_yearly_donations()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE blood_donors
  SET donations_this_year = 0,
      updated_at          = NOW()
  WHERE donations_this_year > 0;
END;
$$;

COMMENT ON FUNCTION reset_yearly_donations() IS
  'Resets donations_this_year to 0 for all donors. Called by annual cron '
  'on Jan 1 (Supabase scheduled function or Vercel cron job). Only touches '
  'rows where donations_this_year > 0 for efficiency. (Req 8.6)';
