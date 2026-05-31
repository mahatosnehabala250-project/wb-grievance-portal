-- ============================================================================
-- Migration: 20260201_009_resolve_cascade_policy.sql
-- Spec:      sahayak-multi-agent-router (task 21.1) — v1.1 batch
-- Purpose:   Policy Resolver SQL function for the Adaptive Donor Cascade.
--            Resolves the active cascade policy (tier sizes + wait windows)
--            for a blood request, honoring precedence:
--              1. non-expired manual admin override  (source = 'manual')
--              2. cold-start safe default             (< 50 outcomes → 'default')
--              3. most-specific learned/bandit/default row
--
-- Requirements covered:
--   23.1  Cascade engine reads tier sizes / wait minutes from cascade_policies.
--   23.2  Default rows (source='default') match the v1 Req 5 schedule.
--   23.3  Cold-start safety: < 50 cascade_outcomes for the feature combination
--         falls back to the static Req 5 default schedule.
--
-- Design sections: §v1.1.4 Adaptive Donor Cascade — "Policy Resolver lookup
--                  precedence" (5-level most-specific-first) and "Cold-start
--                  safety". Also §Property 21 (cold-start safety).
--
-- Consumed by: JS-15B Cascade Engine (task 21.3) — reads the returned row's
--              tier_1_count / tier_2_count / tier_3_count and
--              wait_1_minutes / wait_2_minutes / wait_3_minutes.
--
-- Dependencies (must already exist):
--   - cascade_policies (id, urgency, hour_bucket, district, blood_group,
--     tier_1_count, tier_2_count, tier_3_count, wait_1_minutes, wait_2_minutes,
--     wait_3_minutes, source, weight, ...) from migration 20260201_002.
--   - cascade_outcomes (id, urgency, ...) from migration 20260201_002.
--   - UNIQUE (urgency, hour_bucket, district, blood_group) on cascade_policies
--     (uq_cascade_policies_scope) — one row per exact scope.
--
-- Additive schema changes made here (needed by the resolver, idempotent):
--   - cascade_policies.expires_at timestamptz NULL
--       The §v1.1.4 precedence filters non-expired rows
--       (expires_at IS NULL OR expires_at > now()). Manual overrides (task 21.7)
--       carry an explicit expires_at so they auto-revert (Req 23.9). Default /
--       bandit rows leave it NULL (never expire).
--   - cascade_outcomes.district / .blood_group / .hour_of_day
--       The cold-start count keys on (urgency, district, blood_group,
--       hour_bucket). The v1 outcomes table only stored urgency, so we add the
--       remaining feature columns here; the Cascade Outcome Logger (task 21.5)
--       populates them. Until populated, every bucket counts as < 50 → the
--       resolver returns the safe default schedule, which is exactly the
--       cold-start behaviour Req 23.3 mandates.
--
-- Idempotency:
--   - ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
--   - CREATE OR REPLACE FUNCTION.
--   - Safe to re-run without error.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Additive schema: expiry on policies + feature columns on outcomes
-- ============================================================================

-- Manual-override expiry (Req 23.8, 23.9; §v1.1.4 precedence filter).
ALTER TABLE cascade_policies
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Cold-start feature columns on cascade_outcomes (Req 23.3 count key).
ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS blood_group text;
ALTER TABLE cascade_outcomes
  ADD COLUMN IF NOT EXISTS hour_of_day int;

-- Index supporting the cold-start outcome count.
CREATE INDEX IF NOT EXISTS idx_cascade_outcomes_features
  ON cascade_outcomes (urgency, district, blood_group, hour_of_day);

-- Partial index to make the non-expired manual-override probe cheap.
CREATE INDEX IF NOT EXISTS idx_cascade_policies_manual_active
  ON cascade_policies (urgency, hour_bucket, district, blood_group)
  WHERE source = 'manual';

