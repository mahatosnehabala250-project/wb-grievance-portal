-- ============================================================================
-- Migration: 20260201_008_rls_policies.sql
-- Spec:      sahayak-multi-agent-router (task 17.8) — v1.1 batch
-- Purpose:   Enable Row Level Security and define access policies for every
--            new v1.1 operational table.
--
-- Requirements covered:
--   34.15 — Design §v1.1 Closing Note: every new v1.1 table SHALL have RLS
--           enabled with: service_role full access (insert/update/select),
--           admin role read (select), and NO access for ordinary authenticated
--           users (these are operational/internal tables, not citizen data).
--
-- Tables covered (all created by migrations 20260201_001..005):
--   router_classifier_cache   (001)
--   cascade_outcomes          (002)
--   cascade_policies          (002)
--   cascade_policy_audit      (002)
--   human_handoff_queue       (003)
--   guardrail_violations      (003)
--   query_cache               (003)
--   idempotency_keys          (004)
--   whatsapp_outbox           (004)
--   agent_prompt_versions     (004)
--   agent_prompt_outcomes     (005)
--   circuit_state             (005)
--   donor_response_queue      (005)
--
-- NOTE: mv_session_token_stats (005) is a MATERIALIZED VIEW — RLS does not
--       apply to materialized views, so it is intentionally excluded here.
--
-- Supabase / convention notes (matches v1 migration 20260101_008_rls_policies):
--   - Admin reads are expressed as the v1 JWT-claim convention:
--         FOR SELECT TO authenticated USING (auth.jwt() ->> 'role' = 'admin')
--     This keeps v1.1 policies consistent with v1 (and with migration 004).
--   - In Supabase the service_role key bypasses RLS entirely; the explicit
--     FOR ALL TO service_role policies below are belt-and-suspenders so the
--     n8n / Vercel backends retain full insert/update/select (and cleanup
--     delete) access even if a future role grant changes that default. This
--     also satisfies the Req 34.15 "service-role insert/update/select" clause
--     explicitly rather than relying solely on the bypass.
--   - Ordinary authenticated users (non-admin) get NO policy that grants
--     access, so with RLS enabled every operation is denied for them.
--
-- Idempotency:
--   - ALTER TABLE ... ENABLE ROW LEVEL SECURITY is a no-op if already enabled
--     (migrations 002 and 004 already enabled RLS on some of these tables).
--   - Each policy is DROP POLICY IF EXISTS'd before CREATE POLICY. Prior
--     policy names created by migrations 002/004 are also dropped so that this
--     migration consolidates RLS into a single consistent convention without
--     leaving behind duplicate / divergent policies. Safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- router_classifier_cache  (migration 001)
-- ============================================================================
ALTER TABLE router_classifier_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_router_classifier_cache ON router_classifier_cache;
DROP POLICY IF EXISTS admin_read_router_classifier_cache  ON router_classifier_cache;

CREATE POLICY service_all_router_classifier_cache ON router_classifier_cache
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY admin_read_router_classifier_cache ON router_classifier_cache
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- cascade_outcomes  (migration 002)
--   Drops the prior 002 policy names to consolidate onto the v1 convention.
-- ============================================================================
ALTER TABLE cascade_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_cascade_outcomes  ON cascade_outcomes;
DROP POLICY IF EXISTS admin_read_cascade_outcomes   ON cascade_outcomes;
DROP POLICY IF EXISTS cascade_outcomes_service_all  ON cascade_outcomes;  -- legacy (002)
DROP POLICY IF EXISTS cascade_outcomes_admin_read   ON cascade_outcomes;  -- legacy (002)

CREATE POLICY service_all_cascade_outcomes ON cascade_outcomes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY admin_read_cascade_outcomes ON cascade_outcomes
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- cascade_policies  (migration 002)
-- ============================================================================
ALTER TABLE cascade_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_cascade_policies  ON cascade_policies;
DROP POLICY IF EXISTS admin_read_cascade_policies   ON cascade_policies;
DROP POLICY IF EXISTS cascade_policies_service_all  ON cascade_policies;  -- legacy (002)
DROP POLICY IF EXISTS cascade_policies_admin_read   ON cascade_policies;  -- legacy (002)

CREATE POLICY service_all_cascade_policies ON cascade_policies
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY admin_read_cascade_policies ON cascade_policies
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- cascade_policy_audit  (migration 002)
-- ============================================================================
ALTER TABLE cascade_policy_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_cascade_policy_audit ON cascade_policy_audit;
DROP POLICY IF EXISTS admin_read_cascade_policy_audit  ON cascade_policy_audit;
DROP POLICY IF EXISTS cascade_policy_audit_service_all ON cascade_policy_audit;  -- legacy (002)
DROP POLICY IF EXISTS cascade_policy_audit_admin_read  ON cascade_policy_audit;  -- legacy (002)

