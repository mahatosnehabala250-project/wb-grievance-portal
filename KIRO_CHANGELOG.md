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
| JS-21: Daily Intel Brief (7AM Telegram) | `hPDe3mQWWf9bjWj8` | 4 | Jun 12 (⚠️ inactive — CRON_SECRET set karke activate karo) |

### Supabase Project
- Project ref: `sxdtipaspfolrpqrwadt`
- URL: `https://sxdtipaspfolrpqrwadt.supabase.co`
- Total migrations applied: 118

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
