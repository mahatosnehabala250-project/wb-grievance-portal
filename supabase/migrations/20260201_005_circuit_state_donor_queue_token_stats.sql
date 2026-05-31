-- ============================================================================
-- Migration: 20260201_005_circuit_state_donor_queue_token_stats.sql
-- Spec:      sahayak-multi-agent-router (task 17.5)
-- Purpose:   v1.1 operational objects:
--              * circuit_state          (shared circuit-breaker state table)
--              * donor_response_queue    (SOS FIFO fairness queue)
--              * mv_session_token_stats  (24h/7d token rollup for outliers)
--              * agent_prompt_outcomes   (per agent/version/day metric rollup)
--            plus an hourly refresh of the materialized view (cron SQL lives in
--            scripts/cron/refresh-session-token-stats.sql, per the 17.3 pattern).
--
-- Requirements covered:
--   29.1, 29.5  circuit_state shared breaker state (Design §v1.1.10)
--   30.7        mv_session_token_stats outlier detection (Design §v1.1.11)
--   31.5        donor_response_queue SOS fairness queue (Design §v1.1.12)
--   33.3        agent_prompt_outcomes A/B outcome rollup (Design §v1.1.14)
--
-- Idempotent + additive: every object guarded by IF NOT EXISTS / ON CONFLICT /
-- DO $$ blocks. Safe to re-apply. No destructive statements.
-- ============================================================================

BEGIN;

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. circuit_state — shared circuit-breaker state across n8n + Vercel runtimes
--    Req 29.1, 29.5, Design §v1.1.10
-- ============================================================================

CREATE TABLE IF NOT EXISTS circuit_state (
  name                 text PRIMARY KEY CHECK (name IN ('gemini','whatsapp','embeddings')),
  state                text NOT NULL CHECK (state IN ('closed','open','half_open')) DEFAULT 'closed',
  consecutive_failures int NOT NULL DEFAULT 0,
  window_start         timestamptz NOT NULL DEFAULT now(),
  opened_at            timestamptz,
  last_probe_at        timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Seed the three breakers (closed by default). Idempotent on re-apply.
INSERT INTO circuit_state (name) VALUES ('gemini'), ('whatsapp'), ('embeddings')
  ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- 2. donor_response_queue — per-request FIFO fairness queue for SOS requests
--    Req 31.5, Design §v1.1.12
--    blood_request_id/donor_id reference uuid PKs on blood_requests/blood_donors.
-- ============================================================================

CREATE TABLE IF NOT EXISTS donor_response_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blood_request_id   uuid NOT NULL REFERENCES blood_requests(id),
  donor_id           uuid NOT NULL REFERENCES blood_donors(id),
  received_at        timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL CHECK (status IN ('queued','processing','done','skipped')) DEFAULT 'queued',
  trace_id           uuid
);

-- FIFO drain index: one queued row per request in received_at order.
CREATE INDEX IF NOT EXISTS idx_drq_request_received
  ON donor_response_queue (blood_request_id, received_at);

-- Status lookup index for the worker tick.
CREATE INDEX IF NOT EXISTS idx_drq_status
  ON donor_response_queue (status);

-- ============================================================================
-- 3. mv_session_token_stats — daily mean/stddev of session token usage (7d)
--    Req 30.7, Design §v1.1.11
--    Uses live columns conversation_sessions.last_activity_at + session_tokens_24h.
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_session_token_stats AS
SELECT date_trunc('day', last_activity_at) AS day,
       avg(session_tokens_24h)             AS mean_tokens,
       stddev(session_tokens_24h)          AS stddev_tokens
  FROM conversation_sessions
 WHERE last_activity_at > now() - interval '7 days'
 GROUP BY 1;

-- Unique index on day enables fast lookups (and CONCURRENTLY refresh if ever needed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_session_token_stats_day
  ON mv_session_token_stats (day);

-- Populate immediately on first creation (no-op-ish on re-apply).
REFRESH MATERIALIZED VIEW mv_session_token_stats;

-- Hourly refresh is scheduled out-of-band (following the cron pattern used by
-- migration 17.3's query_cache cleanup). The refresh SQL lives in:
--   scripts/cron/refresh-session-token-stats.sql
-- Register it with pg_cron, or call it from a Vercel cron route, on '0 * * * *':
--   SELECT cron.schedule('refresh-session-token-stats', '0 * * * *',
--     $$REFRESH MATERIALIZED VIEW mv_session_token_stats$$);

-- ============================================================================
-- 4. agent_prompt_outcomes — per (agent, version, day) metric rollup
--    Req 33.3, Design §v1.1.14
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_prompt_outcomes (
  agent           text NOT NULL,
  version         text NOT NULL,
  day             date NOT NULL,
  invocations     int  NOT NULL DEFAULT 0,
  success_rate    numeric NOT NULL DEFAULT 0,    -- flow completion / invocations
  p95_latency_ms  int,
  escalation_rate numeric NOT NULL DEFAULT 0,    -- strike-3 reached / sessions
  helpful_rate    numeric NOT NULL DEFAULT 0,    -- citizen-flagged-helpful / replies
  PRIMARY KEY (agent, version, day)
);

COMMIT;
