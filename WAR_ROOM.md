# WAR ROOM — MLA/MP Command Center (Design + Sales Doc)
> **Purpose:** Ek concrete, buildable spec for "War Room" — TV-pe-chalne-wala live command center feature. NO naye tables, NO n8n calls yahan — pure design doc, data sources jo already portal mein hain unhi pe based hai.
> **Status:** Design-only. n8n abhi down hai (HTTPS 000) — is doc mein n8n ko kahin call nahi kiya gaya, sirf reference hai ki karyakarta alerts already Telegram se live hain (Session 70).

---

## 1. War Room kya hai

Ek **single screen** — MLA/MP ke office mein TV pe ya laptop pe khula reh sakta hai, poore din — jo batata hai: **abhi kya jal raha hai, kaun kaam kar raha hai, kahan dhyaan dena hai.**

Yeh "dashboard" nahi hai jisme graphs scroll karte rehte hain. Yeh ek **operational cockpit** hai — jaisे control-room mein screen hoti hai jisme sirf woh dikhta hai jispe *action* lena hai. Owner ne clearly bola hai: "intelligence dashboard" clutter nahi chahiye (koi vanity chart, koi "insight of the day" card nahi) — sirf actionable cheezein: kaunsa complaint SLA todh raha hai, kaunsa booth garam hai, kaunsa karyakarta jawab nahi de raha.

**Kab use hota hai:**
- **Governance mode** (normal din): MLA/staff subah dekhte hain — kal kya khula reh gaya, kaunsa block chup hai (complaints hi nahi aa rahe — worse sign than complaints).
- **Campaign/election mode**: same screen, upar election-margin overlay on — "yeh 12 booth pichli baar 25 votes se hare the, aur wahan complaints resolve nahi ho rahe" — seedha targeting list.

Big-screen friendly matlab: bade fonts, 3-4 panels max per fold, auto-refresh (poll every 30-60s — koi websocket zaroori nahi abhi), no mouse-hover-required interactions (sab kuch visible bina click ke).

---

## 2. Screens/Widgets (sab existing data se buildable)

Layout: 2×2 ya 2×3 grid, ek "today's actions" strip neeche fixed.

### 2.1 Live Complaint Ticker (by AC/Block)
- Source: `complaints` table, same scope filter jo already `getComplaintScopeFilter(payload)` mein hai (RBAC-scoped — MLA apna AC, MP apna Lok Sabha ke saare AC).
- Dikhaye: last N complaints (rolling), `status` (OPEN/IN_PROGRESS/REGISTERED/ASSIGNED), `urgency`, `category`, `assembly_constituency`, `block`. Naya complaint aaye toh row highlight (30-60s poll, koi websocket abhi nahi chahiye).
- Grouping: block-wise count strip on top ("Bandwan: 14 open, Balarampur: 6 open...") — ek glance mein kahan load hai.

### 2.2 Booth-wise Heat (complaints per booth + SLA breaches)
- Source: `polling_stations` (booth → gp_code/village/block mapping, 2,802 booths across 9 ACs) JOIN `complaints` on gp_code/village match (jaisa `/api/booths` already RBAC-scope karta hai).
- Metric per booth: open complaint count + **SLA breach count** (`slaBreach=true` filter jo `/api/complaints` mein already hai — open/in-progress >7 din purana).
- Heat = simple bucket (green <2 open, amber 2-5, red >5 ya koi SLA breach) — koi complex scoring nahi, owner ko "clutter" nahi chahiye.
- Weak-match booths (`match_score < 0.4`, ~627 abhi) ko heat map mein flag karo alag se — inka data thoda unreliable hai jab tak karyakarta ground-verify na kare.

