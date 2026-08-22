# Worklog — shared between agents

### 2026-08-19 · codex · DONE · Rating endpoint no longer hides an audit-write failure

**Changed:** `src/app/api/complaints/field-rate/route.ts`

**Why:** The endpoint saved `satisfactionRating` and then attempted to add the
required `RATED` activity row, but ignored the insert error. It could therefore
return `{ ok: true }` even when the audit trail was missing.

**Verified:** targeted ESLint and TypeScript checks run after the change. Live
verification not performed because this session does not have the webhook secret
and no citizen record was modified.

**Watch out:** the rating update and activity insert are still separate database
operations. If the insert fails, the caller receives a 500 even though the
rating may already have persisted; a retry safely overwrites the same rating.

Two AI engineers work on this repo: **Claude Code** and **Zcode (Z.AI)**.
Neither can see the other's chat. This file and `git log` are the only channels
between them.

New engineer? Read `HANDOFF_ZCODE.md` first. Then read the last few entries here.

## Rules

1. **Read before you start.** The last entries tell you what is half-finished
   and what is already claimed. Also run `git log --oneline -20`.
2. **Claim before you build.** If a piece of work will take more than an hour,
   append a `CLAIMED` entry *first* and push it. That is how the other agent
   knows not to start the same thing.
3. **Append when you finish.** Newest at the top, directly under this line.
   Never edit or delete someone else's entry.
4. **Say what is not verified.** If you could not test something, write that.
   A confident wrong claim costs the other agent a day.
5. Commit this file together with the change it describes.

## Format

```
### YYYY-MM-DD · agent · STATUS · short title
**Changed:** files or areas touched
**Why:** the problem, not the diff
**Verified:** how you know it works — or "not verified, because ..."
**Watch out:** anything the next person could break
```

`STATUS` is one of `CLAIMED` (starting), `DONE`, `BLOCKED`, `ABANDONED`.

---

### 2026-08-19 · claude · DONE · FUTURE_DIRECTIONS.md — frontier research, two agent sweeps

**Changed:** `FUTURE_DIRECTIONS.md` (new)

**Why:** The owner asked what OpenAI, Anthropic, Microsoft, NVIDIA, Musk and the
frontier labs say the world becomes, and whether this project is being built on
dated technology. Two multi-agent sweeps: one on protocols/models/voice/civic/
disruption, one on the labs themselves.

Three findings change engineering decisions here:

1. **The 13-tool cliff.** Tool-calling accuracy is 85-91% at 5 tools, 65-78% at
   20+, degradation starting around 10-15. JS-01 has 13. Measured production
   behaviour, not theory. This is the evidence behind splitting JS-01 — but only
   after an eval exists, or the split cannot be shown to have helped.
2. **Indic models do not comprehend romanised Bengali better than frontier
   models.** Indi-RomCoM (Jun 2026): Sarvam-30B 56.1% vs Claude Opus 4.6 61.2%
   at 75% code-mixing. Their real edge is register and speech. Buy Sarvam for
   ASR/TTS; do not swap the reasoning model.
3. **The old tool-call failure is solved upstream and was replaced.** Enabling
   JSON-schema constraints together with tool calling makes models emit valid
   JSON and silently never call a tool. Carry it as a debugging heuristic.

**Verified:** node inventory and JS-01 read live from the n8n API. Model and
protocol claims carry sources in the report. Frontier-lab claims are separated
into shipped / announced / said-on-a-podcast, and the report says which.

**Watch out:** the report's own conclusion is that none of this is what is
killing the product — zero field workers is. Treat sections 6 and 7 as the
actionable part and the rest as context. Also flagged: Meta's WhatsApp Cloud API
is the one dependency with no exit path, and Gemini's price doubles 1 Jan 2027,
so the model ID belongs in one env var.

---

### 2026-08-19 · claude · DONE · Technology direction report — TECH_DIRECTION.md

**Changed:** `TECH_DIRECTION.md` (new)

**Why:** The owner asked whether the project is being built on dated technology
and what the industry is doing with agents, orchestrators and sub-agents. Report
answers it against the live instance rather than against blog posts.

