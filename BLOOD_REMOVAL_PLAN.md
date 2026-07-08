# Blood/Donor ("রক্ত সহায়ক") Total Removal Plan

**Status:** planning document only — no code, DB, or n8n changes have been made yet.
**Constraint honored:** n8n is currently unreachable (HTTPS → 000). Nothing here calls n8n; Section 1 is a pre-written runbook for when it comes back.

---

## 1. Live bot fix (n8n) — the ONLY thing the citizen sees — PRIORITY 1

This is independent of the code refactor below and must ship first, because it is the only
change a citizen actually experiences today. Once `https://n8n.srv1347095.hstgr.cloud` is back
up (verify with a plain `GET /api/v1/workflows` — expect 200, not 000), write and run
`scratchpad/remove_blood_n8n.js` (does not exist yet — author it at that point) as a two-phase
**inspect-then-apply** script: Phase 1 authenticates with `X-N8N-API-KEY` (read from
`C:/Users/mahat/Downloads/json.txt` field `N8N_API_KEY`, base
`https://n8n.srv1347095.hstgr.cloud/api/v1`), lists workflows to find the current id behind
`JS-01v2` (the id is not fixed/known — must be resolved by name at runtime), pulls its JSON, and
dumps a dry-run diff showing: (a) every node whose name matches `Blood Agent`, `Donor Agent`,
`Gemini Check - Blood`, `Gemini Check - Donor`, `IF Gemini Open - Blood`, `IF Gemini Open - Donor`
plus their incoming/outgoing connections from the CEO Router's `$json.agent` switch, and (b) the
welcome/greeting node's reply template, flagging any line containing `blood|donor|রক্ত|rokto|rakt|
raktdaan|ডোনার|রক্তদাতা`. Phase 2 (only run after a human reviews the Phase-1 diff) PATCHes the
workflow: deletes the six blood/donor nodes and their dangling connections, collapses the CEO
Router switch to `complaint | info | welcome | cancel` only, and rewrites the welcome reply to
drop any blood-donation service line, then re-activates the workflow. After applying, send a test
"hii" through the real WhatsApp number and confirm the reply lists only complaint/info/welcome —
no রক্ত/blood/donor text anywhere — before touching any portal code.

---

## 2. Portal code removal

### (a) Router core — `src/lib/router/ceoRouter.ts` and `src/lib/router/classifier.ts`

**`src/lib/router/ceoRouter.ts`** (currently 41 blood/donor occurrences):
- `RouterDecision.agent` union: drop `'blood' | 'donor'` → becomes `'complaint' | 'info' | 'welcome' | 'cancel'`.
- `HybridRouterDecision.agent` union: same narrowing (adds `'clarification'` still).
- `KEYWORDS` object type + literal: remove the `blood: RegExp[]` and `donor: RegExp[]` keys entirely (lines ~84–129, the two large multilingual regex arrays) — keep `complaint` and `greeting`.
- Rule 2 "state lock" block: remove the two `if (lastIntent === 'donor_pending_response')` / `if (lastIntent === 'seeker_confirming')` branches that return `agent: 'blood'`.
- Rule 3 "state prefix": remove the `lastIntent.startsWith('blood_')` and `lastIntent.startsWith('donor_')` branches (keep `complaint_*`).
- Rule 6 "idle keyword routing": remove the `idle_keyword_blood` and `idle_keyword_donor` blocks (keep `idle_keyword_complaint`), and update the doc comment at the top of the file (lines 17–25) that documents this precedence.
- `HOT_STATES` set: remove `'donor_pending_response'`, `'seeker_confirming'`, `'donor_confirming'` (keep `'complaint_confirming'`).
- Update all JSDoc references to "blood agent"/"donor agent" precedence in the file header comment (lines 1–41).

**`src/lib/router/classifier.ts`** (5 occurrences):
- `Agent` type: drop `'blood' | 'donor'` from the union (line 50) → `'complaint' | 'info' | 'welcome'`.
- `AGENTS` const array (line 53–59): remove `'blood'` and `'donor'` entries.
- `buildPrompt()` template (lines 137–146): remove the `blood` and `donor` class descriptions from the Gemini prompt's "Classes" list.
- Update file header doc comment ("classifies... into one of five agents" → four/three).

**Risk:** `decideHybrid`'s hot-state bypass and rule-confidence logic are structurally unaffected (no blood/donor-specific code there), but any caller elsewhere that pattern-matches on `agent === 'blood'`/`'donor'` will now fail to type-check — that is the intended forcing function to find remaining callers.

### (b) Dead admin UI to delete

- **Delete** `src/components/admin/DonorPoolTable.tsx` (35 occurrences; exports `DonorPoolTableProps`, `DonorPoolTable({ bloodRequestId, donors })`).
- **Importer check:** grep found **zero importers** of `DonorPoolTable` anywhere under `src/` — it appears to be dead/orphaned code already. Re-run the grep at removal time to confirm nothing new imports it before deleting.

### (c) Prompt files to delete

- `n8n-workflows/prompts/blood.md`
- `n8n-workflows/prompts/blood.compact.md`
- `n8n-workflows/prompts/donor.md`
- `n8n-workflows/prompts/donor.compact.md`

These are the source-of-truth prompt bodies loaded by `src/lib/abtest/promptLoader.ts` /
`promptRegistry.ts` (each has 2 blood/donor references — the registry map that lists
`blood`/`donor` as valid agent keys alongside `complaint`/`info`). Those two files need their
agent-key maps narrowed in the same PR as the router core edit (2a), not left dangling.

### (d) Other src files referencing blood/donor that need edits (not deletion)

These are secondary references (feature flags, cascade scheduling, trace/observability, admin
dashboards) that only make sense once blood/donor agents exist — narrow or delete the
blood/donor-specific branches, keep the rest:

| File | Occurrences | What to remove |
|---|---|---|
| `src/lib/flowStack/manager.ts` | 2 | `Flow` type: drop `'blood' \| 'donor'` from `export type Flow = 'complaint' \| 'blood' \| 'donor'` |
| `src/lib/cascade/tierSchedule.ts` | 7 | Whole module is the "Smart Donor Cascade" tier-notification scheduler — likely delete entirely once donor cascade is gone; confirm no complaint-flow code depends on it |
| `src/lib/agents/n8nLinks.ts` | 2 | Remove `blood: { workflowId: 'JS-01v2', nodeId: 'blood-agent' }` and `donor: {...}` map entries |
| `src/lib/abtest/promptRegistry.ts` | 2 | Narrow `AGENTS` const from 4 to 2 (`complaint`,`info`) |
| `src/lib/abtest/promptLoader.ts` | 2 | Same agent-key narrowing |
| `src/lib/featureFlags/getFeatureFlag.ts` | 1 | Remove `DONOR_CASCADE_ENABLED` flag |
| `src/lib/guardrail/rules/jsonLeak.ts` | 5 | Check if blood/donor PII field names are hardcoded in leak-detection rules; remove if so |
| `src/lib/rateLimit/check.ts` | 10 | Per-agent rate-limit buckets likely keyed by agent name; drop blood/donor buckets |
| `src/lib/idempotency/middleware.ts` | 1 | Likely just an agent-name string in a comment/example — verify and drop |
| `src/lib/trace/logger.ts` | 1 | Same — likely a log-field example |
| `src/lib/router/cache.ts` | 1 | Classifier cache — check for blood/donor-specific cache key logic |
| `src/components/MPCommandView.tsx` | 3 | Remove blood/donor from any command-routing UI copy |
| `src/components/admin/AgentRoutingTable.tsx` | 9 | Remove blood/donor rows/columns from the agent routing admin table |
| `src/components/admin/SessionStateInspector.tsx` | 18 | Remove blood/donor state-name rendering (donor_pending_response, seeker_confirming, etc.) |
| `src/components/admin/v1_1/TraceTimeline.tsx` | 11 | Remove blood/donor trace event rendering |
| `src/components/admin/CEORouterTester.tsx` | 11 | Remove blood/donor test-message presets from the router tester UI |
| `src/components/admin/v1_1/LatencyPercentilesPanel.tsx` | 4 | Remove blood/donor per-agent latency breakdown rows |
| `src/components/admin/CascadeVisualizer.tsx` | 16 | Whole component visualizes the donor cascade — likely delete entirely |
| `src/components/admin/v1_1/InFlightCascadesStat.tsx` | 4 | Same — likely delete (donor-cascade-specific stat tile) |
| `src/app/dashboard/agents/[id]/page.tsx` | 45 | Largest single file — contains the full blood/donor agent prompt specs (`CreateBloodRequest`, `DonorRespond`, `RegisterDonor`, `UpdateDonorStatus`, `DeferDonor`) inline as page content; remove the `blood` and `donor` agent-detail blocks |
| `src/app/dashboard/agent-routing/page.tsx` | 4 | Remove blood/donor from routing-page agent list |
| `src/app/dashboard/agents/page.tsx` | 10 | Remove blood/donor cards from the agents index page |
| `src/app/api/cron/whatsapp-outbox-drainer/route.ts` | 1 | Check for blood/donor-specific outbox message type handling |
| `src/app/api/agents/prompt-versions/route.ts` | 2 | Narrow accepted agent-key enum |
| `src/app/api/agents/prompt-version/route.ts` | 3 | Same |
| `src/app/api/trace/[id]/route.ts` | 4 | Remove blood/donor trace-type filters |
| `src/app/api/system-health/route.ts` | 1 | Remove blood/donor health-check entry |
| `src/app/api/cron/data-retention/route.ts` | 1 | Remove blood/donor table from retention job's table list |
| `src/app/api/sessions/save/route.ts` | 7 | Remove blood/donor state validation branches |
| `src/app/api/cache/invalidate/route.ts` | 2 | Remove blood/donor cache-key patterns |
| `src/app/api/routing/log/route.ts` | 2 | Narrow accepted agent enum |
| `src/app/api/routing/decisions/route.ts` | 1 | Same |
| `src/app/api/router/classify/route.ts` | 1 | Same |
| `src/app/api/ratelimit/check/route.ts` | 1 | Remove blood/donor rate-limit bucket keys |
| `src/app/api/privacy/erase/route.ts` | 2 | **Important:** GDPR-style erase endpoint — must still erase rows from `blood_donors`/`blood_requests`/`donation_history` for existing users even after the feature is removed from new code; do not silently drop this without a data-retention decision |
| `src/app/api/n8n/cascade-trigger/route.ts` | 29 | Second-largest file; this is the webhook endpoint n8n's donor cascade calls — either delete entirely or leave as a no-op stub returning 410 Gone, since n8n will no longer emit these calls after Section 1 lands |

### Test files — ordered, with explicit risk flags

**High-risk (property-based tests — will need semantic rewrite, not just deletion, because they assert invariants over the blood/donor state space):**
- `tests/properties/ceo-router.property.test.ts` (62 occurrences) — **HIGH RISK.** Generates random session/message fixtures across all agents including blood/donor state transitions; the arbitrary/generator itself must be narrowed or the property will vacuously pass/fail. Rewrite generators before deleting assertions.
- `tests/properties/find-matching-donors.property.test.ts` (78 occurrences) — **HIGH RISK / DELETE WHOLESALE.** Entire file is donor-matching logic; delete the file, confirm no shared arbitrary/generator module it exports is imported elsewhere.
- `tests/properties/cooldown.property.test.ts` (46 occurrences) — **HIGH RISK.** Donor cooldown-window invariants; check if any complaint-side cooldown logic is co-located before deleting wholesale.
- `tests/properties/yearly-cap.property.test.ts` (96 occurrences) — **HIGH RISK, highest occurrence count in the repo.** Confirm this is a donor yearly-donation-cap test (not a complaint-side yearly cap) before deleting — do not delete blind.
- `tests/properties/session-transitions.property.test.ts` (19) — narrow the state-machine arbitrary to drop donor/blood states.
- `tests/properties/stale-session-reset.property.test.ts` (10) — same, narrow fixture states.
- `tests/properties/flow-stack-algebra.property.test.ts` (4), `flow-stack-overflow.property.test.ts` (3), `flow-stack-cancel.property.test.ts` (4) — narrow `Flow` arbitrary to drop `'blood'|'donor'`.
- `tests/properties/hybrid-router-rule-first.property.test.ts` (2), `classifier-cache-idempotence.property.test.ts` (4), `guardrail-idempotence.property.test.ts` (1) — low occurrence, likely just fixture agent names — safe to edit directly.

**Medium risk (integration/unit tests with explicit blood/donor test cases to delete):**
- `tests/integration/js01v2-webhook-hop.test.ts` (24) — tests the exact n8n webhook hop for blood/donor; delete blood/donor test cases, keep complaint/info hop tests.
- `tests/api/sessions-routing.test.ts` (14), `tests/api/classifier.test.ts` (7) — delete blood/donor test cases and fixture data.
- `tests/idempotency/middleware.test.ts` (11) — delete blood/donor idempotency-key test cases.
- `tests/flowStack/manager.test.ts` (14) — delete/rewrite tests exercising `Flow: 'blood'|'donor'`.
- `tests/components/admin-routing.test.tsx` (15) + its snapshot `tests/components/__snapshots__/admin-routing.test.tsx.snap` (4) — delete blood/donor rows from test + **regenerate snapshot** (do not hand-edit .snap).
- `tests/abtest/promptRegistry.test.ts` (21), `tests/abtest/promptLoader.test.ts` (9), `tests/abtest/sticky.test.ts` (1) — delete blood/donor prompt-key test cases.
- `tests/guardrail/rules.test.ts` (2), `tests/rateLimit/check.test.ts` (2) — delete blood/donor-specific cases.
- `tests/integration/observability-fire-and-forget.test.ts` (7) — delete blood/donor trace-event cases.

**Low risk (dedicated donor component test — delete wholesale):**
- `tests/components/__snapshots__/donor-portal.test.tsx.snap` (3) — orphaned snapshot; the corresponding `donor-portal.test.tsx` source was not found by this grep (test file may already be missing/renamed) — verify and delete the stray snapshot regardless.

**DB migration test fixtures (not app tests, but exercise the DB — see Section 3):**
- `tests/migrations/v1_1_smoke.sql` (31), `tests/migrations/smoke.sql` (68), `tests/migrations/README.md` (11) — these SQL smoke tests insert/select against `blood_donors`/`blood_requests`/`donation_history`; must be updated in lockstep with the DB migration in Section 3, not before.

---

## 3. Database — DESTRUCTIVE, separate migration, explicit confirmation required

Tables to drop (in `prisma/migrations/sahayak/`):
- `blood_donors` — created in `20260101_002_blood_donor_medical.sql`
- `blood_requests` — created in `20260101_003_blood_request_cascade.sql`
- `donation_history` — created in `20260101_004_donation_history.sql`

Related objects that must be dropped alongside (found via the same migration set):
- RLS policies on all three tables in `20260101_008_rls_policies.sql`
- Eligibility function + trigger in `20260101_006_eligibility_function_and_trigger.sql` (likely a donor-eligibility check function/trigger — confirm it doesn't also serve complaint tables before dropping)
- Cascade screening logs in `20260101_005_cascade_screening_logs.sql` (donor cascade notification logs)
- Any `donor`/`blood` foreign keys referenced from `20260101_001_routing_observability.sql` (routing_decisions may FK into these tables — check before drop)

**This must NOT be auto-applied.** Recommended process:
1. Full `pg_dump` backup of the three tables + dependent objects, timestamped, stored outside the repo.
2. Write a new down-migration (`DROP TABLE ... CASCADE` guarded by `IF EXISTS`) as its own file, reviewed separately from the code-removal PR.
3. Apply only after explicit user confirmation, and only after Sections 1 and 2 are live and verified for at least one full day (so any in-flight donor cascade jobs drain first).
4. `src/app/api/privacy/erase/route.ts` (flagged in 2d) determines whether any live user data in these tables needs export/erasure before drop — resolve that before dropping.

---

## 4. Sequencing, effort, and biggest risk

**Recommended order:**
1. **n8n workflow fix (Section 1)** — as soon as n8n is back up. Verify with a live "hii" test message that the reply is clean of blood/donor/রক্ত text. *This alone satisfies "citizen never sees it again" even if code refactor is delayed.*
2. **Portal code refactor (Section 2)** — router core (2a) first, since it changes the `Agent` type that everything else type-checks against; then dead-code deletion (2b, 2c); then the long tail of secondary files (2d); tests last, in the order listed (low/medium risk before the high-risk property tests, since narrowing shared type unions will surface compile errors in the property-test generators automatically).
3. **DB migration (Section 3)** — last, only after 1 and 2 are confirmed stable in production for at least a day, with a backup taken and explicit user sign-off on the drop migration.

**Estimated effort:**
- Section 1 (n8n): ~1–2 hours once n8n is reachable (author script, inspect, apply, verify live).
- Section 2a (router core): ~1–2 hours, but is the forcing function for everything downstream.
- Section 2b–2d (dead code + secondary files): ~1 day — mostly mechanical but touches 37 files.
- Section 2 tests: ~1–2 days, dominated by the property-test rewrites (not deletions).
- Section 3 (DB): ~2–3 hours of hands-on migration work plus a mandatory backup/wait period.

**Single biggest risk:** the **router property-test suite churn**, specifically
`ceo-router.property.test.ts`, `find-matching-donors.property.test.ts`, `cooldown.property.test.ts`,
and `yearly-cap.property.test.ts` (96, 78, 62, 46 occurrences respectively — over 280 combined).
These are not simple deletions: fast-check-style arbitraries generate random fixtures across the
*entire* agent/state space, so narrowing the `Agent`/`Flow` unions in Section 2a will make these
generators produce fixtures that no longer type-check or that vacuously skip the removed branches.
Each property file needs its generator narrowed by hand and its invariants re-verified (are they
still non-trivial after blood/donor states are removed?) — this is the part most likely to hide a
regression in the *complaint* flow if done carelessly, since complaint and blood/donor logic often
share state-machine plumbing (`flowStack/manager.ts`'s `Flow` type, `HOT_STATES`, session state
prefixes).

---

## File-count summary

| Category | Count |
|---|---|
| Router core files edited (2a) | 2 |
| Admin component deleted (2b) | 1 |
| Prompt files deleted (2c) | 4 |
| Other `src/` files edited (2d) | 33 |
| **`src/` total touched** | **39** |
| Test files touched (2e, incl. 2 snapshot files) | 29 |
| DB migration files touched (Section 3) | 7 |
| **Grand total files touched** | **75** |
