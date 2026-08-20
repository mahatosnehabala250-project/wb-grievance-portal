# Handoff — read this before touching anything

You are a second AI engineer joining this repo. Claude Code has been working on
it for months. You have no context, no access and no MCP servers configured.
This file is everything you need. Read it end to end before your first edit.

The other agent reads `AGENT_WORKLOG.md`. So do you. See **Working together** at the
bottom — that is not optional, it is how we avoid overwriting each other.

---

## 0. Do these first

**a) The repo is PUBLIC and a strategy document is committed to it.**

`FOCUS.md` is tracked and visible at
`github.com/mahatosnehabala250-project/wb-grievance-portal`. It contains the
pricing strategy, who to sell to, the admission that *"594 mein 537 demo, last
month sirf 5 real complaints"*, and the phrase *"Cambridge Analytica for
panchayat"*. This product is being sold to a sitting MLA. That phrase in a
public repo, tied to a real politician, is a press risk, and the demo-data
admission undercuts every demo the owner gives.

`WAR_ROOM.md` is also tracked — a sales/design doc, less severe.

`PRICING.md`, `GTM_PLAN.md` and `ROADMAP_ALLINDIA.md` are untracked. Keep them
that way. **Never `git add -A`** in this repo — it will sweep them in.

Do not fix this silently. `git rm --cached` does not remove a file from
history; the owner has to decide between rewriting history and making the repo
private. Raise it, do not act alone.

**a2) `worklog.md` and `AGENT_WORKLOG.md` are two different files.**

`worklog.md` (lowercase) is the older task log. `AGENT_WORKLOG.md` is the shared
log between the two agents — that is the one you read and append to.

Windows treats filenames case-insensitively and git does not. Writing a file
named `WORKLOG.md` on Windows silently overwrites `worklog.md`, which is exactly
what happened once already. **Check `git ls-files` for an existing name before
creating any file whose name differs only in case.**

**b) Never commit secrets.** Credentials live in `.env`, which is gitignored.
The GitHub token is also embedded in the git remote URL — so never paste the
output of `git remote -v` anywhere without redacting it.

---

## 1. What this is

**Banglar Sahayak** — a constituency-service platform for an Indian MLA
(Member of Legislative Assembly). Citizens send grievances over WhatsApp in
Bengali; the MLA's office tracks, assigns and closes them.

- Live: https://wb-grievance-portal.vercel.app
- Pilot seat: **Purulia** assembly constituency, West Bengal
- Owner: solo founder, lives in the district, Bengali-speaking. Time is the
  scarcest resource — not money and not ideas. Weigh every suggestion against
  that.

**The owner's standing instructions**, learned the hard way:

| Rule | Why |
|---|---|
| Never delete existing data | Only your own test rows |
| Do not run the local dev server | Verify against the deployed site |
| No fake features | A fake "AI Brain" widget and a fake bulk-categorise dialog were both deleted from this repo. If a number cannot be computed from real data, do not put it on screen |
| English UI | A Bengali nav translation was built and rejected |
| He decides business/content; you decide technical | |

---

## 2. The single most important fact

The dashboards are good. **The product has no users on the ground.**

Verified against the live database:

- `karyakartas` table: **0 rows**
- Six accounts carry a field role. Every one is named `Demo Karyakarta`,
  `Demo GP Coordinator`, `Test Karyakarta (Chharradumdumi GP)` — they are all
  test accounts created by the owner
- The 30 `BLOCK`/`OFFICER` accounts that auto-assignment targets were seeded on
  2026-04-15, **all share one identical bcrypt hash**, and are located in North
  24 Parganas and Nadia — **not Purulia**. There is no valid assignee in the
  system