The finding that matters: `@n8n/n8n-nodes-langchain.agentTool` v3,
`mcpClientTool` v1.2, and `evaluation` v4.8 + `evaluationTrigger` v4.7 are
**already installed** on this n8n. Orchestrator + sub-agents is a wiring job
here, not a migration. Do not move to LangGraph / OpenAI Agents SDK / Claude
Agent SDK — that rebuilds 37 workflows to reach the pattern already available.

Recommended order: (1) build an eval harness from the 53 real complaints before
touching JS-01, (2) enable `needsFallback` on the agent node, (3) only then split
JS-01's 13 tools and 5 jobs into a router plus five sub-agents.

**Verified:** node inventory read live from the n8n API; `agentTool` schema
fetched and confirmed to carry its own model/memory/tools/systemMessage plus
maxIterations and needsFallback. JS-01 confirmed at agent typeVersion 3.1.

**Watch out:** Step 3 is a refactor of the only component that touches real
citizens, and there is still no way to measure a regression. Step 1 is not
optional ceremony — it is what makes Step 3 safe. Also: the delivery bottleneck
(0 real field workers) is untouched by any of this.

---

### 2026-08-19 · claude · DONE · n8n JS-01: language detection was answering Bengali speakers in English

**Changed:** n8n workflow `JS-01: Sahayak — Citizen AI Agent` (`YsUZwu99ckTnzekR`),
node `Parse Message`. **Not a repo change** — this lives in n8n, not in git.
Backup of the pre-change workflow is in the session scratchpad as
`js01.BACKUP-20260819-1243.json`.

**Why:** `Parse Message` decided language from Unicode script:
`bnChars>=2 → bn`, `hiChars>=3 → hi`, `enWords>=3 → en`. But the people on this
line write Bengali in Latin letters. Of 36 complaints tagged `bn`, 26 carry no
Bengali character at all — they were tagged `bn` only because they were short.
And 16 real complaints were tagged `en`, including "Amar kanshsrer taka dukhe
nai" and "Joler samsya". The system prompt says "follow citizen language", so
those citizens were answered in English by their own MLA's office.

New order: Bengali script → Devanagari → romanised-Hindi markers → romanised-
Bengali markers → English stopwords → default Bengali. Hindi is tested before
Bengali because nahi/raha/hai are distinctive while "pani" belongs to both.

**Verified:** 19 of 20 real complaint strings from the database now classify
correctly, against 9 of 16 before. The one miss is "OBC certificate reissue
approval delay" → bn, which is the deliberate default: answering that in Bengali
in Purulia is a far smaller error than the reverse. After deploy, re-fetched the
workflow: active=true, 24/24 nodes, connections byte-identical, new code present,
old `enWords` branch gone.

**Watch out:** the n8n PUT API rejects `settings` keys it does not own — strip
everything except errorWorkflow/timezone/executionOrder/callerPolicy or it
returns 400 `settings must NOT have additional properties`. Also: the workflow
JSON contains the N8N_WEBHOOK_SECRET in plaintext in the `Rate Limit` and
`Guardrail` nodes. **Never commit a workflow export to this repo.** That secret
should be rotated and moved into n8n credentials.

**Still open in JS-01, not fixed here:** `Send Reply` carries a fallback for when
the agent emits the literal text "Calling X with input" instead of calling the
tool — meaning that failure happens, and each occurrence burns a WhatsApp message
and confuses the citizen. Worth a retry rather than a papered-over reply.

---

### 2026-08-17 · zcode · DONE · Secret-authed rating endpoint for Sarvam voice agent

**Changed:** `src/app/api/complaints/field-rate/route.ts` (new)

**Why:** A Sarvam AI Bengali voice agent will call citizens whose complaints are
closed and ask whether the fix actually worked. It cannot hit the existing
`PATCH /api/complaints/[id]/rate` because that requires a staff JWT. Built a new
POST endpoint that accepts `{ticketNo, rating, note, stillBroken}` behind
`X-N8N-SECRET`, the same pattern proven in `field-update/route.ts`.

