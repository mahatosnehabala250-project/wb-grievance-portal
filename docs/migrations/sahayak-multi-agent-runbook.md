# Sahayak Multi-Agent Router — Zero-Downtime Migration Runbook

**From:** JS-01 v1 (single-agent Sahayak)
**To:** JS-01v2 (CEO Router + 4 specialist agents) + JS-15B (Donor Cascade Engine)
**Rollback time:** < 60 seconds
**Estimated migration window:** 15 minutes (excluding monitoring)

---

## Pre-Migration Checklist

- [ ] All DB migrations applied (`supabase/migrations/20260101_001` through `20260101_009`)
- [ ] `conversation_sessions.last_activity_at` column exists and is backfilled
- [ ] `routing_decisions` and `agent_invocations` tables exist with correct nullable columns
- [ ] `calculate_next_eligible_date` function and `trg_update_donor_after_donation` trigger are live
- [ ] `n8n_webhook_config` table/row exists with `target_workflow_id` pointing to JS-01 v1
- [ ] Next.js app deployed with new API routes:
  - `/api/sessions/save`
  - `/api/routing/log`
  - `/api/agents/test-route`
  - `/api/routing/decisions`
  - `/api/blood-requests/donor-respond` (advisory-lock version)
  - `/api/blood-requests/pre-screening`
  - `/api/blood-donors/register` (medical fields)
  - `/api/blood-donors/record-donation`
  - `/api/blood-donors/defer`
  - `/api/blood-donors/update-status`
  - `/api/blood-requests/escalate`
  - `/api/n8n/cascade-trigger`
  - `/api/admin/webhook-target`
- [ ] `n8n-workflows/JS-01v2.json` and `n8n-workflows/JS-15B.json` are committed and tested
- [ ] `deploy-workflows-v2.js` script tested in staging
- [ ] `scripts/validate-mid-conversation-migration.js` passes (all `last_intent` states route correctly)
- [ ] `N8N_WEBHOOK_SECRET` env var set and matching between Next.js and n8n
- [ ] Specialist agent prompts reviewed (`n8n-workflows/prompts/complaint.md`, `blood.md`, `donor.md`, `info.md`)
- [ ] JS-08 Watchdog wired as global error trigger on JS-01v2
- [ ] Team notified — ops channel aware of migration window

---

## Migration Steps

### Step 1: Deploy DB Migrations

```bash
# Apply all additive migrations (safe — JS-01 v1 continues running)
cd supabase
supabase db push
```

Migrations are idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`). JS-01 v1 is unaffected — new columns have defaults, new tables are unused by v1.

**Verify:**
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'conversation_sessions' AND column_name = 'last_activity_at';
-- Should return 1 row

SELECT count(*) FROM routing_decisions; -- Should be 0 (table exists, empty)
```

### Step 2: Deploy Next.js App

Push to main branch — Vercel auto-deploys.

```bash
git push origin main
```

New API routes go live but are not called until JS-01v2 is active. Existing routes remain unchanged.

**Verify:** `curl https://your-app.vercel.app/api/agents/test-route` returns 401 (auth required, route exists).

### Step 3: Upload JS-01v2 and JS-15B to n8n

```bash
node deploy-workflows-v2.js
```

This script:
1. Injects `code-nodes/ceo-router.js` and `code-nodes/prepare-context.js` into JS-01v2
2. Injects specialist agent prompts from `n8n-workflows/prompts/`
3. Deploys JS-01v2 and JS-15B as **inactive** workflows

**Verify:** Open n8n editor → both workflows visible, inactive (grey circle).

### Step 4: Switch Webhook Target

Single config flag flip — this is the cutover moment.

```bash
# Via admin API
curl -X PATCH https://your-app.vercel.app/api/admin/webhook-target \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"target_workflow_id": "<JS-01v2-workflow-id>"}'
```

Or directly in DB:
```sql
UPDATE n8n_webhook_config
SET target_workflow_id = '<JS-01v2-workflow-id>', updated_at = NOW()
WHERE id = 1;
```

**Activate JS-01v2 in n8n** (if not auto-activated by the deploy script):
- n8n editor → JS-01v2 → Toggle Active
- n8n editor → JS-15B → Toggle Active

**Do NOT deactivate JS-01 v1 yet.** Keep it active as the rollback target.

### Step 5: Monitor

Open `/dashboard/agent-routing` and verify:

- [ ] Messages are flowing through JS-01v2
- [ ] `routing_decisions` table is populating
- [ ] Agent distribution looks correct (complaint/blood/donor/info/welcome)
- [ ] No spike in fallback/default routing
- [ ] Response times normal (CEO Router < 50ms, agents < 4s p95)

Monitor for 24–48 hours before cleanup.

---