### 2.3 Karyakarta Activity
- Source: `users` (role_level='KARYAKARTA', isActive, telegramChatId) + `polling_stations.karyakarta_user_id` (kitne booth assign hain) + complaint assignment/resolution timestamps.
- Dikhaye: kaun assigned hai kis booth/GP pe, last activity kab (last complaint update jo unke assigned area mein unhone touch kiya), aur "silent" karyakarta flag (assigned hai, but 7+ din se koi movement nahi — same SLA logic, karyakarta pe apply).
- Yeh already-existing Telegram alert pipe (Session 70, 100% verified) ka natural extension hai — hum sirf "kisko bheja gaya" ko "kya use response diya" ke saath dikha rahe hain.

### 2.4 Hotspot Booths (complaint load × past close margin)
- Source: `election_results_booth` (2021, `w`/`r` = winner/runner-up votes) + live booth complaint heat (2.2).
- Logic: booth jahan margin tight tha (`abs(w-r)` small, e.g. ≤25-50 votes — "razor-thin", same threshold jo `/api/map/politics` mein already use ho raha hai) **AND** abhi complaint load high hai / SLA breach hai → top of list.
- ⚠️ **Caveat carry-forward** (already PURULIA_GEO_MAPPING.md mein note hai): 2021 booth PS numbers **≠** 2026 SIR ke baad renumbered PS. Number-pe-number join invalid — yeh already `/api/map/politics` bhi jaanta hai (booth stats sirf AC-level aggregate karta hai, per-booth join nahi karta abhi). War Room ke Hotspot widget ko bhi **AC-level ya verified-village-level** join use karna chahiye jab tak koi 2021↔2026 PS crosswalk na bane — warna galat booth ko "hotspot" bata dega.
- Yeh sabse premium widget hai — seedha "kahan jaana hai" batata hai.

### 2.5 Today's Actions (fixed strip, bottom)
- Ek simple auto-generated to-do list, koi AI/LLM nahi chahiye — pure SQL rules:
  1. Har SLA-breach complaint jiska koi assignee nahi.
  2. Har "silent" karyakarta (2.3).
  3. Top-3 hotspot booth (2.4) jinpe is hafte koi ground visit/resolution nahi hua.
- Yeh list hi War Room ka "so what" hai — baaki sab widgets isi list ko justify karte hain.

**Explicitly NOT included** (owner ki feedback ke mutabik — no intelligence clutter): sentiment trends, word clouds, "insight" cards, predictive scores, historical trend graphs. Sab kuch ek clear action ki taraf point karna chahiye.

---

## 3. Election-time value (premium upsell framing)

Normal mahine mein War Room ek governance tool hai — "kya khula hai, kaun jawab nahi de raha." Election ke 60-90 din pehle, wahi data ek **targeting tool** ban jaata hai:

- **Hotspot Booths (2.4)** batata hai: "yeh 8-12 booth aise hain jo pichli baar 25-50 votes se decide hue the, aur wahan abhi grievance load high hai ya SLA toot rahi hai." Yeh candidate/party ko batata hai **kahan resource (karyakarta visit, camp, resolution push) daalna hai** — na ki blanket har booth pe equal effort.
- **Karyakarta Activity (2.3)** batata hai kaunsa karyakarta un tight-margin booths pe actually active hai vs sirf assigned-on-paper hai — election se pehle "silent" karyakarta ko replace/activate karne ka time milta hai.
- **Complaint resolution speed** khud ek campaign asset ban jaata hai: "in tight booths mein humne itne din mein resolve kiya" — ground pe bataने layak number.

Yeh feature normal governance version se **structurally same** hai — bas election_results_booth overlay ON hai aur hotspot widget promoted hai. Isliye ise "premium add-on" bolna sahi hai: same infra, extra data-join, extra sensitivity (electoral data + targeting = higher value, higher care).

---

## 4. Build Estimate (honest — mostly a read-only aggregation view)

