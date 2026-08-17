# Worklog — shared between agents

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
