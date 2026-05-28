-- ============================================================================
-- Migration: 20260201_001_router_classifier_cache_and_session_columns.sql
-- Spec:      sahayak-multi-agent-router (task 17.1) — v1.1 batch
-- Purpose:   Router classifier cache table and additional session columns
--            for flow stack, history summary, token budget, three-strike
--            escalation, and handoff state.
--
-- Requirements covered:
--   34.1  router_classifier_cache table
--   34.2  conversation_sessions.flow_stack, history_summary
--   34.3  conversation_sessions.session_tokens_24h (token budget tracking)
--   34.4  conversation_sessions.strike_count (three-strike escalation)
--
-- Design sections: §v1.1.1, §v1.1.2, §v1.1.3, §v1.1.5, §v1.1.8, §v1.1.11
--
-- Idempotency: all DDL is guarded by IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
--              Safe to re-run without error.
-- ============================================================================

BEGIN;

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. router_classifier_cache table
--    Caches Gemini Flash classifier decisions keyed by normalized query text.
--    Used by the Hybrid Router to avoid redundant LLM calls for repeated
--    or similar messages within the TTL window.
-- ============================================================================
CREATE TABLE IF NOT EXISTS router_classifier_cache (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_query  text NOT NULL UNIQUE,
  intent            text NOT NULL,
  confidence        float NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  expires_at        timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

-- Index on normalized_query for fast cache lookups (UNIQUE already creates one,
-- but we name it explicitly for clarity and documentation).
CREATE INDEX IF NOT EXISTS idx_router_cache_normalized_query
  ON router_classifier_cache (normalized_query);

-- Index on expires_at for efficient TTL cleanup jobs
CREATE INDEX IF NOT EXISTS idx_router_cache_expires_at
  ON router_classifier_cache (expires_at);

-- ============================================================================
-- 2. conversation_sessions — additional columns for v1.1 features
--    All use ADD COLUMN IF NOT EXISTS for safety (flow_stack may already
--    exist from the v1 migration 20260101_001).
-- ============================================================================

-- 2a. flow_stack — tracks nested flow context for multi-turn conversations
--     May already exist from v1 migration; IF NOT EXISTS makes this a no-op.
ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS flow_stack jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2b. history_summary — last 20 flow summaries for long-term memory
ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS history_summary jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2c. session_tokens_24h — rolling 24-hour token budget tracking
ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS session_tokens_24h integer NOT NULL DEFAULT 0;

-- 2d. strike_count — three-strike auto-escalation counter
ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS strike_count integer NOT NULL DEFAULT 0;

-- 2e. handoff_active — whether a human handoff is currently active for session
ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS handoff_active boolean NOT NULL DEFAULT false;

-- ============================================================================
-- 3. routing_decisions — additional v1.1 columns
--    trace_id already exists from v1 migration (20260101_001); add classifier
--    and confidence columns for the Hybrid Router (§v1.1.1).
-- ============================================================================

-- 3a. trace_id — may already exist from v1; IF NOT EXISTS makes this safe.
ALTER TABLE routing_decisions
  ADD COLUMN IF NOT EXISTS trace_id uuid;

-- 3b. classifier_used — whether the Gemini Flash classifier was invoked
ALTER TABLE routing_decisions
  ADD COLUMN IF NOT EXISTS classifier_used boolean NOT NULL DEFAULT false;

-- 3c. confidence — classifier confidence score (NULL when rule-based only)
ALTER TABLE routing_decisions
  ADD COLUMN IF NOT EXISTS confidence numeric;

-- ============================================================================
-- 4. agent_invocations — additional v1.1 columns
--    trace_id links invocations to the same request trace (§v1.1.8).
-- ============================================================================

-- 4a. trace_id — correlates with routing_decisions.trace_id
ALTER TABLE agent_invocations
  ADD COLUMN IF NOT EXISTS trace_id uuid;

-- 4b. advanced_flow — whether the invocation used the v1.1 advanced flow stack
ALTER TABLE agent_invocations
  ADD COLUMN IF NOT EXISTS advanced_flow boolean;

-- 4c. queue_wait_ms — time spent waiting in the concurrency queue (§v1.1.11)
ALTER TABLE agent_invocations
  ADD COLUMN IF NOT EXISTS queue_wait_ms integer;

-- 4d. guardrail_blocked — whether the guardrail layer blocked this invocation
ALTER TABLE agent_invocations
  ADD COLUMN IF NOT EXISTS guardrail_blocked boolean NOT NULL DEFAULT false;

COMMIT;