**Reused as-is (zero/near-zero new work):**
- RBAC scope filters — `getComplaintScopeFilter`, `/api/booths` scope logic, `assembliesForLokSabha` — already handle MLA/MP/DISTRICT/BLOCK/GP/KARYAKARTA jurisdiction.
- `complaints` table + `slaBreach=true` query param — already exists in `/api/complaints`.
- `polling_stations` table + karyakarta assignment — already exists (`/api/booths`, Session 69).
- `election_results_ac` + `election_results_booth` + margin/razor-thin logic — **already prototyped** in `/api/map/politics` (Battleground Index). This is the biggest accelerant — the join pattern (election × live grievance, scope-locked) already exists and works; War Room mostly re-packages it into a denser, TV-friendly layout instead of a map page.
- Karyakarta Telegram alert pipe (Session 70) — no new alerting needed, War Room only *reads* activity, doesn't need to send anything new.

**New work needed:**
1. **New aggregation API** (`/api/war-room` or similar) — combines: complaint counts by AC/block/booth, SLA-breach counts, karyakarta last-activity, hotspot join (complaint load × margin) — mostly SQL/Prisma queries stitching together tables that already have the right shape. Est. **1-2 days** (mirrors `/api/map/politics` pattern closely).
2. **New component** (`WarRoomView.tsx`) — grid layout, big-screen CSS, 30-60s poll refresh, "today's actions" strip. No new charting library needed (owner dislikes chart clutter — this is mostly numbers/lists/badges, similar to `BoothsView.tsx`'s plain-table style). Est. **2-3 days**.
3. **Karyakarta "silent" flag logic** — small new SQL: last-touched-complaint-timestamp per assigned karyakarta vs now(). Est. **half day**.
4. **AC-level-safe hotspot join** — reuse `/api/map/politics` booth-stat aggregation (already AC-level to sidestep the 2021↔2026 PS-numbering mismatch) rather than inventing a new per-booth join. Est. **half day** (mostly wiring, logic exists).
5. **Route/nav wiring + RBAC gate** (War Room visible only to roles that already see Booths + Map, i.e. MLA/MP/DISTRICT/ADMIN/STATE — not raw karyakarta view) — Est. **half day**.

**Total realistic estimate: ~5-7 dev-days** for a working v1 (single AC/MLA scope, poll-based refresh, no new tables, no new n8n workflows). This is honest scoping — it is fundamentally **a new read-only view stitched from data that already exists and is already RBAC-scoped**; the hard parts (booth mapping, election data, karyakarta alerts, SLA logic) are all done.

**Build order:**
1. Aggregation API (SLA + booth heat + karyakarta activity) — no election data yet, ships as plain governance War Room.
2. Component + nav wiring, test with one MLA's real scope.
3. Add hotspot/election overlay (reuse Battleground Index join) behind a feature flag — this is the premium layer, ship it separately so base War Room can go live first.
4. Polish: big-screen CSS pass, auto-refresh tuning, "today's actions" rule tuning with real usage feedback.

---

## 5. Pricing Hook

War Room slots in as the **premium / election-season add-on**, not part of the base package:

- **Base package** (existing pitch): ~₹20-25k/month per MLA — WhatsApp grievance intake, complaint tracking, booth directory, karyakarta alerts.
- **War Room add-on**: sold as a **2-3× premium during the election window** (60-90 days pre-election) — because that's exactly when the hotspot/targeting value (Section 3) is highest and when an MLA/MP is willing to pay for an edge, not just governance hygiene.
- Off-season, War Room can stay live at a lower/base-included tier (just the governance widgets — 2.1/2.2/2.3/2.5) since it's cheap to run (no new infra); the **hotspot/election overlay (2.4)** is the part that gets gated/priced as the premium layer and switched on for the election window.
- Positioning line: "Aapka existing data — complaints, booths, karyakarta — already andar hai. War Room sirf isko ek TV pe laake, election ke waqt targeting tool bana deta hai. Baaki sab already ban chuka hai — hum sirf sahi jagah dikha rahe hain."

---

**File:** `C:/Users/mahat/Downloads/wb-grievance-portal/WAR_ROOM.md`