-- ============================================================================
-- 2. resolve_cascade_policy(p_urgency, p_district, p_blood_group, p_hour_bucket)
--    Returns the resolved cascade_policies row for the given feature combination.
--
--    hour_bucket convention: the seeded default rows use the 4-hour bucket START
--    hour (0, 4, 8, 12, 16, 20). p_hour_bucket is therefore normalized to
--    floor(hour / 4) * 4 so callers may pass either a raw local hour-of-day
--    (0..23) or an already-bucketed value — both map to the same seeded bucket.
--
--    Precedence (most-specific-first within each phase; §v1.1.4):
--      Phase A — non-expired manual override, most specific first.
--      Phase B — cold-start: if < 50 matching cascade_outcomes, return the
--                source='default' row for the bucket (static Req 5 schedule).
--      Phase C — most-specific non-expired learned/bandit/default row.
--      Phase D — defensive fallback: any default row for the urgency.
--
--    Specificity ordering (matches the design's 5 levels): a row whose
--    district/blood_group/hour_bucket is non-NULL is more specific than a
--    wildcard (NULL) row. Because the WHERE clause only admits rows whose
--    non-NULL dimensions equal the parameter, "(dimension IS NOT NULL) DESC"
--    ranks specific matches above wildcards. Dimension priority is
--    district > blood_group > hour_bucket, per design levels 1-5. A source
--    tiebreak (manual > bandit > default) guards the rare case of two rows at
--    the same specificity.
-- ============================================================================
CREATE OR REPLACE FUNCTION resolve_cascade_policy(
  p_urgency      text,
  p_district     text,
  p_blood_group  text,
  p_hour_bucket  int
)
RETURNS cascade_policies
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_hour_bucket  int;
  v_bucket_index int;
  v_outcomes     int;
  v_row          cascade_policies;
BEGIN
  -- Normalize to the 4-hour bucket start hour (0,4,8,12,16,20) used by seeds.
  v_hour_bucket  := (GREATEST(COALESCE(p_hour_bucket, 0), 0) / 4) * 4;
  v_bucket_index := v_hour_bucket / 4;

  -- --------------------------------------------------------------------------
  -- Phase A: non-expired manual override (most specific first).
  -- A human admin decision always wins, even during cold-start (Req 23.8).
  -- --------------------------------------------------------------------------
  SELECT cp.* INTO v_row
  FROM cascade_policies cp
  WHERE cp.source = 'manual'
    AND cp.urgency = p_urgency
    AND (cp.hour_bucket = v_hour_bucket OR cp.hour_bucket IS NULL)
    AND (cp.district = p_district     OR cp.district IS NULL)
    AND (cp.blood_group = p_blood_group OR cp.blood_group IS NULL)
    AND (cp.expires_at IS NULL OR cp.expires_at > NOW())
  ORDER BY
    (cp.district IS NOT NULL)    DESC,
    (cp.blood_group IS NOT NULL) DESC,
    (cp.hour_bucket IS NOT NULL) DESC,
    cp.updated_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  -- --------------------------------------------------------------------------
  -- Phase B: cold-start safety (Req 23.3).
  -- If fewer than 50 outcomes exist for this (urgency, district, blood_group,
  -- hour_bucket) feature combination, return the static default schedule.
  -- --------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_outcomes
  FROM cascade_outcomes co
  WHERE co.urgency = p_urgency
    AND co.district = p_district
    AND co.blood_group = p_blood_group
    AND (co.hour_of_day / 4) = v_bucket_index;

  IF v_outcomes < 50 THEN
    -- Default row for the exact bucket (universal scope: district/group NULL).
    SELECT cp.* INTO v_row
    FROM cascade_policies cp
    WHERE cp.source = 'default'
      AND cp.urgency = p_urgency
      AND cp.hour_bucket = v_hour_bucket
      AND cp.district IS NULL
      AND cp.blood_group IS NULL
    LIMIT 1;

    IF FOUND THEN
      RETURN v_row;
    END IF;
    -- Fall through to Phase D if the exact-bucket default is somehow absent.
  ELSE
    -- ------------------------------------------------------------------------
    -- Phase C: warm bucket — most-specific non-expired learned/bandit/default.
    -- ------------------------------------------------------------------------
    SELECT cp.* INTO v_row
    FROM cascade_policies cp
    WHERE cp.urgency = p_urgency
      AND (cp.hour_bucket = v_hour_bucket OR cp.hour_bucket IS NULL)
      AND (cp.district = p_district     OR cp.district IS NULL)
      AND (cp.blood_group = p_blood_group OR cp.blood_group IS NULL)
      AND (cp.expires_at IS NULL OR cp.expires_at > NOW())
    ORDER BY
      (cp.district IS NOT NULL)    DESC,
      (cp.blood_group IS NOT NULL) DESC,
      (cp.hour_bucket IS NOT NULL) DESC,
      CASE cp.source
        WHEN 'manual'  THEN 3
        WHEN 'bandit'  THEN 2
        WHEN 'default' THEN 1
        ELSE 0
      END DESC,
      cp.updated_at DESC
    LIMIT 1;

    IF FOUND THEN
      RETURN v_row;
    END IF;
  END IF;

  -- --------------------------------------------------------------------------
  -- Phase D: defensive fallback — any default row for the urgency.
  -- Guarantees a non-NULL policy for any seeded urgency even if the exact
  -- bucket row is missing (e.g. a not-yet-seeded bucket).
  -- --------------------------------------------------------------------------
  SELECT cp.* INTO v_row
  FROM cascade_policies cp
  WHERE cp.source = 'default'
    AND cp.urgency = p_urgency
    AND cp.district IS NULL
    AND cp.blood_group IS NULL
  ORDER BY ABS(cp.hour_bucket - v_hour_bucket) ASC, cp.hour_bucket ASC
  LIMIT 1;

  -- v_row is NULL only for an unknown urgency with no seeded default — the
  -- caller (cascade engine) treats a NULL result as "use built-in static
  -- schedule" per §v1.1.4.
  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION resolve_cascade_policy(text, text, text, int) IS
  'Adaptive Donor Cascade Policy Resolver (task 21.1; Design §v1.1.4). Returns '
  'the cascade_policies row giving tier sizes / wait windows for '
  '(urgency, district, blood_group, hour_bucket). Precedence: non-expired '
  'manual override → cold-start default (< 50 cascade_outcomes) → most-specific '
  'non-expired bandit/default row → any default for the urgency. p_hour_bucket '
  'is normalized to the 4-hour bucket start (0,4,8,12,16,20). '
  '(Req 23.1, 23.2, 23.3)';

COMMIT;
