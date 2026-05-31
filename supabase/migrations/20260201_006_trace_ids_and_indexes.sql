-- ============================================================================
-- Migration: 20260201_006_trace_ids_and_indexes.sql
-- Spec:      sahayak-multi-agent-router (task 17.6)
-- Purpose:   v1.1 distributed-trace plumbing. Adds a `trace_id uuid` column to
--            every logging table that participates in a request trace and
--            creates per-trace indexes so the v1.1.13 timeline view can
--            reconstruct a full trace with `WHERE trace_id = $1 ORDER BY ...`.
--
-- Requirements covered:
--   27.2   trace_id propagated to all logging tables
--   34.16  per-trace indexes for timeline reconstruction
--
-- Design reference: §v1.1.8 (Trace IDs — Schema)
--
-- Additive & idempotent: every column uses ADD COLUMN IF NOT EXISTS and every
-- index uses CREATE INDEX IF NOT EXISTS. Several columns (routing_decisions,
-- agent_invocations, query_cache, whatsapp_outbox, guardrail_violations) were
-- already declared by earlier v1.1 migrations (001/003/004); re-declaring them
-- here is a safe no-op and keeps this migration self-contained.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. trace_id columns (additive, idempotent)
-- ----------------------------------------------------------------------------

-- Already added in 20260201_001 — re-asserted for completeness.
ALTER TABLE routing_decisions      ADD COLUMN IF NOT EXISTS trace_id uuid;
ALTER TABLE agent_invocations      ADD COLUMN IF NOT EXISTS trace_id uuid;

-- New in this migration.
ALTER TABLE cascade_notifications  ADD COLUMN IF NOT EXISTS trace_id uuid;
ALTER TABLE screening_log          ADD COLUMN IF NOT EXISTS trace_id uuid;
ALTER TABLE query_cache            ADD COLUMN IF NOT EXISTS trace_id uuid;   -- last-write trace
ALTER TABLE whatsapp_outbox        ADD COLUMN IF NOT EXISTS trace_id uuid;
ALTER TABLE guardrail_violations   ADD COLUMN IF NOT EXISTS trace_id uuid;   -- already declared in Req 34.10

-- ----------------------------------------------------------------------------
-- 2. per-trace indexes for fast timeline reconstruction (Req 27.5, 34.16)
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_routing_trace      ON routing_decisions     (trace_id);
CREATE INDEX IF NOT EXISTS idx_invocations_trace  ON agent_invocations     (trace_id);
CREATE INDEX IF NOT EXISTS idx_cascade_trace      ON cascade_notifications (trace_id);
CREATE INDEX IF NOT EXISTS idx_screening_trace    ON screening_log         (trace_id);
CREATE INDEX IF NOT EXISTS idx_query_cache_trace  ON query_cache           (trace_id);
CREATE INDEX IF NOT EXISTS idx_outbox_trace       ON whatsapp_outbox       (trace_id);
CREATE INDEX IF NOT EXISTS idx_guardrail_trace    ON guardrail_violations  (trace_id);

COMMIT;
