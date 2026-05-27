-- ============================================================================
-- Migration: 20260101_009_system_config.sql
-- Spec:      sahayak-multi-agent-router (task 7.4)
-- Purpose:   Create system_config table for runtime feature flags and
--            operational configuration. Enables feature-flag-driven rollout
--            of capabilities (e.g., INFO_USE_EMBEDDINGS) without redeployment.
--
-- Requirements covered:
--   11.3 : Info Code Path Phase 2 gated behind INFO_USE_EMBEDDINGS flag
--   11.5 : Runtime feature-flag resolution for Status / Info Code Path
--
-- Idempotency:
--   - CREATE TABLE IF NOT EXISTS is safe for re-runs.
--   - INSERT ... ON CONFLICT DO NOTHING prevents duplicate seed rows.
--   - Policies are dropped (IF EXISTS) before being re-created.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Create system_config table
-- ============================================================================
CREATE TABLE IF NOT EXISTS system_config (
  key        text        PRIMARY KEY,
  value      text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on every change
CREATE OR REPLACE FUNCTION trg_system_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS system_config_updated_at ON system_config;
CREATE TRIGGER system_config_updated_at
  BEFORE UPDATE ON system_config
  FOR EACH ROW
  EXECUTE FUNCTION trg_system_config_updated_at();

-- ============================================================================
-- 2. Seed default configuration flags
-- ============================================================================
INSERT INTO system_config (key, value) VALUES
  ('INFO_USE_EMBEDDINGS', 'false'),
  ('ACTIVE_WORKFLOW_VERSION', 'v2'),
  ('DONOR_CASCADE_ENABLED', 'true'),
  ('MAX_CASCADE_TIER', '4')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. Enable Row Level Security
-- ============================================================================
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. RLS Policies
--    - service_role bypasses RLS by default in Supabase (used by n8n backend
--      and API routes with SUPABASE_SERVICE_ROLE_KEY).
--    - Admin role can read all config values.
-- ============================================================================

-- Service role bypass policy (explicit for clarity, though service_role
-- already bypasses RLS in Supabase)
DROP POLICY IF EXISTS service_role_all_system_config ON system_config;
CREATE POLICY service_role_all_system_config ON system_config
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Admin read policy
DROP POLICY IF EXISTS admin_read_system_config ON system_config;
CREATE POLICY admin_read_system_config ON system_config
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

COMMIT;
