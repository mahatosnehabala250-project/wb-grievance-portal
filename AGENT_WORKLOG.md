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
