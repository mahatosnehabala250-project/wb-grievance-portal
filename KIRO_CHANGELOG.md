# WB Grievance Portal — AI Collaborative Changelog
> **Purpose:** Har AI tool (Kiro, Claude, ya koi bhi) ne kya kiya, exactly kab kiya — sab milke kaam kar sakein bina ek doosre ka kaam overwrite kiye.
> **Rule:** Koi bhi AI change kare — is file mein likhe. DB functions touch karne se pehle HAMESHA `pg_get_functiondef` se current version padho.
> **Format:** Har session mein AI ka naam, date, time (IST), aur kya kiya — clearly likho taaki koi bhi AI tool aake seedha samjhe aur kaam shuru kar sake.

---

## 🔴 CRITICAL — DO NOT OVERWRITE

### `register_complaint` function
**Current working version restored by Claude (Jun 10, ~10:03 IST)**
- Returns: `json`
- Ticket format: `WB-26-PUR-XXXXXX` (NOT "WBGR-")
- Uses camelCase: `ticketNo`, `citizenName` (NOT snake_case)
- Validates GP+Block via `validate_gp_in_block()`
- Auto-derives `assembly_constituency` + `parliamentary_constituency` from LGD
- Live test confirmed: `WB-26-PUR-001039` (Sumit Kumar, Jangidiri → Bandwan AC → Jhargram MP ✅)

**History of this function (important):**
1. Original working version (from migrations) ✅
2. **Kiro broke it** (Jun 10 session) — dropped it and replaced with broken version: `WGBR-` format + snake_case columns → table mein columns hi nahi the
3. **Claude restored it** (Jun 10, ~10:03 IST) — clean version with proper validation, now working

---

## 📋 Changes Log

---

### SESSION 22 — Claude Code (June 15, 2026): LEVEL 10 — Autonomous Operations / AI Chief-of-Staff Action Queue (roadmap 1–10 COMPLETE)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8), ultracode. Designed via a 6-agent workflow (discover execution+reuse surfaces → design → 3 adversarial verify lenses); every finding applied. Data feasibility verified directly via SQL.

#### 🧠 What it is (and deliberately is NOT)
- A scope-locked **proposal queue**, NOT an autopilot. Engine spots a real signal on a real ticket, drafts the action + its ready-to-fire execute route, and a human **approves with one tap** → an EXISTING audited route runs it. With ~4 complaints/week the queue is small-but-real; we say so and never pad.

#### ✅ NEW: `computeOperations(payload)` + `ActionQueue`/`ActionItem` in `src/lib/intelligence.ts`
- Builds the queue from the **authoritative scoped `findMany` row-set** (so every item carries a REAL `id` for the `[id]` execute routes). The Level 1–9 engines are reused only to rank/justify, never to source ids. Per-ticket NLP anger joined from `complaint_nlp` (same batched pattern as computeNetwork).
- **5 action types — each mapped to a real, scope-safe execute route:**
  - `ASSIGN_OFFICER` (active+unassigned) → `PATCH /complaints/[id] {assignedToId}` (scoped officer picker from `getUserListScope`)
  - `ESCALATE` (SLA-breached, age>per-urgency-SLA) → `PATCH /complaints/[id] {urgency}` — body is **ONLY `{urgency}`**, never status, so an INTERNAL action can't silently fire WB-03 to a citizen
  - `CHASE_STATUS` (stuck IN_PROGRESS >7d) → `POST /complaints/[id]/comments` (internal note)
  - `CLOSE_QUICKWIN` (old LOW/MED active) → `PATCH /complaints/[id] {status:RESOLVED,resolution}` — **CITIZEN_FACING**, confirm + resolution text required
  - `REOPEN` (status=RESOLVED AND `satisfactionRating`≤2) → `PATCH /complaints/[id]/reopen`
- Deterministic score (0–100, `0.45·urgency + 0.35·age + 0.20·anger`) — no probabilities; one action per ticket (priority then score), cap 15.
- **Outcome loop = existing `activity_logs`** (actorId + 14d window), NO new table: "you actioned N, M now resolved" as honest **correlation** (joins to current status), never causation; "No actions yet" on empty.
- KARYAKARTA (`canMutateComplaints=false`) → advisory read-only queue, no approve buttons.

#### ✅ NEW: thin `GET /api/intelligence/operations` + "Autonomous Operations" card in `IntelligenceCommandView.tsx`
- Click-to-load card (mirrors Network/Fusion pattern): stats line, action rows with one-tap approve (inline officer `<select>` / resolution input / confirm for citizen-facing), honest **disabled gaps** (RESPOND_CITIZEN, AUTO_PILOT) and a caveats `<details>`.

#### 🛡️ Adversarial review caught & FIXED before ship (honesty discipline)
- **Fabrication cut:** original REOPEN trigger read low ratings from `brief.wins[]`, which is sorted to EXCLUDE low ratings → impossible. Re-sourced from real `satisfactionRating≤2` rows (often empty — renders empty honestly).
- **Binding fix:** signals carry `ticketNo` only / area aggregates have no id; building `[id]` routes from them was unsound. Now all items come from the `findMany` row-set (real id); area signals are advisory context only.
- **Auto-pilot dropped (v1):** every write is human-approved; no unattended load-time writes.
- **No phantom vulns:** recon (read mid-edit) called escalate/reopen/bulk/escalate-batch unsafe; verify agents re-read HEAD and confirmed they are now fully guarded (fixed in SESSION 21 + addendum). The shipped spec/UI claims NO fake security bug.
- **Real gap closed:** `POST /complaints/[id]/comments` lacked `canMutateComplaints` (KARYAKARTA could comment). Added the gate.

#### ✔️ Verification
- `npx tsc --noEmit` clean on all Level-10 files (`lib/intelligence.ts`, `api/intelligence/operations/route.ts`, `IntelligenceCommandView.tsx`, `comments/route.ts`).
- SQL replication of the engine's triggers (ADMIN scope): ASSIGN 32, ESCALATE 31, CHASE 6, CLOSE 20, **REOPEN 1** — real items from real rows, no fabrication. Per-role scope yields smaller queues (honest).

#### ⚠️ Next AI — Please Note
- The action queue is **read-only**; execution happens on the EXISTING complaint routes (one-tap approve from the UI), which already enforce `complaintInScope` + `canMutateComplaints` + assignee scope. No new mutation endpoint, no new table.
- **Roadmap 1–10 COMPLETE.** Future: a real citizen-notify endpoint would unlock RESPOND_CITIZEN (currently an honest disabled chip); a draft-then-approve auto-pilot for internal notes only.

---

### SESSION 21 — Claude Code (June 15, 2026): End-to-end security audit + fixes (PII leak closure, scope-lock legacy routes, RBAC geo-forcing, `complaint_nlp` RLS)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Full-codebase auth/scope audit, then fixed every real finding. DB hardening verified directly via Supabase SQL.

#### 🧠 Why this session
- User asked for "end to end verify audit". Audit verdict was **RED**: the RBAC build (Sessions 1–6) secured the *main* complaint routes, but several **legacy routes were never migrated** and still leaked citizen PII. Worst of all, a derived DB table (`complaint_nlp`) was readable/writable by the **public anon key**.