- Assignment has fired **12 times in the entire history of the database**. All
  12 by `mla_purulia` (the owner's own account), on two days, to his own demo
  rows. One afternoon of self-testing
- 42 complaints in the pilot seat. 6 open, 35 resolved
- **0 of the 35 resolved complaints carry a satisfaction rating.** No closure
  has ever been confirmed with a citizen
- Nothing at all has been closed in the last 14 days
- 153 villages in the seat; complaints have ever arrived from 13

The assignment mechanism **works end to end** — n8n returns 200, the Telegram
buttons write correct `STATUS_CHANGED` rows back through `field-update`. It has
simply never been used by a real person.

**So: more dashboard work does not move this product.** Months have gone into
screens while this number stayed at zero. If you find yourself building another
chart, stop and re-read this section.

---

## 3. Stack

- **Next.js 16.2.6** (App Router, Turbopack), React, TypeScript, Tailwind,
  shadcn/ui + Radix, recharts, Leaflet, sonner, framer-motion
- **Supabase** (Postgres + PostgREST). `src/lib/db.ts` is a hand-written
  Prisma-shaped adapter over the Supabase REST client — it is *not* Prisma
- **Vercel** — deploys from `main`. Push to `main` = deploy to production
- **n8n** — 36 workflows. Inbound auth via an `X-N8N-SECRET` header. Database
  triggers POST to `js-*` webhook paths resolved through the `n8n_webhook_config`
  table and `get_webhook_url()`
- **Telegram** — field workers update case status from a bot
- **WhatsApp** — Meta Cloud API (`graph.facebook.com`), citizen intake

### Running it

```bash
npm install
npx tsc --noEmit -p tsconfig.json    # typecheck
npx eslint src/path/to/file.tsx      # lint
npx vitest run tests/...             # tests
```

**Typecheck has a pre-existing baseline of errors** in `tests/` and a handful in
`src/` (`leaderboard/route.ts`, `db.ts`, `N8NWorkflowsView.tsx`,
`WB01WorkflowDetailView.tsx`, `ceoRouter.ts`). Compare against the baseline —
do not assume your change caused them. `src/app/page.tsx` also has 3
pre-existing React-Compiler lint errors.

---

## 4. MCP servers you should connect

You have none configured. These are the ones that matter:

**Supabase** — read the database directly. Without it you are guessing.
Project ref: `sxdtipaspfolrpqrwadt` (region ap-south-1, Postgres 17).
Connect the official Supabase MCP server with a read-only token. The owner has
one working; ask him rather than minting your own.

**n8n** — 37 live workflows drive every notification. There is now a working
MCP server for it **running locally in Docker**, already pointed at the live
instance and health-checked:

```
container : n8n-mcp-server   (ghcr.io/czlonkowski/n8n-mcp)
endpoint  : http://localhost:3000/mcp   (MCP_MODE=http)
auth      : Bearer token — read it from the container, never from a file:
            docker inspect n8n-mcp-server --format '{{json .Config.Env}}' | grep -o 'AUTH_TOKEN=[^"]*'
```

Registered with Claude Code as `n8n-docker` at user scope. Register it with your
own client the same way. Do not assume a key you find in the repo still works —
the one in `build_wb_all.js` is expired.

Note: the image is 2.47.8 and 2.73.0 is out. Two other containers of the same
image (`vigorous_euler`, `quirky_lamarr`) are running and doing nothing — one is
in stdio mode with nothing attached to its stdin, the other predates the API key.
They are the owner's to remove, not yours.

If you cannot get MCP working, you can still read the database through the
app's own authenticated API endpoints in a browser session, which is how a lot
of this project's verification has been done.

---

## 5. Traps that have already cost days

Every one of these was a real bug found and fixed. Do not re-introduce them.

**Timezone.** Complaint timestamps are `timestamp without time zone` holding
UTC, and PostgREST serialises them with no zone marker: `"2026-08-09T12:05:35"`.
JavaScript reads that as *local* time. On the UTC Vercel server it happens to be
right; in an Indian browser every figure was 5½ hours early and nothing looked
broken. **Always use `dbDate()` / `dbTime()` from `src/lib/db-time.ts`. Never
pass a database timestamp to `new Date()`.**

**SLA.** One definition only: `src/lib/sla.ts` — CRITICAL 1 day, HIGH 3,
MEDIUM 7, LOW 15, warning at ⅔. It used to exist in eight places in three
shapes, so the same complaint was "late" on one screen and "on time" on the
next. Import it; do not write a new rule.

**Database triggers fire real messages.** `complaints` has 8 triggers. In
particular `trg_js12_email` fires on UPDATE whenever `category` changes to
anything other than `OTHER`, and POSTs to a **live** BDO-email webhook. A bulk
category backfill would have emailed Block Development Officers about 22
months-old complaints. Before any bulk UPDATE:

```sql
ALTER TABLE complaints DISABLE TRIGGER trg_js12_email;
ALTER TABLE complaints DISABLE TRIGGER complaints_updated_at;
-- ... your update ...
ALTER TABLE complaints ENABLE TRIGGER trg_js12_email;
ALTER TABLE complaints ENABLE TRIGGER complaints_updated_at;
```

Disable `complaints_updated_at` too, or every ageing and staleness figure in the
app will report that those rows were touched today.

**PostgREST caps at 1000 rows** unless you call `.range()`. A GP dropdown was
empty for 6 of 9 seats because of this.

**Telegram.** The callback payload is `upd:<ticket>:<STATUS>` and is capped at
64 bytes. Node parameters are snake_case — it is `parse_mode`, **not**
`parseMode`; the wrong key saves without error and is silently ignored. Markdown
breaks on `_`, which is why `IN_PROGRESS` is sent as a Bengali label.

**Vercel freezes the function when the response is sent.** Fire-and-forget
background work does not run. `notifyN8NAssignment` was dying mid-query for
exactly this reason — it is now awaited.

**`git add -A` is banned here.** See section 0.

---

## 6. What actually works

- WhatsApp intake, end to end, with real citizens (53 real complaints from 39
  distinct phone numbers)
- Ticket generation, LGD geo-derivation (village → GP → block → AC), activity
  logging, RBAC scoping by jurisdiction
- Telegram field-update round trip (proven, never used by a real worker)
- The map: official ML InfoMap/SOI village polygons, 2,689 features, WGS84,
  every one of Purulia's 153 village coordinates verified to fall inside its own
  polygon
- Category classification — `src/lib/categorise.ts`, keyword-based, handles
  Bengali/Hindi/English/romanised-Bengali. 23 unit tests built from real rows
- Government routing tables: 46 department email routes, 20 block BDO addresses

## 7. What is hollow

- Field workers: zero (section 2)
- `village_coordinates` table: 30 of 42 rows are a block centroid stored as if
  it were a village. The dead route that read it was deleted; the table remains
- The 89 villages with no coordinates — the official shapefile does not cover
  them. **Do not invent coordinates.** A wrong lat/lng is worse than a blank
  because it looks filled in
- Demo data: all 537 `source='DEMO'` rows share one identical `issue` string
  about a water tap, while their `category` and `description` are correct and
  varied. Only `issue` is broken

---

## 8. What to work on

The owner's agreed priority, in order. Do not skip to 3.

**1. Secret-authed rating endpoint — a couple of hours, and it is yours to do.**

A Sarvam AI Bengali voice agent will call the 49 citizens who have a phone
number and confirm whether their complaint was actually fixed. It cannot call
`/api/complaints/[id]/rate` because that requires a staff JWT.

Build a new endpoint that accepts `{ticketNo, rating, note, stillBroken}` and
authenticates the *machine*, not a user. Copy the pattern proven in
`src/app/api/complaints/field-update/route.ts`: `n8nSecretOk()` on an
`X-N8N-SECRET` header, identity resolved server-side, never asserted by the
caller. Write the rating and an activity-log row.

*Proof it worked:* satisfaction rating present on 30 of 35 closed complaints.
Today it is 0.

**2. Recruit one real person in one gram panchayat.** Zero engineering. This is
the owner's job and it cannot be done at a keyboard. It is also the only thing
that fixes section 2.

**3. Repair the government-email lane.** An MLA's real lever is a signed
reference to the BDO with a number on it, which the department must answer —
not a karyakarta. The machinery exists; two BDO addresses are dead and the rest
need re-verifying against current `wb.gov.in` listings. This is the only
delivery path that works at zero headcount.

**Do not build:** more dashboards, more charts, anything labelled "AI insight",
or complaint-intake features. The state government launched a free grievance
helpline in June 2026 — intake is not sellable and not the constraint.

---

## 9. Working together

Both agents share this repo. Coordinate through git and one file.

**`AGENT_WORKLOG.md`** is append-only and lives at the repo root. Before you start,
read the last few entries. When you finish a piece of work, append an entry in
the format that file specifies. Commit it with your change.

Also: `git log --oneline -20` shows what the other agent did. Commit messages in
this repo explain **why**, not what — read them, they carry the reasoning.

**Conventions**
- Branch: work on `main`. Push to `main` deploys to production, so typecheck and
  lint before every push
- Commit messages: explain the reasoning and what went wrong before. Look at
  recent history for the register
- Verify against the deployed site, not a local dev server
- Say plainly when something is not verified. This project has been burned more
  than once by a confident claim that turned out to be a cached response or a
  misread screenshot