Only resolved complaints can be rated. Re-ratings overwrite — the voice agent may
re-attempt if the first call was garbled, and the activity log records both.
The `stillBroken` flag is stored in the activity-log metadata but does not flip
status — the office decides what to do after reading the note.

**Verified:** typecheck passes — no new errors against the pre-existing baseline
(leaderboard, db.ts, N8NWorkflowsView, WB01WorkflowDetailView, ceoRouter, tests).
Lint clean. Not verified against the deployed site because N8N_WEBHOOK_SECRET is
not available in this session.

**Watch out:** the endpoint uses `ticketNo` (uppercase-normalised), not `id`.
The voice agent must send the header `X-N8N-SECRET`, not `Authorization: Bearer`.
If the agent sends a bad secret, the response is 401 with body `{ ok: false }` —
same shape as field-update, so the caller can parse it uniformly.

---

### 2026-08-16 · claude · DONE · Handoff written, Zcode joining

**Changed:** `HANDOFF_ZCODE.md` (new), `WORKLOG.md` (new)

**Why:** A second agent (Zcode) is joining with no context, no repo access and
no MCP servers. The handoff carries the architecture, the standing rules, every
trap that has already cost this project days, and the agreed priority order.

**Verified:** the facts in the handoff were read out of the live database and
the repo today, not recalled. The public-repo exposure in section 0 was checked
against the GitHub API (`"visibility": "public"`) and `git ls-files`.

**Watch out:** `FOCUS.md` and `WAR_ROOM.md` are committed to a public repo and
`FOCUS.md` carries pricing strategy plus the phrase "Cambridge Analytica for
panchayat". The owner has to decide what to do — do not rewrite history alone.

---

### 2026-08-16 · claude · DONE · MLA home rebuilt around a time ledger

**Changed:** `src/components/MLADashboardView.tsx`,
`src/app/api/mla/stats/route.ts`, `src/app/page.tsx`

**Why:** The home screen could not answer the first question an office asks —
what came in today and how much of it got dealt with. Added a Today / This week
/ This month ledger with filed, closed, net and a clearing bar; a fourteen-day
arrivals-vs-closures chart; a five-tile KPI row; a category ring; quick actions
that open real views. Removed the "Keeping up?" card because it contradicted the
new ledger (rolling 30 days vs calendar month, same "+6" from different numbers)
and removed the announcement banner, which cried wolf in amber on every load.

Windows are **calendar** periods in IST, not rolling ones — "last 24 hours"
drops this morning's complaints at 2pm, which is not how anyone thinks.

**Verified:** live on the deployed site; API returns `windows` and `daily`;
ledger, ring and quick actions read correct values in the browser; "Write
letter" navigates to Letters. Typecheck and lint clean against baseline.

**Watch out:** `d.flow` is still on the API response — the Intel tab reads
`flow.closed`. Do not remove it. Category ring percentages use largest-remainder
rounding so they sum to exactly 100; naive `Math.round` printed 102.

---

### 2026-08-16 · claude · DONE · Category was hardcoded to OTHER on every intake

**Changed:** `src/lib/categorise.ts` (new), `tests/lib/categorise.test.ts` (new),
`src/app/api/complaints/register/route.ts`, two migrations under
`supabase/migrations/`

**Why:** `register_complaint` hardcoded the literal `'OTHER'` into its INSERT
and took no category parameter, so the category the intake agent collected was
computed in the route and thrown away on every call. 23 of 53 real WhatsApp
complaints read OTHER — including ones whose whole text is "drinking water" and
"Bidyut". Added `p_category` to the function, wrote a keyword classifier that
handles Bengali, Hindi, English and romanised Bengali, and backfilled 22 rows.

**Verified:** 23 unit tests from real database rows, all passing. RPC tested
inside a transaction and rolled back. OTHER went 43% → 6% on real complaints.
The three that remain are honest — a mobile-network complaint and two OBC
certificate requests, for which no category exists.

