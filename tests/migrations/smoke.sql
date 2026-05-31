-- =============================================================================
-- Smoke / migration tests for the sahayak-multi-agent-router spec (task 1.9)
-- =============================================================================
-- Spec        : .kiro/specs/sahayak-multi-agent-router
-- Validates   : Requirements 18.1 - 18.13 (+ 18.15), NFR Reliability
-- Design refs : design.md §Smoke / migration tests, §SQL DDL, §Data Models
--
-- WHAT THIS DOES
--   Asserts that every DDL object introduced by migrations 20260101_001 .. 010
--   actually exists in the live schema after the migrations have run:
--     * table existence              (Req 18.1, 18.3, 18.5, 18.6, 18.7)
--     * column existence + data type (Req 18.2, 18.4, 18.8, 18.9, 18.15)
--     * column nullability fixes      (Req 18.15 tokens_used, 1.9 agent_dispatched)
--     * indexes                       (observability + matcher hot paths)
--     * RLS enabled + named policies  (Req 18.13)
--     * CHECK / UNIQUE constraints    (medical + cascade invariants)
--     * functions and trigger presence (Req 18.10, 18.11, 18.12)
--     * donation_history immutability  (Req 8.2 — UPDATE/DELETE revoked)
--   It also runs a handful of pure-function value checks
--   (calculate_next_eligible_date, get_compatible_blood_groups) so the cooldown
--   math and ABO/Rh matrix are smoke-tested, not just present.
--
-- HOW TO RUN
--   psql:  psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f tests/migrations/smoke.sql
--   node:  node tests/migrations/run-smoke.js   (see that file / README.md)
--
-- BEHAVIOUR
--   The script is non-destructive and read-only against application data. It is
--   designed to be PORTABLE: it uses no pgTAP extension, only the system
--   catalogs + information_schema, so it runs on any Postgres / Supabase
--   instance. It collects ALL assertion results into a session-temp table and
--   prints a TAP-style report, then RAISES at the end if any assertion failed
--   (so a non-zero exit / failed query is surfaced to CI).
--
--   Pre-requisite: the base schema (blood_donors, blood_requests,
--   blood_donor_responses, conversation_sessions) and migrations 001..010 must
--   already be applied. Tables that are created by the base JS-15 v1 schema and
--   only ALTERed by these migrations (blood_requests, blood_donor_responses)
--   are asserted to exist; a clear failure is reported if they are missing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Results sink (session-temp; lives for the duration of this connection)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS pg_temp.smoke_results;
CREATE TEMP TABLE smoke_results (
  id     serial PRIMARY KEY,
  label  text    NOT NULL,
  passed boolean NOT NULL,
  detail text
);

-- -----------------------------------------------------------------------------
-- 1. Assertion helpers (created in pg_temp, dropped automatically at session end)
-- -----------------------------------------------------------------------------

