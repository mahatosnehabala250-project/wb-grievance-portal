-- ============================================================================
-- Migration: 20260201_010_enable_rls_internal_tables.sql
-- Spec:      sahayak-multi-agent-router — production-hardening pass (Req 18.13)
-- Purpose:   Enable Row Level Security on three internal-only tables that the
--            Supabase security advisor flagged as fully exposed to the anon /
--            authenticated roles.
--
-- These tables are written/read EXCLUSIVELY by the service role:
--   - circuit_state          (v1.1.10 circuit breakers — n8n + /api routes)
--   - donor_response_queue   (SOS fan-out queue — cron drainer)
--   - agent_prompt_outcomes  (A/B prompt outcome aggregation — nightly job)
--
-- The service role bypasses RLS, so enabling RLS with NO policies is the correct
-- production posture: it denies all access via the anon / publishable keys while
-- leaving service-role access unaffected. This mirrors the deny-by-default stance
-- of 20260201_008_rls_policies.sql for the other v1.1 tables.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is safe to re-run.
-- ============================================================================

ALTER TABLE public.circuit_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donor_response_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_prompt_outcomes ENABLE ROW LEVEL SECURITY;
