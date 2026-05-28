-- ============================================================================
-- Migration: 20260201_003_handoff_guardrail_cache.sql
-- Spec:      sahayak-multi-agent-router (task 17.3)
-- Purpose:   v1.1 tables for human handoff queue, guardrail violation logging,
--            and semantic query cache with pgvector ANN index.
--
-- Requirements covered:
--   34.9   human_handoff_queue table (three-strike escalation)
--   34.10  guardrail_violations table (output guardrail logging)
--   34.11  query_cache table (semantic cache for status/scheme queries)
--   26.4   query_cache TTL per category
--   26.5   cache miss → store result with appropriate TTL
--
-- Idempotency: this migration is safe to re-run. Every DDL is guarded by
-- IF NOT EXISTS / DROP CONSTRAINT IF EXISTS before re-creation.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. Extensions
-- ============================================================================
-- pgvector is required for the query_cache embedding column and ANN index.
CREATE EXTENSION IF NOT EXISTS vector;

-- gen_random_uuid() — Supabase enables pgcrypto by default.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. human_handoff_queue  (Req 34.9, Req 24.4)
--    Stores escalated sessions when the three-strike counter fires.
--    Officers claim/resolve via /dashboard/handoffs.
-- ============================================================================
CREATE TABLE IF NOT EXISTS human_handoff_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       text NOT NULL,
  reason           text NOT NULL,                         -- 'strike_3', 'manual', 'system'
  snapshot         jsonb NOT NULL DEFAULT '{}'::jsonb,    -- conversation snapshot at handoff time
  claimed_by       text,                                  -- officer identifier
  claimed_at       timestamptz,
  resolved_at      timestamptz,
  resolution_notes text,
  status           text NOT NULL DEFAULT 'pending',
  created_at       timestamptz NOT NULL DEFAULT NOW()
);

-- CHECK on status — idempotent drop + re-create
ALTER TABLE human_handoff_queue
  DROP CONSTRAINT IF EXISTS chk_handoff_status;

ALTER TABLE human_handoff_queue
  ADD CONSTRAINT chk_handoff_status
  CHECK (status IN ('pending', 'claimed', 'resolved'));

-- CHECK on reason
ALTER TABLE human_handoff_queue
  DROP CONSTRAINT IF EXISTS chk_handoff_reason;

ALTER TABLE human_handoff_queue
  ADD CONSTRAINT chk_handoff_reason
  CHECK (reason IN ('strike_3', 'manual', 'system'));

-- Index for listing pending handoffs ordered by creation time
CREATE INDEX IF NOT EXISTS idx_handoff_status_created
  ON human_handoff_queue (status, created_at);

-- ============================================================================
-- 2. guardrail_violations  (Req 34.10, Req 25.8)
--    Logs every non-OK guardrail outcome (repair, substitute, reject).
--    FK to agent_invocations for linking back to the agent call.
-- ============================================================================
CREATE TABLE IF NOT EXISTS guardrail_violations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           text,
  agent_invocation_id  uuid,                              -- FK added below if table exists
  trace_id             uuid,
  rule_name            text NOT NULL,                     -- e.g. 'pii_phone', 'language_mismatch'
  original_reply       text,                              -- the reply before guardrail action
  repaired_reply       text,                              -- the reply after repair (NULL if blocked)
  action               text NOT NULL,                     -- 'repaired', 'blocked', 'flagged'
  severity             text NOT NULL DEFAULT 'medium',    -- 'low', 'medium', 'high'
  created_at           timestamptz NOT NULL DEFAULT NOW()
);

-- CHECK on action
ALTER TABLE guardrail_violations
  DROP CONSTRAINT IF EXISTS chk_guardrail_action;

ALTER TABLE guardrail_violations
  ADD CONSTRAINT chk_guardrail_action
  CHECK (action IN ('repaired', 'blocked', 'flagged'));

-- CHECK on severity
ALTER TABLE guardrail_violations
  DROP CONSTRAINT IF EXISTS chk_guardrail_severity;

ALTER TABLE guardrail_violations
  ADD CONSTRAINT chk_guardrail_severity
  CHECK (severity IN ('low', 'medium', 'high'));

-- FK to agent_invocations (only if that table exists — it should from migration 001)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'agent_invocations'
  ) THEN
    -- Drop existing FK if present to make this idempotent
    ALTER TABLE guardrail_violations
      DROP CONSTRAINT IF EXISTS fk_guardrail_agent_invocation;

    ALTER TABLE guardrail_violations
      ADD CONSTRAINT fk_guardrail_agent_invocation
      FOREIGN KEY (agent_invocation_id) REFERENCES agent_invocations(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Index for querying violations by session and time
CREATE INDEX IF NOT EXISTS idx_guardrail_session_created
  ON guardrail_violations (session_id, created_at DESC);

-- ============================================================================
-- 3. query_cache  (Req 34.11, Req 26.1–26.5)
--    Semantic cache for status, scheme, and help queries.
--    Uses pgvector for embedding-based similarity search.
-- ============================================================================
CREATE TABLE IF NOT EXISTS query_cache (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash       text UNIQUE NOT NULL,                  -- normalized hash for exact dedup
  query_text       text NOT NULL,                         -- original query text
  query_embedding  vector(768),                           -- pgvector embedding for ANN search
  category         text NOT NULL,                         -- 'status', 'scheme', 'help'
  response         text NOT NULL,                         -- cached response
  hit_count        int NOT NULL DEFAULT 0,
  trace_id         uuid,                                  -- last-write attribution
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  expires_at       timestamptz NOT NULL                   -- TTL: 5min status, 7d scheme, 1h help
);

-- CHECK on category
ALTER TABLE query_cache
  DROP CONSTRAINT IF EXISTS chk_cache_category;

ALTER TABLE query_cache
  ADD CONSTRAINT chk_cache_category
  CHECK (category IN ('status', 'scheme', 'help'));

-- pgvector ivfflat index for fast approximate nearest-neighbour search
-- Note: ivfflat requires at least some rows to build effectively, but the
-- index can be created on an empty table (PG will rebuild on first VACUUM).
CREATE INDEX IF NOT EXISTS idx_query_cache_embedding
  ON query_cache USING ivfflat (query_embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================================
-- 4. Additional indexes
-- ============================================================================

-- Expiry-based cleanup index for the nightly cron
CREATE INDEX IF NOT EXISTS idx_query_cache_expires
  ON query_cache (expires_at);

-- Category + expiry for cache lookups
CREATE INDEX IF NOT EXISTS idx_query_cache_category_expires
  ON query_cache (category, expires_at);

COMMIT;