#### 🔴 CRITICAL fixed
1. **`/api/complaints/search`** & **`/api/n8n/complaints`** — were fully **unauthenticated** ("no auth — called by n8n") yet returned citizen name + phone + full rows. Added the codebase-standard **`x-n8n-secret` vs `N8N_WEBHOOK_SECRET`** fail-closed guard (same pattern as `check-duplicate`/`register`/`validate-block`).
2. **`complaint_nlp` table — RLS was OFF while `anon` held full SELECT/INSERT/UPDATE/DELETE.** The public anon key (ships in the browser bundle) could hit `GET/POST .../rest/v1/complaint_nlp` directly and read/modify all NLP-enriched data. Migration `enable_rls_complaint_nlp`: `ENABLE` + `FORCE` RLS, added `service_role_complaint_nlp` (FOR ALL, the app's only real path) + `jurisdictional_read_complaint_nlp` (authenticated SELECT mirroring the `complaints` policy via the parent row). Verified: rls_on=true, forced=true, 2 policies. **App unaffected** — all 5 server consumers (`intelligence.ts`, `map/risk`, `advisor`, `cron/nlp-enrich`, `nlp-insights`) use `SUPABASE_SERVICE_ROLE_KEY`, which the service_role policy covers.
3. **`/api/export`** — `?token=` auth was fine but scope was legacy `role==='BLOCK'/'DISTRICT'` only → governance role_levels (MP/MLA/DISTRICT_ADMIN/GP_COORD/KARYAKARTA) fell through to **no filter = state-wide CSV** of Name+Phone. Swapped to `getComplaintScopeFilter(payload)`.

#### 🟠 HIGH fixed
- **`/api/search`** & **`/api/activity-feed`** — same legacy `BLOCK/DISTRICT`-only scope (state-wide leak for every governance role). Replaced all branches with `getComplaintScopeFilter(payload)` (activity-feed: applied to complaint/webhook/hour where-clauses).
- **`/api/ticket/[ticketNo]`** — authenticated but **no per-record scope check**; any staff could look up any ticket statewide. Now fetches the full row, runs `complaintInScope(payload, …)`, returns **404** (not 403) for out-of-scope so existence isn't leaked, and the response is trimmed to the citizen-facing subset (no phone).
- **`/api/complaints/[id]/comments`** — GET had **no scope check** (existence only) and POST used legacy `BLOCK/DISTRICT`. Both now gated by `complaintInScope` (GET → 404, POST → 403).
- **RBAC geo not forced into creator scope** (`src/lib/rbac.ts` `validateNewUserScope` + `/api/users` POST) — every geo check was guarded by `if (geo.X && …)`, so a **blank** field skipped validation and the route persisted null/blank or **un-cross-checked client values** (only MP's lok_sabha was force-set). Now `validateNewUserScope` returns a **resolved `geo`** with every omitted/owned field forced to the actor's jurisdiction (MP→seat, MLA→constituency, DISTRICT→district, BLOCK→block, GP→gp_code/name+parents). POST persists `verdict.geo` instead of raw client input → a scoped creator can never mint an unbound or cross-seat user. (PATCH still re-validates via `validateNewUserScope`; it reads `.ok` only, backward-compatible.)

#### ✔️ Verification
- `npx tsc --noEmit` — **clean on all touched files** (`export`, `search`, `activity-feed`, `ticket/[ticketNo]`, `complaints/search`, `n8n/complaints`, `complaints/[id]/comments`, `lib/rbac.ts`, `api/users`). Pre-existing repo-wide tsc errors (examples/, tests/, seed.ts, db.ts internal typing, leaderboard) are unrelated and predate this session.
- `complaint_nlp` RLS state confirmed via SQL after migration.

#### ⚠️ Next AI — Please Note (ACTION REQUIRED if these endpoints are live in n8n)
- **`/api/complaints/search` and `/api/n8n/complaints` now require the `x-n8n-secret` header.** If any n8n HTTP node calls them, add header `x-n8n-secret = {{ $env.N8N_WEBHOOK_SECRET }}` (same value as Vercel `N8N_WEBHOOK_SECRET`). The primary intake (JS-01) and duplicate check (`check-duplicate`) already use the secret pattern, so these two may be unused legacy — verify before assuming breakage.
- Residual (low): for an **MLA/DISTRICT** creating a GP_COORD/KARYAKARTA, the supplied `gp_code` is anchored to the creator's constituency/district but not individually verified against a gp→AC mapping (no such mapping table yet). Constituency/district binding is enforced; tighten when a gp↔AC map exists.
- Roadmap unchanged: 1–9 done. Remaining: Level 10 (Autonomous Org). **The earlier `complaint_nlp` RLS TODO is now CLOSED.**

#### ➕ Addendum (same day, found while scoping Level 10's execution surfaces) — 4 more mutation routes hardened
The audit's leaky-route inventory missed the **write/escalation** routes; mapping them for the Level-10 action queue surfaced the same flaw class. Fixed:
- **`/api/complaints/[id]/escalate`** & **`/api/complaints/[id]/reopen`** — legacy `role==='BLOCK'/'DISTRICT'`-only scope **and no `canMutateComplaints` gate** → a governance role (MLA/KARYAKARTA) could escalate/reopen **any** complaint statewide, and read-only KARYAKARTA could mutate. Now `complaintInScope` + `canMutateComplaints`.
- **`/api/complaints/escalate-batch`** — claimed "uses N8N_WEBHOOK_SECRET for optional verification" but **verified nothing** → a fully open bulk MUTATION (changes urgency + fires citizen/officer notifications). Added `x-n8n-secret` fail-closed guard. **WB-05 (SLA breach) must now send `x-n8n-secret`.**
- **`/api/complaints/bulk`** — legacy `BLOCK/DISTRICT`-only scope on an `updateMany` → governance roles could bulk-update **any** ids statewide; no mutate gate. Now `getComplaintScopeFilter` + `canMutateComplaints`.
- tsc clean on all four. These are prerequisites for the Level-10 action queue (which routes one-tap actions through them).

---

### SESSION 20 — Claude Code (June 14, 2026): Level 8 — Network Intelligence (org/escalation chain; cascade honestly data-gated)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Data recon done directly via SQL.

#### 🧠 Honest finding (real queries)
- The headline Level-8 idea — **issue-cascade / contagion graphs** — is NOT supported by the data: category co-occurrence is thin and concentration-driven (only OTHER↔WATER/ROAD across 2 blocks each), and **ZERO root-causes span ≥2 villages**. Building a cascade graph would fabricate edges. So that is a labeled gap, not a feature.
- **Competitor watch** also not possible (single-party dataset; no opposition/election/news data).
- What IS real: the **organisational / escalation tree** + **weakest-link** detection.

#### ✅ NEW: `computeNetwork(payload)` + `NetworkResult`/`NetNode` in `src/lib/intelligence.ts`
- Builds the scope's admin chain as a tree (ADMIN: District→AC→Block; MP: AC→Block→Village; MLA: Block→Village; Block-coord: GP→Village; …) from scoped complaints. Each node: load, active, resolved, **unresolved%**, avgAnger (NLP).
- **Weakest links:** nodes with total≥3 AND unresolved≥60%, ranked by unresolved×volume — shows WHERE in the chain the backlog concentrates.
- Thin **issue co-occurrence** (categories sharing ≥2 blocks) — clearly labeled co-location, NOT causation.
- Honest **gaps** array: issue-cascade (NOT_ENOUGH_DATA), competitor watch (NOT_CONNECTED), officer response-timing (NOT_ENOUGH_DATA). Aggregate-only, scope-locked.

#### ✅ NEW: `/api/intelligence/network` (thin scoped GET) + UI "Network Intelligence" card
- Weakest-links list, recursive org-chain tree (load bar + unresolved% color + anger), issue-links chips, honest "not available yet" gaps, caveats. New `NetTreeNode` recursive renderer.

#### ✔️ Verification
- tsc clean on all touched files.

#### ⚠️ Next AI — Please Note
- The org tree is REAL; the cascade/contagion graph is intentionally NOT built (no multi-village root-cause spread exists yet). When data grows (root-causes spanning villages, longitudinal volume), the cascade graph can be added — until then keep it a labeled gap, do NOT fabricate edges.
- Co-occurrence is co-location only; never relabel it causation.
- Roadmap: 1–9 done (8 = this). Remaining: 10 (Autonomous Org). Earlier security TODO still open: enable RLS on `complaint_nlp`.

---

### SESSION 19 — Claude Code (June 14, 2026): Level 7 — Data Fusion / Entity Ontology (honest "360 area profile")

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Design used a workflow whose DISCOVER phase (DB data-inventory + code-recon) succeeded; the design/critic/synth agents hit a session limit, so the spec was synthesized by hand from the (authoritative) inventory — same honesty discipline as Session 18.

#### 🧠 Honest scope (from the data inventory)
- A fused per-node entity profile IS buildable today — but it's a **grievance-intelligence** fusion, not the full Palantir "every signal" fusion. Real & fused: complaint load + composite risk, anger (NLP), top root-causes, category mix, a **complaint-driven scheme-FAILURE proxy** (Lakshmir Bhandar/Kanyashree/Pension/Yuvashree/Scholarship… detected from category + NLP root_cause), recurrence (repeat flag), and **political context** (MLA, party, ST/SC reservation, Lok Sabha) from constituency_block_mapping. NOT in DB → labeled "not connected" placeholders, never faked: census/SECC, election results/margins, news sentiment, weather/mandi, true scheme enrollment %, map lat/lng, per-area officer cards.

#### ✅ NEW: `computeFusion(payload)` + `FusionResult`/`FusionNode` in `src/lib/intelligence.ts`
- Reuses computeIntelligenceBrief (per-node hotspots+risk) + a scoped complaint re-fetch + complaint_nlp + constituency_block_mapping (political, joined by normalized block/AC name).
- **Transparent priority score** that does NOT double-count: `risk*0.5 + schemeLoad*0.2 + concentration*0.15 + recurrence*0.1 + reservation`. (anger/SLA already live inside the composite risk; only ORTHOGONAL salience is added on top.) Component breakdown is returned so it's auditable.
- Aggregate-only, scope-locked.

#### ✅ NEW: `/api/intelligence/fusion` (thin scoped GET) + UI "Area Fusion — Entity 360" card
- Priority-ranked node list; click → expand to the fused profile (political badge, grievance strip, scheme-failure breakdown, top causes, transparent priority math). An "External data — not connected" panel lists the pluggable sources (census/election/news/scheme-coverage) — the honest moat framing: framework ready, sources plug in later, never estimated. Caveats block.

#### ⚠️ SECURITY finding (from inventory — for a later session): `complaint_nlp` has **RLS DISABLED**. Our routes use the service-role key server-side + scope filter so they're safe, but if the anon/publishable key can reach `complaint_nlp` from the client, enable RLS. Worth a quick audit.

#### ✔️ Verification
- tsc clean on all touched files (intelligence.ts, fusion route, IntelligenceCommandView).

#### ⚠️ Next AI — Please Note
- Fusion = `computeFusion` in intelligence.ts. Scheme detection = `SCHEME_PATTERNS` regex over category+root_cause. Add schemes there. It is a FAILURE proxy — never relabel it "coverage/saturation".
- Priority weights are deliberately transparent and orthogonal-to-risk. Do not fold anger/SLA back in (double-counting).
- External sources are placeholders by design. When real census/ECI data is added, slot it into `NOT_CONNECTED` → real fields; keep the "never fabricate" rule.
- Roadmap: 1–7 + 9 done. Remaining: 8 (Network Intelligence), 10 (Autonomous Org).

---

### SESSION 18 — Claude Code (June 14, 2026): Level 6 — Predictive Engine (HONEST early-warning, not fake ML)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Design phase used a 7-agent workflow (data recon + 3 forecasting designs + adversarial statistician critic + synthesis) BEFORE coding.

#### 🧠 The honest call (why this matters)
- The adversarial review caught the trap: **56 complaints over ~8 weeks, 0 full annual cycles, ~96% missing resolvedAt, 41% of volume in one block, 38% in category OTHER.** Real statistical forecasting (SARIMA/Prophet/seasonality) is IMPOSSIBLE here — it would produce fake precision that destroys credibility. So the engine ships ONLY what's defensible today, with explicit "not enough data" gating + caveats everywhere.

#### ✅ NEW: `computeForecast(payload)` in `src/lib/intelligence.ts` (+ `ForecastResult` type)
- Reuses `computeIntelligenceBrief` for the scope-locked 12-week trend (no new scope logic).
- **Scope-wide volume** as a RANGE: recency-weighted moving average (weights 1,2,3) + damped week-over-week momentum (φ=0.5) + **Negative-Binomial-style band** (sd=√(point·VMR), VMR clamped 1–4 to honor real overdispersion — NOT Poisson). Never a bare point. Gated to ≥6 weekly points.
- **Trajectory** label (RISING / FLAT / COOLING) from damped momentum.
- **Deterministic SLA-breach gauge** per OPEN complaint (age vs urgency-SLA, createdAt only) — counts + top-8 queue. Explicitly NOT a probability.
- **Per-area/category signals:** a NUMBER only when total≥8 AND active≥5; else WATCH label; else suppressed. (Today only Manbazar I qualifies.)
- **Seasonal watchlist:** NO numbers — labeled hypotheses from seasonal_patterns, with the table's own June-contradiction surfaced as proof it's unreliable.
- 7 mandatory caveats shipped in the payload.

#### ✅ NEW: `/api/intelligence/forecast` — thin scoped GET (copy of brief route), delegates to computeForecast.
#### ✅ UI: "Forecast / Early-Warning" card in IntelligenceCommandView
- On-demand "Project" button. Honesty banner ("Confidence: LOW — early-signal, NOT a statistical forecast") + trajectory. History+projected-band AreaChart (dashed projection + uncertainty band). SLA-breach risk queue. Area/category WATCH chips. Seasonal watchlist. Collapsible always-present caveats. NOT_ENOUGH_DATA renders a "collecting" panel, no chart/numbers.

#### 📌 No DB changes. Phase-2 roadmap (do NOT build yet): a `risk_history` snapshot table (written by daily-briefs cron) for velocity/ETA trajectory; backfill `resolvedAt` (or status-change audit log) before any SLA-breach PROBABILITY model.

#### ✔️ Verification
- tsc clean on all touched files (intelligence.ts, forecast route, IntelligenceCommandView).

#### ⚠️ Next AI — Please Note
- Forecast math = `computeForecast` in intelligence.ts. It is DELIBERATELY conservative (ranges, gating, caveats). Do NOT "improve" it into point forecasts or seasonal numbers on this data volume — that was rejected by adversarial review for fabricating precision. Revisit only after 12+ months history + resolvedAt backfill.
- SLA gauge uses the same SLA_DAYS values as the brief (CRITICAL .25/HIGH 1/MEDIUM 3/LOW 7) — keep them identical or the BREACHED count diverges from brief.kpis.slaBreached.

---

### SESSION 17 — Claude Code (June 14, 2026): Block-name normalization (data hygiene — fixes fragmented blocks)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). DB-only change (no app code).

#### 🐛 Problem
- Free-text intake meant the same block was stored many ways: "Manbazar I" / "Manbazar 1" / "Manbazar-I" / "Manbazar" / "manbazar" — fragmenting the map, hotspots, dashboards, and every block aggregate. (This was the long-standing data-hygiene note from Session 3.)

#### ✅ Fix (migration `add_block_normalization`)
- **`normalize_block(text)`** SQL function: lowercases, hyphens→space, collapses spaces, arabic→roman numeral suffix (1→I, 2→II...), then matches against canonical `constituency_block_mapping.block_name`. Unknown blocks pass through unchanged. Bare "manbazar" (no numeral) → "Manbazar I" (gp 111050 / headquarters; disambiguated from data).
- **Backfill:** all existing complaints normalized. Result: Manbazar variants (6 spellings) → **Manbazar I (23)** + **Manbazar II (6)**; "Purulia -1"+"Purulia I" → **Purulia I (3)**. Manbazar II correctly stayed a SEPARATE block (not merged).
- **Trigger `complaints_normalize_block`** (BEFORE INSERT OR UPDATE OF block): every future write — app manual create, n8n JS-01/intake, `register_complaint` RPC — gets canonicalized automatically. No app code needs to change.

#### ✔️ Verified
- Distinct Manbazar blocks: 6 → 2. Counts add up (23 = all Manbazar-I variants merged).

#### ✅ Follow-up (same session): DISTRICT normalization too (migration `add_district_normalization`)
- The `district` field had the same problem ("Purulia" vs "purulia") which was splitting "Manbazar I" into two map markers. Added `normalize_district(text)` (canonical match vs `constituency_block_mapping.district`, fallback initcap), backfilled, and EXTENDED the trigger to fire on block OR district change and clean both.
- Result: MLA Bandwan map now shows exactly 2 clean blocks — Manbazar I (16) + Manbazar II (3) — no fragments.

#### ⚠️ Next AI — Please Note
- Block AND district canonicalization is now enforced at the DB layer (trigger `complaints_normalize_block` + `normalize_block` / `normalize_district`). Source of truth = `constituency_block_mapping`. To add canonical blocks/districts for NEW areas, add rows there and the functions auto-cover them.
- The trigger does NOT touch `register_complaint`'s logic — it only cleans the stored block/district AFTER the row is built. Did not modify the CRITICAL `register_complaint` function.
- Same pattern could be applied to other messy free-text fields later (village, gp_name) if needed.

---

### SESSION 16 — Claude Code (June 14, 2026): Level 5 — Geospatial Risk Command (risk/anger heatmap)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8) — Anthropic CLI
- **Roadmap:** Level 5 of the 1→10 plan (1-4 + 9 done; this is 5).

#### ✅ NEW: `/api/map/risk` — scope-locked geospatial risk endpoint
- Per-block aggregates for the caller's jurisdiction ONLY (getComplaintScopeFilter — same boundary as /api/complaints): total, active, resolved, critical, slaBreached, resolutionRate, **avgAnger (from complaint_nlp)**, and a composite **risk score 0-100** (activeRatio*35 + slaRatio*25 + critical*20 + anger*20).
- Aggregate-only (block level). No individual-citizen data.

#### ✅ REBUILT: `src/components/MapView.tsx` — "Risk Command Map"
- Now consumes the scope-locked /api/map/risk (was the unauthenticated block-stats).
- **3 view modes:** 🎯 Risk / 😡 Anger / ✅ Resolution — markers colour by a green→amber→red heat ramp; size = active + critical load.
- Rich popups (risk, anger, active, critical, SLA breach, resolution %, top categories), adaptive legend, sidebar ranked by the active mode.
- **Auto-centres on the scoped blocks** — an MLA lands on their AC, a karyakarta on their area, not all-WB.

#### ✅ SECURITY: `/api/map/block-stats` now requires auth (was anonymous — leaked all-district data). Superseded by /api/map/risk; kept for back-compat with an auth guard.

#### ✔️ Verification
- tsc clean on all touched files (map/risk, MapView, block-stats).

#### ⚠️ Next AI — Please Note
- Block coordinates are a hardcoded table in MapView (`BLOCK_COORDS`, Purulia + a few others). New districts need rows there OR a proper lgd-village coordinate join. Map degrades gracefully (defaults to Purulia centre) if a block is missing.
- Risk-score weights live in /api/map/risk — tune there. Anger comes from complaint_nlp (populated by n8n JS-22), so anger mode is richer as enrichment backfills.
- Next planned roadmap step: Level 6 (Predictive Engine — volume/SLA-breach forecasting; `seasonal_patterns` table already exists).

---

### SESSION 15 — Claude Code (June 13, 2026): AI Chief-of-Staff (Level 9) — DeepSeek-powered scoped Q&A

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8) — Anthropic CLI
- **Driver:** User provided a DeepSeek key + chose "AI Strategic Advisor" feature.

#### 🧠 What it does
- Politician/officer asks a natural-language question (Bengali/Hindi/English) → gets an **evidence-cited answer grounded ONLY in their scope-locked data.** "Is hafte kahan daura karun?" → DeepSeek cites villages + anger scores + ticket numbers + quick wins with reasons.

#### ✅ NEW: `src/lib/advisor.ts`
- `buildContext(brief, nlp)`: turns the scoped IntelligenceBrief + NLP aggregates into a compact factual block (KPIs, risk, hotspots, surges, warnings, officers, benchmark, quick wins, root-cause clusters, anger hotspots, entity watch).
- `askAdvisor(question, context)`: DeepSeek call (OpenAI-compatible, `DEEPSEEK_API_KEY`, model `deepseek-chat`, base `DEEPSEEK_BASE_URL`). System prompt: answer in same language, cite specifics, no hallucination, no individual profiling, action-oriented.

#### ✅ NEW: `/api/intelligence/advisor` (POST {question})
- Scope-locked: computeIntelligenceBrief(payload) + buildNlpContext (complaint_nlp for scoped ids only) → context → DeepSeek. The model only ever sees the caller's jurisdiction.

#### ✅ UI: IntelligenceCommandView — "AI Chief-of-Staff" hero card (top)
- Question input + Send, suggested-question chips, evidence-cited answer panel, graceful "set DEEPSEEK_API_KEY" state.

#### ✔️ Verification
- DeepSeek key live-tested (model deepseek-v4-flash). Answer quality verified on real Bandwan context — cited Ankrobarakadam/Bargoria/Baliguma anger scores + actual quick-win tickets in Hindi. tsc clean.

#### ⚠️ User TODO
- Vercel env: `DEEPSEEK_API_KEY=<key from platform.deepseek.com>` → redeploy → Intel Command → AI Chief-of-Staff → ask.

#### ⚠️ Next AI — Please Note
- Advisor = `src/lib/advisor.ts` (DeepSeek). Prompt/context changes go there.
- It reads ONLY scoped data (brief + complaint_nlp) — never widens scope. Keep the no-profiling ethics line in the system prompt.
- Provider-flexible by design (OpenAI-compatible base URL) — could point at any compatible LLM via env.

---

### SESSION 14 — Claude Code (June 13, 2026): NLP Brain LIVE — Gemini enrichment self-contained in n8n (JS-22 rebuilt)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8) — Anthropic CLI
- **Context:** User wants gemini-2.5-flash-lite. The pasted key returned 403 "project denied access" for 2.5 models (project-level block). Solution: do enrichment INSIDE n8n using the EXISTING working Google Gemini credential — no key copying, no Vercel key needed.

#### ✅ JS-22 REBUILT (`yxH2qx9I9vNrGHDL`) — self-contained, 8 nodes, **ACTIVE + TESTED**
- Schedule (30 min) → Get Enriched IDs (Supabase, `alwaysOutputData`) → Collect Enriched → Get Complaints (Supabase) → Pick Pending (Code: diff + build Gemini body, batch 8) → **Call Gemini** (HTTP, `googlePalmApi` credential `GZKueH9lQUzyB0GK` — n8n injects the key, gemini-2.5-flash-lite) → Parse NLP (Code) → Save NLP (Supabase upsert to complaint_nlp)
- **Key insight:** HTTP Request node + `nodeCredentialType: googlePalmApi` lets n8n inject the working Gemini key without exposing it. Reuses the SAME credential JS-01 uses in prod.
- **LIVE-TESTED:** 13 complaints enriched. Anger hotspots (Ankrobarakadam 75, Bargoria 70, Baliguma 67), emotion mix (frustrated 10, angry 1, desperate 1), entity watch — all populating. Verified via /api/intelligence/nlp-insights (admin): coverage 13/56, 8 anger hotspots, 2 entity watch.
- ⚠️ Old bug fixed: when complaint_nlp empty, Get Enriched IDs returned 0 items → chain died. `alwaysOutputData: true` fixes first-run.
- Rapid back-to-back manual runs hit Gemini free-tier rate limit (expected) — the 30-min schedule drains the backlog cleanly.

#### ✅ UI: IntelligenceCommandView NLP section now shows data whenever `coverage.enriched > 0`
- Removed the "set GEMINI_API_KEY in Vercel" gate — enrichment lives in n8n now, Vercel only READS complaint_nlp. No Vercel LLM key required for NLP to work.

#### 📌 Architecture note
- NLP enrichment = **n8n JS-22 (Gemini)**. Vercel `/api/cron/nlp-enrich` (Gemini/Anthropic) still exists as an alternate path but is NOT the primary — JS-22 is. `/api/intelligence/nlp-insights` is provider-agnostic (reads complaint_nlp).

#### ⚠️ Next AI — Please Note
- To enrich faster/backfill: n8n → JS-22 → Execute (each run = 8 complaints). Don't spam — Gemini free tier rate-limits.
- JS-22 uses Supabase cred `2g6ksgz4oy9Ye7kP` + Gemini cred `GZKueH9lQUzyB0GK`. Both pre-existing.
- Clusters need duplicate root_cause_key (same problem, multiple complaints) — forms naturally with volume.

---

### SESSION 12 — Claude Code (June 13, 2026): NLP Brain (Level 4) — AI reads the raw complaint text

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8) — Anthropic CLI
- **Goal:** The copy-proof feature — extract intelligence from the complaint TEXT that category/urgency can't capture. User picked this via /goal-style option.

