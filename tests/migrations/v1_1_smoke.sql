-- =============================================================================
-- Smoke / migration tests for the sahayak-multi-agent-router v1.1 batch (task 17.9)
-- =============================================================================
-- Spec        : .kiro/specs/sahayak-multi-agent-router
-- Validates   : Requirements 34.1 - 34.16 (+ 23.x, 26.x, 28.5, 29.x, 30.7,
--               31.5, 33.3), Design §v1.1 Data sections
-- Design refs : design.md §v1.1.1 .. §v1.1.14
--
-- WHAT THIS DOES
--   Asserts that every DDL object introduced by the v1.1 migration batch
--   20260201_001 .. 008 actually exists in the live schema after the migrations
--   have run:
--     * table existence              (13 new v1.1 tables, Req 34.1-34.14)
--     * key column existence + type   (uuid/text/int/bool/jsonb/numeric/vector…)
--     * column nullability            (NOT NULL invariants on key columns)
--     * indexes                       (incl. the ivfflat ANN index
--                                      idx_query_cache_embedding on query_cache)
--     * CHECK / UNIQUE / FK constraints (enum + scope invariants)
--     * RLS enabled on all 13 tables  (Req 34.15)
--     * circuit_state seed rows        (gemini / whatsapp / embeddings, Req 29.1)
--     * cascade_policies default rows  (routine / urgent / critical, Req 23.2)
--     * conversation_sessions v1.1 columns (flow_stack, history_summary,
--                                      strike_count, session_tokens_24h, …)
--     * trace_id columns + per-trace indexes (Req 27.2 / 34.16)
--     * functions + triggers from 007  (trg_donor_invitation_counter,
--                                      decrement_30d_invitations,
--                                      trg_complaint_cache_invalidate,
--                                      rate_limit_check)
--     * mv_session_token_stats materialized view + its unique index (Req 30.7)
--
-- HOW TO RUN
--   psql:  psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f tests/migrations/v1_1_smoke.sql
--   node:  node tests/migrations/run-smoke.js v1_1_smoke.sql   (see that file)
--   npm :  npm run test:migrations:v1_1                        (see package.json)
--
-- BEHAVIOUR
--   Non-destructive and read-only against application data. PORTABLE: uses no
--   pgTAP extension, only the system catalogs + information_schema, so it runs
--   on any Postgres / Supabase instance. It collects ALL assertion results into
--   a session-temp table, prints a TAP-style report, then RAISEs at the end if
--   any assertion failed (so a non-zero exit / failed query surfaces to CI).
--
--   Pre-requisite: the v1 base schema + migrations 20260101_001..010 AND the
--   v1.1 batch 20260201_001..008 must already be applied. Tables only ALTERed
--   by these migrations (conversation_sessions, routing_decisions,
--   agent_invocations, blood_donors, cascade_notifications, screening_log,
--   complaints, intake_rate_limits) are asserted to exist; a clear failure is
--   reported if they are missing.
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
  PERFORM pg_temp.expect(v_ok, format('table %I exists', p_table), 'missing table');
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