## Rollback Procedure (< 60 seconds)

If anything goes wrong after Step 4:

### 1. Switch webhook back to JS-01 v1

```bash
curl -X PATCH https://your-app.vercel.app/api/admin/webhook-target \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"target_workflow_id": "<JS-01-v1-workflow-id>"}'
```

Or directly:
```sql
UPDATE n8n_webhook_config
SET target_workflow_id = '<JS-01-v1-workflow-id>', updated_at = NOW()
WHERE id = 1;
```

### 2. Immediate effect

- JS-01v2 stops receiving new messages instantly
- JS-01 v1 resumes processing (it was never deactivated)
- No data loss — `conversation_sessions` is shared between both workflows
- Mid-conversation users continue seamlessly (v1 reads the same `last_intent` and `collected_data`)

### 3. Optional: deactivate JS-01v2 in n8n

Only if you want to prevent accidental re-routing. Not required for rollback.

---

## Post-Migration Verification (after 24–48h stable)

### Data checks

```sql
-- routing_decisions populating
SELECT agent_dispatched, count(*) FROM routing_decisions
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY agent_dispatched;

-- agent_invocations populating
SELECT agent, count(*), avg(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_seconds
FROM agent_invocations
WHERE started_at > NOW() - INTERVAL '24 hours'
GROUP BY agent;

-- No orphaned sessions (stale reset working)
SELECT count(*) FROM conversation_sessions
WHERE last_activity_at < NOW() - INTERVAL '1 hour'
AND last_intent != 'idle';
-- Should be 0 or very low
```

### Manual agent flow tests

| Flow | Test message | Expected agent | Verify |
|------|-------------|----------------|--------|
| Complaint | "Mera road kharab hai" | complaint | Collects fields, registers ticket |
| Blood request | "A+ blood chahiye" | blood | Collects details, creates request |
| Donor registration | "Donor banna hai" | donor | Collects details, registers |
| Status check | "WB-2026-00123" | info | Returns ticket status |
| Greeting | "Namaskar" | welcome | Returns welcome message |
| Donor response | (set `last_intent=donor_pending_response`, send "Haan") | blood | Calls DonorRespond(HAAN) |

### Dashboard checks

- [ ] `/dashboard/agent-routing` — shows live routing decisions with correct agent distribution
- [ ] `/dashboard/agents` — all 4 agents listed with prompts and tool lists
- [ ] `/dashboard/blood` — cascade tiers visible for new requests
- [ ] Existing chat dashboard — SessionStateInspector shows `active_agent` field

### Cleanup (after 7 days stable)

1. Deactivate JS-01 v1 in n8n
2. Archive JS-01 v1 JSON to git (`git add n8n-workflows/archive/JS-01-v1.json`)
3. Remove any v1-only dead code paths

---

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `N8N_WEBHOOK_SECRET` | Next.js + n8n | Auth header for n8n → API calls |
| `NEXT_PUBLIC_SUPABASE_URL` | Next.js | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Next.js | Service-role DB access |
| `NEXT_PUBLIC_N8N_HOST` | Next.js | Deep-link to n8n editor from admin UI |
| `JWT_SECRET` | Next.js | Admin JWT signing |
| `INFO_USE_EMBEDDINGS` | `system_config` table | Feature flag: `false` at v1 launch |

---

## Known Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CEO Router misroutes a mid-conversation message | Low | Medium | Property 1 test covers all `last_intent` states; `validate-mid-conversation-migration.js` runs pre-deploy |
| Stale session not detected (missing `last_activity_at`) | Low | Low | Migration backfills column; Prepare Context has defensive fallback to `NOW()` |
| n8n Code Node sandbox rejects bundled router | Low | High | `build-router-code-node.js` tested in CI; no `require()` or npm imports |
| Advisory lock timeout under high donor concurrency | Low | Medium | 5s `lock_timeout`; returns 503 with retry guidance; v1.1 replaces with optimistic UPDATE |
| WhatsApp webhook URL changes during migration | None | — | Webhook URL is unchanged; only the internal routing target flips |
| JS-15B cascade re-notifies donors | Low | Medium | `cascade_notifications` UNIQUE constraint on `(blood_request_id, donor_id, tier)` enforces idempotency |
| Rollback leaves orphan `routing_decisions` rows | None | — | Rows are append-only observability data; harmless if v1 resumes |
| Gemini rate limit hit by 4 parallel agents | Low | Medium | Only one agent runs per message (Switch Node); no parallel AI calls |

---

## Contacts

| Role | Responsibility |
|------|---------------|
| Ops lead | Executes migration steps, monitors dashboard |
| Backend dev | On-call for API route issues, DB queries |
| n8n admin | Workflow activation/deactivation, node debugging |
| Product | Go/no-go decision, rollback call |