#### 🧠 What it extracts (per complaint, from raw Bengali/Hindi/English text)
- **anger_score (0-100):** how distressed/desperate the citizen actually sounds (WATER + "bachche bimar" ≠ WATER + "thoda dikkat")
- **root_cause + root_cause_key:** the underlying cause, slugged for **clustering** — "8 complaints share ONE broken pump" → fix once, resolve 8
- **entities:** officers / schemes / infrastructure / places named in the text
- **emotion** + **severity_flags** (child_safety, health_risk, water, repeat, vulnerable, safety) + **summary_en**

#### ✅ NEW: `src/lib/nlp/enrich.ts` — Anthropic Claude enrichment engine
- Uses `@anthropic-ai/sdk` (installed) with `output_config.format` json_schema → guaranteed-valid JSON, fence-stripping fallback
- **Model via `ANTHROPIC_MODEL` env, default `claude-haiku-4-5`** — cost-right for per-complaint scale (~₹0.3/complaint). Bump to `claude-opus-4-8`/`claude-sonnet-4-6` for higher quality.
- Graceful: no `ANTHROPIC_API_KEY` → `enrichOne()` returns null, system works without NLP
- **ETHICS LINE in code:** aggregate civic intelligence only — issue-level signal, NOT individual-citizen psychological profiling/voter targeting. (DPDP + ECI line.)

#### ✅ NEW DB: `complaint_nlp` table (migration `add_complaint_nlp_table`)
- One row/complaint: anger_score, emotion, root_cause(+key), entities jsonb, summary_en, severity_flags[], model, enriched_at. Indexed on root_cause_key + anger_score.

#### ✅ NEW APIs
- `/api/cron/nlp-enrich` (GET batch + POST single) — CRON_SECRET-gated, finds un-enriched complaints, runs Claude, upserts. Batch bounded (default 25, max 50) to cap cost/latency.
- `/api/intelligence/nlp-insights` (GET) — **scope-locked** aggregates (same getComplaintScopeFilter boundary): root-cause clusters, anger hotspots (by sub-area), entity watch (recurring officers/schemes/infra), emotion mix, severity flags, coverage. AGGREGATE ONLY.