CREATE POLICY service_all_cascade_policy_audit ON cascade_policy_audit
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY admin_read_cascade_policy_audit ON cascade_policy_audit
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- human_handoff_queue  (migration 003)
-- ============================================================================
ALTER TABLE human_handoff_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_human_handoff_queue ON human_handoff_queue;
DROP POLICY IF EXISTS admin_read_human_handoff_queue  ON human_handoff_queue;

CREATE POLICY service_all_human_handoff_queue ON human_handoff_queue
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY admin_read_human_handoff_queue ON human_handoff_queue
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- guardrail_violations  (migration 003)
-- ============================================================================
ALTER TABLE guardrail_violations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_guardrail_violations ON guardrail_violations;
DROP POLICY IF EXISTS admin_read_guardrail_violations  ON guardrail_violations;

CREATE POLICY service_all_guardrail_violations ON guardrail_violations
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY admin_read_guardrail_violations ON guardrail_violations
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- query_cache  (migration 003)
-- ============================================================================
ALTER TABLE query_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_query_cache ON query_cache;
DROP POLICY IF EXISTS admin_read_query_cache  ON query_cache;

CREATE POLICY service_all_query_cache ON query_cache
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY admin_read_query_cache ON query_cache
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- idempotency_keys  (migration 004)
-- ============================================================================
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_idempotency_keys      ON idempotency_keys;
DROP POLICY IF EXISTS admin_read_idempotency_keys       ON idempotency_keys;
DROP POLICY IF EXISTS service_role_all_idempotency_keys ON idempotency_keys;  -- legacy (004)

CREATE POLICY service_all_idempotency_keys ON idempotency_keys
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY admin_read_idempotency_keys ON idempotency_keys
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- whatsapp_outbox  (migration 004)
-- ============================================================================
ALTER TABLE whatsapp_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_whatsapp_outbox      ON whatsapp_outbox;
DROP POLICY IF EXISTS admin_read_whatsapp_outbox       ON whatsapp_outbox;
DROP POLICY IF EXISTS service_role_all_whatsapp_outbox ON whatsapp_outbox;  -- legacy (004)

CREATE POLICY service_all_whatsapp_outbox ON whatsapp_outbox
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY admin_read_whatsapp_outbox ON whatsapp_outbox
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- agent_prompt_versions  (migration 004)
-- ============================================================================
ALTER TABLE agent_prompt_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_agent_prompt_versions      ON agent_prompt_versions;
DROP POLICY IF EXISTS admin_read_agent_prompt_versions       ON agent_prompt_versions;  -- also legacy (004)
DROP POLICY IF EXISTS service_role_all_agent_prompt_versions ON agent_prompt_versions;  -- legacy (004)

CREATE POLICY service_all_agent_prompt_versions ON agent_prompt_versions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY admin_read_agent_prompt_versions ON agent_prompt_versions
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- agent_prompt_outcomes  (migration 005)
-- ============================================================================
ALTER TABLE agent_prompt_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_agent_prompt_outcomes ON agent_prompt_outcomes;
DROP POLICY IF EXISTS admin_read_agent_prompt_outcomes  ON agent_prompt_outcomes;

CREATE POLICY service_all_agent_prompt_outcomes ON agent_prompt_outcomes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY admin_read_agent_prompt_outcomes ON agent_prompt_outcomes
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- circuit_state  (migration 005)
-- ============================================================================
ALTER TABLE circuit_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_circuit_state ON circuit_state;
DROP POLICY IF EXISTS admin_read_circuit_state  ON circuit_state;

CREATE POLICY service_all_circuit_state ON circuit_state
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY admin_read_circuit_state ON circuit_state
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- donor_response_queue  (migration 005)
-- ============================================================================
ALTER TABLE donor_response_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_donor_response_queue ON donor_response_queue;
DROP POLICY IF EXISTS admin_read_donor_response_queue  ON donor_response_queue;

CREATE POLICY service_all_donor_response_queue ON donor_response_queue
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY admin_read_donor_response_queue ON donor_response_queue
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- Note on authenticated (non-admin) users:
--   No policy above grants ordinary authenticated users any access. With RLS
--   enabled and only an admin-conditional SELECT policy present, the USING
--   clause evaluates false for non-admin JWTs, so SELECT returns zero rows and
--   INSERT/UPDATE/DELETE are denied outright. This is the intended posture for
--   these internal operational tables (Req 34.15).
-- ============================================================================

COMMIT;
