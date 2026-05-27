-- ============================================================================
-- Migration: 20260101_001_routing_observability.sql
-- Spec:      sahayak-multi-agent-router (task 1.1)
-- Purpose:   Routing + invocation observability tables, conversation_sessions
--            extensions for active_agent + last_activity_at, and nullability
--            fixes on observability columns.
--
-- Requirements covered:
--   1.3   conversation_sessions tracks active_agent
--   1.7   stale-session check uses last_activity_at (canonical freshness col)
--   13.1  /dashboard/agent-routing reads from routing_decisions
--   18.1  routing_decisions table shape
--   18.2  conversation_sessions.active_agent column + default
--   18.3  agent_invocations table shape
--   18.15 agent_invocations.tokens_used is NULLABLE (Gemini node may not
--         expose tokenUsage; downstream consumers fall back to a local
--         estimateTokens(prompt, response) helper)
--
-- Idempotency: this migration is safe to re-run. Every DDL is guarded by
-- IF NOT EXISTS / IF EXISTS, named CHECK constraints are dropped before
-- being re-created, and the NOT NULL fix-ups read information_schema.
--
-- Naming: new tables use lowercase snake_case columns (no double-quoting).
-- The conversation_sessions table also uses snake_case per the design doc.
-- ============================================================================

BEGIN;

-- gen_random_uuid() lives in pgcrypto on older PG and in pg_catalog from PG13+.
-- Supabase enables pgcrypto by default, but we make the dependency explicit so
-- a cold test database also works.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 0. conversation_sessions — create if not exists
--    The table may already exist from a prior n8n session-save workflow.
--    We create it with the full schema expected by the multi-agent router.
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversation_sessions (
  session_id        text PRIMARY KEY,                    -- phone number
  state             text,                                -- legacy / free-form state
  last_intent       text NOT NULL DEFAULT 'idle',
  active_agent      text NOT NULL DEFAULT 'ceo',
  collected_data    jsonb NOT NULL DEFAULT '{}'::jsonb,
  language          text NOT NULL DEFAULT 'hi',
  last_activity_at  timestamptz NOT NULL DEFAULT NOW(),
  flow_stack        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 1. conversation_sessions.active_agent  (Req 1.3, 18.2)
--    ADD COLUMN IF NOT EXISTS so this is safe if the table was just created
--    above (which already includes the column) or if it existed without it.
-- ============================================================================
ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS active_agent text NOT NULL DEFAULT 'ceo';

ALTER TABLE conversation_sessions
  DROP CONSTRAINT IF EXISTS chk_session_active_agent;

ALTER TABLE conversation_sessions
  ADD CONSTRAINT chk_session_active_agent
  CHECK (active_agent IN ('ceo','complaint','blood','donor','info'));

-- ============================================================================
-- 2. conversation_sessions.last_activity_at  (Req 1.7) — canonical freshness
--    column read by Prepare Context for stale-session detection.
-- ============================================================================
ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT NOW();

-- ============================================================================
-- 3. One-time back-fill for last_activity_at.
--    Dynamically builds the COALESCE list based on which legacy columns exist
--    so the migration doesn't fail on deployments that lack last_activity or
--    updated_at columns.
-- ============================================================================
DO $$
DECLARE
  has_last_activity boolean;
  has_updated_at    boolean;
  sql_text          text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'conversation_sessions'
       AND column_name  = 'last_activity'
  ) INTO has_last_activity;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'conversation_sessions'
       AND column_name  = 'updated_at'
  ) INTO has_updated_at;

  sql_text := 'UPDATE conversation_sessions SET last_activity_at = COALESCE(';
  IF has_last_activity THEN
    sql_text := sql_text || 'last_activity, ';
  END IF;
  IF has_updated_at THEN
    sql_text := sql_text || 'updated_at, ';
  END IF;
  sql_text := sql_text || 'NOW()) '
           || 'WHERE last_activity_at IS NULL '
           || '   OR last_activity_at = ''1970-01-01''::timestamptz';

  EXECUTE sql_text;
END $$;

-- ============================================================================
-- 4. Index on last_activity_at  (Req 1.7 — Prepare Context stale-session scan)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity_at
  ON conversation_sessions (last_activity_at);

-- ============================================================================
-- 5. routing_decisions table  (Req 18.1, 13.1)
--    agent_dispatched is NULLABLE so stale-reset rows (Req 1.9) can carry NULL.
-- ============================================================================
CREATE TABLE IF NOT EXISTS routing_decisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          text NOT NULL,
  message_text        text,                              -- truncated to <=200 chars by app layer
  last_intent_before  text,
  agent_dispatched    text,                              -- nullable; CHECK below
  reason              text NOT NULL,
  trace_id            uuid,
  created_at          timestamptz NOT NULL DEFAULT NOW()
);

-- 5a. If a prior partial migration created routing_decisions without trace_id,
--     add it now so the column shape matches the design.
ALTER TABLE routing_decisions
  ADD COLUMN IF NOT EXISTS trace_id uuid;

-- 5b. Drop NOT NULL on agent_dispatched if an earlier migration set it
--     (Req 1.9 needs NULL for stale-reset rows).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'routing_decisions'
       AND column_name  = 'agent_dispatched'
       AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE routing_decisions
      ALTER COLUMN agent_dispatched DROP NOT NULL;
  END IF;
END $$;

-- 5c. Idempotent CHECK on agent_dispatched — allows NULL for stale-reset rows.
ALTER TABLE routing_decisions
  DROP CONSTRAINT IF EXISTS chk_routing_agent_dispatched;

ALTER TABLE routing_decisions
  ADD CONSTRAINT chk_routing_agent_dispatched
  CHECK (
    agent_dispatched IS NULL
    OR agent_dispatched IN ('complaint','blood','donor','info','welcome')
  );

-- ============================================================================
-- 6. agent_invocations table  (Req 18.3, 18.15)
--    tokens_used is NULLABLE — n8n's Gemini node does not always expose
--    tokenUsage; NULL means "not captured" and downstream consumers fall back
--    to a local estimateTokens(prompt, response) helper (Req 30.8 v1.1).
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_invocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    text NOT NULL,
  agent         text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT NOW(),
  completed_at  timestamptz,
  tokens_used   integer,                                  -- NULL allowed (Req 18.15)
  tools_called  jsonb DEFAULT '[]'::jsonb,
  success       boolean,
  error_message text
);

-- 6a. Drop NOT NULL on tokens_used if an earlier migration set it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'agent_invocations'
       AND column_name  = 'tokens_used'
       AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE agent_invocations
      ALTER COLUMN tokens_used DROP NOT NULL;
  END IF;
END $$;

-- 6b. Idempotent CHECK on agent column.
ALTER TABLE agent_invocations
  DROP CONSTRAINT IF EXISTS chk_agent_invocations_agent;

ALTER TABLE agent_invocations
  ADD CONSTRAINT chk_agent_invocations_agent
  CHECK (agent IN ('complaint','blood','donor','info','welcome'));

-- ============================================================================
-- 7. Observability indexes
-- ============================================================================
-- Already created above in section 4, but repeated here for clarity:
-- idx_sessions_last_activity_at ON conversation_sessions(last_activity_at)

CREATE INDEX IF NOT EXISTS idx_routing_session_time
  ON routing_decisions (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_routing_agent_time
  ON routing_decisions (agent_dispatched, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invocations_agent_time
  ON agent_invocations (agent, started_at DESC);

COMMIT;