#### ✅ NEW n8n: JS-22 (`q3eY0cJESRMjuaIi`) — every 30 min calls the batch enrich endpoint (validated 0 errors). ⚠️ INACTIVE until ANTHROPIC_API_KEY set.

#### ✅ UI: IntelligenceCommandView — new "NLP Brain" section
- On-demand "Analyze" button → root-cause cluster cards (count + villages + tickets + avg anger), anger-hotspot bars, entity-watch list, emotion/severity chips. Graceful "set ANTHROPIC_API_KEY" / "no data yet" states.

#### ⚠️ User TODO (to activate)
1. Vercel env: `ANTHROPIC_API_KEY=<key from console.anthropic.com>` (and optionally `ANTHROPIC_MODEL`) → redeploy
2. n8n: activate JS-22 (auto-enrich), OR hit `/api/cron/nlp-enrich` once to backfill
3. Open Intel Command → NLP Brain → Analyze

#### ✔️ Verification
- tsc: all NLP files 0 errors. JS-22 validated. (Production test deferred — routes deploy on push.)

#### ⚠️ Next AI — Please Note
- NLP enrichment = `src/lib/nlp/enrich.ts` (single source). Prompt/schema changes go there.
- **Do NOT add individual-citizen profiling/targeting** on top of this. Aggregate clusters/hotspots only. The ethics line is the product's legal moat ("Palantir-grade, court-proof").
- Existing `z-ai-web-dev-sdk` AI route (process-complaint) is DEAD in prod (returns fallback). The working LLMs are now: n8n Gemini (triage) + this Anthropic path (NLP). Don't revive ZAI.
- To enrich on complaint-create (vs 30-min batch), POST `/api/cron/nlp-enrich` with `{id}` from JS-01/JS-02 after register.

---

### SESSION 11 — Claude Code (June 13, 2026): Premium visuals for EVERY role — GovernanceDashboardView upgraded to Palantir-grade

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8) — Anthropic CLI
- **Driver:** User — "kya har role ke liye McKinsey/Palantir-level visuals, charts, deep analysis hai?"

#### 🔍 Audit finding (chart richness per view)
| View | For | Chart components | Was |
|------|-----|------------------|-----|
| Intel Command | ALL roles | 8 | ✅ premium |
| MP Command | MP | 9 | ✅ |
| Main Dashboard | Admin/District | 14 | ✅ |
| MLA Dashboard | MLA | 8 | ✅ |
| **GovernanceDashboardView** | **Karyakarta/GP/Block HOME** | **0** | 🔴 plain tables |
- **The gap:** coordinators (the most numerous users — hundreds of karyakartas) landed on a chart-less dashboard. Off-brand for a "Palantir for politicians" product. Note: Intel Command (premium) was already available to them — but their HOME was weak.

#### ✅ FIX — GovernanceDashboardView Home tab rebuilt with charts (recharts)
- **Area Health Score** — radial gauge 0–100 (positive framing for field staff: resolution rate 45 + low-SLA 25 + low-critical 15 + rating 15), STRONG/STEADY/WATCH/WEAK grade
- **Status Mix** donut (active/in-progress/resolved/rejected)
- **Performance** card — resolution-rate bar + avg rating + last-7-days
- **8-Week Tempo** area chart (filed vs resolved)
- **Issue Categories** bar chart (category-colored)
- **{Village/GP} Leaderboard** — horizontal stacked bars (resolved vs active), role-adaptive grouping (karyakarta/GP→village, block→GP)
- All computed client-side from the already-scoped `/api/complaints?limit=500` fetch — no new API, no extra cost

#### ✔️ Verification
- tsc: GovernanceDashboardView 0 errors. Complaints + Breakdown tabs untouched.

#### 📌 Per-role visual parity now
- Every governance role's HOME is chart-rich, AND every role also has Intel Command (risk gauge, hotspot matrix, peer benchmark, sentiment, PR wins, Wapas Jao). Visual grade is now consistent top-to-bottom.

#### ⚠️ Next AI — Please Note
- GovernanceDashboardView ka Home tab ab recharts use karta hai (same pattern as IntelligenceCommandView/MPCommandView). Naya chart add karna ho to wahi ChartContainer + recharts idiom follow karo.
- Health Score formula GovernanceDashboardView mein inline hai; agar isे standardize karna ho to ek shared `lib/scoring.ts` bana sakte ho (Intel Command ka riskIndex iska inverse hai).

---

### SESSION 10 — Claude Code (June 13, 2026): Information Architecture Redesign — proper role-based navigation (no more "khichdi")

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8) — Anthropic CLI
- **Problem:** User feedback — "admin pe MP Command kyun dikhta hai? MLA pe bhi khichdi lagta hai. Lagta hai koi proper design flow hi nahi, bina planning ka." 100% jaayaz.

#### 🐛 ROOT CAUSE (the actual bug)
- DB mein `mp_purulia` user ka `role = ADMIN` AND `role_level = MP` dono set the (galat seed). Nav gating `role === 'ADMIN' || role_level === 'MP'` pe thi → wo user dono dekh raha tha. Aur ADMIN ko `role_level` se independent saare role-views (MP Command + MLA Dashboard) ek hi flat list mein mil rahe the — koi grouping nahi, koi hierarchy nahi.
- **Design problem:** nav ek single flat `allNavItems` array thi with scattered `...(condition ? [item] : [])` spreads — 20+ items bina kisi section/order ke. Yahi "khichdi" feel de raha tha.

#### ✅ FIX 1 — Data: `mp_purulia` role ADMIN → BLOCK (role_level MP intact)
- Ab wo pure MP hai, ADMIN nahi. (DB update applied.)

#### ✅ FIX 2 — Information Architecture: role-wise sectioned navigation (`navSections`)
Har role ka apna **curated, ordered, grouped** menu — `page.tsx` mein ek hi `navSections` builder:
- **ADMIN** → Home (Dashboard, Intel Command) · *Operations* · *Insights* · **Role Previews** (MP Command + MLA Dashboard — ab clearly "preview" labelled, confusion khatam) · *System* (users, audit, n8n, deployment...) · Settings
- **MP** → MP Command (home) + Intel Command · *Operations* (Complaints, Map) · *Team* (Users) · Settings
- **MLA** → MLA Dashboard (home) + Intel Command · *Operations* · *Team* · Settings
- **DISTRICT_ADMIN** → Dashboard + Intel · *Operations* (+Analytics) · *Team* · Settings
- **BLOCK_COORD / GP_COORD** → Dashboard + Intel · *Operations* · *Team* · Settings
- **KARYAKARTA** → Dashboard + Intel · *Operations* · Settings (no team mgmt)
- **Legacy officers (BLOCK/DISTRICT/STATE)** → Dashboard + Intel · *Operations* · *Insights* · Settings

#### ✅ FIX 3 — Home view + stale-view guard
- `homeView` per role: ADMIN→dashboard, MP→mp_command, MLA→mla_dashboard, baaki→dashboard. Login pe wahin land karta hai.
- **Guard added:** agar current `view` user ke nav-allowed set mein nahi hai (role switch / stale state), to auto-redirect to `homeView`. Pehle stale view pe blank/wrong screen dikh sakti thi.

#### ✅ FIX 4 — Both nav renderers (desktop sidebar + mobile sheet) ab section headers ke saath render karte hain (uppercase tracking-widest labels)

#### ✔️ Verification
- tsc: page.tsx 0 errors. Removed dead vars: `allNavItems`, `isCoordinatorRole`, `coordinatorAllowed`.

#### ⚠️ Next AI — Please Note
- **Navigation ka SINGLE SOURCE = `navSections` builder in page.tsx** (top of Home component). Naya view add karna ho to relevant role ke section mein daalo — flat list mat banao.
- Render guards (`view === 'mp_command' && (role_level MP || ADMIN)`) abhi bhi defence-in-depth ke liye hain — nav + guard dono rakho.
- Agar koi aur user `role=ADMIN` + `role_level=<something>` dono rakhe to wo ADMIN treat hoga (ADMIN check pehle aata hai). Seed/admin-create karte waqt dhyan: real ADMIN ka role_level OFFICER rakho.

---

### SESSION 9 — Claude Code (June 13, 2026): Staff Telegram Self-Linking (1-click connect for daily briefs)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-fable-5) — Anthropic CLI
- **Problem solved:** JS-21 daily brief sirf unhe jata hai jinke `users.telegramChatId` set hai — abhi sirf 1 user linked tha. Manual ID entry scale nahi karti (500 karyakartas!).

#### ✅ Flow (citizen JS-12 deep-link jaisa hi, par STAFF ke liye)
1. User portal Settings → **"Connect Telegram"** button → API one-time code generate karta hai
2. Telegram khulta hai deep link se (`t.me/<bot>?start=staff_<code>`) → user START dabata hai
3. JS-12 ka naya staff branch code match karta hai → `users.telegramChatId` save + code clear (single-use)
4. Bot reply: "✅ Linked! Kal subah se Daily Intel Brief aayega"

#### ✅ Changes
- **DB migration `add_telegram_link_code_to_users`:** `users.telegram_link_code` text + unique partial index; prisma schema bhi updated
- **NEW API `/api/users/telegram-link` (POST):** logged-in user ke liye 20-hex one-time code; response mein `deepLink` (agar `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` env set hai) warna manual `/start staff_<code>` instructions
- **SettingsView:** "Telegram Daily Intel Brief" card — Connect button + deep link open + manual fallback steps
- **n8n JS-12 updated (21 nodes now, validated 0 errors):** `Parse Telegram` mein staffCode detection + 4 naye nodes: `Is Staff Link` (IF) → `Link Staff Account` (PATCH users by code, return=representation) → `Build Staff Reply` → `Send Staff Reply` (HTML). Routing: Parse → Is Staff Link → (true: staff branch / false: Route by Ticket — existing citizen flow untouched)
- `.env.example`: `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` added

#### ⚠️ User TODO
- Vercel env mein `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=<bot ka username, @ ke bina>` set karo (BotFather/bot profile mein dikhega) — iske bina bhi manual `/start staff_<code>` se linking chalti hai, bas 1-click deep link nahi khulega

#### ✔️ Verification
- tsc: touched files 0 errors; JS-12 validated errorCount 0 (warnings pre-existing class)

---

### SESSION 8 — Claude Code (June 12, 2026): Level 3 Push Intelligence + "Wapas Jao" Mode + n8n JS-21

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-fable-5) — Anthropic CLI

#### ✅ REFACTOR: `src/lib/intelligence.ts` (new shared engine)
- Intelligence-brief computation `/api/intelligence/brief` route se nikal ke lib mein — ab interactive view AUR cron push dono YEHI engine use karte hain (logic duplicate nahi)
- `computeIntelligenceBrief(payload)` + `formatBriefForTelegram(brief)` (HTML parse-mode, dynamic text esc() — Session 4 rule followed)

#### ✅ NEW API: `/api/cron/daily-briefs` (Level 3 — Push Intelligence)
- Machine-to-machine route — `x-cron-secret` header vs `CRON_SECRET` env (user JWT nahi)
- Saare active governance users (MP/MLA/DISTRICT_ADMIN/BLOCK_COORD/GP_COORD/KARYAKARTA + ADMIN) jinke paas `telegramChatId` hai → har ek ka APNA scoped brief compute → Telegram-ready HTML messages return
- Empty jurisdictions skip (0 complaints = no message)
- `.env.example` mein `CRON_SECRET` added

