-- ============================================================================
-- Migration: 20260101_010_webhook_config.sql
-- Spec:      sahayak-multi-agent-router (task 15.2)
-- Purpose:   Create n8n_webhook_config table — a single-row toggle controlling
--            which n8n workflow ID receives the WhatsApp webhook trigger.
--            Enables < 60s rollback between JS-01 (v1) and JS-01v2 by flipping
--            the 'active_workflow' row without redeployment.
--
-- Requirements covered:
--   19.1 : Single-flag webhook switch for migration
--   19.3 : Admin-controlled rollback path
--   NFR Security : Admin-only write access via RLS
--
-- Idempotency:
--   - CREATE TABLE IF NOT EXISTS is safe for re-runs.
--   - INSERT ... ON CONFLICT DO NOTHING prevents duplicate seed rows.
--   - Trigger and policies are dropped (IF EXISTS) before re-creation.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Create n8n_webhook_config table
-- ============================================================================
CREATE TABLE IF NOT EXISTS n8n_webhook_config (
  key        text        PRIMARY KEY,
  value      text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on every change
CREATE OR REPLACE FUNCTION trg_n8n_webhook_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS n8n_webhook_config_updated_at ON n8n_webhook_config;
CREATE TRIGGER n8n_webhook_config_updated_at
  BEFORE UPDATE ON n8n_webhook_config
  FOR EACH ROW
  EXECUTE FUNCTION trg_n8n_webhook_config_updated_at();

-- ============================================================================
-- 2. Seed default configuration
--    'active_workflow' controls which workflow receives WhatsApp webhooks.
--    Valid values: 'JS-01' (legacy v1) or 'JS-01v2' (multi-agent router).
-- ============================================================================
INSERT INTO n8n_webhook_config (key, value) VALUES
  ('active_workflow', 'JS-01v2')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. Enable Row Level Security
-- ============================================================================
ALTER TABLE n8n_webhook_config ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. RLS Policies
--    - service_role: full access (used by API routes with SUPABASE_SERVICE_ROLE_KEY)
--    - authenticated admin: read + update (for the admin endpoint)
-- ============================================================================

DROP POLICY IF EXISTS service_role_all_n8n_webhook_config ON n8n_webhook_config;
CREATE POLICY service_role_all_n8n_webhook_config ON n8n_webhook_config
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS admin_read_n8n_webhook_config ON n8n_webhook_config;
CREATE POLICY admin_read_n8n_webhook_config ON n8n_webhook_config
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

DROP POLICY IF EXISTS admin_update_n8n_webhook_config ON n8n_webhook_config;
CREATE POLICY admin_update_n8n_webhook_config ON n8n_webhook_config
  FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin')
  WITH CHECK (auth.jwt() ->> 'role' = 'admin');

COMMIT;
