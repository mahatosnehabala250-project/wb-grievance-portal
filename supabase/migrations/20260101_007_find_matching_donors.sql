-- ============================================================================
-- Migration: 20260101_007_find_matching_donors.sql
-- Spec     : sahayak-multi-agent-router
-- Purpose  : Create the `get_compatible_blood_groups` helper and the
--            `find_matching_donors` RPC function that returns eligible,
--            ABO/Rh-compatible donors for a blood request, applying all
--            medical eligibility filters and yearly donation cap exclusions.
--
-- Requirements:
--   8.5  : find_matching_donors SHALL filter by eligibility (next_eligible_date,
--           permanently_deferred, deferral_until, age 18–65, weight >= 45 kg,
--           is_paused, is_available) AND ABO/Rh compatibility.
--   8.6  : Yearly donation caps (whole_blood male=4/yr, female=3/yr,
--           platelets=24/yr) SHALL exclude capped donors from matching.
--   18.12: find_matching_donors RPC SHALL exist per Req 8.5 and 8.6.
--
-- Design references:
--   - design.md §Property 9 (find_matching_donors eligibility and compatibility)
--   - design.md §Property 11 (yearly cap enforcement)
--   - MEDICAL_RULES.md ABO/Rh compatibility matrix
--
-- Idempotency:
--   - Functions use CREATE OR REPLACE.
--   - All statements are safe to re-run.
-- ============================================================================

-- ============================================================================
-- Step 1: get_compatible_blood_groups helper
-- ============================================================================
-- Returns an array of donor blood groups that can donate TO the requested
-- (recipient) blood group, based on standard ABO/Rh compatibility rules.
--
-- Compatibility matrix (recipient ← compatible donors):
--   AB+ ← O-, O+, A-, A+, B-, B+, AB-, AB+ (universal recipient)
--   AB- ← O-, A-, B-, AB-
--   A+  ← O-, O+, A-, A+
--   A-  ← O-, A-
--   B+  ← O-, O+, B-, B+
--   B-  ← O-, B-
--   O+  ← O-, O+
--   O-  ← O-
-- ============================================================================
CREATE OR REPLACE FUNCTION get_compatible_blood_groups(p_requested_group text)
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_requested_group
    WHEN 'AB+' THEN ARRAY['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+']
    WHEN 'AB-' THEN ARRAY['O-', 'A-', 'B-', 'AB-']
    WHEN 'A+'  THEN ARRAY['O-', 'O+', 'A-', 'A+']
    WHEN 'A-'  THEN ARRAY['O-', 'A-']
    WHEN 'B+'  THEN ARRAY['O-', 'O+', 'B-', 'B+']
    WHEN 'B-'  THEN ARRAY['O-', 'B-']
    WHEN 'O+'  THEN ARRAY['O-', 'O+']
    WHEN 'O-'  THEN ARRAY['O-']
    ELSE ARRAY[]::text[]  -- unknown group returns empty (no match)
  END;
END;
$$;

COMMENT ON FUNCTION get_compatible_blood_groups(text) IS
  'Returns an array of donor blood groups that can donate TO the requested '
  '(recipient) blood group per standard ABO/Rh compatibility. '
  'AB+ is universal recipient; O- is universal donor. (Req 8.5, 18.12)';