#### ✅ NEW n8n WORKFLOW: JS-21 (`hPDe3mQWWf9bjWj8`) — 4 nodes, validated 0 errors
- `Every Morning 7AM` (cron 0 7 * * *, Asia/Kolkata) → `Fetch Briefs from App` (HTTP GET + x-cron-secret) → `Split Messages` (code) → `Send Brief via Telegram` (HTML, existing "Telegram account" credential `W4l40lF1yCNM5z9s`)
- ⚠️ **ACTIVATION PENDING — 2 manual steps:**
  1. Vercel env mein add karo: `CRON_SECRET=wbgp_cron_7f3a9d2e84c1b6f05a47e92d13c8ab60` (ye value JS-21 ke header mein hardcoded hai — change karo to dono jagah karo)
  2. n8n mein JS-21 ACTIVATE karo (inactive create hua hai)

#### ✅ NEW: "Wapas Jao" Mode (closed-loop politics — moat feature)
- API `/api/intelligence/wapas-jao`: scope-locked RESOLVED complaints, village-wise grouped, citizen names + ratings ke saath (visibility widen NAHI hoti — wahi data jo ComplaintsView mein already dikhta hai, bas visit-brief format mein)
- UI: IntelligenceCommandView mein new section — village accordion + per-village "Copy brief" button (WhatsApp paste-ready text: "Sumit ji aapka paani ka kaam hua tha…")

#### ✔️ Verification
- tsc: new/touched files 0 errors; n8n JS-21 validated (errorCount 0, sirf best-practice warnings — same class as JS-12)

#### ⚠️ Next AI — Please Note
- Brief engine ka SINGLE SOURCE = `src/lib/intelligence.ts` — brief format ya rules badalne ho to wahan
- JS-21 ka cron-secret app ke `CRON_SECRET` env se match hona zaroori hai — mismatch = 401
- n8n workflow IDs table mein JS-21 add kiya (neeche Key Reference)

---

### SESSION 7 — Claude Code (June 11, 2026 — ~20:15 IST): Intelligence Command — role-adaptive war-room brief (Karyakarta → MP)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-fable-5) — Anthropic CLI
- **Goal:** Har role ko corporate/McKinsey-grade intelligence dashboard — product differentiator for political-party customers

#### ✅ NEW API: `/api/intelligence/brief` (src/app/api/intelligence/brief/route.ts)
- **Scope-locked:** complaints `getComplaintScopeFilter` se filter hote hain (same boundary as /api/complaints) — karyakarta=village, GP=panchayat, block=GPs, MLA=AC, MP=seat, district=blocks
- **Computed intelligence (rule-based, deterministic, no LLM cost):**
  - **Political Risk Index 0–100** (weighted: active ratio 30, SLA ratio 25, critical 15, momentum 20, sentiment 10) + grade (LOW/GUARDED/ELEVATED/HIGH/SEVERE) + plain-language drivers
  - **Momentum:** 7d vs prev-7d intake (% change)
  - **Category surge detection:** week-over-week ≥25% + ≥2 complaints
  - **Hotspot matrix:** sub-areas ranked by mini risk score (role-specific grouping)
  - **Early warnings rule engine:** surges, critical clusters, SLA breakdown, volume spikes, sentiment drops, stalled resolution
  - **12-week trend** (filed vs resolved), **sentiment** (dist + direction improving/declining), **officer watch** (resolution scores), **avg resolution days**
  - **PR Ammunition:** recently resolved + well-rated (press/social material)
  - **Quick Wins:** old low-urgency OPEN complaints (easy closes first)
  - **Peer Benchmark:** sibling areas comparison (GP vs GPs in block, block vs blocks in district, AC vs ACs, seat vs seats, district vs districts) + percentile — ⚠️ AGGREGATE COUNTS ONLY (name+totals+rate), zero complaint detail, zero PII — deliberate design
- Perf note: computes in JS from scoped fetch (take 2000) — fine at current volume; bade volume pe SQL RPC mein migrate karna

#### ✅ NEW VIEW: `IntelligenceCommandView.tsx`
- One component, every role — title adapts (Ground/Panchayat/Block/Constituency/Parliamentary/District Intelligence)
- "RESTRICTED · EYES ONLY" classified-style header + scope badge + brief timestamp
- SVG risk gauge (5-zone arc + needle), KPI situation report, early-warnings feed, 12-week area chart, issue-composition pie + surge list, hotspot risk bars, horizontal peer-benchmark bar chart (purple=self), sentiment star distribution, officer leaderboard, PR-wins + quick-wins cards

#### ✅ Wiring
- `types.ts`: ViewType += `intel_command`
- `page.tsx`: "Intel Command" nav (sab roles); old admin alert view ab "Alert Engine" (ADMIN-only); coordinators (KARYAKARTA included) ke focused-nav mein intel_command added

#### ✔️ Verification
- tsc: new/touched files 0 errors (baaki pre-existing)

#### ⚠️ Next AI — Please Note
- Intelligence = rule-based on scoped complaint data. AGGREGATE only cross-scope (benchmark). **Individual-citizen profiling/targeting features mat banana** — DPDP + ethics line. PII analytics nahi.
- Next phase ideas (documented for roadmap): n8n JS-09 alerts ko warnings rule-engine se feed karna (Telegram push per role), weekly PDF brief via JS-17 pattern, block-name normalization (Session 3 note) hotspot accuracy improve karega

---

### SESSION 6 — Claude Code (June 11, 2026 — ~19:30 IST): Production RBAC — Full Hierarchy, Server-Side Scope Enforcement, MP Command Center

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-fable-5) — Anthropic CLI
- **Goal:** Production-ready role-based access system (Admin/MP/MLA/District/Block/GP Coordinator/Karyakarta) — ALL scope enforcement server-side

#### 🔍 AUDIT FINDINGS (security holes fixed this session)
1. 🔴 **CRITICAL — `/api/complaints/[id]` GET+PATCH:** sirf BLOCK/DISTRICT roles ka scope check tha. MP/MLA/BLOCK_COORD/GP_COORD/KARYAKARTA **koi bhi complaint state-wide read/modify kar sakte the** (ID guess karke).
2. 🔴 **CRITICAL — `/api/users/list`:** har authenticated user ko state-wide officer list leak ho rahi thi (no scoping).
3. 🟠 `/api/users` POST/PATCH: governance fields (role_level/constituency/gp_code/...) create/update hi nahi kar sakta tha; sirf ADMIN; koi hierarchy nahi.
4. 🟠 `canAccessConstituency` (jwt.ts): MP ko **poore state** ke ACs ka access deta tha — ab deprecated (kept for reference, no callers).
5. 🟠 `get_mp_dashboard_stats` RPC: 9 Purulia ACs **hardcoded**, MP ke seat se scoped nahi, legacy `constituency` column use karta tha. (Function abhi bhi DB mein hai but app ab use nahi karti.)
6. 🟡 `MPCommandView.tsx`: hardcoded MLA list (Purulia-only) + **fake TREND_DATA**, koi real drill-down nahi.

#### ✅ NEW: `src/lib/rbac.ts` — RBAC single source of truth
- `ROLE_LEVEL_RANK`: ADMIN(0) → MP(1) → MLA(2) → DISTRICT_ADMIN(3) → BLOCK_COORD(4) → GP_COORD(5) → KARYAKARTA/OFFICER(6)
- `creatableRoleLevels()` / `canCreateRoleLevel()`: har role sirf apne se NEECHE wale roles bana sakta hai (MP→MLA+below, MLA→coords+officers, Block→GP/Karyakarta, GP→Karyakarta)
- `validateNewUserScope()`: naya user creator ki HI geography ke andar hona chahiye — `constituency_block_mapping` table se validate (MP ke seat ke ACs, MLA ke AC ke blocks, etc.)
- `complaintInScope()`: per-record scope check (snake_case + camelCase dono column shapes handle karta hai — Supabase REST mode ke liye)
- `canMutateComplaints()`: KARYAKARTA = READ-ONLY; baaki sab apne scope mein status/assign kar sakte hain
- `userInManageScope()`: kis user ko edit/list kar sakte ho (lower rank + apni geography)
- `getUserListScope()`: user-list scoping (MP/MLA ke liye mapping-backed post-filter)
- `assembliesForLokSabha()` / `blocksForAssembly()` / `assembliesForDistrict()` / `mlaNamesByAssembly()` — mapping helpers (5-min cache)
- `canAccessAssembly()`: MLA→own AC; MP→sirf apne seat ke ACs; DISTRICT_ADMIN→apne district ke ACs

#### ✅ FIXED: `/api/complaints/[id]` (GET + PATCH)
- GET/PATCH dono ab `complaintInScope()` se FULL hierarchy check karte hain
- PATCH: `canMutateComplaints()` gate (KARYAKARTA 403)
- PATCH assignment: assignee ACTIVE hona chahiye AUR actor ke jurisdiction ke andar (`userInManageScope`) — MLA doosre AC ka officer assign nahi kar sakta

#### ✅ REWRITTEN: `/api/users` (GET/POST/PATCH) — hierarchical user management
- GET: jurisdiction-scoped list + same-or-higher rank hidden + `meta.creatableRoles` (UI isse adapt hoti hai)
- POST: `validateNewUserScope()` enforced — role hierarchy + geography dono server-side; password min 8 chars; sirf ADMIN hi ADMIN/STATE base-role bana sakta hai; saare governance fields ab create hote hain
- PATCH: `userInManageScope()` check + scope-change pe re-validation (privilege escalation blocked)

#### ✅ FIXED: `/api/users/list` — ab actor ke scope tak filtered (pehle full leak)

#### ✅ FIXED: `/api/mla/stats`
- `canAccessAssembly()` (mapping-backed) — MP ab sirf apne seat ke ACs drill kar sakta hai
- Query ab `constituency` OR `assembly_constituency` dono match karti hai (legacy + new rows)

#### ✅ NEW DB RPC: `get_mp_command_center(p_lok_sabha)` (migration `add_get_mp_command_center_rpc`)
- Seat-scoped KPIs + per-AC cards (har AC dikhta hai, 0 complaints wale bhi) + MLA names from `constituency_block_mapping` + REAL 6-month trend (filed/resolved) + seat-scoped officer count
- AC matching: `COALESCE(assembly_constituency, constituency)` — dono column generations covered
- **Live tested:** `get_mp_command_center('Jhargram')` → sirf Bandwan AC (22 complaints), correct trend ✅

#### ✅ FIXED: `/api/mp/dashboard` — MP HAMESHA apne seat pe locked; sirf ADMIN `?lok_sabha=` override kar sakta hai. Naya RPC use karta hai.
#### ✅ FIXED: `/api/mp/leaderboard` — MP→seat ACs, DISTRICT_ADMIN→district ACs filtered

#### ✅ REBUILT: `MPCommandView.tsx` — dynamic MP Command Center
- Hardcoded MLA_META/TREND_DATA hataya — constituencies + trend ab API se
- Seat name dynamic header badge; "9 Constituencies" → actual count
- **Real drill-down:** AC card click → `/api/mla/stats` fetch → SLA breaches, critical, rating, block breakdown, top officers, recent complaints inline expand
- Palette ab name-hash se stable assign hoti hai (kisi bhi seat ke liye kaam karega)

