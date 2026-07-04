# PRODUCT AUDIT — JanSunwai WB ("khichdi ka naksha")
*Claude Code · June 22, 2026 · Honest, no sugar-coating. Numbers measured from the actual repo + DB.*

## 0. Ek line mein
**Engineering A+, focus D.** Ye ek impressive intelligence-platform hai jo 5 audiences aur ~4 alag products ko ek saath serve karne ki koshish karta hai — isliye khichdi lagta hai. Data 90% demo hai (537 demo vs 57 real complaints; last 30 din mein sirf **5 real**). Sabse bada gap koi feature nahi — **ek asli user + asli data-flow** hai.

## 1. Surface ka size (measured)
| Cheez | Count | Note |
|---|---|---|
| Top-level views (page.tsx) | **24** | + 9 CommandCenter rooms = 33 destinations |
| React components | 41 | 2 dead: `PerformanceLeaderboard`, `SystemHealthWidget` |
| API routes | **125** | ek solo founder ke liye bahut bada maintenance surface |
| DB tables (public) | **76** | |
| Complaints | 594 | **537 DEMO (90%) · 57 real · sirf 5 real last-30-days** |
| Users | 58 | zyada tar test/seed |

## 2. Asli structure: ye 1 nahi, ~4 PRODUCTS hain
1. **Grievance OS (core)** — complaints CRUD + RBAC + dashboard + map + n8n notifications. *(~35 routes — ye asli product hai)*
2. **Intelligence suite** — brief/forecast/fusion/network/nlp/operations/advisor + CommandCenter rooms. *(10+ routes, 10 "levels" — impressive, par bina real data ke khaali engine)*
3. **রক্ত সহায়ক (blood donor)** — **14+9 = ~23 routes**, OTP auth, certificates, SOS queue. **Poora alag product** jo grievance se sirf "WB citizens" share karta.
4. **AI-orchestration research lab** — cascade/guardrail/router/agents/bandit-trainer/classifier-calibration/prompt-versions. *(~13 routes — R&D infra jo shayad koi UI use hi nahi karta)*
+ **Saathi assistant** (naya, 4 routes) — ye #1 aur #2 ko *jodne* wala layer hai (sahi disha).

**Khichdi ki jadd:** #3 aur #4 core se unrelated hain, par same repo/nav/DB mein baithe hain.

## 3. Dead / at-risk code (safai list)
- ❌ `PerformanceLeaderboard.tsx`, `SystemHealthWidget.tsx` — kahin import nahi hote.
- ❌ Routes jinka koi UI reference nahi: `announcements`, `reports/weekly`, `consent` (0 refs).
- ⚠️ ADMIN-only System section (8 views: n8n, wb01Workflow, endpointHealth, deployment, liveData, integrations, systemStatus, audit) — sirf tumhare liye; users ke liye noise. "Dev console" mein chhupao.
- ⚠️ `agents/*`, `cascade/*`, `guardrail/*`, `router/classify`, `routing/*` — AI-lab remnants; UI se disconnected. Archive-branch material.
- ⚠️ Gemini Live (`live-token`) — code sahi, par **API access denied (billing)**; billing tak shelved.

## 4. Chhupe gems (jo underused hain)
- 💎 **RBAC scope system** — genuinely production-grade (har route pe server-enforced). Yahi tumhara technical moat hai.
- 💎 **Saathi** (tool-calling + eval 22/23) — front-door banne layak.
- 💎 **PR-card / Wapas-Jao briefs** — politician ki asli need (credit) ka beej; expand nahi kiya.
- 💎 **Command Map** (2D+search+timeline) — demo-winner.
- 💎 n8n WhatsApp intake — **asli data-inflow ka darwaza**; abhi ~5 complaints/month hi aa rahe.

## 5. Overlap/confusion (khichdi ke concrete examples)
- "Overview" **2 jagah** (top-nav + CommandCenter room). Map **3 jagah** (view, room, MLA dashboard embeds).
- MP Command vs MLA Dashboard vs Dashboard vs GovernanceDashboard — 4 "home" concepts.
- Intelligence 2 jagah: `intelligence` (Alert Engine) view AUR `intel_command` rooms.
- Brain/Entity360 naam user-facing jargon (redesign ke baad bhi tabs pe wahi naam).

## 6. Simplification blueprint (jab tum bolo)
**Target: 24 views → 6 + Saathi front-door.**
1. **Aaj** (AajHome — role-adapted home)
2. **Complaints** (list + detail + actions)
3. **Map** (ek hi jagah)
4. **Intelligence** (rooms yahin: forecast/brain/entity360/network — sub-tabs)
5. **Team** (users + leaderboard)
6. **Settings**
- ✨ **Saathi** har jagah — "kuch bhi poochho/karwao".
- ADMIN System-section → alag `/admin` console. Blood-donor → alag app/subdomain (ya explicit "Module" switch). AI-lab routes → archive branch.
- Dead code delete (upar §3).

*Ye blueprint implement karne se pehle FOCUS.md ke 5 sawaal ke jawab chahiye — kyunki kya katega, woh positioning decide karti hai.*