**Watch out:** recreating the function let Supabase's default privileges grant
EXECUTE to `anon`, which the old version never had — on a SECURITY DEFINER
function that inserts complaints. Revoked in a follow-up migration. **If you
ever `DROP`/`CREATE` a function in this database, re-check `proacl` afterwards.**
The backfill ran with `trg_js12_email` disabled or it would have emailed 22 BDOs.

---

### 2026-08-16 · claude · DONE · Map village layer rebuilt from the official shapefile

**Changed:** `public/purulia-villages.geojson`, `src/components/MapView.tsx`,
`src/app/api/map/villages/route.ts`; deleted `src/app/api/map/block-stats/route.ts`

**Why:** The boundary file carried `vilnam_soi` (Survey of India name) as its
label, and that column is not aligned to the geometry — the polygon carrying
"Andhuli" as its SOI name lies 20 km from the actual Andhuli. Mostly masked by
`purulia-gp.json`, but 55 polygons fell through and were labelled with an
unrelated village's name. Rebuilt from the official shapefile with the LGD name,
gram panchayat and block on every feature.

Also: the map now reports what it is *not* showing. Four real complaints
(village "Purulia" ×3 and "Taltal") are not in the LGD register and were
vanishing from the map silently.

**Verified:** all 153 Purulia village coordinates tested point-in-polygon
against the source shapefile — 153 inside, 0 outside. Vertex count matches the
official file exactly (192,200); the file replaced had lost 2,118.

**Watch out:** 89 villages district-wide have no coordinates and the official
shapefile does not cover them. **Do not geocode them into the database.** The
old `village_coordinates` table shows what happens — 30 of its 42 rows are a
block centroid stored as a village location, all 11 that overlap official data
disagree by more than 2 km.

---

### 2026-08-16 · claude · DONE · A failed load no longer reads as "you have no complaints"

**Changed:** `src/components/ComplaintsView.tsx`, `src/components/MLADashboardView.tsx`

**Why:** When `/api/complaints` errored, the list kept its initial empty state
and drew "0 total complaints — No complaints found matching your filters" over a
seat holding 42. Watched it happen live: three identical requests returned 500,
500, 200, and Supabase's REST logs showed a fifteen-minute run of 522s across
every table. Failure is now its own state with one quiet retry and a Try again
button; rows already on screen stay.

**Verified:** forced a 500 in the browser against the deployed site and
confirmed the banner renders and the old empty-state message is gone.

**Watch out:** the MLA home used `const d = data!` and threw into the error
boundary when the first load failed. Guarded now.

---

## 2026-08-21 — Claude — JS-04 closure message now names the MLA's office

**Why.** The closure notification is the single highest-value moment in the
product: it is when a citizen learns their pension or scholarship came through.
It read `👤 অফিসার: <name>` — and "officer" reads to a villager as a government
clerk, which hands the credit to the state rather than to the MLA whose worker
actually did the work. The MLA's name appeared nowhere in the message.

**Changed (both live).**

1. `trigger_js04_status_update()` — migration `js04_payload_add_mla_and_category`.
   Adds three fields to the webhook payload: `assemblyConstituency`, `mlaName`
   (resolved in the trigger, so n8n needs no extra round trip), and `category`.
   Additive only — every pre-existing field keeps its name and meaning.
   The MLA lookup excludes `username LIKE '%demo%'`: Bandwan carries both a real
   MLA (Labsen Baskey) and a "Demo MLA" row, and without the filter the winner
   would depend on row order.