#### ✅ UPDATED: `UserManagementView.tsx`
- "Designation" select — server ke `meta.creatableRoles` se driven (MP ko MLA+below dikhte hain, MLA ko coords, etc.)
- Conditional geography fields: MP→Lok Sabha, MLA→AC, GP/Karyakarta→GP code+name, Karyakarta→villages (comma-sep)
- Table mein Designation column; password min-8 client validation

#### ✅ UPDATED: `page.tsx` nav gating
- Users view ab MP/MLA/DISTRICT_ADMIN/BLOCK_COORD/GP_COORD ko bhi (pehle ADMIN-only)
- Coordinator focused-nav mein 'users' added (KARYAKARTA ke liye nahi)

#### ✔️ Verification
- `npx tsc --noEmit`: is session ke saare touched files **0 errors** (baaki errors pre-existing — examples/, prisma/seed, db.ts, leaderboard, ceoRouter — SESSION 3 mein bhi noted)
- RPC live-tested on Supabase (Jhargram seat) ✅

#### ⚠️ Next AI — Please Note
- **RBAC ka SINGLE SOURCE OF TRUTH = `src/lib/rbac.ts`** — naye route mein scope check chahiye to YAHI use karo, apna logic mat likho
- `constituency_block_mapping` table = AC↔LS↔block↔MLA authoritative mapping (abhi sirf Purulia district ke 20 blocks seeded — naye districts ke liye rows add karni hongi)
- Old `get_mp_dashboard_stats` RPC ab UNUSED hai (app `get_mp_command_center` use karti hai) — drop karna ho to pehle n8n workflows check karo
- Complaint POST (manual create) abhi bhi sirf BLOCK-role scope check karta hai — coordinators ke liye tighten karna ho to `complaintInScope` pattern use karo
- JWT 24h valid — role/scope change ke baad user ko RE-LOGIN karna hoga (Session 3 wala hi pattern)

---

### SESSION 5 — Claude Code (June 11, 2026 — ~18:30 IST): Project Setup + Changelog Protocol Established

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-sonnet-4-6) — Anthropic CLI
- **Triggered by:** User (mahatosnehabala250@gmail.com)
- **Session type:** Setup + orientation session

#### ✅ Kya Kiya
1. **Git config update** — username `tubiflowcontact-blip` → `mahatosnehabala250-project`, email updated to `mahatosnehabala250@gmail.com`
2. **GitHub CLI install** — `gh` v2.93.0 install kiya via winget
3. **GitHub login** — `mahatosnehabala250-project` account se authenticate kiya
4. **Repo clone** — `wb-grievance-portal` clone kiya `C:\Users\mahat\Downloads\wb-grievance-portal` mein
5. **KIRO_CHANGELOG.md updated** — header improved: ab clearly mention hai ki koi bhi AI tool (Kiro/Claude/etc.) yahan likhe, date+time+AI name ke saath, taaki collaboration seamless ho
6. **Changelog protocol confirmed** — user ne explicitly kaha: "jo bhi change ya update karo, yahan save karo date time wise taaki doosri AI tool samjhe aur sab ek saath kaam kar sakein"

#### 📌 Current System State (as of this session)
- Repo: `mahatosnehabala250-project/wb-grievance-portal` ✅ cloned locally
- Last code change: SESSION 4 (Claude, Jun 11 — Telegram HTML parse_mode fix)
- Pending: MP Command Center, end-to-end Telegram test, geography validation (see SESSION 4 notes below)

#### ⚠️ Next AI — Please Note
- Ye file HAMESHA update karo jab koi bhi change karo
- DB functions chhune se pehle `pg_get_functiondef` se padho (CRITICAL section dekho upar)
- `register_complaint` function ke saath extra careful rehna — Kiro ne ek baar toda tha

---

### SESSION 4 — Claude (June 11, 2026): Telegram Notification Fixes — parse_mode HTML safety

#### ⚙️ Infrastructure Note
- **Model switch:** `gemini-2.5-flash-lite` (cost + latency optimization for rapid iterations)
- **System prompt:** compressed ~57% (removed redundant instructions, consolidated role descriptions)
- Output/tool-usage patterns may differ slightly from earlier Claude sessions — verify commits before auto-deploy.

#### 🐛 Issue discovered
- **JS-12 Execution #4148:** "Send Success Reply" failed with `Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 139`
- **Root cause:** Telegram send nodes were using default Markdown `parse_mode`. If reply text contains underscores or special chars (like `_` in Bengali text or emojis), Telegram's entity parser tries to interpret them as formatting, causing parse errors.
- **Note:** The actual reply text was properly mapped to Bengali labels (e.g., `IN_PROGRESS` → `'প্রক্রিয়াধীন'`), so the issue was latent — triggered by specific text combinations.

#### ✅ Fix: Set all Telegram send nodes to HTML parse mode
**Affected workflows:**
1. **JS-12 Telegram Link Bot** (`ee8Ttjih5vJ1ZPsK`)
   - `Send Success Reply` → added `parseMode: HTML`
   - `Send Help Reply` → added `parseMode: HTML`
   - `Send Status Reply` → added `parseMode: HTML`
   - `Send Rating Reply` → added `parseMode: HTML`

2. **JS-04 Status Broadcaster** (`zxhMcvjLPbcuEzGz`)
   - `Notify via Telegram` → added `parseMode: HTML`

**Why HTML mode?**
- HTML mode uses strict `<tag>text</tag>` syntax — won't accidentally interpret `_`, `*`, `[` as formatting
- Our messages are plain Bengali/Hindi/English text with emojis — HTML mode safe for all content
- Fallback: If no HTML tags present, sent as plain text anyway

**Status:** Applied ✅ (5 nodes updated, 2 workflows)

#### ℹ️ What this fixes
- ✅ Telegram replies will now send even if message contains underscores, asterisks, or complex Unicode
- ✅ Emoji characters (✅ 🎫 📋 etc.) will render correctly
- ✅ Future-proofs against similar parse errors if resolution text or status labels are ever expanded

#### ✅ FOLLOW-UP (same session): HTML-escape dynamic content (bulletproof fix)
**Why:** HTML parse_mode alone is NOT safe — if dynamic text (citizen name, officer name, resolution text, issue, Telegram first_name) contains `<`, `>`, or `&`, Telegram HTML parser would STILL throw "can't parse entities". Real risk: officer writes resolution like "pipe < 2 inch" or "road A & B".

**Fix:** Added `esc()` helper to all message-building Code nodes that escapes `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;` on dynamic values only.

**JS-04 Status Broadcaster (`zxhMcvjLPbcuEzGz`):**
- `Build Status Message` now produces TWO fields:
  - `statusMessage` = PLAIN text → used by `Notify via WhatsApp` (WhatsApp does NOT parse HTML, so plain text required — escaping here would show literal `&amp;` to citizens)
  - `statusMessageHtml` = HTML-escaped → used by `Notify via Telegram`
- `Notify via Telegram` text changed: `statusMessage` → `statusMessageHtml`
- ⚠️ KEY INSIGHT: JS-04 shares one message for 2 channels. WhatsApp = plain, Telegram = escaped. Do NOT escape the shared field.

**JS-12 Telegram Link Bot (`ee8Ttjih5vJ1ZPsK`)** — Telegram-only, so escape directly:
- `Save Link + Build Reply` → escape name, ticketNo, statusLabel
- `Build Status Reply` → escape ticketNo, status, issue
- `Build Rating Reply` → escape rating, ticketNo
- `Build Help Reply` → escape Telegram first_name

**Validation:** Both workflows `errorCount: 0` ✅ (only pre-existing best-practice warnings)

**Result:** Now bulletproof — ANY citizen name, officer name, or resolution text with `<`, `>`, `&` will send correctly on Telegram. WhatsApp continues to get clean plain text.

---

### SESSION 3 — Kiro (June 10, 2026): Phase 2 BUGFIX #2 — scope filter used Prisma field names (returned 0)

#### 🐛 Root cause (the real one)
`src/lib/db.ts` is a 3-mode adapter. **Production runs in Supabase REST mode**, which treats each `where` key as a LITERAL column name (`q.eq(key, value)`), with NO Prisma field→column mapping and NO support for `{ equals, mode: 'insensitive' }`. The scope filter used Prisma field names (`gpCode`, `assemblyConstituency`) + `{ equals, mode }` → PostgREST got unknown columns → query failed → **0 complaints** (not even the BLOCK fallback ran cleanly).

#### ✅ Fix (`src/lib/jwt.ts` getComplaintScopeFilter)
Rewrote to use ACTUAL column names + plain equality:
- MP → `parliamentary_constituency`, MLA → `assembly_constituency`, GP_COORD → `gp_code`, DISTRICT → `district`, BLOCK → `block`, KARYAKARTA → `village { in: [...] }`
- Dropped `{ equals, mode }` wrappers (unsupported by the Supabase adapter)

#### ✅ GovernanceDashboardView
- Reads `gp_name` (snake) fallback for GP display, since Supabase mode returns raw snake_case columns (no camelCase mapping).

#### ⚠️ Known broader issue (note for next)
Supabase-mode reads return raw columns: `gp_name`, `assembly_constituency` (snake) — NOT `gpName`/`assemblyConstituency`. So the standard ComplaintDetailDialog / ComplaintsView (which read camelCase) may show "—" for GP/Assembly in production. A global snake→camel read-mapper in db.ts (or reading both) would fix this everywhere. Counts/KPIs are unaffected.

---

### SESSION 3 — Kiro (June 10, 2026): Phase 2 BUGFIX — GP/Karyakarta showed 0 complaints

#### 🐛 Root cause
`gp_code`, `gp_name`, `assigned_villages` were added to the DB `users` table (Phase 1 SQL migration) but were **never added to the Prisma `User` model**. So `db.user.findUnique` at login didn't return them → JWT carried `gp_code: null` → the GP_COORD / KARYAKARTA scope branch in `getComplaintScopeFilter` was skipped → wrong/zero results on the governance dashboard.

