-- ============================================================================
-- Migration: 20260201_009_donor_fairness_ranking.sql
-- Spec:      sahayak-multi-agent-router (task 21.2) — v1.1 batch
-- Purpose:   Donor fairness ranking for the Adaptive Donor Cascade. Adds the
--            `donor_with_score` composite type and the `rank_donors_with_fairness`
--            SQL function that orders eligible donors by a fairness score so the
--            same top donors are not invited every single time (anti-burnout).
--
-- Requirements covered:
--   23.5  blood_donors.last_invited_at / invitations_last_30d feed the
--         anti-burnout recency penalty (columns added in 20260201_002).
--   23.6  Within-tier ranking by
--         (0.5 * distance_score + 0.3 * recency_penalty + 0.2 * acceptance_rate),
--         where recency_penalty is a normalized inverse of invitations_last_30d
--         and time since last_invited_at.
--
-- Design references:
--   - design.md §v1.1.4 Adaptive Donor Cascade → "Donor fairness ranking SQL"
--   - design.md §Property 22 (Donor fairness monotonicity)
--   - requirements.md Req 23.5, 23.6
--
-- Consumed by:
--   - JS-15B Cascade Engine (task 21.3) via Supabase RPC
--     `rank_donors_with_fairness(p_blood_group, p_district, p_units, p_block)`,
--     which slices the top-N rows (excluding already-notified donors) per tier.
--
-- Dependencies (must already exist):
--   - find_matching_donors(text, text, integer, text)  (20260101_007)
--   - blood_donors.last_invited_at, invitations_last_30d, total_offers_accepted
--     (20260101_002 + 20260201_002)
--   - cascade_notifications(donor_id, ...)              (20260101_005)
--
-- Design vs. implementation notes:
--   * The design's reference query joins `blood_donors d ON d.id = e.donor_id`.
--     `find_matching_donors` exposes the donor id as `id` (not `donor_id`), so
--     the join key here is `d.id = e.id`.
--   * The design references `d.total_invitations` for acceptance_rate. There is
--     no such column on `blood_donors`; lifetime invitations are derived from
--     the count of `cascade_notifications` rows for the donor (the same source
--     of truth that `decrement_30d_invitations()` recomputes the 30-day window
--     from). acceptance_rate = total_offers_accepted / NULLIF(total_invitations, 0).
--   * `same_block` / `distance_score` are computed from the donor's `block` vs.
--     `p_block`. Because `find_matching_donors` already restricts to the
--     requested district, returned donors score 1.0 (same block) or 0.5 (same
--     district); the 0.0 "adjacent" branch is retained for forward-compatibility.
--
-- Deployment caveat (legacy overload):
--   This migration calls `find_matching_donors(p_blood_group, p_district,
--   p_units * 5, p_block)` — the 4-arg, TABLE-returning matcher created by
--   20260101_007. On a fresh database built from the repo migrations in order,
--   that is the ONLY `find_matching_donors` overload, so the call resolves
--   unambiguously. Some pre-spec (JS-15 v1) databases also carry a legacy
--   5-arg `find_matching_donors(..., p_exclude_phone) RETURNS json` overload
--   that is NOT part of this spec's migration set. Where that legacy overload
--   still exists, Postgres reports "function ... is not unique" because a 4-arg
--   call matches both candidates (the 5th arg has a default). Resolve it by
--   dropping the obsolete v1 overload (out of scope for this migration —
--   coordinate with the JS-15 v1 owner) so only the canonical matcher remains:
--     DROP FUNCTION IF EXISTS find_matching_donors(text, text, integer, text, text);
--
-- Idempotency:
--   - The composite type is created behind a pg_type guard.
--   - The function uses CREATE OR REPLACE.
--   - Safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. donor_with_score composite type
--    The row shape returned by rank_donors_with_fairness: every column the
--    cascade engine needs to message a donor, plus the fairness sub-scores and
--    the final rank it slices the top-N from.
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'donor_with_score'
  ) THEN
    CREATE TYPE donor_with_score AS (
      id                   uuid,
      phone                text,
      name                 text,
      blood_group          text,
      district             text,
      block                text,
      total_donations      integer,
      donations_this_year  integer,
      last_donation_type   text,
      gender               text,
      date_of_birth        date,
      weight_kg            integer,
      next_eligible_date   date,
      created_at           timestamptz,
      same_block           boolean,
      invitations_last_30d integer,
      last_invited_at      timestamptz,
      total_invitations    integer,
      distance_score       numeric,
      recency_penalty      numeric,
      acceptance_rate      numeric,
      fairness_score       numeric,
      rank                 bigint
    );
  END IF;
END $$;