-- generic boolean assertion
CREATE OR REPLACE FUNCTION pg_temp.expect(p_cond boolean, p_label text, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.smoke_results (label, passed, detail)
  VALUES (p_label, COALESCE(p_cond, false), CASE WHEN COALESCE(p_cond, false) THEN NULL ELSE p_detail END);
END;
$$;

-- table exists in public schema
CREATE OR REPLACE FUNCTION pg_temp.check_table(p_table text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = p_table AND table_type = 'BASE TABLE'
  ) INTO v_ok;
  PERFORM pg_temp.expect(v_ok, format('table %I exists', p_table), 'missing base table');
END;
$$;

-- column exists, with optional data_type match
CREATE OR REPLACE FUNCTION pg_temp.check_column(p_table text, p_column text, p_type text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_type text;
BEGIN
  SELECT data_type INTO v_type FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column;

  IF v_type IS NULL THEN
    PERFORM pg_temp.expect(false, format('column %I.%I exists', p_table, p_column), 'column not found');
    RETURN;
  END IF;

  IF p_type IS NULL THEN
    PERFORM pg_temp.expect(true, format('column %I.%I exists', p_table, p_column));
  ELSE
    PERFORM pg_temp.expect(v_type = p_type,
      format('column %I.%I is %s', p_table, p_column, p_type),
      format('expected %s, found %s', p_type, v_type));
  END IF;
END;
$$;

-- column nullability: p_nullable true => IS NULLABLE, false => NOT NULL
CREATE OR REPLACE FUNCTION pg_temp.check_nullable(p_table text, p_column text, p_nullable boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_is_nullable text;
BEGIN
  SELECT is_nullable INTO v_is_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column;

  IF v_is_nullable IS NULL THEN
    PERFORM pg_temp.expect(false,
      format('column %I.%I nullability', p_table, p_column), 'column not found');
    RETURN;
  END IF;

  PERFORM pg_temp.expect((v_is_nullable = 'YES') = p_nullable,
    format('column %I.%I is %s', p_table, p_column, CASE WHEN p_nullable THEN 'NULLABLE' ELSE 'NOT NULL' END),
    format('is_nullable=%s', v_is_nullable));
END;
$$;

-- column default contains a substring (e.g. 'ceo', '0', 'routine')
CREATE OR REPLACE FUNCTION pg_temp.check_default(p_table text, p_column text, p_needle text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_default text;
BEGIN
  SELECT column_default INTO v_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column;
  PERFORM pg_temp.expect(v_default IS NOT NULL AND v_default ILIKE '%'||p_needle||'%',
    format('column %I.%I default ~ %L', p_table, p_column, p_needle),
    format('default=%s', COALESCE(v_default, '<none>')));
END;
$$;

-- index exists by name
CREATE OR REPLACE FUNCTION pg_temp.check_index(p_index text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = p_index) INTO v_ok;
  PERFORM pg_temp.expect(v_ok, format('index %I exists', p_index), 'index missing');
END;
$$;

-- named constraint exists on table (any contype)
CREATE OR REPLACE FUNCTION pg_temp.check_constraint(p_table text, p_constraint text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t  ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname = p_table AND c.conname = p_constraint
  ) INTO v_ok;
  PERFORM pg_temp.expect(v_ok, format('constraint %I on %I exists', p_constraint, p_table), 'constraint missing');
END;
$$;

-- a CHECK constraint whose definition mentions p_needle exists on table
CREATE OR REPLACE FUNCTION pg_temp.check_check_def(p_table text, p_needle text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t  ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname = p_table AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%'||p_needle||'%'
  ) INTO v_ok;
  PERFORM pg_temp.expect(v_ok, p_label, format('no CHECK on %I matching %L', p_table, p_needle));
END;
$$;

-- RLS enabled on table
CREATE OR REPLACE FUNCTION pg_temp.check_rls(p_table text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT c.relrowsecurity INTO v_ok
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = p_table;
  PERFORM pg_temp.expect(COALESCE(v_ok, false), format('RLS enabled on %I', p_table),
    'row security disabled or table missing');
END;
$$;

-- named RLS policy exists on table
CREATE OR REPLACE FUNCTION pg_temp.check_policy(p_table text, p_policy text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = p_table AND policyname = p_policy
  ) INTO v_ok;
  PERFORM pg_temp.expect(v_ok, format('policy %I on %I exists', p_policy, p_table), 'policy missing');
END;
$$;

-- "admin role can read" capability (Req 18.13). Faithful to the requirement
-- rather than to a brittle policy NAME: passes when a SELECT (or ALL) policy
-- exists whose USING expression gates on the admin role. Migration 008 names
-- these admin_read_*, but this check also tolerates equivalently-gated
-- policies under a different name.
CREATE OR REPLACE FUNCTION pg_temp.check_admin_read(p_table text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = p_table
       AND cmd IN ('SELECT', 'ALL')
       AND COALESCE(qual, '') ILIKE '%admin%'
  ) INTO v_ok;
  PERFORM pg_temp.expect(v_ok, format('admin can SELECT %I (Req 18.13)', p_table),
    'no admin-gated SELECT policy found');
END;
$$;

-- "service role can insert/update" capability (Req 18.13). In Supabase the
-- service_role bypasses RLS, so this passes if the role has BYPASSRLS or an
-- explicit permissive ALL/INSERT policy exists for it.
CREATE OR REPLACE FUNCTION pg_temp.check_service_write(p_table text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_bypass boolean; v_policy boolean;
BEGIN
  SELECT COALESCE(bool_or(rolbypassrls), false) INTO v_bypass
    FROM pg_roles WHERE rolname = 'service_role';
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = p_table
       AND cmd IN ('ALL', 'INSERT', 'UPDATE')
       AND ('service_role' = ANY(roles) OR 'public' = ANY(roles))
  ) INTO v_policy;
  PERFORM pg_temp.expect(v_bypass OR v_policy,
    format('service_role can write %I (Req 18.13)', p_table),
    'no service_role write path (neither BYPASSRLS nor a permissive policy)');
END;
$$;

-- function exists by name (and optional argument-count match)
CREATE OR REPLACE FUNCTION pg_temp.check_function(p_name text, p_nargs integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = p_name
       AND (p_nargs IS NULL OR p.pronargs = p_nargs)
  ) INTO v_ok;
  PERFORM pg_temp.expect(v_ok,
    format('function %I(%s) exists', p_name, COALESCE(p_nargs::text, '*')), 'function missing');
END;
$$;

-- non-internal trigger exists on table by name
CREATE OR REPLACE FUNCTION pg_temp.check_trigger(p_table text, p_trigger text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger tg
      JOIN pg_class t  ON t.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname = p_table AND tg.tgname = p_trigger
       AND NOT tg.tgisinternal
  ) INTO v_ok;
  PERFORM pg_temp.expect(v_ok, format('trigger %I on %I exists', p_trigger, p_table), 'trigger missing');
END;
$$;

-- assert a role does NOT hold a privilege on a table (immutability). Skips if role absent.
CREATE OR REPLACE FUNCTION pg_temp.check_no_privilege(p_role text, p_table text, p_priv text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_has boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_role) THEN
    PERFORM pg_temp.expect(true, format('%s lacks %s on %I (role absent — skipped)', p_role, p_priv, p_table));
    RETURN;
  END IF;
  SELECT has_table_privilege(p_role, format('public.%I', p_table), p_priv) INTO v_has;
  PERFORM pg_temp.expect(NOT v_has, format('%s lacks %s on %I', p_role, p_priv, p_table),
    'privilege unexpectedly granted (donation_history must be immutable)');
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Run all assertions
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- ===========================================================================
  -- 2.1  Table existence
  -- ===========================================================================
  -- New tables created by these migrations (Req 18.1, 18.3, 18.5, 18.6, 18.7)
  PERFORM pg_temp.check_table('routing_decisions');     -- Req 18.1
  PERFORM pg_temp.check_table('agent_invocations');     -- Req 18.3
  PERFORM pg_temp.check_table('donation_history');      -- Req 18.5
  PERFORM pg_temp.check_table('cascade_notifications'); -- Req 18.6
  PERFORM pg_temp.check_table('screening_log');         -- Req 18.7
  PERFORM pg_temp.check_table('system_config');         -- task 7.4
  -- Base / extended tables that must be present for the ALTERs + FKs to apply
  PERFORM pg_temp.check_table('conversation_sessions');
  PERFORM pg_temp.check_table('blood_donors');
  PERFORM pg_temp.check_table('blood_requests');
  PERFORM pg_temp.check_table('blood_donor_responses');

  -- ===========================================================================
  -- 2.2  conversation_sessions columns (Req 18.2, 1.7)
  -- ===========================================================================
  PERFORM pg_temp.check_column('conversation_sessions', 'active_agent', 'text');
  PERFORM pg_temp.check_nullable('conversation_sessions', 'active_agent', false);
  PERFORM pg_temp.check_default('conversation_sessions', 'active_agent', 'ceo');
  PERFORM pg_temp.check_constraint('conversation_sessions', 'chk_session_active_agent');
  PERFORM pg_temp.check_column('conversation_sessions', 'last_activity_at', 'timestamp with time zone');
  PERFORM pg_temp.check_nullable('conversation_sessions', 'last_activity_at', false);

  -- ===========================================================================
  -- 2.3  routing_decisions columns (Req 18.1) + agent_dispatched NULLABLE (Req 1.9)
  -- ===========================================================================
  PERFORM pg_temp.check_column('routing_decisions', 'id', 'uuid');
  PERFORM pg_temp.check_column('routing_decisions', 'session_id', 'text');
  PERFORM pg_temp.check_column('routing_decisions', 'message_text', 'text');
  PERFORM pg_temp.check_column('routing_decisions', 'last_intent_before', 'text');
  PERFORM pg_temp.check_column('routing_decisions', 'agent_dispatched', 'text');
  PERFORM pg_temp.check_nullable('routing_decisions', 'agent_dispatched', true); -- stale-reset rows carry NULL
  PERFORM pg_temp.check_column('routing_decisions', 'reason', 'text');
  PERFORM pg_temp.check_nullable('routing_decisions', 'reason', false);
  PERFORM pg_temp.check_column('routing_decisions', 'trace_id', 'uuid');
  PERFORM pg_temp.check_column('routing_decisions', 'created_at', 'timestamp with time zone');
  PERFORM pg_temp.check_constraint('routing_decisions', 'chk_routing_agent_dispatched');

  -- ===========================================================================
  -- 2.4  agent_invocations columns (Req 18.3) + tokens_used NULLABLE (Req 18.15)
  -- ===========================================================================
  PERFORM pg_temp.check_column('agent_invocations', 'id', 'uuid');
  PERFORM pg_temp.check_column('agent_invocations', 'session_id', 'text');
  PERFORM pg_temp.check_nullable('agent_invocations', 'session_id', false);
  PERFORM pg_temp.check_column('agent_invocations', 'agent', 'text');
  PERFORM pg_temp.check_nullable('agent_invocations', 'agent', false);
  PERFORM pg_temp.check_column('agent_invocations', 'started_at', 'timestamp with time zone');
  PERFORM pg_temp.check_column('agent_invocations', 'completed_at', 'timestamp with time zone');
  PERFORM pg_temp.check_column('agent_invocations', 'tokens_used', 'integer');
  PERFORM pg_temp.check_nullable('agent_invocations', 'tokens_used', true);  -- Req 18.15
  PERFORM pg_temp.check_column('agent_invocations', 'tools_called', 'jsonb');
  PERFORM pg_temp.check_column('agent_invocations', 'success', 'boolean');
  PERFORM pg_temp.check_column('agent_invocations', 'error_message', 'text');
  PERFORM pg_temp.check_constraint('agent_invocations', 'chk_agent_invocations_agent');

  -- ===========================================================================
  -- 2.5  blood_donors medical columns (Req 18.4 / 8.1)
  -- ===========================================================================
  PERFORM pg_temp.check_column('blood_donors', 'date_of_birth', 'date');
  PERFORM pg_temp.check_column('blood_donors', 'weight_kg', 'integer');
  PERFORM pg_temp.check_column('blood_donors', 'deferral_until', 'date');
  PERFORM pg_temp.check_column('blood_donors', 'deferral_reason', 'text');
  PERFORM pg_temp.check_column('blood_donors', 'permanently_deferred', 'boolean');
  PERFORM pg_temp.check_column('blood_donors', 'permanent_deferral_reason_enc', 'bytea');
  PERFORM pg_temp.check_column('blood_donors', 'last_donation_type', 'text');
  PERFORM pg_temp.check_column('blood_donors', 'total_offers_accepted', 'integer');
  PERFORM pg_temp.check_column('blood_donors', 'donations_this_year', 'integer');
  PERFORM pg_temp.check_constraint('blood_donors', 'chk_donor_weight_kg');
  PERFORM pg_temp.check_constraint('blood_donors', 'chk_donor_last_donation_type');
  PERFORM pg_temp.check_constraint('blood_donors', 'chk_donor_gender');
  PERFORM pg_temp.check_index('idx_donors_lookup');

  -- ===========================================================================
  -- 2.6  blood_requests cascade columns (Req 18.8) + invariants
  -- ===========================================================================
  PERFORM pg_temp.check_column('blood_requests', 'cascade_tier', 'integer');
  PERFORM pg_temp.check_column('blood_requests', 'donors_confirmed_count', 'integer');
  PERFORM pg_temp.check_column('blood_requests', 'donors_standby_count', 'integer');
  PERFORM pg_temp.check_column('blood_requests', 'urgency', 'text');
  -- Assert the urgency enum CHECK by its allowed values, not by a brittle name
  -- (deployed DBs may use chk_blood_request_urgency vs chk_blood_requests_urgency).
  PERFORM pg_temp.check_check_def('blood_requests', 'critical', 'CHECK blood_requests.urgency enum (critical|urgent|routine) present');
  PERFORM pg_temp.check_constraint('blood_requests', 'chk_confirmed_le_needed'); -- Req 18.8 / race-safety

  -- ===========================================================================
  -- 2.7  blood_donor_responses (Req 18.9)
  -- ===========================================================================
  PERFORM pg_temp.check_column('blood_donor_responses', 'response_status', 'text');
  -- Assert by allowed values rather than a brittle constraint name
  -- (deployed DBs may use chk_response_status vs chk_blood_donor_responses_status).
  PERFORM pg_temp.check_check_def('blood_donor_responses', 'standby', 'CHECK blood_donor_responses.response_status enum present');
  PERFORM pg_temp.check_index('idx_responses_request_status');

  -- ===========================================================================
  -- 2.8  donation_history columns + immutability (Req 18.5 / 8.2)
  -- ===========================================================================
  PERFORM pg_temp.check_column('donation_history', 'id', 'uuid');
  PERFORM pg_temp.check_column('donation_history', 'donor_id', 'uuid');
  PERFORM pg_temp.check_nullable('donation_history', 'donor_id', false);
  PERFORM pg_temp.check_column('donation_history', 'blood_request_id', 'uuid');
  PERFORM pg_temp.check_nullable('donation_history', 'blood_request_id', true);
  PERFORM pg_temp.check_column('donation_history', 'donated_date', 'date');
  PERFORM pg_temp.check_nullable('donation_history', 'donated_date', false);
  PERFORM pg_temp.check_column('donation_history', 'donation_type', 'text');
  PERFORM pg_temp.check_column('donation_history', 'units', 'integer');
  PERFORM pg_temp.check_column('donation_history', 'hospital', 'text');
  PERFORM pg_temp.check_column('donation_history', 'hemoglobin_level', 'numeric');
  PERFORM pg_temp.check_nullable('donation_history', 'hemoglobin_level', true);
  PERFORM pg_temp.check_column('donation_history', 'notes', 'text');
  PERFORM pg_temp.check_column('donation_history', 'created_at', 'timestamp with time zone');
  PERFORM pg_temp.check_check_def('donation_history', 'donation_type', 'CHECK donation_history.donation_type enum present');
  PERFORM pg_temp.check_check_def('donation_history', 'units', 'CHECK donation_history.units bounds present');
  PERFORM pg_temp.check_index('idx_donation_history_donor');
  -- Immutability (Req 8.2): UPDATE/DELETE revoked from all roles
  PERFORM pg_temp.check_no_privilege('authenticated', 'donation_history', 'UPDATE');
  PERFORM pg_temp.check_no_privilege('authenticated', 'donation_history', 'DELETE');
  PERFORM pg_temp.check_no_privilege('anon',          'donation_history', 'UPDATE');
  PERFORM pg_temp.check_no_privilege('anon',          'donation_history', 'DELETE');
  PERFORM pg_temp.check_no_privilege('service_role',  'donation_history', 'UPDATE');
  PERFORM pg_temp.check_no_privilege('service_role',  'donation_history', 'DELETE');

  -- ===========================================================================
  -- 2.9  cascade_notifications (Req 18.6 / 5.8) + idempotency invariant (5.9)
  -- ===========================================================================
  PERFORM pg_temp.check_column('cascade_notifications', 'id', 'uuid');
  PERFORM pg_temp.check_column('cascade_notifications', 'blood_request_id', 'uuid');
  PERFORM pg_temp.check_nullable('cascade_notifications', 'blood_request_id', false);
  PERFORM pg_temp.check_column('cascade_notifications', 'donor_id', 'uuid');
  PERFORM pg_temp.check_nullable('cascade_notifications', 'donor_id', false);
  PERFORM pg_temp.check_column('cascade_notifications', 'tier', 'integer');
  PERFORM pg_temp.check_column('cascade_notifications', 'notified_at', 'timestamp with time zone');
  PERFORM pg_temp.check_column('cascade_notifications', 'responded_at', 'timestamp with time zone');
  PERFORM pg_temp.check_nullable('cascade_notifications', 'responded_at', true);
  PERFORM pg_temp.check_column('cascade_notifications', 'response', 'text');
  PERFORM pg_temp.check_check_def('cascade_notifications', 'tier', 'CHECK cascade_notifications.tier 1..4 present');
  PERFORM pg_temp.check_check_def('cascade_notifications', 'haan', 'CHECK cascade_notifications.response enum present');
  PERFORM pg_temp.check_constraint('cascade_notifications', 'uniq_cascade_request_donor_tier'); -- Req 5.9
  PERFORM pg_temp.check_index('idx_cascade_notif_request_tier');
  PERFORM pg_temp.check_index('idx_cascade_notif_donor');

  -- ===========================================================================
  -- 2.10 screening_log (Req 18.7 / 9.4)
  -- ===========================================================================
  PERFORM pg_temp.check_column('screening_log', 'id', 'uuid');
  PERFORM pg_temp.check_column('screening_log', 'donor_id', 'uuid');
  PERFORM pg_temp.check_nullable('screening_log', 'donor_id', false);
  PERFORM pg_temp.check_column('screening_log', 'blood_request_id', 'uuid');
  PERFORM pg_temp.check_nullable('screening_log', 'blood_request_id', true);
  PERFORM pg_temp.check_column('screening_log', 'screening_answers', 'jsonb');
  PERFORM pg_temp.check_nullable('screening_log', 'screening_answers', false);
  PERFORM pg_temp.check_column('screening_log', 'screening_passed', 'boolean');
  PERFORM pg_temp.check_nullable('screening_log', 'screening_passed', false);
  PERFORM pg_temp.check_column('screening_log', 'deferral_applied', 'boolean');
  PERFORM pg_temp.check_column('screening_log', 'created_at', 'timestamp with time zone');
  PERFORM pg_temp.check_index('idx_screening_log_donor');

  -- ===========================================================================
  -- 2.11 system_config (task 7.4)
  -- ===========================================================================
  PERFORM pg_temp.check_column('system_config', 'key', 'text');
  PERFORM pg_temp.check_column('system_config', 'value', 'text');
  PERFORM pg_temp.check_nullable('system_config', 'value', false);
  PERFORM pg_temp.check_column('system_config', 'updated_at', 'timestamp with time zone');

  -- ===========================================================================
  -- 2.12 Observability indexes (migration 001)
  -- ===========================================================================
  PERFORM pg_temp.check_index('idx_sessions_last_activity_at');
  PERFORM pg_temp.check_index('idx_routing_session_time');
  PERFORM pg_temp.check_index('idx_routing_agent_time');
  PERFORM pg_temp.check_index('idx_invocations_agent_time');

  -- ===========================================================================
  -- 2.13 Functions (Req 18.10, 18.12 / 8.3, 8.5, 8.6)
  -- ===========================================================================
  PERFORM pg_temp.check_function('calculate_next_eligible_date', 3);  -- Req 18.10
  PERFORM pg_temp.check_function('find_matching_donors');            -- Req 18.12
  PERFORM pg_temp.check_function('get_compatible_blood_groups', 1);
  PERFORM pg_temp.check_function('reset_yearly_donations', 0);
  PERFORM pg_temp.check_function('trg_fn_update_donor_after_donation', 0);

  -- ===========================================================================
  -- 2.14 Triggers (Req 18.11 / 8.4)
  -- ===========================================================================
  PERFORM pg_temp.check_trigger('donation_history', 'trg_update_donor_after_donation'); -- Req 18.11
  PERFORM pg_temp.check_trigger('blood_donors', 'trg_blood_donors_updated_at');
  PERFORM pg_temp.check_trigger('system_config', 'system_config_updated_at');

  -- ===========================================================================
  -- 2.15 RLS enabled on new tables (Req 18.13)
  -- ===========================================================================
  PERFORM pg_temp.check_rls('routing_decisions');
  PERFORM pg_temp.check_rls('agent_invocations');
  PERFORM pg_temp.check_rls('donation_history');
  PERFORM pg_temp.check_rls('cascade_notifications');
  PERFORM pg_temp.check_rls('screening_log');
  PERFORM pg_temp.check_rls('system_config');

  -- ===========================================================================
  -- 2.16 RLS capabilities (Req 18.13): admin can read, service role can write.
  --      Checked by capability (USING gates on admin / service_role can write)
  --      rather than by exact policy name, so naming drift between
  --      migration 008 (admin_read_*) and a deployed DB (svc_all_*) does not
  --      cause false negatives — but a genuinely MISSING admin-read path on a
  --      new table still fails loudly.
  -- ===========================================================================
  PERFORM pg_temp.check_admin_read('routing_decisions');
  PERFORM pg_temp.check_admin_read('agent_invocations');
  PERFORM pg_temp.check_admin_read('donation_history');
  PERFORM pg_temp.check_admin_read('cascade_notifications');
  PERFORM pg_temp.check_admin_read('screening_log');
  PERFORM pg_temp.check_service_write('routing_decisions');
  PERFORM pg_temp.check_service_write('agent_invocations');
  PERFORM pg_temp.check_service_write('cascade_notifications');
  PERFORM pg_temp.check_service_write('screening_log');
  -- Donor self-service reads (Req 18.13 — authenticated donors read own rows)
  PERFORM pg_temp.check_policy('donation_history',      'donor_read_own_history');
  PERFORM pg_temp.check_policy('screening_log',         'donor_read_own_screening');
END $$;

-- -----------------------------------------------------------------------------
-- 3. Pure-function value checks (cooldown math + ABO/Rh matrix)
--    These do not depend on application data: calculate_next_eligible_date with
--    a random (non-existent) donor id resolves gender => NULL, exercising the
--    type-driven branches (whole_blood default = 90, platelets/plasma = 14,
--    double_red = 168).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_base date := DATE '2026-01-01';
BEGIN
  PERFORM pg_temp.expect(
    calculate_next_eligible_date(gen_random_uuid(), 'platelets', v_base) = v_base + 14,
    'calculate_next_eligible_date platelets = +14d',
    'cooldown mismatch');
  PERFORM pg_temp.expect(
    calculate_next_eligible_date(gen_random_uuid(), 'plasma', v_base) = v_base + 14,
    'calculate_next_eligible_date plasma = +14d',
    'cooldown mismatch');
  PERFORM pg_temp.expect(
    calculate_next_eligible_date(gen_random_uuid(), 'double_red', v_base) = v_base + 168,
    'calculate_next_eligible_date double_red = +168d',
    'cooldown mismatch');
  PERFORM pg_temp.expect(
    calculate_next_eligible_date(gen_random_uuid(), 'whole_blood', v_base) = v_base + 90,
    'calculate_next_eligible_date whole_blood (no gender) = +90d',
    'cooldown mismatch');

  -- ABO/Rh matrix: O- is universal donor (only O- can give to O-), AB+ accepts all 8
  PERFORM pg_temp.expect(
    get_compatible_blood_groups('O-') = ARRAY['O-'],
    'get_compatible_blood_groups(O-) = {O-}',
    'matrix mismatch');
  PERFORM pg_temp.expect(
    array_length(get_compatible_blood_groups('AB+'), 1) = 8,
    'get_compatible_blood_groups(AB+) = all 8 groups',
    'AB+ should accept every group');
  PERFORM pg_temp.expect(
    get_compatible_blood_groups('zzz') = ARRAY[]::text[],
    'get_compatible_blood_groups(unknown) = {}',
    'unknown group should return empty array');
END $$;

-- -----------------------------------------------------------------------------
-- 4. Report (TAP-style) + fail the run if any assertion failed
-- -----------------------------------------------------------------------------
SELECT
  format('%s %s - %s%s',
         CASE WHEN passed THEN 'ok' ELSE 'not ok' END,
         id, label,
         CASE WHEN passed OR detail IS NULL THEN '' ELSE '  # '||detail END) AS tap
FROM pg_temp.smoke_results
ORDER BY id;

DO $$
DECLARE
  v_total  integer;
  v_failed integer;
  v_rec    record;
  v_msg    text := '';
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT passed) INTO v_total, v_failed FROM pg_temp.smoke_results;

  RAISE NOTICE '==================== SMOKE TEST SUMMARY ====================';
  RAISE NOTICE '1..%', v_total;
  RAISE NOTICE 'total: %  passed: %  failed: %', v_total, v_total - v_failed, v_failed;

  IF v_failed > 0 THEN
    FOR v_rec IN
      SELECT label, detail FROM pg_temp.smoke_results WHERE NOT passed ORDER BY id
    LOOP
      v_msg := v_msg || E'\n  - ' || v_rec.label || COALESCE('  # '||v_rec.detail, '');
    END LOOP;
    RAISE EXCEPTION E'Migration smoke tests FAILED (% of % assertions):%', v_failed, v_total, v_msg;
  END IF;

  RAISE NOTICE 'All % migration smoke assertions PASSED.', v_total;
END $$;