#### ✅ Fix
- `prisma/schema.prisma` User model: added `gp_code String?`, `gp_name String?`, `assigned_villages String[] @default([])`
- DB: `assigned_villages` set NOT NULL default `'{}'` (Prisma scalar lists can't be null)
- `prisma generate` run; Vercel build also runs it (`prisma generate && next build`)

#### ⚠️ ACTION REQUIRED after deploy
Existing JWT tokens were minted WITHOUT gp_code. Affected users (gpcoord_demo, karyakarta_demo, etc.) **must LOG OUT and LOG IN again** to get a fresh token carrying gp_code. Then GP_COORD → 11 complaints (gp 111050), KARYAKARTA → village-scoped.

---

### SESSION 3 — Kiro (June 10, 2026): Phase 2 FIX — coordinators were seeing District Performance

#### 🐛 Issue
A GP coordinator (gpcoord_demo) saw the standard DashboardView's "District Performance — Top 5 districts" leaderboard (showing messy block values as districts). Coordinators should only see their own scope.

#### ✅ Fixes (page.tsx)
- `view==='dashboard'` now renders `GovernanceDashboardView` for KARYAKARTA/GP_COORD/BLOCK_COORD (instead of the district-leaderboard DashboardView). So even clicking "Dashboard" shows their scoped view.
- Removed duplicate "My Dashboard" nav item; auto-redirect for coordinators → 'dashboard'.
- **Focused nav for coordinators:** only Dashboard, Complaints, Map, Settings. Hidden: WhatsApp Chats, Rakta, Analytics, Intelligence, Schemes, Live Data (district-wide views a coordinator shouldn't see).

#### Known data-hygiene note
`complaints.block` is inconsistent ("Manbazar I" / "Manbazar-I" / "manbazar" / "Manbazar 1"). BLOCK_COORD exact-match filter (16) misses variant spellings. Coordinator dashboards use clean `gp_code`/`village`, so unaffected. A future block-normalization migration would fix district/block leaderboards too.

---

### SESSION 3 — Kiro (June 10, 2026): Governance Hierarchy — PHASE 2 (Dashboards)

#### ✅ New: `GovernanceDashboardView.tsx` (one adaptive dashboard for 3 roles)
Reusable dashboard that adapts by `role_level`:
- **KARYAKARTA** → header shows assigned villages, breakdown by village
- **GP_COORD** → header shows GP name, breakdown by village
- **BLOCK_COORD** → header shows block, breakdown by Gram Panchayat
- Data source: existing scoped `/api/complaints?limit=500` (Phase 1 scope filter applies automatically) — no new API needed
- Tabs: Home (7 KPI cards + critical/SLA alerts + avg rating + top-breakdown), Complaints (search/status filter + click → existing ComplaintDetailDialog with full actions), Breakdown (village/GP-wise resolution bars)
- Style mirrors MLADashboardView (gradient header, tab pills, ScrollArea, framer-motion)

#### ✅ Wiring (`page.tsx`, `types.ts`)
- `ViewType` += `governance`
- Nav item "My Dashboard" gated to KARYAKARTA/GP_COORD/BLOCK_COORD/ADMIN
- Auto-redirect on login: these 3 role_levels → `governance` view
- Render guard added

#### Verified
- All edited/new files: 0 diagnostics. (Pre-existing TS errors in examples/, prisma/seed, MapView, db.ts etc. are unrelated and predate this work.)
- Scope counts confirmed in Phase 1 (Karyakarta 11 / GP 11 / Block 16 / MLA 19 / MP 19 / District 42 / all 55).

---

### SESSION 3 — Kiro (June 10, 2026): Governance Hierarchy — PHASE 1 (Foundation)

#### Design
Full hierarchy: Karyakarta → GP Coord → Block Coord → MLA → MP → District → State → Admin.
Visibility derived from `role_level` first, then base `role`. Geo auto-mapping (village→GP→block→AC→LS→district) already done by register_complaint+LGD.

#### ✅ DB (migration `phase1_governance_roles_and_user_jurisdiction`)
- Extended `users.role_level` CHECK: added `BLOCK_COORD, GP_COORD, KARYAKARTA`
- Added `users.gp_code`, `users.gp_name`, `users.assigned_villages text[]`

#### ✅ Demo users (password for ALL: `Demo@2026`)
All scoped to Purulia / Manbazar I / GP Kamtajangidiri (111050) / Bandwan AC / Jhargram LS so they see test complaints:
| username | role_level | scope | complaints visible |
|----------|-----------|-------|-----|
| karyakarta_demo | KARYAKARTA | villages Jangidiri, Baliguma | 11 |
| gpcoord_demo | GP_COORD | gp_code 111050 | 11 |
| blockcoord_demo | BLOCK_COORD | block Manbazar I | 16 |
| mla_demo | MLA | Bandwan | 19 |
| mp_demo | MP | Jhargram | 19 |
| district_demo | DISTRICT_ADMIN | Purulia | 42 |
| state_demo | (STATE) | all | 55 |
| admin_demo | (ADMIN) | all | 55 |

#### ✅ Code (pushed to GitHub)
- `src/lib/jwt.ts` — added gp_code/gp_name/assigned_villages to JWTPayload + NEW `getComplaintScopeFilter(user)` (single source of truth for complaint visibility, governance-scoped, applied LAST so scoped users can't widen via query params)
- `src/app/api/auth/login/route.ts` — payload + response now include gp_code/gp_name/assigned_villages
- `src/app/api/auth/me/route.ts` — FIXED: now returns role_level/constituency/lok_sabha/gp_code/... (previously dropped on refresh → MP/MLA dashboards would break after reload)
- `src/lib/auth-store.ts` — User type extended with new role_levels + jurisdiction fields
- `src/lib/constants.ts` — added `ROLE_LEVEL_MAP` + `ROLE_LEVEL_COLORS`
- `src/app/api/complaints/route.ts` — uses getComplaintScopeFilter (replaces block/district-only logic)
- `src/app/api/dashboard/route.ts` — uses getComplaintScopeFilter (where + slaWhere)

#### Phase 1 result
Standard Dashboard + Complaints views now respect the FULL hierarchy scope for all roles. MLA/MP dashboards unchanged (already existed). 
**Phase 2 (next):** dedicated Karyakarta / GP Coord / Block Coord dashboard views + nav gating. **Phase 3:** drill-down. **Phase 4:** admin user-management UI for assigning jurisdiction.

---

## 📋 Changes Log (earlier)

#### 🐛 Bug: Citizen rated 039 on Telegram but rating saved to 033
- **Root cause 1:** `save_telegram_rating` had a `satisfactionRating IS NULL` filter. 039 was already rated (3, from an earlier manual test), so the citizen's "4" skipped 039 and landed on the next unrated resolved complaint = 033.
- **Root cause 2:** `complaints.resolvedAt` was NULL for ALL rows (app never set it). RPC fell back to `updatedAt` ordering which is imprecise.
- **Fixes:**
  1. RPC `save_telegram_rating` — removed the `IS NULL` filter. Now targets the **most recently resolved** complaint (the one just prompted) and allows overwrite. (migration `fix_save_telegram_rating_target_latest_resolved`)
  2. New trigger `trg_set_resolved_at` — sets `resolvedAt = now()` when status → RESOLVED. Makes "most recently resolved" deterministic + fixes analytics. (migration `add_set_resolved_at_trigger`)
  3. Data correction: WB-26-PUR-001039 → rating 4 (citizen's real rating); WB-26-PUR-001033 → reverted to NULL.
- **Status:** Applied ✅

---

### SESSION 2 — Kiro (June 10, 2026 — Evening, fix #4: Telegram Rating)

#### ✅ DB: New RPC `save_telegram_rating(p_chat_id, p_rating)`
- **Why:** Telegram pe citizen rating ke liye sirf "3" bhejta hai (ticket number nahi). Existing `save_citizen_rating` ko ticket_no chahiye.
- **What:** New RPC — chat_id → phone (via citizen_telegram_links) → latest RESOLVED + unrated complaint → saves rating + logs activity + recalcs officer score.
- **Status:** Applied (migration `add_save_telegram_rating_rpc`) ✅
- **Live test:** Sumit's rating 3/5 saved for WB-26-PUR-001039 ✅

#### ✅ n8n: JS-12 — Telegram rating branch added
- **Problem:** User Telegram pe "3" (rating) bhejta tha → bot ke paas rating handler nahi tha → "help reply" (with confusing WhatsApp link wa.me/+918918213286) de deta tha.
- **Fix:** 4 new nodes + routing:
  - `Parse Telegram` updated: detects bare digit 1-5 → `ratingValue`
  - `Is Rating` (IF) → true → `Save Telegram Rating` (RPC) → `Build Rating Reply` → `Send Rating Reply`
  - `Is Rating` false → `Build Help Reply` (unchanged)
  - Routing: `Is Status Query` false → `Is Rating` (instead of straight to Help)
- **Now:** Telegram pe 1-5 bhejne se rating save hoti hai + Bengali confirmation reply. Help reply sirf genuinely unrecognized messages pe.
- **Status:** Applied ✅ (17 nodes, validated, 0 errors)
- **NOTE:** "Build Help Reply" mein hardcoded `wa.me/+918918213286` (service WhatsApp number) — ab rating us tak fall-through nahi hoti, par agar number galat hai to JS-12 "Build Help Reply" node mein update karna.

---

### SESSION 2 — Kiro (June 10, 2026 — Evening, fix #3)

#### ✅ n8n FIX: JS-04 Decide Channel — handle NUMBER chat_id (exec #4160 — THE real fix)
- **Symptom:** Telegram link save hone ke BAAD bhi status RESOLVED WhatsApp pe gaya.
- **Root cause (confirmed via exec #4160):** `Check Citizen Telegram` returned `"json": 7335362261` — a **NUMBER**, not a string or object. chat_id pura digits hai isliye n8n ne JSON number parse kiya. Pichla Decide Channel fix sirf `string` + `object` handle karta tha → number case mein `tgId` null → `hasTelegram: false` → WhatsApp.
- **Fix:** `Decide Channel` ab `typeof !== 'object'` (i.e. string OR number) ko direct value treat karta hai, plus object shapes. Number ab `String(tgId)` ho jaata hai → hasTelegram true → Telegram.
- **Status:** Applied ✅
- **NOTE for next session:** JS-04 "Notify via Telegram" still uses Telegram default Markdown parse mode. If a citizen's `resolution` text ever contains `_` `*` `[` `` ` ``, the telegram send could fail (same class as JS-12 #4148). Consider disabling parse_mode on telegram send nodes for full safety.

#### ✅ Confirmed working
- Telegram linking: link click → "✅ লিঙ্ক সফল হয়েছে" reply aata hai ✅
- `citizen_telegram_links`: `918768374600` → `7335362261` (active) ✅

---

### SESSION 2 — Kiro (June 10, 2026 — Evening, continued)

#### ✅ n8n FIX: JS-12 Telegram Markdown entity error (exec #4148)
- **Symptom:** Link click ke baad `Send Success Reply` fail: `Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 139`
- **Root cause:** Reply mein raw status `IN_PROGRESS` tha. Telegram Markdown mode mein `_` (underscore) italic shuru karta hai jo band nahi hota → parse error.
- **GOOD NEWS:** Is execution mein link **save ho gaya** (Upsert succeeded) — array/object fix kaam kar gaya. Sumit: `918768374600` ↔ chat `7335362261`.
- **Fix:** `Save Link + Build Reply` ab status ko Bengali label mein map karta hai (statusMap) — underscore eliminated.
- **Status:** Applied ✅

#### ✅ n8n FIX: JS-04 Decide Channel — robust telegram chat_id parsing
- **Concern:** `get_citizen_telegram` RPC text return karta hai; n8n scalar response ko string YA object (`{data:...}`) mein wrap kar sakta hai. Purana code sirf `typeof === 'string'` check karta tha → object case mein Telegram detect nahi hota → WhatsApp fallback.
- **Fix:** `Decide Channel` ab string + object dono shapes handle karta hai (`tgRes.data || tgRes.get_citizen_telegram || tgRes.telegram_chat_id`).
- **Status:** Applied ✅ (validated, 0 errors)

#### ✅ Confirmed: Telegram link now persists
- `citizen_telegram_links`: `918768374600` → `7335362261` (active) ✅

---

### SESSION 2 — Kiro (June 10, 2026 — Evening)

#### ✅ n8n FIX: JS-12 array/object parsing bug (CRITICAL — root cause of "no Telegram reply")
- **Symptom:** Telegram link click → `/start WB-26-PUR-001023` → koi reply nahi aaya. Status update WhatsApp pe gaya par Telegram pe nahi.
- **Root cause:** `Lookup Phone from Ticket` PostgREST se array `[{...}]` return karta hai, par **n8n usko individual item (object) mein split kar deta hai**. `Save Link + Build Reply` code `Array.isArray(dbResult)` check kar raha tha → object pe `false` → `complaint = null` → guard `return []` → chain ruk gaya → link save nahi hua → koi reply nahi.
- **Verified via execution #4140:** Lookup ne phone `917363055827` (বিমান মাহাতো) return kiya, par Save node ne 0 items output kiya.
- **Fix:** `Save Link + Build Reply` aur `Build Status Reply` dono nodes mein parsing fix:
  ```js
  const complaint = Array.isArray(raw) ? (raw[0] || null) : (raw && (raw.phone || raw.ticketNo) ? raw : null);
  ```
  Ab dono shapes (array ya object) handle hote hain.
- **Status:** Applied in n8n ✅ (validated, errorCount 0)

#### ℹ️ JS-04 Status Broadcaster — NO CHANGE NEEDED
- Execution #4141: Sumit (918768374600) ka status IN_PROGRESS → WhatsApp pe gaya, Telegram pe nahi.
- **Reason:** Sumit ka Telegram link kabhi save hua hi nahi (JS-12 bug ki wajah se). `citizen_telegram_links` table EMPTY thi.
- JS-04 logic + `get_citizen_telegram` RPC sahi hai. JS-12 fix ke baad jab user link karega, JS-04 automatically Telegram pe bhejega.

#### ℹ️ Frontend "error" on status change — likely Vercel deploy pending OR transient
- User ne frontend pe status IN_PROGRESS kiya → error message dikha, PAR WhatsApp notification chala gaya (matlab backend webhook fire hua).
- Investigate next session: frontend ka `/api/complaints/[id]` PATCH response — possibly Prisma client out of sync with new columns until Vercel redeploys, ya optimistic-UI error. WhatsApp gaya iska matlab DB update + JS-04 trigger dono hue.

---

### SESSION 1 — Kiro (June 10, 2026 — Morning)

#### ✅ DB Migration: `drop_duplicate_register_complaint_numeric`
- **What:** `register_complaint(... numeric, numeric)` — old duplicate function drop kiya
- **Why:** PGRST203 overloading error — n8n complaint register nahi kar pa raha tha
- **Status:** Applied ✅

#### ✅ DB Migration: `fix_lookup_village_coords_block_normalization`
- **What:** `lookup_village_coords()` function update — block name normalization added
- **Detail:** `"Manbazar I"` (space) vs `"Manbazar-I"` (hyphen) — dono ab same treat hote hain
- **Why:** Assembly auto-fill nahi ho raha tha because block name LGD table se match nahi karta tha
- **Status:** Applied ✅

#### ✅ DB Migration: `register_complaint_reject_invalid_gp_and_derive_assembly`
- **What:** `register_complaint` update — GP+Block validation + assembly fallback
- **Detail:** Invalid GP (e.g. Kamta Jangidiri in Hura block) → returns `invalid_gp_block` error. Village not in LGD → derives assembly from GP's village list.
- **Status:** Applied ✅

#### ❌ DB MISTAKE (KIRO): `register_complaint` broken recreation
- **What:** Session end mein ek nayi broken function recreate ki — `RETURNS TABLE`, `WGBR-` format, snake_case columns
- **Why wrong:** `complaints` table mein `ticket_no`, `citizen_name` columns hain hi nahi; `PENDING` status invalid hai
- **Impact:** All new complaint registrations started failing
- **Fixed by:** Claude (same day, ~10:03 IST)

#### ✅ Code: `src/lib/guardrail/rules/languageMismatch.ts`
- **What:** Bengali/Devanagari/Latin — teeno scripts ab har session language ke liye allowed
- **Why:** Bengali replies `en`/`hi` sessions mein guardrail block kar raha tha → "One moment please..." wrong fallback ja raha tha citizens ko
- **Status:** Pushed to GitHub ✅ (commit `5bc57e3`)

#### ✅ Code: `prisma/schema.prisma`
- **What:** New fields mapped to existing DB columns:
  - `gpName` → `gp_name`
  - `assemblyConstituency` → `assembly_constituency`
  - `parliamentaryConstituency` → `parliamentary_constituency`
  - `villageCode` → `village_code`
  - `gpCode` → `gp_code`
- **Status:** Pushed + `prisma generate` run ✅

#### ✅ Code: `src/lib/types.ts`
- **What:** `Complaint` interface mein `gpName`, `assemblyConstituency`, `parliamentaryConstituency`, `villageCode`, `gpCode` add kiye
- **Status:** Pushed ✅

#### ✅ Code: `src/components/ComplaintDetailDialog.tsx`
- **What:** Info grid mein add kiya: Village, Gram Panchayat (correctly `gpName`, pehle galat `pct` tha), Assembly Constituency, Lok Sabha
- **Status:** Pushed ✅

#### ✅ Code: `src/components/ComplaintsView.tsx`
- **What:**
  - "Block" column renamed to "Location"
  - Now shows: Block + District, GP, Village, Assembly Constituency (stacked)
  - Mobile cards: GP name + Assembly added
  - CSV export: Village, GP, Assembly, Lok Sabha columns added
- **Status:** Pushed ✅

#### ✅ n8n: JS-12 Telegram Link Bot (`ee8Ttjih5vJ1ZPsK`)
- **What:**
  - Bug fix 1: Empty phone guard — invalid ticket pe chain stops, corrupt empty-phone link DB mein nahi jaata
  - Bug fix 2: Success reply now reads from "Save Link" node (not Upsert's empty response) → "message text empty" error fix
  - New feature: Status query branch — citizen Telegram pe ticket number bheje to live status reply milega
- **Nodes added:** `Is Status Query`, `Lookup Status`, `Build Status Reply`, `Send Status Reply`
- **Status:** Applied in n8n ✅ (13 nodes total, was 9)

#### ✅ DB: Corrupt empty-phone rows cleaned
- **What:** `citizen_telegram_links` se `phone = ''` rows delete kiye
- **Status:** Applied ✅

#### ✅ Tests: `tests/guardrail/rules.test.ts`
- **What:** Language mismatch tests updated — new cross-script tolerance behavior reflect karta hai
- **Status:** Pushed ✅

---

### SESSION 1 — Claude (June 10, 2026 — After Kiro)

#### ✅ DB: `register_complaint` function restored
- **What:** Kiro ki broken version drop karke proper working version restore kiya
- **Version:** `RETURNS json`, `WB-26-PUR-` format, camelCase columns, full LGD lookup
- **Live test:** `WB-26-PUR-001039` (Sumit Kumar, Jangidiri, Manbazar I → Bandwan AC → Jhargram MP) ✅
- **Status:** Working in production ✅

#### ✅ n8n: JS-01 Sahayak execution #4100 verified
- **What:** Post-fix complaint registration working, triage + dispatch triggers fire hoga
- **Status:** Confirmed working ✅

---

## 📌 Current System State (June 11, 2026 — Morning)

| Component | Status | Last Changed |
|-----------|--------|-------------|
| Guardrail false-block | ✅ Fixed | Kiro (Jun 10) |
| `lookup_village_coords` block normalization | ✅ Fixed | Kiro (Jun 10) |
| `register_complaint` GP validation + assembly | ✅ Fixed | Claude (Jun 10) |
| Frontend — GP/Village/Assembly visible | ✅ Done | Kiro (Jun 10) |
| Telegram linking (JS-12) | ✅ Fixed + Enhanced | Kiro (Jun 10) |
| JS-04 Status Broadcaster | ✅ Working (fixed by #12 fix) | Kiro (Jun 10) |
| **Telegram send parse_mode (HTML safety)** | **✅ Fixed** | **Claude (Jun 11)** |
| Complaint rating save bug | 🔄 Ready to test | Claude (Jun 11) |
| Geography validation | ❓ Need investigation | Pending |
| **MP Command Center (seat-scoped + drill-down)** | **✅ BUILT** | **Claude Code (Jun 11, S6)** |
| **RBAC — full hierarchy server-side (rbac.ts)** | **✅ BUILT** | **Claude Code (Jun 11, S6)** |
| **Complaint [id] scope bypass (all roles)** | **✅ Fixed** | **Claude Code (Jun 11, S6)** |
| **User mgmt hierarchy (create below + own scope)** | **✅ BUILT** | **Claude Code (Jun 11, S6)** |

---

## 🚀 Pending Work — Next Session

### Priority 1: Test end-to-end flow
- Fresh WhatsApp complaint → ticket + Telegram link
- Click Telegram link → JS-12 links → `citizen_telegram_links` pe valid phone
- Status change in portal → JS-04 sends Telegram notification
- Send ticket on Telegram → get status reply

### Priority 2: MP Command Center (large feature)
**What is needed:**
- New roles: `MP`, `MLA` (currently only ADMIN, BLOCK, DISTRICT, STATE)
- Constituency-based complaint visibility (MLA → sirf apni AC, MP → sab)
- New dashboard view `/mp-command-center`:
  - All Assembly Constituencies cards
  - Click MLA card → drill-down with Complaints, Officers, Karyakartas, Villages, GPs, Escalations
- Intake flow UNCHANGED: Name → Village → District → Block → GP → Details
- Assembly auto-derived from GP/Village mapping (already working backend)

---

## 🗂️ Key Reference

### n8n Workflow IDs
| Name | ID | Nodes | Updated |
|------|----|-------|---------|
| JS-01: Sahayak (AI Agent) | `YsUZwu99ckTnzekR` | 29 | Jun 10 |
| JS-02: Priya Triage | `1DhuTXFdgOosTe1g` | 5 | Jun 7 |
| JS-03: Dispatch | `ujYm0XWJ93I55GC0` | 14 | Jun 7 |
| JS-04: Status Broadcaster | `zxhMcvjLPbcuEzGz` | 9 | Jun 10 |
| JS-12: Telegram Link Bot | `ee8Ttjih5vJ1ZPsK` | 13 | Jun 10 |
| JS-17: MP Weekly Brief | `0TT4yfYrcQ11m5dU` | 10 | Jun 4 |
| JS-21: Daily Intel Brief (7AM Telegram) | `hPDe3mQWWf9bjWj8` | 4 | Jun 12 (✅ active) |
| JS-22: NLP Brain — Gemini enrichment (self-contained) | `yxH2qx9I9vNrGHDL` | 8 | Jun 13 (✅ ACTIVE — uses n8n Gemini credential, no Vercel key needed) |

### Supabase Project
- Project ref: `sxdtipaspfolrpqrwadt`
- URL: `https://sxdtipaspfolrpqrwadt.supabase.co`
- Total migrations applied: 119 (latest: `enable_rls_complaint_nlp`, Jun 15)

### GitHub Repo
- `mahatosnehabala250-project/wb-grievance-portal`
- Latest commit: `5bc57e3` (Jun 10, Kiro)

### Key DB Functions (DO NOT MODIFY without reading current version first)
```sql
-- Read before touching:
SELECT pg_get_functiondef(oid) FROM pg_proc 
WHERE proname = 'register_complaint' AND pronamespace = 'public'::regnamespace;

SELECT pg_get_functiondef(oid) FROM pg_proc 
WHERE proname = 'lookup_village_coords' AND pronamespace = 'public'::regnamespace;

SELECT pg_get_functiondef(oid) FROM pg_proc 
WHERE proname = 'validate_gp_in_block' AND pronamespace = 'public'::regnamespace;
```

### Complaint Table — Correct Column Names
```
camelCase (Prisma)     DB column
ticketNo            →  "ticketNo"
citizenName         →  "citizenName"
gpName              →  gp_name
assemblyConstituency → assembly_constituency
parliamentaryConstituency → parliamentary_constituency
n8nProcessed        →  "n8nProcessed"
createdAt           →  "createdAt"
updatedAt           →  "updatedAt"
```
**Important:** Mix of camelCase (quoted) and snake_case — always check before writing SQL INSERT/UPDATE.