-- ============================================================================
-- Step 2: find_matching_donors RPC
-- ============================================================================
-- Returns eligible, compatible donors for a blood request, applying:
--   1. ABO/Rh compatibility (via get_compatible_blood_groups)
--   2. District match
--   3. Eligibility filters:
--      - next_eligible_date <= CURRENT_DATE (or NULL)
--      - permanently_deferred = false
--      - deferral_until <= CURRENT_DATE (or NULL)
--      - Age between 18 and 65 (from date_of_birth)
--      - weight_kg >= 45
--      - is_paused = false
--      - is_available = true
--   4. Yearly donation cap exclusion:
--      - whole_blood + male: max 4/year
--      - whole_blood + female: max 3/year
--      - platelets: max 24/year (any gender)
--   5. Ordering: same-block first, then total_donations DESC, then created_at ASC
--   6. LIMIT to p_units * 3 (over-fetch to allow for cascade tiers)
--
-- Parameters:
--   p_blood_group : The recipient's blood group (e.g., 'A+', 'O-')
--   p_district    : The district to search in
--   p_units       : Number of units needed (used for LIMIT calculation)
--   p_block       : Optional block for same-block priority ordering
-- ============================================================================
CREATE OR REPLACE FUNCTION find_matching_donors(
  p_blood_group text,
  p_district    text,
  p_units       integer,
  p_block       text DEFAULT NULL
)
RETURNS TABLE (
  id                  uuid,
  phone               text,
  name                text,
  blood_group         text,
  district            text,
  block               text,
  total_donations     integer,
  donations_this_year integer,
  last_donation_type  text,
  gender              text,
  date_of_birth       date,
  weight_kg           integer,
  next_eligible_date  date,
  created_at          timestamptz
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_compatible_groups text[];
BEGIN
  -- Get the list of donor blood groups compatible with the requested group
  v_compatible_groups := get_compatible_blood_groups(p_blood_group);

  RETURN QUERY
  SELECT
    d.id,
    d.phone,
    d.name,
    d.blood_group,
    d.district,
    d.block,
    d.total_donations,
    d.donations_this_year,
    d.last_donation_type,
    d.gender,
    d.date_of_birth,
    d.weight_kg,
    d.next_eligible_date,
    d.created_at
  FROM blood_donors d
  WHERE
    -- 1. ABO/Rh compatibility
    d.blood_group = ANY(v_compatible_groups)

    -- 2. District match
    AND d.district = p_district

    -- 3. Availability and deferral filters
    AND d.is_available = true
    AND d.is_paused = false
    AND d.permanently_deferred = false

    -- 4. Cooldown: next_eligible_date must be today or in the past (or NULL = never donated)
    AND (d.next_eligible_date IS NULL OR d.next_eligible_date <= CURRENT_DATE)

    -- 5. Temporary deferral must be expired (or NULL = no deferral)
    AND (d.deferral_until IS NULL OR d.deferral_until <= CURRENT_DATE)

    -- 6. Age between 18 and 65 (date_of_birth must be present)
    AND d.date_of_birth IS NOT NULL
    AND EXTRACT(YEAR FROM age(CURRENT_DATE, d.date_of_birth)) >= 18
    AND EXTRACT(YEAR FROM age(CURRENT_DATE, d.date_of_birth)) <= 65

    -- 7. Minimum weight 45 kg (weight_kg must be present)
    AND d.weight_kg IS NOT NULL
    AND d.weight_kg >= 45

    -- 8. Yearly donation cap exclusion
    --    whole_blood: male max 4/yr, female max 3/yr, other max 3/yr (conservative)
    --    platelets: max 24/yr (any gender)
    --    Donors who have NOT reached their cap pass this filter.
    --    Donors with NULL last_donation_type are not capped (never donated this year).
    AND NOT (
      -- Whole blood cap: male = 4, female/other = 3
      (d.last_donation_type = 'whole_blood' AND d.gender = 'male' AND d.donations_this_year >= 4)
      OR
      (d.last_donation_type = 'whole_blood' AND d.gender = 'female' AND d.donations_this_year >= 3)
      OR
      (d.last_donation_type = 'whole_blood' AND (d.gender IS NULL OR d.gender = 'other') AND d.donations_this_year >= 3)
      OR
      -- Platelets cap: 24/yr for any gender
      (d.last_donation_type = 'platelets' AND d.donations_this_year >= 24)
    )

  ORDER BY
    -- Same-block donors first (if p_block is provided)
    CASE WHEN p_block IS NOT NULL AND d.block = p_block THEN 0 ELSE 1 END ASC,
    -- Most experienced donors next
    d.total_donations DESC,
    -- Earliest registered as tiebreaker
    d.created_at ASC

  -- Over-fetch: return up to 3x the units needed to allow for cascade tiers
  -- and potential declines. Minimum 10 donors returned.
  LIMIT GREATEST(p_units * 3, 10);
END;
$$;

COMMENT ON FUNCTION find_matching_donors(text, text, integer, text) IS
  'Returns eligible, ABO/Rh-compatible donors for a blood request. Applies '
  'all medical eligibility filters (cooldown, deferral, age 18-65, weight >= 45 kg, '
  'availability) and yearly donation cap exclusions (whole_blood male=4/yr, '
  'female=3/yr; platelets=24/yr). Orders by same-block first, then '
  'total_donations DESC, then created_at ASC. (Req 8.5, 8.6, 18.12)';
