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

### SESSION 58 — Claude Code (June 22, 2026): IA simplification — every role gets 6 destinations

#### ✅ What changed (`src/app/page.tsx` navSections rewrite)
Per PRODUCT_AUDIT §6 blueprint: **Home · Complaints · Map · Intelligence · Team · Settings** for every role (KARYAKARTA/OFFICER: no Team; legacy officers: +WhatsApp Chats). Role homes preserved (MP→MP Command as "Home", MLA→MLA Dashboard as "Home"). "Intel Command" renamed **Intelligence** — Overview/Forecast/Brain/Entity360/Actions/Field all live inside it as rooms. **ADMIN** keeps everything via a tucked "System" section (chat/analytics/alert-engine/schemes/liveData/audit/status/integrations/n8n/wb01/endpointHealth/deployment/MP-MLA previews). Top-level `overview` removed from all navs (room remains); assistant NAV destination `overview` remapped to intel_command+room. Stale views auto-bounce to role home via the existing `allowed` guard.

#### Net effect
MLA/MP sidebar: 6 items (was ~8 across 4 sections). Admin: 6 + System. Saathi (✨) = universal front door.

---

### SESSION 57 — Claude Code (June 22, 2026): FOCUS decision — রক্ত সহায়ক (blood) removed from main; audit docs

#### 🎯 Founder decisions (FOCUS.md)
Product is for **MLA + MP offices** (grievance OS). **Blood-donor module OUT of main.**

#### ✅ What was done
- **Archive first:** full code preserved on branch **`archive/rakta-sahayak-blood`** (pushed) — restore anytime.
- **Removed from main:** `api/blood*`, `api/blood-donors/*`, `api/blood-requests/*`, `api/donor/*`, `api/cascade/*` (donor cascade), crons `sos-queue-drainer`, `bandit-trainer`, `cascade-override-expiry`, `decrement-invitations` (+ their `vercel.json` entries); pages `dashboard/blood`, `donor/*`, `verify/[id]` (certificate); components `RaktaSahayakView`, `donor/*`; `rakta` view from nav/ViewType/render; 12 blood test files. Also deleted dead `PerformanceLeaderboard` + `SystemHealthWidget` (audit finding). Net: **~26 routes + 8 pages + 5 components off main.**
- **Kept (shared by complaints bot):** `cron/whatsapp-outbox-drainer` (generic outbox), `lib/flowStack` + `lib/cascade/tierSchedule` (bot lib internals — blood-flow branches unused now; cleanup later if desired). DB tables untouched (donor data preserved).
- Also added `PRODUCT_AUDIT.md` (measured khichdi map: 24 views/125 routes/76 tables, 4-products-in-1, dead code, 6-view simplification blueprint) + `FOCUS.md` (5 founder questions).

#### ⚠️ Next AI — Please Note
- If any **n8n workflow** still posts to blood endpoints (SOS/donor flows), it will now 404 — disable those n8n workflows.
- Remaining FOCUS answers pending: positioning (govern-OS vs intel), pricing, DPDP posture. Next big task: 24→6 view simplification (blueprint in PRODUCT_AUDIT §6).

---

### SESSION 56 — Claude Code (June 22, 2026): Saathi — fix script-mismatch data bug + TTS markdown + honesty

#### 🐛 Critical bug fixed (from a live test)
"Baliguma mein kitni complaints?" returned **593** (the GLOBAL total) instead of Baliguma's. Root cause: Hindi/Bengali voice → place names transcribed in **Devanagari/Bengali script** (बालিগুমা), but the DB stores **Latin** ("Baliguma"). Old `normArea` stripped all non-`[a-z0-9]` → **empty target** → `includes('')` matched EVERY row → returned the global total mislabeled as the area.
- **Fix:** added a Devanagari/Bengali → Latin transliteration (`INDIC` map + `translit`) inside `normArea`, plus collapse-repeated-letters (vowel-length) and a bidirectional `areaMatch`. Empty target now returns "area not understood" (never match-all). Applied to `area_breakdown`, `query_complaints` (area filter), and `search_complaints` (transliterate before DB `contains`). (`src/lib/assistant/tools.ts`)
- **Prompt honesty:** for a place question, if the tool returns total 0 / not-found, the model must SAY the area wasn't found — never substitute global numbers. (`agent.ts`)

#### 🔊 Voice polish
- TTS was reading "*" aloud as "star" (model used `*bold*`). Fixed both ends: `speak()` now strips markdown (`* _ \` # ~ > |`) before speaking, and the system prompt forbids asterisks/markdown ("spoken aloud").

#### ⚠️ Still open (next)
- "zoom karo / village ko map pe dikhao" only OPENS the map — it does NOT fly/zoom to the place yet (needs a map-focus directive: assistant → MapView flyTo). Web Speech is press-to-talk (re-click per turn, no barge-in) — **Gemini Live (⚡ toggle)** is the fix for continuous + barge-in + natural voice; the user's test was the Web Speech fallback, not Live.

---

### SESSION 55 — Claude Code (June 22, 2026): Saathi — guarded text-to-SQL (`ask_data`) "ask anything"

