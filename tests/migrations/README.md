# Migration smoke tests

SQL smoke tests for the **sahayak-multi-agent-router** spec (tasks file: task 1.9).

These tests assert that every schema object created by migrations
`20260101_001` … `20260101_010` is actually present in a live database after
the migrations have been applied:

| Concern | Examples asserted |
| --- | --- |
| Table existence | `routing_decisions`, `agent_invocations`, `donation_history`, `cascade_notifications`, `screening_log`, `system_config` |
| New columns + types | `conversation_sessions.active_agent` / `last_activity_at`, `blood_donors` medical columns, `blood_requests` cascade columns, `blood_donor_responses.response_status` |
| Nullability fixes | `agent_invocations.tokens_used` (Req 18.15), `routing_decisions.agent_dispatched` (Req 1.9) |
| Indexes | `idx_donors_lookup`, `idx_responses_request_status`, `idx_donation_history_donor`, observability indexes, cascade/screening indexes |
| RLS | row security enabled + named admin/donor policies on all new tables (Req 18.13) |
| CHECK / UNIQUE constraints | `chk_confirmed_le_needed`, `chk_donor_weight_kg`, `uniq_cascade_request_donor_tier`, response/urgency/tier enums |
| Functions | `calculate_next_eligible_date`, `find_matching_donors`, `get_compatible_blood_groups`, `reset_yearly_donations` |
| Trigger | `trg_update_donor_after_donation` on `donation_history` |
| Immutability | `UPDATE`/`DELETE` revoked on `donation_history` for all roles (Req 8.2) |
| Function behaviour | cooldown math (+14 / +90 / +168 days) and ABO/Rh compatibility matrix |

Requirements covered: **18.1 – 18.13** (+ 18.15), plus NFR Reliability.
Design refs: `design.md` §Smoke / migration tests, §SQL DDL, §Data Models.

## Design notes

- **No pgTAP dependency.** The script uses only `information_schema` and the
  `pg_catalog` system views, so it runs on any stock Postgres / Supabase
  instance without installing an extension.
- **Portable + self-reporting.** All assertions are collected into a
  session-temp table and printed in TAP style (`ok N - label` /
  `not ok N - label  # detail`). The script then `RAISE EXCEPTION`s at the end
  if any assertion failed, so a CI step fails loudly with the full list.
- **Read-only.** It never writes to application tables. Pure-function checks use
  `gen_random_uuid()` for a non-existent donor id so no rows are touched.

## Running

### Option A — Node runner (uses the `pg` client already in this repo)

```bash
# point at a real Postgres / Supabase pooler URL (not the supabase://use-rest-api sentinel)
SMOKE_DATABASE_URL="postgres://USER:PASS@HOST:5432/postgres" \
  node tests/migrations/run-smoke.js
```

The runner resolves the connection string from `SMOKE_DATABASE_URL`,
then `DIRECT_URL`, then `DATABASE_URL`. If only the `supabase://use-rest-api`
sentinel is configured it prints a **SKIP** and exits `0`.

### Option B — psql

```bash
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f tests/migrations/smoke.sql
```

## Prerequisites

The base schema and migrations `001`…`010` must already be applied. The script
asserts that the base tables it depends on (`blood_requests`,
`blood_donor_responses`, `conversation_sessions`, `blood_donors`) exist and
reports a clear failure if they are missing.

## v1.1 batch smoke test (`v1_1_smoke.sql`, task 17.9)

`v1_1_smoke.sql` applies the same portable, pgTAP-free pattern to the v1.1
migration batch `20260201_001`…`20260201_008`. It asserts:

| Concern | Examples asserted |
| --- | --- |
| Table existence | the 13 new tables: `router_classifier_cache`, `cascade_outcomes`, `cascade_policies`, `cascade_policy_audit`, `human_handoff_queue`, `guardrail_violations`, `query_cache`, `idempotency_keys`, `whatsapp_outbox`, `agent_prompt_versions`, `agent_prompt_outcomes`, `circuit_state`, `donor_response_queue` |
| New columns + types | `conversation_sessions.flow_stack` / `history_summary` / `strike_count` / `session_tokens_24h` / `handoff_active`, `query_cache.query_embedding` (pgvector `vector`), router/agent trace + classifier columns |
| Indexes | the **ivfflat** ANN index `idx_query_cache_embedding` (access method asserted), per-trace indexes (`idx_routing_trace` …), cache/queue/policy indexes |
| CHECK / UNIQUE / FK | enum CHECKs asserted by allowed **value** (status/severity/category/action/state/name), `uq_cascade_policies_scope`, `uq_idempotency_key_endpoint`, `uq_agent_prompt_versions_agent_version`, `fk_guardrail_agent_invocation` |
| RLS | row security enabled on all 13 tables + admin-read / service-write capability (Req 34.15) |
| Seed / default rows | `circuit_state` breakers (`gemini` / `whatsapp` / `embeddings`), `cascade_policies` default rows (`routine` / `urgent` / `critical`) |
| Trace plumbing | `trace_id` columns on `cascade_notifications` / `screening_log` / `query_cache` / `whatsapp_outbox` / `guardrail_violations` |
| Functions + triggers | `trg_fn_donor_invitation_counter`, `decrement_30d_invitations`, `trg_fn_complaint_cache_invalidate`, `rate_limit_check`; triggers `trg_donor_invitation_counter` (on `cascade_notifications`) and `trg_complaint_cache_invalidate` (on `complaints`) |
| Materialized view | `mv_session_token_stats` + its unique index `idx_mv_session_token_stats_day` |

Requirements covered: **34.1 – 34.16** (plus 23.x, 26.x, 28.5, 29.x, 30.7,
31.5, 33.3). Design refs: `design.md` §v1.1.1 … §v1.1.14.

Prerequisite: the v1 base schema + migrations `20260101_001`…`010` **and** the
v1.1 batch `20260201_001`…`008` must already be applied.

### Running the v1.1 test

```bash
# npm script (resolves the same SMOKE_DATABASE_URL / DIRECT_URL / DATABASE_URL chain)
npm run test:migrations:v1_1

# node runner with explicit SQL file (file must live in tests/migrations/)
SMOKE_DATABASE_URL="postgres://USER:PASS@HOST:5432/postgres" \
  node tests/migrations/run-smoke.js v1_1_smoke.sql

# psql
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f tests/migrations/v1_1_smoke.sql
```

The node runner takes an optional first argument naming the `.sql` file to run
(relative to `tests/migrations/`, defaulting to `smoke.sql`). As with the v1
test, it prints a **SKIP** and exits `0` when only the `supabase://use-rest-api`
sentinel is configured.
