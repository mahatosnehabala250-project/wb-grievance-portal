-- =============================================================================
-- Migration: 20260101_005_cascade_screening_logs.sql
-- Spec: sahayak-multi-agent-router
-- Task: 1.5 — cascade_notifications and screening_log tables
--
-- Requirements:
--   - Req 5.8  — `cascade_notifications` table logs every donor notification
--                with (id, blood_request_id, donor_id, tier, notified_at,
--                responded_at, response).
--   - Req 9.4  — `screening_log` table records pre-donation health-screening
--                answers (5-year retention for medical audit/compliance).
--   - Req 18.6 — Schema requirement that `cascade_notifications` exist per
--                Req 5.8.
--   - Req 18.7 — Schema requirement for `screening_log` columns: id, donor_id,
--                blood_request_id, screening_answers (jsonb), screening_passed
--                (bool), deferral_applied (bool), created_at.
--
-- Design references:
--   - design.md §Data Models (ER diagram)
--   - design.md §SQL DDL (cascade_notifications + screening_log blocks)
--   - design.md §Notable invariants (cascade_notifications UNIQUE constraint
--     guarantees tier-level idempotency)
--   - design.md §Retention (screening_log: 5 years)
--
-- Idempotency:
--   - All DDL uses IF NOT EXISTS so this migration is safe to re-run.
--   - The UNIQUE constraint `uniq_cascade_request_donor_tier` is the database
--     enforcement point for Req 5.9 (cascade re-trigger SHALL NOT re-notify
--     donors already notified at the current tier). JS-15B's
--     `INSERT ... ON CONFLICT (blood_request_id, donor_id, tier) DO NOTHING`
--     relies on this exact constraint name + columns. DO NOT REMOVE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- cascade_notifications
-- -----------------------------------------------------------------------------
-- Logs every donor invitation issued by JS-15B Donor Cascade Engine, one row
-- per (blood_request_id, donor_id, tier). The UNIQUE constraint enforces
-- cascade idempotency at the DB layer so duplicate workflow re-entries cannot
-- double-notify a donor at the same tier (Req 5.9).
CREATE TABLE IF NOT EXISTS cascade_notifications (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    blood_request_id  uuid        NOT NULL REFERENCES blood_requests(id) ON DELETE CASCADE,
    donor_id          uuid        NOT NULL REFERENCES blood_donors(id)   ON DELETE CASCADE,
    tier              integer     NOT NULL CHECK (tier BETWEEN 1 AND 4),
    notified_at       timestamptz NOT NULL DEFAULT NOW(),
    responded_at      timestamptz NULL,
    response          text        NULL CHECK (
        response IS NULL OR response IN ('haan', 'nahi', 'timeout')
    ),
    -- IDEMPOTENCY GUARANTEE (Req 5.9):
    -- This UNIQUE constraint is the canonical enforcement point that prevents
    -- the same donor from being notified twice for the same blood_request at
    -- the same tier. JS-15B inserts MUST use:
    --   INSERT INTO cascade_notifications (blood_request_id, donor_id, tier)
    --   VALUES (...) ON CONFLICT (blood_request_id, donor_id, tier) DO NOTHING
    -- Removing or renaming this constraint will break Property 3 (cascade
    -- idempotency) and the JS-15B re-entry contract.
    CONSTRAINT uniq_cascade_request_donor_tier UNIQUE (blood_request_id, donor_id, tier)
);

-- Index: per-request-and-tier lookups (read prior tier's notified set in JS-15B)
CREATE INDEX IF NOT EXISTS idx_cascade_notif_request_tier
    ON cascade_notifications (blood_request_id, tier);

-- Index: per-donor history lookups (donor portal "who invited me" + fairness ranking)
CREATE INDEX IF NOT EXISTS idx_cascade_notif_donor
    ON cascade_notifications (donor_id, notified_at DESC);

COMMENT ON TABLE cascade_notifications IS
    'Tier-by-tier donor notification log for the JS-15B cascade engine. '
    'UNIQUE (blood_request_id, donor_id, tier) enforces Req 5.9 idempotency. '
    'Retention: 1 year (Req 18.6 / design §Retention).';

COMMENT ON CONSTRAINT uniq_cascade_request_donor_tier ON cascade_notifications IS
    'Cascade idempotency invariant (Req 5.9): re-triggering JS-15B for the same '
    '(blood_request_id, tier) MUST NOT re-notify donors already notified at that tier.';

-- -----------------------------------------------------------------------------
-- screening_log
-- -----------------------------------------------------------------------------
-- Records every pre-donation health-screening invocation: the answers given,
-- whether the donor passed, and whether a temporary deferral was applied.
-- One row per screening invocation (Property 12).
CREATE TABLE IF NOT EXISTS screening_log (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    donor_id           uuid        NOT NULL REFERENCES blood_donors(id)   ON DELETE CASCADE,
    blood_request_id   uuid        NULL     REFERENCES blood_requests(id) ON DELETE SET NULL,
    screening_answers  jsonb       NOT NULL,
    screening_passed   boolean     NOT NULL,
    deferral_applied   boolean     NOT NULL DEFAULT false,
    created_at         timestamptz NOT NULL DEFAULT NOW()
);

-- Index: per-donor screening history lookups (donor portal + audit queries)
CREATE INDEX IF NOT EXISTS idx_screening_log_donor
    ON screening_log (donor_id, created_at DESC);

-- 5-year retention (Req 9.4 / design §Retention §Medical Compliance):
-- screening_log rows are part of the medical audit trail for blood-donor
-- eligibility decisions. Retention purges run only after 5 years from
-- created_at; cleanup is handled out-of-band by an admin cron job and MUST
-- NOT be performed by application code. Note: blood_request_id uses
-- ON DELETE SET NULL (rather than CASCADE) so the screening record survives
-- request deletion, preserving the per-donor audit trail required for
-- compliance.
COMMENT ON TABLE screening_log IS
    'Pre-donation health-screening audit log (Req 9.4, 18.7). '
    'Retention: 5 years minimum for medical/compliance audit. '
    'One row per screening invocation (Property 12). '
    'blood_request_id is nullable so the record survives request deletion.';