#### ✅ What was built (careful, security-first)
`ask_data` tool (`src/lib/assistant/tools.ts`) — open-ended data questions the other tools can't answer, via a SAFE read-only SQL path. **The LLM never touches the raw table.** A focused DeepSeek call writes an inner SELECT that may ONLY use two server-built CTEs:
- `c` = complaints **pre-filtered by `scopeToSql(payload)`** (so scope can't be widened) and **PII-FREE** (exposes id, ticket, category, status, urgency, block, village, district, ac, gp_code, created_at, resolved_at — NO name/phone/description), and
- `n` = complaint_nlp signal (anger/emotion/root_cause), joined on `n.complaint_id = c.id`.

Guards (layered): `validateInnerSql` rejects anything not starting with SELECT, any `;`/comments, DML/DDL keywords (insert/update/delete/drop/alter/create/grant/copy/into/set/…), `pg_`/`information_schema`, and any FROM/JOIN target that isn't `c`/`n`; then the inner is wrapped `WITH c…, n… SELECT * FROM (<inner>) _q LIMIT 200` and run via `db.$queryRawUnsafe`. Worst case = an in-scope, non-PII aggregate — never cross-jurisdiction, never citizen PII, never a mutation. Registered as a READ tool (also usable by the Live tool-proxy), positioned as a FALLBACK after the structured tools. Verified the scoped-CTE+join+wrap pattern runs on the real DB before shipping.

#### ⚠️ Next AI — Please Note
- `complaints` columns are mixed-case: snake (block, category, status, urgency, district, gp_code, assembly_constituency, …) but camelCase quoted (`"ticketNo"`, `"createdAt"`, `"resolvedAt"`); there is NO `rating` column. The CTE aliases the camel ones to snake so generated SQL stays simple.
- Raw arbitrary text-to-SQL was deliberately avoided; this is the guarded version. Keep the PII-free + pre-scoped `c` CTE as the core guarantee if extending.

---

### SESSION 54 — Claude Code (June 22, 2026): Saathi — cross-tab analytics + 2 new write-actions

#### ✅ What was added
- **`query_complaints` cross-tab** — optional `subGroupBy` for 2-dimension breakdowns (block × category, month × category, category × status, …). Pure server-side, scope always enforced. Widens "ask anything (data)" coverage without raw LLM SQL (deliberately NOT building raw text-to-SQL — a bad query = cross-jurisdiction/PII leak; if needed later, do it as a guarded read-only + table-whitelist + forced-scope task).
- **Write-actions `add_note` + `reopen_complaint`** — both single-complaint, propose→confirm→existing audited route. `add_note` → POST `/api/complaints/[id]/comments` `{content}` (activity-logged, no external trigger). `reopen_complaint` → PATCH `/api/complaints/[id]/reopen` (only RESOLVED/REJECTED → OPEN, fires the legit single citizen-reopened notification). Both gated on `canMutateComplaints`. NO bulk writes (trigger-storm risk from the demo-seed incident). Wired in `shared.ts` (WRITE_TOOL_NAMES), `tools.ts` (schemas), `agent.ts` (kinds: note/reopen), `CommandAssistant.tsx` (confirm-card → route).

---

### SESSION 53 — Claude Code (June 22, 2026): Saathi — general analytics tool + eval harness

#### ✅ What was built (coverage for the long tail of questions)
- **`query_complaints`** tool (`src/lib/assistant/tools.ts`) — one flexible, scope-locked analytics primitive: `count|active|critical|resolved` grouped by `category|block|village|status|urgency|assembly_constituency|district|month|none`, optional `status/urgency/category/area` filters + `timeRange` (last7/30/90/all). Collapses hundreds of "X by Y / trend / this-month / compare" questions into one tool. Area filter is numeral-safe (Manbazar 1 = Manbazar I).
- **Eval harness** — `src/lib/assistant/eval-set.ts` (23 realistic questions tagged with expected tool / required text / expected navigation), `GET /api/assistant/eval?from&count` (admin/senior-gated; runs the slice through the REAL agent with the caller's JWT and scores tool-match + text + navigation, paged for maxDuration), and `scripts/eval-assistant.mjs` (CLI: signs an ADMIN token from `JWT_SECRET` env and paginates the endpoint, prints a scored table + pass-rate).

#### ⚠️ Next AI — Please Note
- Run the eval logged-in as ADMIN (browser console: `fetch('/api/assistant/eval?from=0&count=6',{headers:{Authorization:'Bearer '+localStorage.wb_token}}).then(r=>r.json()).then(d=>console.table(d.data.results))`) — repeat with from=6,12,18. Or CLI with the Vercel `JWT_SECRET`. Treat <90% pass as tool-description/prompt work, not a rebuild.
- `JWT_SECRET` is NOT in local `.env` (Vercel-only), so the CLI needs it passed explicitly.

---

### SESSION 52 — Claude Code (June 22, 2026): Saathi Phase 2 — Gemini Live (realtime voice), opt-in

#### ✅ What was built (dep: `@google/genai@^2`)
Realtime, continuous voice on top of the SAME tool/RBAC backend. Opt-in **⚡ toggle** in the assistant; Web Speech (Phase 1) stays as the default/fallback.
- **`src/lib/assistant/shared.ts`** (new, client-safe) — `NAV_DESTINATIONS` + `WRITE_TOOL_NAMES` moved here so the browser Live code never imports server-only `tools.ts` (which pulls db/prisma). `tools.ts` re-exports them.
- **`src/app/api/assistant/live-token/route.ts`** (new) — mints a **short-lived ephemeral token** (server-side, `ai.authTokens.create`, 25-min / connect-within-2-min) so `GEMINI_API_KEY` never reaches the browser. Returns token + model (`GEMINI_LIVE_MODEL`, default `gemini-2.0-flash-live-001`) + system instruction + role-filtered Gemini function declarations (`getGeminiToolDeclarations` converts the OpenAI schemas → Gemini Schema).
- **`src/app/api/assistant/tool/route.ts`** (new) — executes ONE **read** tool for a Live session with the caller's JWT (scope-locked); navigate/write are client-side. RBAC holds even though audio is browser↔Gemini direct.
- **`public/pcm-capture-worklet.js`** + **`src/lib/assistant/live.ts`** (new) — `LiveSession`: ephemeral connect, mic→PCM16 16kHz via AudioWorklet → `sendRealtimeInput`, plays 24kHz audio out (gapless scheduler + barge-in on `interrupted`), routes `toolCall`s (read→`/api/assistant/tool`, navigate→`goTo`, write→confirm card), streams input/output transcripts.
- **`src/components/CommandAssistant.tsx`** — ⚡ Live toggle (dynamic-imports `live.ts` so the SDK stays out of the default bundle), live transcript banner, turn-complete → push to history.

#### ⚠️ Next AI — Please Note
- Two things most likely to need a tweak after live testing: the **model id** (`GEMINI_LIVE_MODEL` env — try `gemini-2.5-flash-native-audio-preview-09-2025` for better Bengali) and ephemeral-token API shape (SDK `@google/genai@2.9`). Live needs a real browser + mic + Chrome/Edge; verify mic permission + autoplay.
- Security unchanged: tools run server-side with JWT scope; ephemeral token is single-use + short-lived; writes still propose→confirm→audited route.

---

### SESSION 51 — Claude Code (June 22, 2026): "Saathi" — central role-aware voice assistant (Jarvis), Phase 1

#### ✅ What was built (plan-mode → approved → built)
A global, always-available voice/command assistant that hears a question/command (Hindi/Bengali/English), calls **tools** to fetch data or act, **answers aloud**, and **navigates** pages — strictly limited to the logged-in user's **RBAC scope**.
- **`src/lib/assistant/tools.ts`** (new) — OpenAI-format tool schemas + server-side executors. Read tools (`get_overview`, `search_complaints`, `get_complaint`, `top_hotspots`, `get_forecast`, `get_nlp_insights`, `get_priority_areas`, `get_network`, `get_pending_actions`, `get_leaderboard`, `list_team`) run with the caller's JWT and reuse the SAME scope-locked logic (`getComplaintScopeFilter`, `computeIntelligenceBrief`, self-fetch of existing intelligence/* routes) — so the model **cannot** see out-of-scope data. PII (citizen name/phone) is never sent to the LLM. `navigate` + write tools are role-gated (writes only if `canMutateComplaints`).
- **`src/lib/assistant/agent.ts`** (new) — DeepSeek function-calling loop (max 5 iters). Executes reads server-side; captures `navigate` directive + write `proposedActions` (writes never auto-run).
- **`src/app/api/assistant/route.ts`** (new) — POST, verifyToken, runs the agent with `{payload, token, origin}`.
- **`src/lib/nav-context.tsx`** (new) + `page.tsx`/`CommandCenter.tsx` wiring — `goTo(view, room?)` lifted so the assistant can open any role-allowed view AND any CommandCenter room (via `pendingRoom`).
- **`src/components/CommandAssistant.tsx`** (new) — floating mic on every authenticated screen. Multi-turn, **Web Speech STT+TTS** (hi-IN/bn-IN/en-IN), speaks answers, runs navigation, renders write actions as **confirm cards** that call the existing **audited** PATCH routes (correct activity-log + notifications; no trigger bypass).

#### ⚠️ Next AI — Please Note
- Voice v1 = browser Web Speech API (free, Chrome/Edge). **Phase 2 = Gemini Live** realtime (continuous, barge-in) — same `/api/assistant` tool backend; user prefers Gemini for Bengali/Indian languages (GEMINI_API_KEY already set).
- Brain = DeepSeek (function-calling). Security model: tools execute server-side with the JWT; scope filter applied to every read. Writes are propose→confirm→audited-route only.

---

### SESSION 50 — Claude Code (June 22, 2026): Brain + Entity 360 — data diversified + full UX redesign (workflow-designed)

#### Problem
Founder: "Brain aur Entity 360 boring, samajh nahi aata, basic lagta hai." Two root causes found: (1) all 537 DEMO complaints were a single category (WATER) with one identical description → monotone clusters; (2) only 21/537 had NLP enrichment → Brain was nearly empty; (3) both pages were dense 9-10px monochrome text with no headline/visual/action.

#### ✅ Data fix (Supabase, trigger-safe)
- Verified `trg_js12_email` fires on UPDATE OF category too, but its function self-guards on `email_sent_at IS NULL`; all demo rows have it set → **no emails/WhatsApp sent** (confirmed 0 unguarded).
- **Diversified** demo complaints into 10 realistic categories (Water 159 · Road 93 · Electricity 53 · Health 48 · Ration 43 · Education 43 · Pension 40 · Sanitation 25 · Housing 20 · Land 13) with matching Bengali descriptions (hash-bucketed, deterministic).
- **Backfilled `complaint_nlp`** for all 537 (root_cause/root_cause_key/anger/emotion/entities/severity_flags from a per-category 3-variant catalog) → **30 root-cause clusters**, anger-by-block, entity-watch (handpump/PDS/PMGSY/BDO), emotion-mix all now populated.

#### ✅ UX redesign — `IntelligenceCommandView.tsx` (designed via 3-lens Workflow + synthesis)
- **Brain → "Logon ki Asli Shikayat"**: hero takeaway band (biggest root cause + anger RiskGauge + "Yeh theek karwao" work-order copy), ranked cluster bars (width=count, fill=anger color, "BADA MAUKA", tap→tickets), anger heat-strip (peak notch), 3-bucket entity chip-cloud (ढाँचा/योजना/अफ़सर, count-scaled), mood-meter ribbon, collapsible trust footer. Coverage shown as a 36px ring (not a bar).
- **Entity 360 → "Kahan Dhyan Dein"**: #1-priority hero (grade pill + priority RiskGauge + auto plain-Hindi "kyun" + reason chips + "daura karo" copy), always-visible leaderboard (priority bar + active/anger/scheme micro-stats, tap→detail), priority-component stacked bar (replaces the formula string), 4 stat tiles incl. emerald resolution ring, top-causes mini-bars + scheme chips, external sources reframed as forward roadmap, single trust footer.
- Helpers added: `angerColor/angerGrade/gradeToRisk/gradeBar`, `EMO_COLOR`, `ENTITY_BUCKET` (reuse existing `RiskGauge`/`RISK_COLORS`; no new chart lib). CommandCenter tabs renamed: Brain→"Asli Shikayat", Entity 360→"Kahan Dhyan".

---

### SESSION 49 — Claude Code (June 20, 2026): map TIME-SLIDER (play complaint flow over time)

#### ✅ What was built
- **`src/app/api/map/villages/route.ts`** — response now also returns a compact `series[]` (`{code, ts, crit, active}` per plottable complaint) + `range{min,max}` of timestamps. Aggregate-only, scope-locked as before.
- **`src/components/MapView.tsx`** — **⏱ Timeline** toggle (header, mutually exclusive with 3D). When on, a bottom scrubber appears: **▶ play / ⏸**, a day-step slider over the full ~75-day range, and a live readout (date · complaints · villages). The map shows a **rolling 14-day heat window** — markers recompute per cursor position so you watch hotspots light up and cool down over time ("kab garm hua"). Playback advances 1 day / 220ms and loops. Map fit is **frozen** while scrubbing (no jump). Density legend hides while the bar is up.

---

### SESSION 48 — Claude Code (June 20, 2026): map village SEARCH (local, no external geocoder)

#### ✅ What was built
- **`src/components/MapView.tsx`** — header **"🔍 Search any village…"** box with live autocomplete over **all ~2,689 Purulia villages**, built entirely from our own data (`purulia-villages.geojson` centroids + `purulia-gp.json` authoritative names/GP) — **no Bhuvan/ISRO/Mappls geocoder**. Selecting a result: switches to 2D, **flies the map** to the village (zoom 14) and drops a glowing locator **reticle**, and loads that village's complaint stats in the AI panel (shows 0 if none). Result rows show complaint count + GP. Verified the supplied Bhuvan token is geocoding-only + daily-expiry → not used.

---

### SESSION 47 — Claude Code (June 20, 2026): 3D map (MapLibre GL) + 2D⟷3D toggle; Leaflet attribution rebranded

#### ✅ What was built
- **`src/components/Map3D.tsx`** (new) — GPU vector 3D view via **MapLibre GL** (dep `maplibre-gl@^4`). Free **CARTO dark vector** style, pitched (58°) view, NavigationControl. Village polygons (`purulia-villages.geojson`) **extruded by complaint count** into glowing fill-extrusion "data columns" (red=critical / amber=active / cyan), flat faint footprint for the rest. Drag-to-rotate. Same scoped data as the 2D map (joined by `vil_lgd`).
- **`src/components/MapView.tsx`** — **2D ⟷ 3D toggle** in the header (swaps Leaflet `InnerMap` ↔ MapLibre `Map3D`, lazy/ssr:false). Also replaced the default **"Leaflet" attribution prefix → "JanSunwai WB"** (kept tile credits for ToS).

#### ⚠️ Next AI — Please Note
- 3D basemap uses the free CARTO dark style (boundary-neutral). For India-official boundaries, swap in **Mappls (MapmyIndia)** or **Bhuvan** vector style once an API key is available. Extrusion height scale = `cnt * 1800` (tune for drama). deck.gl was NOT added — pure MapLibre fill-extrusion keeps deps minimal.

---

### SESSION 46 — Claude Code (June 20, 2026): DEMO data seed (537 complaints) + ⚠️ trigger-side-effect INCIDENT & remediation

#### ✅ What was done
- Seeded **537 DEMO complaints** across 210 real Purulia villages (lat/lng + AC/GP all set, 75-day date spread, realistic category/status/urgency incl. 33 CRITICAL). All flagged **`source='DEMO'` + ticketNo `WB-DEMO-xxxxxxxx`** + clearly-fake phones `90000xxxxx`. Realistic Bengali/Hindi/English complaint text generated by a 10-agent Workflow. → Command Map + Overview now look alive. **Purge:** `delete from complaints where source='DEMO';`

#### ⚠️ INCIDENT (important — do not repeat)
- The **first** seed batch was inserted with `n8nProcessed=false` / `email_sent_at=null`, which FIRED the live `complaints` triggers via **pg_net**: `trg_js02_triage` (→ js-triage webhook) and `trg_js12_email_dispatch` (→ js-bdo-email webhook). JS-12 ran ~536× and, on success (~hundreds), **sent real emails to BDO/PHED addresses (incl. `ee.phed.purulia@wb.gov.in`) AND WhatsApp messages to the random fake phone numbers**. JS-02 triage also overwrote the inserted urgency (→ all MEDIUM).
- **Remediation:** marked the batch processed/emailed to stop re-fire → **deleted it** → **re-seeded safely** with **`n8nProcessed=true` + `email_sent_at=now()`** (which make `trg_js02_triage` and `trg_js12_email_dispatch` no-op) + fake `90000xxxxx` phones + re-randomised urgency. Verified: pg_net queue empty, **no new JS-12/JS-02 executions fired**. Already-sent messages cannot be recalled.

#### 🛑 Next AI — RULE
- **Any bulk INSERT into `complaints` MUST set `n8nProcessed=true` AND `email_sent_at=now()`** (and avoid `status='REGISTERED'`) to bypass the live n8n triage/email/WhatsApp triggers (pg_net fires real notifications per row otherwise).

---

### SESSION 45 — Claude Code (June 20, 2026): Map category filter + critical pulse; Overview count-up + Open-Map (styling + features)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8), autonomous round. QA first (agent-browser N/A here → tsc + Vercel deploy status; build green, tree clean, stable) → added features + styling.

#### ✅ What changed
- **`src/app/api/map/villages/route.ts`** — points now include per-village **`cats`** (category→count); `data` map too.
- **`src/components/MapView.tsx`** — **Category filter** chips in the header (All + top 5 categories) → filters glow points + hotspots to the selected issue type (cyan). **Critical pulse**: pulsing red ring (CSS `@keyframes`) on critical-hotspot villages. `metricFor` + hotspots are category-aware; fit-bounds respects the filter.
- **`src/components/OverviewDashboard.tsx`** — KPI **count-up animation** (requestAnimationFrame, no dep), **card hover-lift**, and an **"Open Command Map →"** button (`onOpenMap` prop).
- **`src/app/page.tsx`** — passes `onOpenMap={() => setView('map')}` to `OverviewDashboard`.
- **`KIROLOG.md`** (new) — 3-section phase-handover doc (status / completed / risks-next).

#### ✔️ Verification
- `tsc --noEmit` clean for all changed files; committed + pushed; Vercel deploy success.

---

### SESSION 44 — Claude Code (June 20, 2026): GEOMETRY AUDIT — full Purulia village-polygon integrity (internal 100% + external corroboration)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8), ultracode. Deterministic node audit over all 2,689 polygons + a multi-agent Workflow (22-village stratified sample) cross-checked against EXTERNAL sources (OSM Nominatim reverse-geocode + web gazetteers).

#### ✅ Findings — the dataset is SOUND (verification only, no data changed)
- **Naming was NOT a bug.** The "Bardaha→Kamtajangidiri" issue was systematic: the SoI shapefile carries TWO names per polygon — `vilnam_soi` (Survey of India) and `vilname11` (Census/LGD). `vil_lgd` ↔ **`vilname11` = 100.0%** (2633/2634); ↔ `vilnam_soi` = 0.2%. The simplified geojson had used `vilnam_soi` for labels → SESSION 43 already fixed it (labels now use DB name by LGD code). e.g. code 332036: SoI "Bardaha", Census/LGD **"Baliguma"** (the correct one).
- **Geometry is correct.** Point-in-block test: **2,688 / 2,689 (100.0%)** village centroids fall inside their claimed CD block; **0 wrong-block**; 1 border village just outside the *simplified* block polygon (simplification artifact). → `vil_lgd` ↔ polygon ↔ block all consistent, so the SESSION 37 lat/lng backfill is **valid (no corruption)**.
- **External corroboration (Workflow, 22-village sample, 1/block + Baliguma + Bardaha):** **22/22 "consistent", 0 suspect, 0 contradiction.** Nominatim confirmed district=Purulia + state=WB + correct CD block for all 22; village name externally attested for 14/22 (8 exact, 6 close), 8 `unverifiable` (rural villages absent from OSM — expected, NOT a contradiction). Bardaha (331926) reverse-geocoded to Barabazar town pincode 723127 (matches), Baliguma (332036) to Manbazar-I — both confirmed distinct & correctly placed.

#### ⚠️ Next AI — Please Note (optional hardening)
- For positive proof of the 8 externally-`unverifiable` names, cross-walk all 2,689 `vil_lgd` codes against the official **LGD master / Census 2011 PCA** directory (stronger than OSM for rural India). Always key lookups on **LGD code, never bare name** (duplicate names exist: "Rangamati", "Dhabani"). The 1 out-of-block centroid is a boundary/simplification artifact, not a data error.

---

### SESSION 43 — Claude Code (June 20, 2026): Command Map — village NAME now from authoritative DB (shapefile name↔code mismatch)

#### 🐛 Bug (user: "Bardaha ka panchayat Kamtajangidiri kyun dikh raha hai?")
- A village polygon whose shapefile name (`vilnam_soi`) was "Bardaha" carried the **wrong LGD code** `vil_lgd=332036`, which is actually **Baliguma** (Manbazar-I, GP Kamtajangidiri). So the label showed the shapefile NAME ("Bardaha") but the GP looked up BY CODE → "Kamtajangidiri" → inconsistent. Root cause: the open SoI village shapefile has some features where `vilnam_soi` and `vil_lgd` don't agree.

#### ✅ Fix
- **`public/purulia-gp.json`** regenerated as `{village_code: [gp_name, assembly, village_name]}` (added authoritative DB name) for all 2,711 villages.
- **`src/components/MapView.tsx`** — village labels + polygon tooltips now take the **NAME from our DB keyed by LGD code** (same source as GP/AC), not the shapefile `vilnam_soi`. So name + GP + AC are always internally consistent. (e.g. code 332036 now labels "Baliguma · GP Kamtajangidiri" — consistent — instead of "Bardaha · Kamtajangidiri".)

#### ⚠️ Next AI — Please Note
- Deeper data-quality note: because a few shapefile polygons carry a mismatched `vil_lgd`, the exact polygon OUTLINE/centroid for that small set of villages may be geographically imperfect (this is why some `lgd_villages.lat/lng` from the SESSION 37 centroid backfill could be slightly off for mis-coded features). This does NOT affect complaint→GP/AC routing (that derives from registration by village name, not the shapefile). A full geometry audit vs an authoritative village-point source is a future task.

---

### SESSION 42 — Claude Code (June 20, 2026): Command Map — level-of-detail (block default, villages on zoom-in)

#### 🐛 Fix (user: "har village line mat dikhao, block hi dikha; zoom karne par village name dikhao")
- The map drew all 2,689 village outlines + labels at every zoom = cluttered (stray labels confused the user).

#### ✅ What changed (`src/components/MapView.tsx`)
- **Zoom-aware LOD.** Default / zoomed-out: only the **20 CD-block boundaries** (cyan) + **block-name labels** — clean. **Zoom ≥ 12:** the village layer (GP-coloured outlines + village-name labels, GP names at ≥13) appears for the area in view; block labels hide. A `ZoomWatcher` tracks the live zoom. Block outlines stay thin for context at all zooms.
- Uses the existing `public/purulia-blocks.geojson` (20 blocks) for the overview layer.

---

### SESSION 41 — Claude Code (June 20, 2026): Command Map — village-name labels + GP mapping on zoom-in

#### 🐛 Fix (user report: "zoom-in pe gram panchayat mapping + village name nahi dikh raha")
- The rebuilt dark map only showed faint village polygons + hover tooltips — no permanent village names, no GP grouping.

#### ✅ What changed
- **`public/purulia-gp.json`** (new, ~89 KB) — `{village_code: [gp_name, assembly]}` for all 2,711 Purulia villages, pulled from the **authoritative DB** (`lgd_villages` + `lgd_gram_panchayats`), NOT the noisy shapefile gp_name.
- **`src/components/MapView.tsx`** — (1) village polygon outlines now **coloured by Gram Panchayat** (deterministic hue per GP → GP clusters become visible); (2) **village-name labels** appear at zoom ≥ 12, **viewport-limited + capped at 130** so 2,689 labels never all render; at zoom ≥ 13 the **GP name** shows under each village; (3) hover tooltip now reads `Village · GP: X · Block · AC`. Labels follow the ⬡ Villages toggle.

#### ⚠️ Next AI — Please Note
- GP grouping is colour-by-GP on the village polygons (we have no dissolved GP-boundary polygons; a true GP outline would need a union/dissolve of village polygons by gp — future). Labels are client-rendered divIcons; capped for perf.

---

### SESSION 40 — Claude Code (June 19, 2026): Overview Dashboard — dark "Command Center" home (image-2 concept)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Built the founder-approved image-2 Overview as the `overview` room.

#### ✅ What was built
- **`src/components/OverviewDashboard.tsx`** (new) — dark Command Center home, matching the Command Map aesthetic. **4 KPI cards** (Active, Critical, Resolution %, SLA breaches) each with a **mini SVG sparkline** + sub-stat; **Top {Districts/Blocks} by complaints** ranked bars; **AI Insight** card (computed summary + top problem-category bars + scope footer); **two charts** — Complaints over time (SVG area/line) and Complaints by category (SVG bars); **Critical alerts** list. All **dependency-free** (hand-drawn SVG charts), scope-locked.
- **Data:** reuses the existing **`/api/dashboard`** (stats, byCategory, byGroup, monthlyTrend, criticalComplaints) — role-scoped via `getComplaintScopeFilter`.
- **`src/components/CommandCenter.tsx`** — `overview` room now renders `<OverviewDashboard/>` (was `IntelligenceCommandView`).
- **`src/app/page.tsx` + `src/lib/types.ts`** — surfaced as a **top-level "Overview" nav item** (new `view: 'overview'`, icon Gauge) in EVERY role's sidebar, right beside Intel Command. (Fix: it was only reachable buried inside Intel Command → "नहीं दिख रहा"; now it's a first-class sidebar entry.)

#### ⚠️ Next AI — Please Note
- Like the map, looks rich only with volume — current ~30 (mostly test) complaints → sparse KPIs/charts; the **demo-data seed** (still offered, not applied) fills it. `byGroup` is district for ADMIN/STATE, block for others (so MLA sees blocks, admin sees districts) — labels adapt. No "avg resolution time" KPI yet (not computed in /api/dashboard); used SLA breaches instead.

---

### SESSION 39 — Claude Code (June 19, 2026): Command Map REBUILT from scratch — dark glowing intelligence map + AI Insight panel

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Full rewrite of the Map room to the "command center" aesthetic the founder approved (dark, glowing village hotspots, AI insight side-panel — modeled on the image-3 concept).

#### ✅ What changed
- **`src/components/MapView.tsx`** — REWRITTEN. Dark **CARTO dark_all** basemap (free, no key) + **glowing village hotspots** (soft halo + bright core CircleMarkers, color/size by metric) instead of the old big-red-blob block circles. Right-side **AI Insight panel**: active total + 7-day Δ%, computed AI summary, **Top hotspots** (clickable), **top issue categories** bars, density legend. Modes: **Density / Active / SLA-breach / Resolved**. Basemap toggle (Dark / Satellite-for-before-after). Faint village-boundary overlay (canvas). Auto-**fits to the caller's data** (no more opening on Nepal). Still role-adaptive + scope-locked.
- **`src/app/api/map/villages/route.ts`** — extended: now returns `points[]` (village lat/lng + total/active/critical/resolved/**slaBreached**), `categories[]`, and `trend{last7,prior7,pct}` — all scope-locked, aggregate-only.

#### 🎯 Side-benefit (fixes the earlier "map confusing" complaint)
- Everything keys off **resolved Purulia `village_code`** → out-of-district **test/junk complaints (Siliguri, "Test Block", etc.) no longer plot** and no longer skew the center/ranking. The map is clean by construction.

#### ⚠️ Next AI — Please Note
- Plots only where we have village coords (**Purulia / district 321**). Whole-WB admin view needs other districts' village lat/lng (future). With current ~30 (mostly test) complaints the map looks SPARSE — a **demo dataset seed** (offered, not yet applied) will make it look dense like the concept. True smooth heat / 3D would need a MapLibre + deck.gl upgrade (deferred per founder: no 3D for now).

---

### SESSION 38 — Claude Code (June 18, 2026): VILLAGE-LEVEL map layer (2,689 polygons, gaon-by-gaon choropleth)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Built the village-polygon map on top of the verified geo data (SESSION 36/37).

#### ✅ What was built
- **`public/purulia-villages.geojson`** (new, ~3.6 MB) — 2,689 LGD village boundary polygons simplified for web (coords→4 dp, holes dropped, minimal props `{v: vil_lgd, n: name, b: block}`). Generated from the verified shapefile.
- **`src/app/api/map/villages/route.ts`** (new) — scope-locked (`getComplaintScopeFilter`) VILLAGE-level complaint aggregation. Resolves each complaint's free-text `village` → LGD `village_code` by name (within Purulia/321) and returns `{village_code: {total, active, critical, resolved}}`. Aggregate-only, no PII. Same scope boundary as `/api/map/risk`.
- **`src/components/MapView.tsx`** — added a **🏘 Villages** toggle. Lazy-loads the boundary asset + scoped counts on first toggle, renders the 2,689 polygons via a **canvas renderer** (`preferCanvas`). Villages with complaints light up (red=critical / amber=active / green=all-resolved); others faint. Tooltip = village + block + complaint count. Joined by `v`=`vil_lgd`=`village_code`. When villages are on, the block choropleth drops to outline-only so villages show through.

#### ⚠️ Next AI — Please Note
- Complaint data is currently sparse (~tens, mostly test), so most villages render faint — the layer is the gaon-by-gaon FOUNDATION that lights up as real complaint volume grows. The village→code join is by name (collisions rare; picks first). 89 villages still lack lat/lng (unmatched in shapefile). For multi-district expansion, gate the village asset/endpoint by district.

---

### SESSION 37 — Claude Code (June 18, 2026): lat/lng BACKFILL into lgd_villages from village polygons

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Used the verified village-polygon shapefile (`purulia_village_shapefiles.tar.gz`, see SESSION 36) to fill the one remaining geo gap: village coordinates.

#### ✅ What changed (Supabase — `lgd_villages`)
- Computed the **area-weighted centroid** of each village polygon (Polygon/MultiPolygon, WGS84) in Node, joined `shapefile.vil_lgd` → `lgd_villages.village_code`, and wrote `lat`/`lng` (5-decimal ≈ 1 m).
- **Result: 2,622 / 2,711 Purulia villages now have lat/lng** (was 0). All within Purulia bbox (lat 22.72–23.69, lng 85.83–86.90; out-of-range = 0). Centroids sanity-checked (e.g. Kashipur villages ~23.37, 86.7).
- **89 villages still NULL** — their `village_code` had no matching `vil_lgd` in the shapefile (or the shapefile feature had null `vil_lgd`). Fallback: fuzzy name-match or leave null.
- Only `lat`/`lng` were touched. The noisy `ac_no`/`gp_name` shapefile attributes were NOT imported (DB hierarchy stays authoritative — see SESSION 36).

#### ⚠️ Next AI — Please Note
- Village-level map dots are now possible (`lgd_villages.lat/lng`). Next geo step: village-level choropleth using the polygon boundaries (geojson kept in `Downloads/_shp_inspect/`), keyed by `vil_lgd`=`village_code`.

---

### SESSION 36 — Claude Code (June 18, 2026): VERIFICATION — GP→AC mapping vs ECI Delimitation 2008 (100% correct) + village-polygon source assessed

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8), ultracode. Multi-agent workflow: 9 agents fetched each Purulia AC's OFFICIAL extent (ECI Delimitation of Parliamentary & Assembly Constituencies Order, 2008 — via Wikipedia mirrors + official purulia.gov.in/assembly-constituency). Then the DB's full GP-level claim (170 GP rows from `lgd_villages`) was diffed against that authoritative truth. (Workflow hit a session limit mid-run; the 9 AC extents completed, and the remaining GP→AC diff was finished manually against those extents.)

#### ✅ RESULT: `lgd_villages` GP→AC→LS mapping is 100% CORRECT (170/170 GPs)
- Verified against the official 2008 Delimitation Order. Every Gram Panchayat's assembly_constituency matches. This includes the hard cases:
  - **3 SPLIT blocks exactly right:** Arsha 3-way (Arsha/Beldih/Mankiary→Joypur; Chatuhansa/Hensla/Puara→Balarampur; Hetgugui/Sirkabad→Baghmundi), Hura 2-way (Chatumadar/Daldali/Maguria-Lalpur→Manbazar; other 7 GPs→Kashipur), Purulia-I 2-way (Bhandarpuara-Chipida/Manara→Purulia; other 6→Balarampur).
  - **Non-obvious whole blocks right:** Raghunathpur-II block→**Para** AC (not Raghunathpur); Puncha→Manbazar; Neturia/Santuri/Raghunathpur-I→Raghunathpur→**Bankura** LS; Manbazar-II→Bandwan→**Jhargram** LS.
- AC numbers (official): 238 Bandwan(ST), 239 Balarampur, 240 Baghmundi, 241 Joypur, 242 Purulia, 243 Manbazar(ST), 244 Kashipur, 245 Para(SC), 246 Raghunathpur(SC). **The electoral hierarchy in our DB is authoritative-grade; register_complaint can be trusted for AC/LS derivation.**

#### 📦 External asset assessed: `C:\Users\mahat\Downloads\purulia_village_shapefiles.tar.gz` (NOT in repo)
- **REAL & useful for GEOMETRY:** 2,689 Purulia village POLYGONS, CRS WGS84, UTF-8, bbox lng 85.82–86.91 / lat 22.70–23.70 (= Purulia). Attributes incl. `vil_lgd` (LGD village code), `gp_code/gp_name`, `block_lgd/block_name`, `dist_lgd`=321, `ac_no`, `vilcode11/vilname11` (Census 2011), `vilnam_soi` (Survey of India).
- **JOINABLE to our DB:** `vil_lgd` == `lgd_villages.village_code`. 60/60 random sample matched; 2,626 distinct codes cover ~97% of our 2,711 villages. → gives **village centroids = the missing lat/lng**, plus boundary polygons for a village-level map.
- **⚠️ DO NOT import its `ac_no`/`gp_name`** — both are NOISY: `ac_no` has out-of-district/zero values (0, 247, 248, 249) and contamination inside otherwise-single-AC blocks (spatial-join edge artifacts); `gp_name` is scrambled in places (GPs from other blocks appear under a block). Our delimitation-verified DB hierarchy is cleaner. Use the file ONLY for geometry (lat/lng + polygons), keyed by `vil_lgd`.

#### ⚠️ Next AI — Please Note
- lat/lng backfill is now UNBLOCKED: compute polygon centroid per feature, join shapefile.vil_lgd → lgd_villages.village_code, write lat/lng. ~85 DB villages (+51 null-vil_lgd shapefile features) won't match by code — fall back to name match or leave null.

---

### SESSION 35 — Claude Code (June 16, 2026): ROOT-CAUSE geo fix — corrected `lgd_villages` + village-level backfill [Phase 1b]

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8), ultracode. 10-agent workflow fetched all 9 Purulia AC compositions from Wikipedia (Delimitation Commission orders) → an internally-consistent authoritative truth-map → reconciled the DB.

#### 🧠 Root cause (found)
- `register_complaint()` derives AC/LS/GP from the **`lgd_villages`** table (via `lookup_village_coords`). That table already holds the full **Village→GP→Block→AC→LS** hierarchy (+ lat/lng, mostly null). Baliguma was wrong because **`lgd_villages` itself had all 244 Manbazar I villages tagged AC=Bandwan/LS=Jhargram** (should be Manbazar/Purulia) — and registration faithfully copied it. So new complaints kept recurring wrong.
- Both geo tables had DIFFERENT errors: `lgd_villages` (Manbazar-I wrong) AND `constituency_block_mapping` (Jhalda I → Joypur, should be Baghmundi). `lgd_villages` is the better source — it correctly SPLITS blocks across ACs (Hura, Arsha, Purulia I), which the block→AC table cannot.

#### ✅ Authoritative truth-map (Wikipedia / Delimitation) — 20 Purulia CD blocks
- **17 single-AC blocks** (safe block→AC) + **3 SPLIT blocks** needing GP-level: **Hura** = Manbazar (Chatumadar, Daldali, Manguria Lalpur GPs) + Kashipur (7 GPs); **Arsha** = Balarampur/Baghmundi/Joypur; **Purulia I** = Balarampur (6 GPs) + Purulia (2 GPs). AC→LS: Bandwan→Jhargram, Raghunathpur→Bankura, the other 7 → Purulia.

#### ✅ Fixes applied (Supabase)
- `lgd_villages`: Manbazar-I 244 villages → **Manbazar/Purulia**; Barabazar null-AC → Bandwan/Jhargram. (Root cause fixed AT SOURCE → new complaints now derive correctly, no code change.)
- `constituency_block_mapping`: Jhalda I → **Baghmundi** (+ MLA Rahidas Mahato).
- `complaints`: re-backfilled AC/LS **+ gp_name/gp_code** from corrected `lgd_villages` by (village+block). Village-level → SPLIT blocks now correct (Hura complaints → Kashipur/Manbazar by their actual GP). Baliguma = Manbazar/Purulia/Kamtajangidiri. 24 complaints got GP (was null).

#### ✔️ Verification
- Baliguma + all Manbazar-I → Manbazar/Purulia; Hura villages → village-specific Kashipur/Manbazar; 14 remaining (null) are TEST complaints from non-Purulia districts.

#### ✔️ Coverage verification (full Purulia, all 20 blocks)
- **CONFIRMED COMPLETE: all 20 Purulia CD blocks = 2,711 villages in `lgd_villages`, every one with AC + LS + GP set + correct.** An earlier coverage query falsely reported "3 blocks missing (0 villages)" — that was a NAME-VARIANT artifact, NOT a data gap. `lgd_blocks`/`lgd_villages` store the LGD-official spellings **Bagmundi / Bundwan / Jaipur** (block_codes 3045/3048/3050 = 141/135/113 villages), whereas `constituency_block_mapping`, the public geojson, and Wikipedia use canonical **Baghmundi / Bandwan / Joypur**. The 389 villages were always present and correctly tagged (Baghmundi→Purulia, Bandwan→Jhargram, Joypur→Purulia).
- **Spelling variant is BENIGN for live paths**: AC is derived per-VILLAGE (`lookup_village_coords` → `lgd_villages.village_name`), so block spelling is irrelevant to registration; the map matches `complaint.block` ↔ geojson `block` (canonical, LGD spelling preserved in feature `src`). The variant only bit ad-hoc name-joins against `constituency_block_mapping`. No complaint is mis/un-tagged because of it.
- Verified: zero null-AC complaints belong to the 3 variant blocks; a village-name-ONLY backfill produces FALSE positives across districts (e.g. "Gopalnagar"/N-24-Pgs coincidentally matches a Manbazar village) — do NOT backfill on village name alone, always gate by district/block.

#### ⚠️ Next AI — Please Note
- **Only real remaining geo gap:** `lgd_villages.lat/lng` are NULL for all 2,711 → village-level map dots need geocoding (Phase 2; india-geodata census-village polygons give centroids).
- `constituency_block_mapping` oversimplifies the 3 split blocks (Hura→Manbazar etc.) — low impact now that complaints use village-level AC; regenerate from `lgd_villages` (majority AC) if a block-level table is still needed.
- Junk: ~13 null-AC complaints are test data from OTHER districts + 1 literal "Test Village" → delete-candidates. 1 real Purulia complaint (WB-26-PUR-001004 "Keshyatard", Hura) has a village name not in LGD → AC null.

---

### SESSION 34 — Claude Code (June 16, 2026): DATA FIX — complaint assembly/Lok-Sabha backfill (geo mis-tagging) [Phase 1a]

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Supabase DATA change (not code). Triggered by user spotting Baliguma village data was wrong.

#### 🔴 Bug found
- Baliguma (block Manbazar I) complaints were tagged `assembly_constituency='Bandwan'`, `parliamentary_constituency='Jhargram'` — WRONG. Authoritative `constituency_block_mapping` (+ Wikipedia) say **Manbazar I → Manbazar AC → Purulia LS**. Effect: the Purulia MP (scope `parliamentary_constituency='Purulia'`) and Manbazar MLA never saw them; the wrong (Bandwan) MLA did. Systemic: ~36 Purulia complaints had wrong/null AC+LS.

#### ✅ Fix applied (Supabase UPDATE)
- Backfilled `assembly_constituency` + `parliamentary_constituency` from `constituency_block_mapping` for ALL Purulia-block complaints **except Hura** (verified-correct: Manbazar I & Puncha → Manbazar/Purulia; Manbazar II → Bandwan/Jhargram; Purulia I/II → Purulia; Arsha → Balarampur/Purulia). Baliguma's 8 now correctly Manbazar/Purulia.
- **Hura = SPLIT block** (Wikipedia: only 3 of Hura's GPs — Chatumadar, Daldali, Manguria Lalpur — are in Manbazar AC; the rest are in other Purulia-LS ACs). So Hura's AC was NOT force-set (would propagate error); only its `parliamentary_constituency` set to 'Purulia' (safe — all its ACs are Purulia LS). Hura AC needs village/GP-level resolution.

#### 🧭 Verified geo facts (for future work)
- `constituency_block_mapping` AC→Lok-Sabha column is CORRECT (Purulia LS = Balarampur, Baghmundi, Joypur, Purulia, Manbazar, Kashipur, Para; Bandwan→Jhargram; Raghunathpur→Bankura). Block→AC is mostly right but a few blocks genuinely SPLIT across ACs (Hura confirmed) → block→AC is approximate; true AC needs village/booth.
- ~15 complaints are TEST data tagged to non-Purulia blocks (Krishnanagar, Siliguri, Rampurhat, Dinhata, …) — junk, left untouched.

#### ⚠️ Next AI — Please Note (Phase 1b / root cause)
- Root cause NOT yet fixed: NEW complaints still get AC/LS set at registration (the code/n8n that sets them is buggy) — find & correct it, else mis-tagging recurs.
- Pending: gp_name is NULL on most complaints → needs LGD village→GP mapping (Phase 1b master table: Village→GP→Block→AC→LS→District). That table also resolves split-block AC (Hura) at village level.

---

### SESSION 33 — Claude Code (June 16, 2026): Palantir-grade BLOCK CHOROPLETH — real CD-block boundaries, risk-shaded

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8), ultracode. Boundary source found + fetch-verified by a 13-agent workflow (no memory-asserted claims — every candidate was actually downloaded/queried).

#### 🧠 Why
- "Pins amateur lagte hain, shaded polygons professional." The map showed block-CENTROID circle markers (approximate). Now it shades the actual block AREAS — the Palantir look. (Verdict from the boundary-source hunt: datameet/GADM/gov portals were dead-ends or licence-blocked; the verified winner is below.)

#### ✅ Data — verified free CD-block boundaries
- Source: **`yashveeeeeeer/india-geodata` → `admin/blocks` → `LGD_Blocks.parquet`** (Govt of India LGD, **CC0/OGL** — commercial-safe). Confirmed by querying the real parquet: West Bengal → Purulia = **exactly the 20 portal CD blocks**, real polygons.
- Extracted locally (python + pyarrow + shapely): filtered Purulia, simplified (tol 0.0008°), rounded coords (5dp), name-normalised to portal labels (BAGMUNDI→Baghmundi, BUNDWAN→Bandwan, JAIPUR→Joypur, RAGHUNATH PUR-I→Raghunathpur I, JHALDA-I→Jhalda I) → **`public/purulia-blocks.geojson` (79 KB, 20/20 matched)**. The 66 MB source parquet was processed then deleted (not committed).

#### ✅ Map — `src/components/MapView.tsx`
- Added a react-leaflet **`GeoJSON`** choropleth layer: each block polygon shaded by the current mode (risk / anger / resolution) via `colorFor`, no-data blocks faint grey. Click a polygon → selects that block; hover → tooltip with the metric. Matching uses `normBlock()` (case / hyphen / roman-vs-digit tolerant, e.g. "Manbazar I" == "Manbazar 1"). Works under BOTH street and satellite basemaps. Circle markers kept on top for active+critical load size. Boundary file fetched from `/public` on demand (not bundled).

#### ✔️ Verification
- `npx tsc --noEmit` clean on `MapView.tsx`. GeoJSON validated: 20 features, all Polygon, properties.block = portal labels.

#### ⚠️ Next AI — Please Note
- Phase 2 (other districts): same pipeline — filter the LGD parquet for the district, normalise names, drop a `<district>-blocks.geojson` in `/public`. Phase 3 (GP/village) only if a client needs it (village polygons are NOT cleanly free — the Census-2011 sub-district layer in WB == CD block, so it does NOT go below block). Attribution: LGD / india-geodata (CC0/OGL) — add a small credit if required.

---

### SESSION 32 — Claude Code (June 15, 2026): Hyperlocal PR factory (Level 15, Phase 1) — per-village achievement card

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Frontend-only, reuses existing Wapas-Jao resolved-complaint data. No new API, no backend.

#### ✅ NEW: `src/lib/prCard.ts` + button in the "Wapas Jao" / Field section
- A **Megaphone** button per village → generates a shareable **PNG achievement card** ("[village] — N shikayatein solve ✓") with a category breakdown bar chart + avg rating, branded header + footer. Pure Canvas 2D (no dependency), download / native-share.
- **Privacy/ethics:** AGGREGATE only — counts + category breakdown + rating. **NO individual citizen names** (public broadcast → DPDP/consent), even though the underlying Wapas data has them (that's for the politician's private visit brief, not public PR).
- **Honesty:** wording is "ab tak" (all-time resolved — the Wapas API is `status=RESOLVED`, not month-windowed), never a false "is mahine". Category breakdown computed from the returned items.

#### ✔️ Verification
- `npx tsc --noEmit` clean on `prCard.ts` + `IntelligenceCommandView.tsx`.

#### ⚠️ Next AI — Please Note
- Built as a viral/sales feature: "har gaon ka apna 'humne ye kiya' creative". A full factory (batch-generate all villages + auto-WhatsApp send) would build on this single-card generator + a send path (needs consent/opt-in handling).

---

### SESSION 31 — Claude Code (June 15, 2026): Satellite infra-verification PoC (Level 14, Phase 2) — before/after by year

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Free, no-key, no-backend. Tile sources curl-verified (HTTP 200 image/jpeg) before shipping.

#### ✅ Time-travel satellite — `src/components/MapView.tsx`
- In Satellite mode, a **year selector** (Recent · ’23 · ’20 · ’18). "Recent" = Esri World Imagery (current, high-res). 2018/2020/2023 = **EOX Sentinel-2 cloudless** yearly mosaics (10m, free, no API key: `tiles.maps.eox.at/wmts/.../s2cloudless-{year}_3857/...`). The Esri Reference labels overlay stays on top so place names show on every year.
- **How it verifies:** zoom to an area, flip ’18 → Recent → SEE if a road/pond/check-dam/building appeared. Manual before/after "did the work actually happen" — the foundation of officer-claim verification, with zero cost.
- `key={satYear}` on the TileLayer forces a clean swap when the year changes. EOX capped at maxZoom 16 (10m native) to avoid blurry over-zoom; Esri 19.

#### ✔️ Verification
- All tile endpoints curl-tested (EOX 2018/2020/2023 + Esri → HTTP 200 image/jpeg). `npx tsc --noEmit` clean on `MapView.tsx`.

#### ⚠️ Honest scope / Next
- This is **manual** before/after (human flips years + eyeballs change). 10m Sentinel-2 shows roads/ponds/built-up expansion clearly, but NOT a single small house. True **AUTO** change-detection (algorithmic NDVI / built-up diff that auto-flags "claim vs reality") is the next step — needs a processing pipeline (Sentinel Hub statistical API or raster diff), a bigger project. This PoC proves the value first, for free.

---

### SESSION 30 — Claude Code (June 15, 2026): Satellite map layer (Level 14, Phase 1) — Street ↔ Satellite toggle

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). First slice of the Horizon-3 "Eyes Everywhere" vision (L14). Frontend-only, no API key, no backend.

#### 🧠 Context
- Roadmap reality-check: of the pasted Horizon 2/3 vision, the data-hungry features (L11 digital-twin, L12 grievance-epidemiology/protest-prediction) would produce FAKE numbers on 56 complaints — deferred until data grows (consistent with the Level-8 honest "no cross-village contagion yet" finding). Satellite verification (L14) is buildable now and free → started here. User picked it.

#### ✅ Satellite basemap + toggle — `src/components/MapView.tsx`
- `InnerMap` now takes a `basemap: 'street' | 'satellite'` prop. Satellite uses **Esri World Imagery** (`server.arcgisonline.com/.../World_Imagery`) — **free, no API key** — plus a transparent **Reference (boundaries + places)** overlay so village/block names stay readable on the imagery. Street stays OpenStreetMap.
- Header gets a **🗺 Street / 🛰 Satellite** toggle (same button style as the risk/anger/resolution modes). All existing overlays (risk/anger/resolution circle-markers, popups, legend, ranked sidebar, scope-centering) work unchanged on both basemaps.

#### ✔️ Verification
- `npx tsc --noEmit` clean on `MapView.tsx`. No new dependency, no key, no backend change.

#### ⚠️ Next AI — Please Note (Level 14 Phase 2 — later)
- This is the satellite VIEW (foundation). True "infra verification" ("officer said road built; satellite says no") needs a Sentinel-2 / Sentinel Hub pipeline (before/after imagery by date + change detection) — a separate project with an imagery API + processing. Phase-1 toggle is the base it builds on.

---

### SESSION 29 — Claude Code (June 15, 2026): Telegram brief → tappable ticket deep-link (rich + actionable)

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Verified a real working route existed before adding the link (no broken/guessed deep-links).

#### ✅ Quick-win ticket is now a tappable link
- `formatBriefForTelegram()` (`src/lib/intelligence.ts`): the daily-brief "Today ka quick win" ticket is now an `<a href="…/?ticket=WB-…">` link (was `<code>`). Tapping it opens the app and auto-loads that ticket's tracker.
- `TicketTrackerDialog` (`src/components/TicketTrackerDialog.tsx`): new optional `initialTicket` prop — when the dialog opens with it set, it pre-fills + auto-searches (`handleSearch` refactored to accept an explicit value). Reuses the existing scope-locked `/api/ticket/[ticketNo]`.
- `src/app/page.tsx`: reads `?ticket=WB-…` from the URL on mount (via `window.location.search` — no Suspense needed) → opens the tracker with `initialTicket`; clears `deepLinkTicket` on close so manual opens stay empty.
- Spec-compliant Telegram HTML `<a href>` (verified against core.telegram.org formatting options). No public ticket page exists, so the link targets the dashboard tracker (leader is logged in); a logged-out tap shows the tracker's normal 401/login path.

#### ✔️ Verification
- `npx tsc --noEmit` clean on `intelligence.ts`, `TicketTrackerDialog.tsx`, `page.tsx`.

---

### SESSION 28 — Claude Code (June 15, 2026): Telegram rich-text — daily brief upgraded to premium HTML + full sender audit

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). App-side change + live n8n audit via n8n MCP. No live citizen/LLM workflow was force-changed (safety — see below).

#### 🧠 What "Telegram rich text" actually is
- Telegram = `parse_mode: HTML` with `<b><i><u><s><code><pre><a><tg-spoiler><blockquote><blockquote expandable><tg-emoji>`. No brand-new system; **expandable blockquote** is the newest useful feature.

#### ✅ Daily brief upgraded — `formatBriefForTelegram()` in `src/lib/intelligence.ts`
- Now premium rich text: **bold** KPIs/headers, `<i>` dates, `<code>` ticket no, and warnings in an **`<blockquote expandable>`** (compact message, tap to expand). Dynamic text still escaped via `esc()` (Session-4 rule). "Aaj" → "Today". Flows automatically through JS-21 (its Telegram node already had `parseMode: HTML`).

#### 🔎 Audit of ALL Telegram senders (n8n)
- **JS-21 Daily Intel Brief** (`hPDe3mQWWf9bjWj8`): app-formatted, node `parseMode: HTML` ✅ — now premium rich.
- **JS-04 Status Broadcaster** (`zxhMcvjLPbcuEzGz`): builds `statusMessageHtml` (escapes `&<>`), Telegram node `parseMode: HTML` ✅ — already HTML-safe (renders clean; no bold tags yet — optional cosmetic).
- **JS-17 MP Weekly Brief** (`0TT4yfYrcQ11m5dU`): LLM-generated → **now made rich SAFELY** (user chose "MP only"). Its "Format Message" code node got a sanitizer: escape `&<>` FIRST (so any stray model `<`/unbalanced tag is harmless), then add ONLY balanced `<b>` tags (markdown `**`/`__` → bold, and section-header lines bold). `briefText` stays raw for the DB log. Both "Telegram to MP" + "Telegram to Admin" nodes set `parseMode: HTML` (verified saved). Sanitizer was unit-tested locally against adversarial inputs (stray `<`, `<script>`, unclosed tags, `&`) → always balanced `<b>` + zero stray `<>`; no live MP send was triggered (next run Mon 8 AM IST).
- **JS-01 Sahayak** (`YsUZwu99ckTnzekR`): LLM chatbot replies — **intentionally left plain** (user scoped to MP-only). Same sanitizer pattern would make it safe if wanted later.

#### ✔️ Verification
- `npx tsc --noEmit` clean on `intelligence.ts`. JS-21/JS-04 already `parse_mode: HTML` (verified). JS-17 sanitizer unit-tested (PASS) + parseMode HTML verified on both Telegram nodes via n8n MCP. Note: the n8n validator flags "unmatched expression brackets" on the Code nodes — that is a FALSE POSITIVE (it mis-reads the `}}` of `return [{ json: {…} }]` as a `{{ }}` expression); the JS is valid and the workflow runs.

#### ⚠️ Next AI — Please Note
- To make JS-01 Sahayak rich too: reuse the JS-17 escape-first → balanced-`<b>` sanitizer in its reply-formatting node + set the Telegram node `parseMode: HTML`. Cosmetic bold for JS-04 citizen status is safe via the same escape-then-inject in its "Build Status Message" code node. NEVER set `parse_mode: HTML` on raw LLM output without the sanitizer (Telegram 400 = message never delivered).

---

### SESSION 27 — Claude Code (June 15, 2026): DB-backed white-label branding (true multi-tenant theming) — redesign punch-list CLOSED

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Finishes the last optional redesign item.

#### ✅ NEW: `client_branding` table + `/api/branding` route
- Migration `create_client_branding`: `client_branding(scope_key PK, org_name, leader_name, tagline, accent, accent_soft, updated_by, updated_at)`. **RLS ENABLE + FORCE + service_role-only policy** (anon/authenticated blocked — verified anon sees 0). All access via the route (service_role); same hardening as `complaint_nlp`.
- `src/app/api/branding/route.ts` — **GET** resolves the caller's branding by scope (constituency → lok_sabha → district → block, most-specific wins) with config fallback; **POST** lets a governance leader save branding for THEIR OWN scope (MP→seat, MLA→AC, DISTRICT_ADMIN→district, BLOCK_COORD→block; ADMIN must pass `scopeKey`; KARYAKARTA/GP/OFFICER → 403); **DELETE** resets. JWT-auth, scope-permission enforced server-side.
- `CommandCenter` now fetches `/api/branding` on mount; effective branding precedence = **config ← DB ← local preview**. The in-app editor saves to the DB for the whole scope when authorized (toast confirms), else falls back to a local preview — so each MP/MLA sees their own brand from any browser/device, not just one.

#### ✔️ Verification
- `npx tsc --noEmit` clean on the route + `CommandCenter`. `client_branding` RLS forced; anon read = 0 (verified).

#### 🏁 Redesign — fully DONE
- Phases A–C + all optional polish: rooms split, "Today" home, ⌘K Advisor, shareable Daily Brief (text **and** PNG image), Map room, motion/live-pulse, and **DB-backed multi-tenant white-label branding**. Backend additions are isolated and RLS-hardened; Level 1–10 untouched.

---

### SESSION 26 — Claude Code (June 15, 2026): "Aaj"→"Today" + Map room + image Daily-Brief card + motion polish

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Frontend-only. User: use "Today" not "Aaj"; finish the optional polish items.

#### ✅ Changes
- **Label rename:** all user-facing "Aaj" → "Today" (rail label, Today-home heading, brief text, advisor prompt, operations hint). Internal keys/component names (`AajHome`, room key `aaj`) kept to avoid churn.
- **Map room:** `MapView` (Risk/Anger/Resolution map) now a first-class room in `CommandCenter` (rail item between Overview and Forecast), not just a separate top-level view.
- **Image Daily-Brief card:** `src/lib/briefImage.ts` renders the brief as a shareable **PNG** (pure Canvas 2D, 1080×1350, no new dependency) — branded header, risk score, KPIs, today's priorities, Chief-of-Staff line. `AajHome` now has **Text** (clipboard) + **Image** (download / native-share) buttons. PR-ready for WhatsApp/Instagram.
- **Motion + live-pulse:** Today home content fades/slides in (framer-motion); a small accent "live" dot pulses by the scope label.

#### ✔️ Verification
- `npx tsc --noEmit` clean on `AajHome`, `CommandCenter`, `briefImage.ts`, `AdvisorBar`, `BrandingSettings`, `IntelligenceCommandView`.

---

### SESSION 25 — Claude Code (June 15, 2026): UI redesign Phase C — in-app white-label branding editor

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Frontend-only. Closes the redesign punch-list.

#### ✅ NEW: `src/components/BrandingSettings.tsx` — live branding editor
- Gear in the rail → a modal to set **org/brand name, leader name, accent colour** with a colour picker + live swatch. No code needed. Persisted per-browser via localStorage (`src/lib/branding.ts`: `loadBrandingOverride / saveBrandingOverride / clearBrandingOverride / softFromAccent`), merged over the config branding in `CommandCenter` (SSR-safe: base renders first, override applied after mount). "Reset" clears it. Honest scope: this is a local preview/override; true multi-tenant branding stays the config map (later a `client_branding` table). The accent flows through the whole command center (rail, gauge, hero, ⌘K bar).

#### ✔️ Verification
- `npx tsc --noEmit` clean on touched files. `next.config.ts` has `typescript.ignoreBuildErrors: true`, so the Vercel build is gated by runtime correctness; touched files are type-clean.

#### 🏁 Redesign status
- Phase A (shell + Aaj home + branding), B (rooms split + ⌘K + shareable brief), C (branding editor) — **DONE**. Optional future: a true image Daily-Brief card (html-to-image), Map as its own room, motion/live-pulse polish, and promoting branding to a DB table for server-rendered multi-tenant theming.

---

### SESSION 24 — Claude Code (June 15, 2026): UI redesign Phase B — rooms split + ⌘K Advisor command bar + shareable Daily Brief

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Frontend-only, continues SESSION 23. Goal: "baki sab jo kaam baki he finish karo" — finish the command-center redesign.

#### ✅ Rooms split — `IntelligenceCommandView` now room-gated
- Added a `room?` prop + a `show(key)` helper. The single long scroll is now split into focused rooms: **overview** (risk/KPIs/warnings/trend/category/hotspots/benchmark/sentiment/officers/PR+quick-wins), **forecast** (L6), **entity360** (L7 fusion), **network** (L8), **actions** (L10 ops), **brain** (L4 NLP), **field** (Wapas Jao). Backward-compatible: no `room` / `'all'` shows everything. Entering a lazy room **auto-loads** its data (no more hunting for a "Run" button). Implemented with conditional `hidden` classes (no destructive refactor) — every detailed card and the overview group gated; `tsc` clean.

#### ✅ NEW: `src/components/AdvisorBar.tsx` — ⌘K Chief-of-Staff command bar
- Press **⌘K / Ctrl+K anywhere** (or the rail "Advisor" button) → a command-palette overlay to ask the AI Chief-of-Staff (Bangla/Hindi/English). Reuses `POST /api/intelligence/advisor`; suggested prompts, Esc to close, scope-locked + aggregate-only footer. Self-contained, zero backend change.

#### ✅ NEW: shareable Daily Brief (in `AajHome`)
- "Brief" button composes a **WhatsApp/Telegram-ready** text (org + risk + KPIs + aaj ke 3 kaam + Chief-of-Staff line) and copies to clipboard. PR gold for the leader — forward-and-flex. (A polished image card is a future enhancement.)

#### ✅ `CommandCenter` — full rooms rail
- Rail now lists all rooms (Aaj + the 7 ICV rooms) + an Advisor (⌘K) entry; renders `AajHome` or `IntelligenceCommandView room={room}`. White-label branded throughout; responsive (rail stacks on mobile).

#### ✔️ Verification
- `npx tsc --noEmit` clean on `IntelligenceCommandView`, `CommandCenter`, `AdvisorBar`, `AajHome`, `page.tsx`. All Level 1–10 APIs unchanged.

#### ⚠️ Next AI — Please Note
- Remaining redesign polish (optional): an in-app **branding editor UI** (orgName/leader/accent without code; v1 branding is config in `src/lib/branding.ts`), a true **image** Daily-Brief card (needs html-to-image), Map as its own room (currently the separate `MapView` top-level view), and motion/live-pulse polish.

---

### SESSION 23 — Claude Code (June 15, 2026): UI redesign Phase A — Command Center shell + personalized "Aaj" home + white-label branding

#### 🤖 AI Tool Info
- **Tool:** Claude Code (claude-opus-4-8). Frontend-only re-architecture (backend untouched). User feedback: "sab ek scroll mein hai, UI advance nahi lagta" — for a product priced at ₹30L+ it must feel like a personal command center, not a long card stack.

#### 🧠 The shift
- From **one long scroll of ~16 cards** → a **command center with a left "rooms" rail + a personalized daily home**. Each capability eventually becomes its own full-screen room; this increment ships the shell + the home + per-client branding (the biggest perceived jump), deploy-safe, with zero loss of existing functionality.

#### ✅ NEW: white-label branding — `src/lib/branding.ts`
- `resolveBranding(user)` → `{ orgName, leaderName, tagline, accent, accentSoft }`, matched by the user's scope (constituency → lok sabha → district → block), neutral default fallback (`JanSunwai WB`, amber accent). v1 config-driven (`CLIENTS` map, no DB) — add a signed client = one entry. Justifies the setup fee: each MLA/MP gets "mera apna system" (own name + accent). `initialsOf()` helper for avatars.

#### ✅ NEW: `src/components/AajHome.tsx` — the "Aaj" (Today) home room
- 10-second executive glance: greeting by name + scope, one big risk gauge (SVG, grade-coloured), 3 key numbers (active / SLA-breach / is-hafte) from the brief, **AI-picked "aaj ke 3 kaam"** (top 3 of the Level-10 operations queue), the Chief-of-Staff one-liner (composed from the top warning / hotspot / risk driver — no LLM call on load), and the honest outcome line ("aapne N action liye · M ab resolved"). Reuses existing scope-locked APIs (`/api/intelligence/brief` + `/operations`) — no new backend. Themed by branding accent.

#### ✅ NEW: `src/components/CommandCenter.tsx` — the shell
- Left rooms rail (Aaj + Intelligence) + branded header; renders `AajHome` or the existing `IntelligenceCommandView` (untouched) per active room. Responsive (rail stacks on mobile). Mounted in `src/app/page.tsx` (replaces the direct `<IntelligenceCommandView/>` at the `intel_command` view), passed the session `user`.

#### ✔️ Verification
- `npx tsc --noEmit` clean on `branding.ts`, `AajHome.tsx`, `CommandCenter.tsx`, `page.tsx`. Existing `IntelligenceCommandView` and all Level 1–10 APIs unchanged.

#### ⚠️ Next AI — Please Note
- This is **Phase A** (shell + home + branding). **Next iterations** peel the existing Intelligence view into individual rooms (Map / Forecast / Network / Brain / Entity 360 / Field), and add the signature moves: ⌘K advisor command bar, per-client theming UI, and a shareable Daily-Brief image card. The existing view still holds all detailed cards under the "Intelligence" room until then.
- To onboard a real client's branding: add one entry to `CLIENTS` in `src/lib/branding.ts` keyed by their constituency/lok-sabha/district (lowercased).

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
- Total migrations applied: 120 (latest: `create_client_branding`, Jun 15)

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
