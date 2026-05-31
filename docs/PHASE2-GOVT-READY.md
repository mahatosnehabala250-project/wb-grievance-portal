# Phase 2 — Government-Ready Production (P1: Anti-abuse + Observability + Reliability)

Builds on Phase 1 (P0: security + DPDP + guardrail). Phase 1 made JS-01 legally
safe; Phase 2 makes it operationally safe and auditable. JS-01 stays live; each
piece is additive and fail-open.

JS-01 workflow id: `YsUZwu99ckTnzekR` (live, 26 nodes after Phase 2).

## Scope

### 1. Guardrail violation observability  ✅
- `/api/guardrail/apply` (already wired into JS-01) now logs every non-pass
  outcome to `guardrail_violations`, one row per fired rule, correlated by
  `session_id` (citizen phone) and optional `trace_id`.
- Repairs → `action=repaired` (severity low, or medium for pii_leak).
  Substitute/blocks → `action=blocked` (severity high).
- Logging is fire-and-forget (wrapped in try/catch): an observability fault can
  never drop a citizen reply.
- JS-01 Guardrail node body updated to send `session_id` (phone).
- Verified live: a disallowed-URL reply produced a `url_allowlist` / `repaired`
  row keyed to the test phone.

### 2. Per-phone inbound rate limiting (anti-abuse)  ✅
- New route `POST /api/ratelimit/check` (X-N8N-SECRET auth), backed by a new
  sliding-window Postgres fn `rate_limit_check(phone, scope, limit, window)`
  over a dedicated append-only table `rate_limit_events`.
  - The legacy `intake_rate_limits` aggregate table and old `check_rate_limit()`
    fn are left untouched (different shape; not safe to repurpose).
  - Bucket: `wa_inbound` = 30 msgs / 5 min per phone (from `RATE_LIMIT_BUCKETS`).
- Wired into JS-01 inbound:
  `Parse Message → Rate Limit → IF Rate OK`
    - allowed (output 0) → `Upsert Session` (existing flow continues)
    - blocked (output 1) → `Send Wait Reply` (localized "please wait" line)
- Fail-open everywhere: the route never returns `allowed=false` on error, the
  IF treats anything not explicitly `false` as allowed, and the SQL fn is the
  only place a real limit is enforced. A limiter fault can't trap a citizen.
- `rate_limit_events` is bounded by the daily retention cron (purges rows >25h).
- Verified: route returns 401 without secret, allowed=true with secret; SQL fn
  blocks the 3rd call when limit=2.

### 3. Lockdown (defence-in-depth)  ✅
- Revoked anon/authenticated table-level writes (and anon reads) on
  `guardrail_violations`, `agent_invocations`, `routing_decisions`,
  `human_handoff_queue`; service_role retains full access (RLS already enforced
  these, this closes the leftover GRANTs).
- `rate_limit_events`: RLS on, service_role-only policy + grants; fn execute
  restricted to service_role.

## Remaining / future (P2)
- [ ] Human handoff: route guardrail repeat-blocks or explicit "talk to a human"
      to `human_handoff_queue` + an admin notification.
- [ ] agent_invocations / routing_decisions population (per-turn metrics) — needs
      the AI Agent node to emit a structured trace; deferred (larger change).
- [ ] Admin dashboard views over guardrail_violations + rate_limit_events.

## Notes
- All n8n-facing routes use X-N8N-SECRET auth (N8N_WEBHOOK_SECRET).
- No new Vercel cron added (Hobby plan = daily only); rate-limit cleanup piggybacks
  on the existing `/api/cron/data-retention` daily job.