-- ============================================================================
-- 2. rank_donors_with_fairness RPC
--    Pulls the eligible/compatible candidate pool from find_matching_donors
--    (over-fetching p_units * 5 to widen the within-tier pool per design),
--    computes the three fairness sub-scores, and ranks by the weighted score:
--
--      fairness_score = 0.5 * distance_score
--                     + 0.3 * recency_penalty
--                     + 0.2 * acceptance_rate
--
--    distance_score  in [0..1]: 1 = same block, 0.5 = same district, 0 = other.
--    recency_penalty in (0..1]: 1 = never invited recently, → 0 as the donor is
--                    invited more times / more recently (anti-burnout).
--    acceptance_rate in [0..1]: total_offers_accepted / total_invitations.
--
--    Tie-breakers (per design): fairness_score DESC, then total_donations DESC,
--    then created_at ASC. The ROW_NUMBER() window emits a stable `rank` the
--    engine slices the top-N from.
--
-- Parameters:
--   p_blood_group : recipient blood group (e.g. 'A+', 'O-')
--   p_district    : district to search in
--   p_units       : units needed (candidate pool = p_units * 5, via the matcher)
--   p_block       : optional block for same-block (distance_score = 1.0) ranking
-- ============================================================================
CREATE OR REPLACE FUNCTION rank_donors_with_fairness(
  p_blood_group text,
  p_district    text,
  p_units       integer,
  p_block       text DEFAULT NULL
)
RETURNS SETOF donor_with_score
LANGUAGE sql STABLE
AS $$
  WITH eligible AS (
    -- Over-fetch the candidate pool (design §v1.1.4 passes p_units * 5) so the
    -- ranker has enough donors to spread invitations across.
    SELECT *
    FROM find_matching_donors(p_blood_group, p_district, p_units * 5, p_block)
  ),
  scored AS (
    SELECT
      e.id,
      e.phone,
      e.name,
      e.blood_group,
      e.district,
      e.block,
      e.total_donations,
      e.donations_this_year,
      e.last_donation_type,
      e.gender,
      e.date_of_birth,
      e.weight_kg,
      e.next_eligible_date,
      e.created_at,
      (p_block IS NOT NULL AND e.block IS NOT NULL AND e.block = p_block) AS same_block,
      COALESCE(d.invitations_last_30d, 0)                                 AS invitations_last_30d,
      d.last_invited_at                                                   AS last_invited_at,
      ti.total_invitations                                                AS total_invitations,
      -- distance_score in [0..1]: 1 = same block, 0.5 = same district, 0 = other
      (CASE
         WHEN (p_block IS NOT NULL AND e.block IS NOT NULL AND e.block = p_block) THEN 1.0
         WHEN e.district = p_district                                            THEN 0.5
         ELSE 0.0
       END)::numeric                                                      AS distance_score,
      -- recency_penalty in (0..1]: 1 = never invited recently, shrinking as the
      -- donor is invited more times and more recently (anti-burnout fairness).
      (1.0 / (1.0 + COALESCE(d.invitations_last_30d, 0)
                  + GREATEST(0, 30 - COALESCE(EXTRACT(EPOCH FROM (now() - d.last_invited_at)) / 86400.0, 30))
             ))::numeric                                                  AS recency_penalty,
      -- acceptance_rate in [0..1]: offers accepted / lifetime invitations
      COALESCE(d.total_offers_accepted::numeric / NULLIF(ti.total_invitations, 0), 0)::numeric AS acceptance_rate
    FROM eligible e
    JOIN blood_donors d ON d.id = e.id
    CROSS JOIN LATERAL (
      -- Lifetime invitations from the canonical cascade_notifications log.
      SELECT count(*)::int AS total_invitations
      FROM cascade_notifications cn
      WHERE cn.donor_id = e.id
    ) ti
  )
  SELECT
    s.id,
    s.phone,
    s.name,
    s.blood_group,
    s.district,
    s.block,
    s.total_donations,
    s.donations_this_year,
    s.last_donation_type,
    s.gender,
    s.date_of_birth,
    s.weight_kg,
    s.next_eligible_date,
    s.created_at,
    s.same_block,
    s.invitations_last_30d,
    s.last_invited_at,
    s.total_invitations,
    s.distance_score,
    s.recency_penalty,
    s.acceptance_rate,
    (0.5 * s.distance_score + 0.3 * s.recency_penalty + 0.2 * s.acceptance_rate) AS fairness_score,
    ROW_NUMBER() OVER (
      ORDER BY (0.5 * s.distance_score + 0.3 * s.recency_penalty + 0.2 * s.acceptance_rate) DESC,
               s.total_donations DESC,
               s.created_at ASC
    ) AS rank
  FROM scored s
  ORDER BY rank;
$$;

COMMENT ON FUNCTION rank_donors_with_fairness(text, text, integer, text) IS
  'Ranks eligible, ABO/Rh-compatible donors (from find_matching_donors) by a '
  'fairness score (0.5*distance_score + 0.3*recency_penalty + 0.2*acceptance_rate) '
  'so the same top donors are not invited every time. recency_penalty is a '
  'normalized inverse of invitations_last_30d and time since last_invited_at; '
  'acceptance_rate = total_offers_accepted / lifetime cascade_notifications count. '
  'Tie-breakers: fairness_score DESC, total_donations DESC, created_at ASC. '
  'Returns SETOF donor_with_score. (Req 23.5, 23.6; Design §v1.1.4, §Property 22)';

COMMIT;