2. JS-04 `zxhMcvjLPbcuEzGz`, node `Build Status Message`. RESOLVED now reads
   "<MLA>-এর কার্যালয় থেকে <worker> আপনার পেনশন করে দিয়েছেন", carries a
   category-aware next-step line (entitlements get "money should arrive in a few
   days, tell us if it doesn't"), and **no longer asks for a 1-5 rating**.
   Node output shape is unchanged, so downstream nodes were untouched.

**Verified.** Workflow validates with 0 errors (14 warnings, all pre-existing).
MLA lookup resolves correctly for all 9 Purulia ACs. 581/595 complaints carry an
AC; the other 14 fall back to naming the worker alone. Five message variants
rendered locally, including the no-MLA fallback. No live status change was
fired — that would send real messages to real citizens.

**Open, and it matters.** The rating ask was removed but its replacement does
not exist yet, so satisfaction ratings stay at zero until a follow-up workflow
lands: ~15 days after RESOLVED, ask "did the money actually arrive?" That
follow-up is also the only way to catch cases closed on paper but not in fact.

**Also fixed.** `n8n-mcp-server` container was Exited (255) with an empty error —
killed by a host restart, with `RestartPolicy: no`, which is why it never came
back and the MCP connection dropped. Started it and set
`--restart=unless-stopped`. Two idle containers remain (`quirky_lamarr` exited,
`recursing_vaughan` running but permanently "unhealthy" because it is a
stdio-mode container whose healthcheck expects HTTP). Neither blocks anything;
left in place pending the owner's call.

---

## 2026-08-21 — Claude — agent harness: action ledger, memory, MCP tool layer

**The finding that set the shape.** `activity_logs` held 87 rows across 595
complaints. Joined against `complaints.resolvedAt`, **every action type came
back `later_resolved = 0`** — not one logged intervention was ever followed by
a case closing. The constituency graph had nodes and no causal edges, so
"last time this was stuck, X unstuck it" was unanswerable. Separately,
`agent_invocations` was sitting there with 13 columns and 0 rows: logging was
something callers had to remember, so nobody did.

**Built (all live).**

1. Migration `agent_harness_action_ledger` — `agent_actions` (append-only:
   actor, verb, subject, rationale, `parent_action_id`, place, tokens) and
   `action_outcomes` (written later by a look-back job). Split deliberately:
   events are immutable, judgements about them are not. View `action_ledger`
   joins the two and exposes `was_advised`.

2. Migration `agent_harness_outcome_lookback` + `..._gap_guard` —
   `record_action_outcomes(settle_days, horizon_days, min_gap_hours)`.
   **The first cut was wrong and is worth knowing about:** it scored every
   action against its own status notification, written in the same instant, so
   every verb returned 0.0 days and 100% effective. Fixed with a minimum gap
   plus `is_intervention()`, which excludes `status_changed`/`resolved`/
   `created` — those are records *of* an outcome, so judging them by "did the
   status change after?" is circular.

3. Migration `agent_memory_institutional` — `agent_memory` (claim, evidence,
   confidence, `last_confirmed_at`, `expires_at`, status), `decay_memory()`,
   and `propose_memory_from_outcomes()` which grows beliefs *from* the ledger.
   Everything it writes lands as `proposed`; `usable_memory` shows only
   `active`, so a proposal is never served as fact.

4. `mcp-constituency/` — stdio MCP server, 9 tools (under the 10–15 tool
   cliff; JS-01 is already at 13). Two rules: **scope is enforced in
   `scopeFilter()` from the caller's `users` row, never in a prompt** — a
   model can be argued out of an instruction, it cannot be argued into a query
   that was never built. And **every write goes through `logAction()`**, so the
   ledger cannot fall behind the work. Failed tool calls are logged too.

**Verified.** Backfilled the 87 `activity_logs` rows into the ledger.
Outcome job: 17 interventions judged → 0 resolved, 5 moved, 12 nothing.
`what_works` now reads:

```
verb        tried  resolved  moved  nothing
assigned      12       0       1      11
reopened       5       0       4       1
```

Assignment, the system's core mechanic, has closed nothing in twelve
attempts. `assign_case` returns that as a reminder on every call.

`smoke.mjs` boots three actors and confirms scope isolation:
`mla_balarampur` 28 open / `mla_manbazar` 64 open / `mp_purulia` 244 open,
three disjoint sets of villages.

**Also.** Corrected a stale entry in Claude's own memory: the `.env`
`SUPABASE_SERVICE_ROLE_KEY` was recorded as dead (401 on 2026-07-26); re-tested
today it returns 200. It has flipped once, so re-test rather than assume.

**Next, in order.** Schedule `record_action_outcomes()` + `decay_memory()`
(daily is enough). Then the Telegram front door: staff already self-link via
JS-12 and `users.telegram_chat_id`, so the advisor can answer in-channel with
the caller's own scope — one MCP process per linked user, scope resolved from
their row. Do **not** add role-specific tools for that; the same nine tools
scoped differently is the whole design.

## 2026-08-21 (later) — Claude — MCP beyond tools; sampling is deprecated

Went and read the spec instead of building from memory, on the owner's
instruction. Three things came back that would otherwise have shipped wrong.

**1. Sampling is deprecated — protocol revision `2026-07-28`, SEP-2577.**
"New implementations SHOULD NOT adopt it; existing implementations SHOULD
migrate to integrating directly with LLM provider APIs." It stays in the spec
twelve months from that revision before becoming eligible for removal. I had
just built the memory auditor on `server.createMessage`. Rewritten to call
Gemini directly — which is better regardless, because the audit now runs on
every client rather than only ones that expose a model. **Anything in this
repo still reaching for MCP sampling should be moved off it.**

**2. Elicitation has three response actions, not two** — `accept`, `decline`,
`cancel`. I was treating decline and cancel identically. For a ledger whose
whole purpose is learning which advice humans trust, "said no" and "closed the
dialog" are opposite signals; they are now logged separately.

**3. `requestedSchema` is a restricted subset** — flat object, primitive
properties only, no nesting. Also: form mode **MUST NOT** be used to request
credentials (URL mode exists for that). Ours asks for a boolean and an optional
note, which is fine.

**Added to `mcp-constituency/`.**

- **Resources** — `constituency://scope|pulse|memory|evidence`, pre-scoped.
- **Prompts** — `morning_brief` (PA), `weekly_review` (member), `cadre_check`
  (coordinator). This is how role-shaped advisors get built **without
  role-specific tools**: same nine tools, different lens. A fourth audience
  means a fourth prompt, never a tenth tool. Each carries the same house rules,
  including "say nothing at all on a quiet day" — JS-21 has pushed a 7AM brief
  daily for months and nobody has ever acted on it, which is what happens to a
  brief that always looks the same.
- **Elicitation on `assign_case`** — no mutation until a human approves, as a
  protocol round trip rather than a prompt instruction. On a client that cannot
  elicit the action is **refused**, not waved through; `confirm:true` is the
  escape hatch for out-of-band approval. Declines and cancels are written to
  the ledger too — "the advisor suggested this and a human said no" is exactly
  as informative as a yes.

**Verified — `smoke-advanced.mjs`, all gates held.**

```
2. non-eliciting client → assign_case   →  refused, nothing mutated     PASS
3. Manbazar MLA → Balarampur ticket
   (even with confirm:true)             →  "No case ... inside Manbazar" PASS
4. remember("villages starting with B
   resolve faster", 2 observations)     →  UNSUPPORTED, confidence 0.20  PASS
```

The auditor's own words on that last one: *"The observation of only two cases
is insufficient to establish a pattern."* Test row deleted afterwards.

**Zcode:** `FUTURE_STACK_REPORT.md` (yours, 19 Aug) and
`INDEPENDENT_AGENTIC_ROADMAP.md` are both present and correctly untracked. If
you build anything on MCP sampling, see point 1 above before you do.

---

## 2026-08-22 · Zcode · DONE · Three cross-screen inconsistencies found by an A-to-Z crawl, two of them numbers that disagreed

**Why.** An automated pass over every MLA screen (logged in as mla_purulia,
read-only — no submits, no assignments) caught the same facts being reported
differently in different places, which is the one failure mode this product
cannot afford in front of an MLA.

**Changed:**

1. `src/app/api/complaints/route.ts` + `src/components/ComplaintsView.tsx` —
   the summary pills under "Complaints" counted the fifteen rows on the current
   page while sitting beside a global "Total 42": "Resolved 9" on page 1,
   "Resolved 14" on page 2, while the seat had closed 35. The API now returns
   `statusCounts` (three filtered `count` queries alongside the existing one),
   and the pills read those.

2. `src/app/api/war-room/route.ts` — the War Room carried a private breach
   rule (`pct >= 100 || urgency in {HIGH, CRITICAL}`), the urgency-blind shape
   `src/lib/sla.ts` was written to end. Every open HIGH or CRITICAL counted as
   breached regardless of age, so the War Room said "3" over six open cases
   that Home, Hotspots and By Area all correctly called 6 (all six are past
   their real 1/3/7/15-day deadlines). All four call sites now use
   `isBreached()`/`slaLevel()` from sla.ts; "At Risk" follows the library's
   ⅔ warning band instead of a local 75%.

3. `src/components/MLADashboardView.tsx` + `src/components/ComplaintsView.tsx`
   — at 390 px the page scrolled 131 px sideways: the five-tab strip held the
   row at its full width, and the recent-complaints table set the page's width
   to its own. The tab strip now scrolls within itself; the table scrolls
   inside its card; the mobile complaint card's header row wraps.

**Verified:** `npx tsc --noEmit` (only the pre-existing tests/ baseline),
`npx eslint` clean on all four files. Post-deploy verification of the live
numbers appears in the next entry.

**Not changed (owner's call):** every complaint still shows the same Bengali
water-tap sentence — that is the known broken `issue` string on DEMO rows, a
data repair (or purge of test rows), not a UI tweak. Booths still paints ~5 s
of blank rows before 307 booths arrive; Settings still says "2.2.0".

**Follow-up (same day).** The first cut of the war-room fix read `createdAt`
through the route's `str()` helper — but the db adapter's `parseDates` hands
back `createdAt` as a **Date instance**, `str()` only accepts strings, and the
breach test silently saw no start time at all: SLA BREACHED read **0** over six
genuinely late cases. Live-verified and corrected — `createdAtOf()` now passes
the raw value (string or Date) straight to `isBreached`, which accepts both.
Post-deploy check: War Room OPEN 6 / SLA BREACHED 6 / Home "Past deadline" 6.

**Follow-up 2 (same day, E2E pass).** A full entry-to-end exercise of every
page's operations (own test rows, cleaned up after) surfaced two production
breakages in the manual complaint path, both now fixed or healing:

1. `ticket_seq_PUR` had rewound to 001017 while the table held tickets to
   001081 — every new complaint drew an existing number and died on the
   unique index (500 "Failed to create complaint"). No SQL access from this
   session, so the sequence was advanced by calling `generate_ticket_no`
   64 times through PostgREST until it drew past the live maximum; creation
   verified working at 001083/001084. Root cause of the rewind not yet known
   — worth finding which migration or restore moved it.
2. POST /api/complaints stored NULL `assembly_constituency` (intake derives
   it from the village; this path got only free-text block). MLA scoping
   matches on that field, so the office could not open, update, list or
   track a complaint it had just filed — create returned 201 and the row
   was then invisible to everyone. The route now stamps `block_norm`,
   `assembly_constituency` and `parliamentary_constituency` from
   constituency_block_mapping via normBlock, matching the rollup's
   spelling-variant handling. Miss leaves the fields NULL as before, never
   blocking the filing.

**Follow-up 3.** The geography stamping first tried to write `block_norm`
too — PostgREST rejects non-DEFAULT values for generated columns
(428C9), which turned every create into a 500. The column computes
itself; the commit after removes it and writes only the two
constituency fields. Verified: create 201 → MLA can GET, escalate,
resolve, rate, reopen, track the same row (all previously 403/404).

**E2E pass complete (same day).** Full entry-to-end exercise finished: backend
14/14 on the complaint lifecycle, 25 read endpoints, letters/visits/works/
users/feedback CRUD, 7 RBAC negatives, and 12/12 UI submit flows — all on
own test rows, all cleaned up and verified gone. Three production bugs were
found and fixed along the way (ticket-sequence rewind; NULL
assembly_constituency on manual creates; district-wide accounts locked out
of /activity and /rate by a legacy block-only check) — see the commits of
2026-08-22. Full report: the owner holds it as
`frontend-audit/E2E_FULL_REPORT.md` (not committed — it names live credentials
behaviour and test patterns).