-- column user-defined type (udt_name) match — used for the pgvector column
CREATE OR REPLACE FUNCTION pg_temp.check_udt(p_table text, p_column text, p_udt text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_udt text;
BEGIN
  SELECT udt_name INTO v_udt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column;
  PERFORM pg_temp.expect(v_udt = p_udt, format('column %I.%I udt is %s', p_table, p_column, p_udt),
    format('expected udt %s, found %s', p_udt, COALESCE(v_udt, '<none>')));
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

-- column default contains a substring (e.g. 'closed', 'queued', '0')
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

-- index exists by name (covers table indexes AND materialized-view indexes)
CREATE OR REPLACE FUNCTION pg_temp.check_index(p_index text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = p_index
  ) INTO v_ok;
  PERFORM pg_temp.expect(v_ok, format('index %I exists', p_index), 'index missing');
END;
$$;

-- index exists AND uses a given access method (e.g. 'ivfflat' for the ANN index)
CREATE OR REPLACE FUNCTION pg_temp.check_index_method(p_index text, p_method text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_method text;
BEGIN
  SELECT am.amname INTO v_method
    FROM pg_class i
    JOIN pg_namespace n ON n.oid = i.relnamespace
    JOIN pg_am am       ON am.oid = i.relam
   WHERE n.nspname = 'public' AND i.relname = p_index AND i.relkind = 'i';
  PERFORM pg_temp.expect(v_method = p_method,
    format('index %I uses %s', p_index, p_method),
    format('expected access method %s, found %s', p_method, COALESCE(v_method, '<missing>')));
END;
$$;

-- named constraint exists on table (any contype: CHECK / UNIQUE / FK / PK)
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

-- a CHECK constraint whose definition mentions p_needle exists on table.
-- Used to assert enum-style CHECKs by an allowed VALUE rather than a brittle name.
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

-- "admin role can read" capability (Req 34.15). Faithful to the requirement
-- rather than a brittle policy NAME: passes when a SELECT (or ALL) policy
-- exists whose USING expression gates on the admin role. Migration 008 names
-- these admin_read_*, but this tolerates equivalently-gated policies.
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
  PERFORM pg_temp.expect(v_ok, format('admin can SELECT %I (Req 34.15)', p_table),
    'no admin-gated SELECT policy found');
END;
$$;

-- "service role can write" capability (Req 34.15). In Supabase service_role
-- bypasses RLS, so this passes if the role has BYPASSRLS or an explicit
-- permissive ALL/INSERT/UPDATE policy exists for it.
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
    format('service_role can write %I (Req 34.15)', p_table),
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

-- materialized view exists in public schema
CREATE OR REPLACE FUNCTION pg_temp.check_matview(p_name text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = p_name
  ) INTO v_ok;
  PERFORM pg_temp.expect(v_ok, format('materialized view %I exists', p_name), 'matview missing');
END;
$$;

-- at least p_min rows match a WHERE predicate (seed / default-row checks).
-- p_where is a trusted, hard-coded predicate from this test file only.
CREATE OR REPLACE FUNCTION pg_temp.check_count_ge(p_table text, p_where text, p_min integer, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_n integer;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', p_table, p_where) INTO v_n;
  PERFORM pg_temp.expect(v_n >= p_min, p_label, format('found %s rows, expected >= %s', v_n, p_min));
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Run all assertions
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- ===========================================================================
  -- 2.0  Base / ALTERed tables that must exist for the v1.1 ALTERs + FKs to apply
  -- ===========================================================================
  PERFORM pg_temp.check_table('conversation_sessions');
  PERFORM pg_temp.check_table('routing_decisions');
  PERFORM pg_temp.check_table('agent_invocations');
  PERFORM pg_temp.check_table('blood_donors');
  PERFORM pg_temp.check_table('blood_requests');
  PERFORM pg_temp.check_table('cascade_notifications');
  PERFORM pg_temp.check_table('screening_log');
  PERFORM pg_temp.check_table('complaints');
  PERFORM pg_temp.check_table('intake_rate_limits');

  -- ===========================================================================
  -- 2.1  v1.1 table existence — the 13 new operational tables
  -- ===========================================================================
  PERFORM pg_temp.check_table('router_classifier_cache');   -- Req 34.1   (001)
  PERFORM pg_temp.check_table('cascade_outcomes');          -- Req 34.5   (002)
  PERFORM pg_temp.check_table('cascade_policies');          -- Req 34.6   (002)
  PERFORM pg_temp.check_table('cascade_policy_audit');      -- Req 34.7   (002)
  PERFORM pg_temp.check_table('human_handoff_queue');       -- Req 34.9   (003)
  PERFORM pg_temp.check_table('guardrail_violations');      -- Req 34.10  (003)
  PERFORM pg_temp.check_table('query_cache');               -- Req 34.11  (003)
  PERFORM pg_temp.check_table('idempotency_keys');          -- Req 34.12  (004)
  PERFORM pg_temp.check_table('whatsapp_outbox');           -- Req 34.13  (004)
  PERFORM pg_temp.check_table('agent_prompt_versions');     -- Req 34.14  (004)
  PERFORM pg_temp.check_table('agent_prompt_outcomes');     -- Req 33.3   (005)
  PERFORM pg_temp.check_table('circuit_state');             -- Req 29.1   (005)
  PERFORM pg_temp.check_table('donor_response_queue');      -- Req 31.5   (005)

  -- ===========================================================================
  -- 2.2  router_classifier_cache columns (Req 34.1)
  -- ===========================================================================
  PERFORM pg_temp.check_column('router_classifier_cache', 'id', 'uuid');
  PERFORM pg_temp.check_column('router_classifier_cache', 'normalized_query', 'text');
  PERFORM pg_temp.check_nullable('router_classifier_cache', 'normalized_query', false);
  PERFORM pg_temp.check_column('router_classifier_cache', 'intent', 'text');
  PERFORM pg_temp.check_nullable('router_classifier_cache', 'intent', false);
  PERFORM pg_temp.check_column('router_classifier_cache', 'confidence', 'double precision');
  PERFORM pg_temp.check_column('router_classifier_cache', 'created_at', 'timestamp with time zone');
  PERFORM pg_temp.check_column('router_classifier_cache', 'expires_at', 'timestamp with time zone');
  PERFORM pg_temp.check_index('idx_router_cache_normalized_query');
  PERFORM pg_temp.check_index('idx_router_cache_expires_at');

  -- ===========================================================================
  -- 2.3  conversation_sessions v1.1 columns (Req 34.2, 34.3, 34.4; §v1.1.1-.3)
  --      NOTE: the three-strike counter column is named strike_count.
  -- ===========================================================================
  PERFORM pg_temp.check_column('conversation_sessions', 'flow_stack', 'jsonb');
  PERFORM pg_temp.check_nullable('conversation_sessions', 'flow_stack', false);
  PERFORM pg_temp.check_column('conversation_sessions', 'history_summary', 'jsonb');
  PERFORM pg_temp.check_nullable('conversation_sessions', 'history_summary', false);
  PERFORM pg_temp.check_column('conversation_sessions', 'session_tokens_24h', 'integer');
  PERFORM pg_temp.check_nullable('conversation_sessions', 'session_tokens_24h', false);
  PERFORM pg_temp.check_column('conversation_sessions', 'strike_count', 'integer');
  PERFORM pg_temp.check_nullable('conversation_sessions', 'strike_count', false);
  PERFORM pg_temp.check_column('conversation_sessions', 'handoff_active', 'boolean');
  PERFORM pg_temp.check_nullable('conversation_sessions', 'handoff_active', false);

  -- ===========================================================================
  -- 2.4  routing_decisions + agent_invocations v1.1 columns (§v1.1.1, §v1.1.8)
  -- ===========================================================================
  PERFORM pg_temp.check_column('routing_decisions', 'classifier_used', 'boolean');
  PERFORM pg_temp.check_column('routing_decisions', 'confidence', 'numeric');
  PERFORM pg_temp.check_column('routing_decisions', 'trace_id', 'uuid');

  PERFORM pg_temp.check_column('agent_invocations', 'trace_id', 'uuid');
  PERFORM pg_temp.check_column('agent_invocations', 'advanced_flow', 'boolean');
  PERFORM pg_temp.check_column('agent_invocations', 'queue_wait_ms', 'integer');
  PERFORM pg_temp.check_column('agent_invocations', 'guardrail_blocked', 'boolean');

  -- ===========================================================================
  -- 2.5  cascade_policies columns + invariants (Req 34.6 / 23.x)
  -- ===========================================================================
  PERFORM pg_temp.check_column('cascade_policies', 'id', 'uuid');
  PERFORM pg_temp.check_column('cascade_policies', 'urgency', 'text');
  PERFORM pg_temp.check_nullable('cascade_policies', 'urgency', false);
  PERFORM pg_temp.check_column('cascade_policies', 'hour_bucket', 'integer');
  PERFORM pg_temp.check_column('cascade_policies', 'district', 'text');
  PERFORM pg_temp.check_column('cascade_policies', 'blood_group', 'text');
  PERFORM pg_temp.check_column('cascade_policies', 'tier_1_count', 'integer');
  PERFORM pg_temp.check_column('cascade_policies', 'tier_2_count', 'integer');
  PERFORM pg_temp.check_column('cascade_policies', 'tier_3_count', 'integer');
  PERFORM pg_temp.check_column('cascade_policies', 'wait_1_minutes', 'integer');
  PERFORM pg_temp.check_column('cascade_policies', 'wait_2_minutes', 'integer');
  PERFORM pg_temp.check_column('cascade_policies', 'wait_3_minutes', 'integer');
  PERFORM pg_temp.check_column('cascade_policies', 'alpha', 'double precision');
  PERFORM pg_temp.check_column('cascade_policies', 'beta', 'double precision');
  PERFORM pg_temp.check_column('cascade_policies', 'source', 'text');
  PERFORM pg_temp.check_column('cascade_policies', 'weight', 'numeric');
  -- hour_bucket bounds + source enum asserted by definition (not brittle names)
  PERFORM pg_temp.check_check_def('cascade_policies', 'hour_bucket', 'CHECK cascade_policies.hour_bucket bounds present');
  PERFORM pg_temp.check_check_def('cascade_policies', 'bandit', 'CHECK cascade_policies.source enum (default|bandit|manual) present');
  -- one active policy per feature combination (named UNIQUE — stable)
  PERFORM pg_temp.check_constraint('cascade_policies', 'uq_cascade_policies_scope');
  PERFORM pg_temp.check_index('idx_cascade_policies_lookup');

  -- ===========================================================================
  -- 2.6  cascade_outcomes columns + indexes (Req 34.5)
  -- ===========================================================================
  PERFORM pg_temp.check_column('cascade_outcomes', 'id', 'uuid');
  PERFORM pg_temp.check_column('cascade_outcomes', 'policy_id', 'uuid');
  PERFORM pg_temp.check_column('cascade_outcomes', 'blood_request_id', 'uuid');
  PERFORM pg_temp.check_column('cascade_outcomes', 'urgency', 'text');
  PERFORM pg_temp.check_column('cascade_outcomes', 'tier_reached', 'integer');
  PERFORM pg_temp.check_column('cascade_outcomes', 'time_to_fulfill_minutes', 'integer');
  PERFORM pg_temp.check_column('cascade_outcomes', 'donors_notified', 'integer');
  PERFORM pg_temp.check_column('cascade_outcomes', 'donors_accepted', 'integer');
  PERFORM pg_temp.check_column('cascade_outcomes', 'success', 'boolean');
  PERFORM pg_temp.check_index('idx_cascade_outcomes_policy');
  PERFORM pg_temp.check_index('idx_cascade_outcomes_request');

  -- ===========================================================================
  -- 2.7  cascade_policy_audit columns + invariants (Req 34.7)
  -- ===========================================================================
  PERFORM pg_temp.check_column('cascade_policy_audit', 'id', 'uuid');
  PERFORM pg_temp.check_column('cascade_policy_audit', 'policy_id', 'uuid');
  PERFORM pg_temp.check_column('cascade_policy_audit', 'action', 'text');
  PERFORM pg_temp.check_nullable('cascade_policy_audit', 'action', false);
  PERFORM pg_temp.check_column('cascade_policy_audit', 'old_values', 'jsonb');
  PERFORM pg_temp.check_column('cascade_policy_audit', 'new_values', 'jsonb');
  PERFORM pg_temp.check_column('cascade_policy_audit', 'actor', 'text');
  PERFORM pg_temp.check_check_def('cascade_policy_audit', 'manual_override', 'CHECK cascade_policy_audit.action enum present');
  PERFORM pg_temp.check_index('idx_cascade_policy_audit_policy');

  -- ===========================================================================
  -- 2.8  blood_donors fairness columns (Req 23.5 / 34.8)
  -- ===========================================================================
  PERFORM pg_temp.check_column('blood_donors', 'last_invited_at', 'timestamp with time zone');
  PERFORM pg_temp.check_column('blood_donors', 'invitations_last_30d', 'integer');
  PERFORM pg_temp.check_nullable('blood_donors', 'invitations_last_30d', false);
  PERFORM pg_temp.check_index('idx_blood_donors_last_invited');

  -- ===========================================================================
  -- 2.9  human_handoff_queue columns + invariants (Req 34.9 / 24.4)
  -- ===========================================================================
  PERFORM pg_temp.check_column('human_handoff_queue', 'id', 'uuid');
  PERFORM pg_temp.check_column('human_handoff_queue', 'session_id', 'text');
  PERFORM pg_temp.check_nullable('human_handoff_queue', 'session_id', false);
  PERFORM pg_temp.check_column('human_handoff_queue', 'reason', 'text');
  PERFORM pg_temp.check_nullable('human_handoff_queue', 'reason', false);
  PERFORM pg_temp.check_column('human_handoff_queue', 'snapshot', 'jsonb');
  PERFORM pg_temp.check_column('human_handoff_queue', 'claimed_by', 'text');
  PERFORM pg_temp.check_column('human_handoff_queue', 'claimed_at', 'timestamp with time zone');
  PERFORM pg_temp.check_column('human_handoff_queue', 'resolved_at', 'timestamp with time zone');
  PERFORM pg_temp.check_column('human_handoff_queue', 'status', 'text');
  PERFORM pg_temp.check_nullable('human_handoff_queue', 'status', false);
  PERFORM pg_temp.check_check_def('human_handoff_queue', 'claimed', 'CHECK human_handoff_queue.status enum (pending|claimed|resolved) present');
  PERFORM pg_temp.check_check_def('human_handoff_queue', 'strike_3', 'CHECK human_handoff_queue.reason enum (strike_3|manual|system) present');
  PERFORM pg_temp.check_index('idx_handoff_status_created');

  -- ===========================================================================
  -- 2.10 guardrail_violations columns + invariants (Req 34.10 / 25.8)
  -- ===========================================================================
  PERFORM pg_temp.check_column('guardrail_violations', 'id', 'uuid');
  PERFORM pg_temp.check_column('guardrail_violations', 'session_id', 'text');
  PERFORM pg_temp.check_column('guardrail_violations', 'agent_invocation_id', 'uuid');
  PERFORM pg_temp.check_column('guardrail_violations', 'trace_id', 'uuid');
  PERFORM pg_temp.check_column('guardrail_violations', 'rule_name', 'text');
  PERFORM pg_temp.check_nullable('guardrail_violations', 'rule_name', false);
  PERFORM pg_temp.check_column('guardrail_violations', 'original_reply', 'text');
  PERFORM pg_temp.check_column('guardrail_violations', 'repaired_reply', 'text');
  PERFORM pg_temp.check_column('guardrail_violations', 'action', 'text');
  PERFORM pg_temp.check_nullable('guardrail_violations', 'action', false);
  PERFORM pg_temp.check_column('guardrail_violations', 'severity', 'text');
  PERFORM pg_temp.check_check_def('guardrail_violations', 'repaired', 'CHECK guardrail_violations.action enum (repaired|blocked|flagged) present');
  PERFORM pg_temp.check_check_def('guardrail_violations', 'high', 'CHECK guardrail_violations.severity enum (low|medium|high) present');
  -- FK back to agent_invocations (named — created when agent_invocations exists)
  PERFORM pg_temp.check_constraint('guardrail_violations', 'fk_guardrail_agent_invocation');
  PERFORM pg_temp.check_index('idx_guardrail_session_created');

  -- ===========================================================================
  -- 2.11 query_cache columns + invariants + ivfflat ANN index (Req 34.11 / 26.x)
  -- ===========================================================================
  PERFORM pg_temp.check_column('query_cache', 'id', 'uuid');
  PERFORM pg_temp.check_column('query_cache', 'query_hash', 'text');
  PERFORM pg_temp.check_nullable('query_cache', 'query_hash', false);
  PERFORM pg_temp.check_column('query_cache', 'query_text', 'text');
  PERFORM pg_temp.check_nullable('query_cache', 'query_text', false);
  -- pgvector column: information_schema reports USER-DEFINED; udt_name = 'vector'
  PERFORM pg_temp.check_column('query_cache', 'query_embedding');
  PERFORM pg_temp.check_udt('query_cache', 'query_embedding', 'vector');
  PERFORM pg_temp.check_column('query_cache', 'category', 'text');
  PERFORM pg_temp.check_nullable('query_cache', 'category', false);
  PERFORM pg_temp.check_column('query_cache', 'response', 'text');
  PERFORM pg_temp.check_nullable('query_cache', 'response', false);
  PERFORM pg_temp.check_column('query_cache', 'hit_count', 'integer');
  PERFORM pg_temp.check_column('query_cache', 'trace_id', 'uuid');
  PERFORM pg_temp.check_column('query_cache', 'expires_at', 'timestamp with time zone');
  PERFORM pg_temp.check_nullable('query_cache', 'expires_at', false);
  PERFORM pg_temp.check_check_def('query_cache', 'scheme', 'CHECK query_cache.category enum (status|scheme|help) present');
  -- The ivfflat ANN index — assert it exists AND that its access method is ivfflat
  PERFORM pg_temp.check_index('idx_query_cache_embedding');
  PERFORM pg_temp.check_index_method('idx_query_cache_embedding', 'ivfflat');
  PERFORM pg_temp.check_index('idx_query_cache_expires');
  PERFORM pg_temp.check_index('idx_query_cache_category_expires');

  -- ===========================================================================
  -- 2.12 idempotency_keys columns + invariants (Req 34.12)
  -- ===========================================================================
  PERFORM pg_temp.check_column('idempotency_keys', 'id', 'uuid');
  PERFORM pg_temp.check_column('idempotency_keys', 'key', 'text');
  PERFORM pg_temp.check_nullable('idempotency_keys', 'key', false);
  PERFORM pg_temp.check_column('idempotency_keys', 'endpoint', 'text');
  PERFORM pg_temp.check_nullable('idempotency_keys', 'endpoint', false);
  PERFORM pg_temp.check_column('idempotency_keys', 'response_status', 'integer');
  PERFORM pg_temp.check_column('idempotency_keys', 'response_body', 'jsonb');
  PERFORM pg_temp.check_column('idempotency_keys', 'expires_at', 'timestamp with time zone');
  PERFORM pg_temp.check_nullable('idempotency_keys', 'expires_at', false);
  PERFORM pg_temp.check_constraint('idempotency_keys', 'uq_idempotency_key_endpoint');
  PERFORM pg_temp.check_index('idx_idempotency_keys_expires_at');

  -- ===========================================================================
  -- 2.13 whatsapp_outbox columns + invariants (Req 34.13)
  -- ===========================================================================
  PERFORM pg_temp.check_column('whatsapp_outbox', 'id', 'uuid');
  PERFORM pg_temp.check_column('whatsapp_outbox', 'recipient_phone', 'text');
  PERFORM pg_temp.check_nullable('whatsapp_outbox', 'recipient_phone', false);
  PERFORM pg_temp.check_column('whatsapp_outbox', 'message_body', 'jsonb');
  PERFORM pg_temp.check_nullable('whatsapp_outbox', 'message_body', false);
  PERFORM pg_temp.check_column('whatsapp_outbox', 'status', 'text');
  PERFORM pg_temp.check_nullable('whatsapp_outbox', 'status', false);
  PERFORM pg_temp.check_column('whatsapp_outbox', 'attempts', 'integer');
  PERFORM pg_temp.check_column('whatsapp_outbox', 'max_attempts', 'integer');
  PERFORM pg_temp.check_column('whatsapp_outbox', 'scheduled_at', 'timestamp with time zone');
  PERFORM pg_temp.check_nullable('whatsapp_outbox', 'scheduled_at', false);
  PERFORM pg_temp.check_column('whatsapp_outbox', 'trace_id', 'uuid');
  PERFORM pg_temp.check_check_def('whatsapp_outbox', 'expired', 'CHECK whatsapp_outbox.status enum (pending|sent|failed|expired) present');
  PERFORM pg_temp.check_index('idx_whatsapp_outbox_status_scheduled');

  -- ===========================================================================
  -- 2.14 agent_prompt_versions columns + invariants (Req 34.14)
  -- ===========================================================================
  PERFORM pg_temp.check_column('agent_prompt_versions', 'id', 'uuid');
  PERFORM pg_temp.check_column('agent_prompt_versions', 'agent', 'text');
  PERFORM pg_temp.check_nullable('agent_prompt_versions', 'agent', false);
  PERFORM pg_temp.check_column('agent_prompt_versions', 'version', 'text');
  PERFORM pg_temp.check_nullable('agent_prompt_versions', 'version', false);
  PERFORM pg_temp.check_column('agent_prompt_versions', 'prompt_md', 'text');
  PERFORM pg_temp.check_nullable('agent_prompt_versions', 'prompt_md', false);
  PERFORM pg_temp.check_column('agent_prompt_versions', 'weight', 'double precision');
  PERFORM pg_temp.check_column('agent_prompt_versions', 'active', 'boolean');
  PERFORM pg_temp.check_nullable('agent_prompt_versions', 'active', false);
  PERFORM pg_temp.check_column('agent_prompt_versions', 'status', 'text');
  PERFORM pg_temp.check_check_def('agent_prompt_versions', 'complaint', 'CHECK agent_prompt_versions.agent enum (complaint|blood|donor|info) present');
  PERFORM pg_temp.check_check_def('agent_prompt_versions', 'archived', 'CHECK agent_prompt_versions.status enum (staging|active|archived) present');
  PERFORM pg_temp.check_constraint('agent_prompt_versions', 'uq_agent_prompt_versions_agent_version');
  PERFORM pg_temp.check_index('idx_agent_prompt_versions_agent_active');

  -- ===========================================================================
  -- 2.15 agent_prompt_outcomes columns + composite PK (Req 33.3)
  -- ===========================================================================
  PERFORM pg_temp.check_column('agent_prompt_outcomes', 'agent', 'text');
  PERFORM pg_temp.check_nullable('agent_prompt_outcomes', 'agent', false);
  PERFORM pg_temp.check_column('agent_prompt_outcomes', 'version', 'text');
  PERFORM pg_temp.check_nullable('agent_prompt_outcomes', 'version', false);
  PERFORM pg_temp.check_column('agent_prompt_outcomes', 'day', 'date');
  PERFORM pg_temp.check_nullable('agent_prompt_outcomes', 'day', false);
  PERFORM pg_temp.check_column('agent_prompt_outcomes', 'invocations', 'integer');
  PERFORM pg_temp.check_column('agent_prompt_outcomes', 'success_rate', 'numeric');
  PERFORM pg_temp.check_column('agent_prompt_outcomes', 'p95_latency_ms', 'integer');
  PERFORM pg_temp.check_column('agent_prompt_outcomes', 'escalation_rate', 'numeric');
  PERFORM pg_temp.check_column('agent_prompt_outcomes', 'helpful_rate', 'numeric');

  -- ===========================================================================
  -- 2.16 circuit_state columns + invariants (Req 29.1, 29.5)
  -- ===========================================================================
  PERFORM pg_temp.check_column('circuit_state', 'name', 'text');
  PERFORM pg_temp.check_nullable('circuit_state', 'name', false);
  PERFORM pg_temp.check_column('circuit_state', 'state', 'text');
  PERFORM pg_temp.check_nullable('circuit_state', 'state', false);
  PERFORM pg_temp.check_default('circuit_state', 'state', 'closed');
  PERFORM pg_temp.check_column('circuit_state', 'consecutive_failures', 'integer');
  PERFORM pg_temp.check_column('circuit_state', 'window_start', 'timestamp with time zone');
  PERFORM pg_temp.check_column('circuit_state', 'opened_at', 'timestamp with time zone');
  PERFORM pg_temp.check_column('circuit_state', 'last_probe_at', 'timestamp with time zone');
  PERFORM pg_temp.check_column('circuit_state', 'updated_at', 'timestamp with time zone');
  PERFORM pg_temp.check_check_def('circuit_state', 'embeddings', 'CHECK circuit_state.name enum (gemini|whatsapp|embeddings) present');
  PERFORM pg_temp.check_check_def('circuit_state', 'half_open', 'CHECK circuit_state.state enum (closed|open|half_open) present');

  -- ===========================================================================
  -- 2.17 donor_response_queue columns + invariants (Req 31.5)
  -- ===========================================================================
  PERFORM pg_temp.check_column('donor_response_queue', 'id', 'uuid');
  PERFORM pg_temp.check_column('donor_response_queue', 'blood_request_id', 'uuid');
  PERFORM pg_temp.check_nullable('donor_response_queue', 'blood_request_id', false);
  PERFORM pg_temp.check_column('donor_response_queue', 'donor_id', 'uuid');
  PERFORM pg_temp.check_nullable('donor_response_queue', 'donor_id', false);
  PERFORM pg_temp.check_column('donor_response_queue', 'received_at', 'timestamp with time zone');
  PERFORM pg_temp.check_nullable('donor_response_queue', 'received_at', false);
  PERFORM pg_temp.check_column('donor_response_queue', 'status', 'text');
  PERFORM pg_temp.check_nullable('donor_response_queue', 'status', false);
  PERFORM pg_temp.check_column('donor_response_queue', 'trace_id', 'uuid');
  PERFORM pg_temp.check_check_def('donor_response_queue', 'skipped', 'CHECK donor_response_queue.status enum (queued|processing|done|skipped) present');
  PERFORM pg_temp.check_index('idx_drq_request_received');
  PERFORM pg_temp.check_index('idx_drq_status');

  -- ===========================================================================
  -- 2.18 trace_id columns + per-trace indexes (Req 27.2 / 34.16, migration 006)
  -- ===========================================================================
  PERFORM pg_temp.check_column('cascade_notifications', 'trace_id', 'uuid');
  PERFORM pg_temp.check_column('screening_log',         'trace_id', 'uuid');
  PERFORM pg_temp.check_index('idx_routing_trace');
  PERFORM pg_temp.check_index('idx_invocations_trace');
  PERFORM pg_temp.check_index('idx_cascade_trace');
  PERFORM pg_temp.check_index('idx_screening_trace');
  PERFORM pg_temp.check_index('idx_query_cache_trace');
  PERFORM pg_temp.check_index('idx_outbox_trace');
  PERFORM pg_temp.check_index('idx_guardrail_trace');

  -- ===========================================================================
  -- 2.19 Functions + triggers (migration 007)
  -- ===========================================================================
  PERFORM pg_temp.check_function('trg_fn_donor_invitation_counter', 0);   -- Req 23.5
  PERFORM pg_temp.check_function('decrement_30d_invitations', 0);         -- Req 23.5
  PERFORM pg_temp.check_function('trg_fn_complaint_cache_invalidate', 0); -- Req 26.1
  PERFORM pg_temp.check_function('rate_limit_check', 4);                  -- Req 28.5
  PERFORM pg_temp.check_trigger('cascade_notifications', 'trg_donor_invitation_counter');
  PERFORM pg_temp.check_trigger('complaints',            'trg_complaint_cache_invalidate');

  -- ===========================================================================
  -- 2.20 mv_session_token_stats materialized view + unique index (Req 30.7)
  -- ===========================================================================
  PERFORM pg_temp.check_matview('mv_session_token_stats');
  PERFORM pg_temp.check_index('idx_mv_session_token_stats_day');

  -- ===========================================================================
  -- 2.21 RLS enabled on all 13 new v1.1 tables (Req 34.15)
  -- ===========================================================================
  PERFORM pg_temp.check_rls('router_classifier_cache');
  PERFORM pg_temp.check_rls('cascade_outcomes');
  PERFORM pg_temp.check_rls('cascade_policies');
  PERFORM pg_temp.check_rls('cascade_policy_audit');
  PERFORM pg_temp.check_rls('human_handoff_queue');
  PERFORM pg_temp.check_rls('guardrail_violations');
  PERFORM pg_temp.check_rls('query_cache');
  PERFORM pg_temp.check_rls('idempotency_keys');
  PERFORM pg_temp.check_rls('whatsapp_outbox');
  PERFORM pg_temp.check_rls('agent_prompt_versions');
  PERFORM pg_temp.check_rls('agent_prompt_outcomes');
  PERFORM pg_temp.check_rls('circuit_state');
  PERFORM pg_temp.check_rls('donor_response_queue');

  -- ===========================================================================
  -- 2.22 RLS capabilities (Req 34.15): admin can read, service_role can write.
  --      Checked by capability rather than exact policy name, so the policy
  --      consolidation in migration 008 (service_all_* / admin_read_*) does not
  --      make these brittle — but a genuinely MISSING path still fails loudly.
  -- ===========================================================================
  PERFORM pg_temp.check_admin_read('router_classifier_cache');
  PERFORM pg_temp.check_admin_read('cascade_policies');
  PERFORM pg_temp.check_admin_read('human_handoff_queue');
  PERFORM pg_temp.check_admin_read('query_cache');
  PERFORM pg_temp.check_admin_read('circuit_state');
  PERFORM pg_temp.check_service_write('router_classifier_cache');
  PERFORM pg_temp.check_service_write('whatsapp_outbox');
  PERFORM pg_temp.check_service_write('idempotency_keys');
  PERFORM pg_temp.check_service_write('donor_response_queue');
END $$;

-- -----------------------------------------------------------------------------
-- 3. Seed / default-row checks (no application data dependency — these rows are
--    inserted by the migrations themselves).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- circuit_state seed rows: the three breakers (Req 29.1, migration 005)
  PERFORM pg_temp.check_count_ge('circuit_state', 'name = ''gemini''',     1, 'circuit_state seed row gemini present');
  PERFORM pg_temp.check_count_ge('circuit_state', 'name = ''whatsapp''',   1, 'circuit_state seed row whatsapp present');
  PERFORM pg_temp.check_count_ge('circuit_state', 'name = ''embeddings''', 1, 'circuit_state seed row embeddings present');

  -- cascade_policies default rows: one per urgency, source = 'default' (Req 23.2, migration 002)
  PERFORM pg_temp.check_count_ge('cascade_policies', 'urgency = ''routine''  AND source = ''default''', 1, 'cascade_policies default rows for routine present');
  PERFORM pg_temp.check_count_ge('cascade_policies', 'urgency = ''urgent''   AND source = ''default''', 1, 'cascade_policies default rows for urgent present');
  PERFORM pg_temp.check_count_ge('cascade_policies', 'urgency = ''critical'' AND source = ''default''', 1, 'cascade_policies default rows for critical present');
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

  RAISE NOTICE '================== v1.1 SMOKE TEST SUMMARY ==================';
  RAISE NOTICE '1..%', v_total;
  RAISE NOTICE 'total: %  passed: %  failed: %', v_total, v_total - v_failed, v_failed;

  IF v_failed > 0 THEN
    FOR v_rec IN
      SELECT label, detail FROM pg_temp.smoke_results WHERE NOT passed ORDER BY id
    LOOP
      v_msg := v_msg || E'\n  - ' || v_rec.label || COALESCE('  # '||v_rec.detail, '');
    END LOOP;
    RAISE EXCEPTION E'v1.1 migration smoke tests FAILED (% of % assertions):%', v_failed, v_total, v_msg;
  END IF;

  RAISE NOTICE 'All % v1.1 migration smoke assertions PASSED.', v_total;
END $$;
