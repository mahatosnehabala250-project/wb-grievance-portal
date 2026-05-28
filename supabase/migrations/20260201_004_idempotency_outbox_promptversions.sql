-- ============================================================================
-- Migration: 20260201_004_idempotency_outbox_promptversions.sql
-- Spec:      sahayak-multi-agent-router (task 17.4)
-- Purpose:   v1.1 tables for idempotency key deduplication, WhatsApp outbox
--            queue, and agent prompt version management.
--
-- Requirements covered:
--   34.12  idempotency_keys table for retry deduplication (24h TTL)
--   34.13  whatsapp_outbox table for circuit-breaker buffered sends
--   34.14  agent_prompt_versions table for A/B prompt staging
--
-- Idempotent: every DDL is guarded by IF NOT EXISTS / DO $$ blocks.
-- ============================================================================

BEGIN;

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. idempotency_keys — deduplicates retried API calls for 24 hours
--    Req 34.12, Design §v1.1.9
-- ============================================================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL,
  endpoint        text NOT NULL,
  response_status int,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  expires_at      timestamptz NOT NULL
);

-- UNIQUE(key, endpoint) for deduplication lookups
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_idempotency_key_endpoint'
  ) THEN
    ALTER TABLE idempotency_keys
      ADD CONSTRAINT uq_idempotency_key_endpoint UNIQUE (key, endpoint);
  END IF;
END $$;

-- Index on expires_at for the daily cleanup cron:
-- DELETE FROM idempotency_keys WHERE expires_at < NOW();
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
  ON idempotency_keys (expires_at);

-- ============================================================================
-- 2. whatsapp_outbox — buffered outbound messages when WhatsApp circuit is open
--    Req 34.13, Design §v1.1.10
-- ============================================================================

CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_phone text NOT NULL,
  message_body    jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  attempts        int NOT NULL DEFAULT 0,
  max_attempts    int NOT NULL DEFAULT 3,
  last_attempt_at timestamptz,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  scheduled_at    timestamptz NOT NULL DEFAULT NOW(),
  trace_id        uuid
);

-- Status CHECK constraint: pending | sent | failed | expired
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_whatsapp_outbox_status'
  ) THEN
    ALTER TABLE whatsapp_outbox
      ADD CONSTRAINT chk_whatsapp_outbox_status
      CHECK (status IN ('pending', 'sent', 'failed', 'expired'));
  END IF;
END $$;

-- Index for the outbox drainer: find pending messages ready for send
CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_status_scheduled
  ON whatsapp_outbox (status, scheduled_at);

-- ============================================================================
-- 3. agent_prompt_versions — A/B prompt staging and versioning
--    Req 34.14, Design §v1.1.14
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_prompt_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent           text NOT NULL,
  version         text NOT NULL,
  prompt_md       text NOT NULL,
  weight          float NOT NULL DEFAULT 1.0,
  active          boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'staging',
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

-- Agent CHECK constraint: complaint | blood | donor | info
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_agent_prompt_versions_agent'
  ) THEN
    ALTER TABLE agent_prompt_versions
      ADD CONSTRAINT chk_agent_prompt_versions_agent
      CHECK (agent IN ('complaint', 'blood', 'donor', 'info'));
  END IF;
END $$;

-- Status CHECK constraint: staging | active | archived
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_agent_prompt_versions_status'
  ) THEN
    ALTER TABLE agent_prompt_versions
      ADD CONSTRAINT chk_agent_prompt_versions_status
      CHECK (status IN ('staging', 'active', 'archived'));
  END IF;
END $$;

-- UNIQUE(agent, version)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_agent_prompt_versions_agent_version'
  ) THEN
    ALTER TABLE agent_prompt_versions
      ADD CONSTRAINT uq_agent_prompt_versions_agent_version UNIQUE (agent, version);
  END IF;
END $$;

-- Index for prompt selection: find active prompts per agent
CREATE INDEX IF NOT EXISTS idx_agent_prompt_versions_agent_active
  ON agent_prompt_versions (agent, active);

-- ============================================================================
-- 4. RLS policies (service_role full access, admin read on prompt versions)
-- ============================================================================

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_prompt_versions ENABLE ROW LEVEL SECURITY;

-- Service role: full access on all three tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'idempotency_keys' AND policyname = 'service_role_all_idempotency_keys'
  ) THEN
    CREATE POLICY service_role_all_idempotency_keys
      ON idempotency_keys
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'whatsapp_outbox' AND policyname = 'service_role_all_whatsapp_outbox'
  ) THEN
    CREATE POLICY service_role_all_whatsapp_outbox
      ON whatsapp_outbox
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_prompt_versions' AND policyname = 'service_role_all_agent_prompt_versions'
  ) THEN
    CREATE POLICY service_role_all_agent_prompt_versions
      ON agent_prompt_versions
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Admin read access on agent_prompt_versions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_prompt_versions' AND policyname = 'admin_read_agent_prompt_versions'
  ) THEN
    CREATE POLICY admin_read_agent_prompt_versions
      ON agent_prompt_versions
      FOR SELECT TO authenticated
      USING (auth.jwt() ->> 'role' = 'admin');
  END IF;
END $$;

COMMIT;
