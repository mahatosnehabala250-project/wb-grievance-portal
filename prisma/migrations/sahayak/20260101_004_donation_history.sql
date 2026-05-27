-- =============================================================================
-- Migration: 20260101_004_donation_history.sql
-- Spec    : sahayak-multi-agent-router
-- Task    : 1.4 — create the immutable `donation_history` audit table that
--                 backs the JS-15 / Rakta Sahayak donor cooldown pipeline.
--
-- Requirements:
--   - Req 8.2  — A new table `donation_history` SHALL be created with:
--                `id`, `donor_id`, `blood_request_id` (nullable),
--                `donated_date`, `donation_type`, `units`, `hospital`,
--                `hemoglobin_level` (nullable), `notes`, `created_at`.
--   - Req 18.5 — Schema requirement that `donation_history` exist per
--                Req 8 acceptance criteria 2.
--
-- Design references:
--   - design.md §Data Models (ER diagram, donation_history block)
--   - design.md §SQL DDL (donation_history block + REVOKE statements)
--   - design.md §Notable Invariants ("donation_history rows are immutable:
--     REVOKE UPDATE, DELETE from all roles; corrections must be supersede
--     inserts").
--   - design.md §Medical Compliance ("immutable medical audit trail —
--     records SHALL NOT be deletable, only correctable via supersede
--     entries", 5-year minimum append-only retention).
--   - ADR-006: Immutable donation_history with gender-based cooldown
--     function in the database (sibling ADR-005 covers the trigger; this
--     migration only owns the table + REVOKE policy).
--
-- Architecture note:
--   This table is the IMMUTABLE MEDICAL-COMPLIANCE AUDIT LOG per ADR-006.
--   It is the single source of truth for donor cooldown calculations
--   (`calculate_next_eligible_date`) and yearly-cap enforcement
--   (`find_matching_donors`). Once a row is inserted, it MUST NOT be
--   modified or removed by any role — including `service_role` — so the
--   medical audit trail required by NACO/NBTC guidelines (5-year retention)
--   stays intact. Corrections are supersede inserts (see comment block
--   at the REVOKE section below).
--
-- Idempotency:
--   - pgcrypto extension uses CREATE EXTENSION IF NOT EXISTS (in case prior
--     migrations did not create it; gen_random_uuid() depends on it).
--   - Table created with CREATE TABLE IF NOT EXISTS.
--   - Index created with CREATE INDEX IF NOT EXISTS.
--   - REVOKE statements are unconditional but safe to re-run: PostgreSQL
--     REVOKE on already-absent privileges is a no-op (with a NOTICE).
-- =============================================================================

-- gen_random_uuid() depends on the pgcrypto extension. Earlier migrations in
-- this spec already create it, but include the guard here so this file can
-- be applied stand-alone in fresh / partial environments.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- donation_history (immutable medical audit log — ADR-006)
-- -----------------------------------------------------------------------------
-- One row per recorded donation. Inserted by the donor-respond / DONATED
-- command path (see design §Donor flow) and by admin reconciliation jobs.
-- The AFTER INSERT trigger `trg_update_donor_after_donation` (added by
-- migration 20260101_006_eligibility_function_and_trigger.sql) reads each
-- new row to update `blood_donors.last_donated_date`, `last_donation_type`,
-- `next_eligible_date`, `total_donations`, and `donations_this_year`.
--
-- FK semantics:
--   - donor_id ON DELETE RESTRICT: a donor with recorded donations cannot
--     be hard-deleted. The audit trail must outlive the donor record;
--     deactivation is handled via `blood_donors.is_available = false` and
--     the permanent-deferral flag, never via DELETE.
--   - blood_request_id ON DELETE SET NULL: blood requests may be archived
--     or removed, but the donation record itself MUST survive. Setting the
--     FK to NULL preserves the donation while severing the link to the
--     deleted request.
CREATE TABLE IF NOT EXISTS donation_history (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    donor_id          uuid        NOT NULL REFERENCES blood_donors(id)   ON DELETE RESTRICT,
    blood_request_id  uuid        NULL     REFERENCES blood_requests(id) ON DELETE SET NULL,
    donated_date      date        NOT NULL,
    donation_type     text        NOT NULL CHECK (
        donation_type IN ('whole_blood', 'platelets', 'plasma', 'double_red')
    ),
    units             integer     NOT NULL DEFAULT 1 CHECK (units > 0 AND units <= 4),
    hospital          text        NOT NULL,
    hemoglobin_level  numeric(4,1) NULL,
    notes             text        NULL,
    created_at        timestamptz NOT NULL DEFAULT NOW()
);

-- Hot-path index: donor portal "my donation history" view, certificate
-- generation lookups, and `calculate_next_eligible_date` all filter by
-- donor_id and order by donated_date DESC.
CREATE INDEX IF NOT EXISTS idx_donation_history_donor
    ON donation_history (donor_id, donated_date DESC);

-- -----------------------------------------------------------------------------
-- Immutability policy (ADR-006 / design §Notable Invariants)
-- -----------------------------------------------------------------------------
-- Corrections to donation history must be supersede inserts with a `notes`
-- field referencing the prior row's id. This preserves the audit trail for
-- medical compliance (5-year retention requirement, NACO/NBTC guidelines).
--
-- Rationale: the donation_history table is the legal medical record of who
-- donated what, when, and where. Allowing UPDATE or DELETE — even to
-- service_role — would let a buggy workflow, a compromised credential, or
-- an honest admin mistake silently rewrite history and break the audit
-- chain required by NACO/NBTC guidelines (and by hospital blood-bank
-- inspections). Corrections must therefore be performed by INSERTING a new
-- row whose `notes` column references the prior row's id, e.g.
-- "supersedes <uuid>: hemoglobin corrected from 13.2 to 12.8". The trigger
-- and downstream consumers always treat the most-recent (donor_id,
-- donated_date) row as authoritative.
--
-- Privileges intentionally retained (granted elsewhere, not by this file):
--   - INSERT  : service_role inserts via the donor-respond endpoint /
--               admin reconciliation jobs.
--   - SELECT  : admin role (read-all), authenticated donor (RLS-restricted
--               to own rows). Both are configured in the RLS migration
--               20260101_008_rls_policies.sql.
--
-- The REVOKE statements below are unconditional but safe to re-run:
-- revoking a privilege that was never granted is a no-op (NOTICE only).
REVOKE UPDATE, DELETE ON donation_history FROM PUBLIC;
REVOKE UPDATE, DELETE ON donation_history FROM anon;
REVOKE UPDATE, DELETE ON donation_history FROM authenticated;
REVOKE UPDATE, DELETE ON donation_history FROM service_role;

-- -----------------------------------------------------------------------------
-- Documentation comments (visible via \d+ donation_history and pg_catalog)
-- -----------------------------------------------------------------------------
COMMENT ON TABLE donation_history IS
    'Immutable medical audit trail of donor donations (Req 8.2, 18.5; ADR-006). '
    'UPDATE and DELETE are revoked from PUBLIC, anon, authenticated, and '
    'service_role — corrections MUST be performed via supersede inserts whose '
    'notes column references the prior row''s id. Retention: 5 years minimum, '
    'append-only (NACO/NBTC medical compliance).';

COMMENT ON COLUMN donation_history.donor_id IS
    'FK to blood_donors(id) ON DELETE RESTRICT. The audit trail must outlive '
    'the donor record; deactivation is via is_available / permanent-deferral '
    'flags, never via DELETE.';

COMMENT ON COLUMN donation_history.blood_request_id IS
    'Nullable FK to blood_requests(id) ON DELETE SET NULL. Severing the link '
    'on request deletion preserves the donation record (the audit log itself '
    'must survive request lifecycle changes). NULL is also valid for walk-in '
    'donations not tied to a portal request.';

COMMENT ON COLUMN donation_history.donation_type IS
    'One of whole_blood, platelets, plasma, double_red. Drives the cooldown '
    'computed by calculate_next_eligible_date (whole_blood = 90/120 days by '
    'gender, platelets = 14, plasma = 14, double_red = 168).';

COMMENT ON COLUMN donation_history.units IS
    'Units donated (typically 1; bounded 1..4). Enforced by CHECK to prevent '
    'data-entry errors.';

COMMENT ON COLUMN donation_history.notes IS
    'Free-form notes. Used for supersede corrections — by convention starts '
    'with "supersedes <uuid>: <reason>" when superseding a prior row.';
