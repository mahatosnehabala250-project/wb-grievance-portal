# JanSunwai WB — Full App Review (CEO / world-class audit)
*Claude Code · 2026-07-10 · Fable advisor + 6× Sonnet-5 executors, grounded in live code + live Supabase + live n8n. Brutally honest, no praise-padding.*

## TL;DR (one paragraph)
**The engineering is real and genuinely good; the product is not yet real because no real person is using it.** The RBAC/JWT/geo-data core is production-grade solo-founder work. But 90% of data is demo, real WhatsApp inflow flatlined on 2026-06-25 (15 days dark), the karyakarta network has 1 person and 0/2,802 booths assigned, War Room is a design doc with zero code, and the home dashboard shows a frozen fake "Live" AI widget. **The gap is 100% go-to-market (one real user + real data), not more features.** Plus there were live security holes exposing real citizen PII — those are now fixed (this session).

---

## 1. Current status / assessment — per dimension

| Dimension | Verdict | The one hard fact |
|---|---|---|
| **Architecture / code** | PARTLY-REAL | RBAC/JWT/tests are production-grade, but only 5 of ~76 tables sit behind the tested adapter; 44 routes hand-roll raw Supabase with no shared scope enforcement (9/107 routes use rbac.ts). |
| **Security / deploy** | ~~NO-GO~~ → **fixes applied** | 3 anon-reachable PII RPCs + 2 RLS-disabled election tables + 1 unauth webhook were LIVE. **All closed this session.** Remaining: GitHub PAT in git remote, stale `supabase-migration.sql` landmine, 82 SECURITY DEFINER fns unaudited. |
| **Data reality** | MOSTLY-DEMO | 537/594 complaints = DEMO. Of 52 "WhatsApp" rows, ~44% fabricated + 48% of the rest are the founder's own number. **~15 distinct real citizens ever, each once, none in 15 days.** 27 of 29 real complaints never assigned. |
| **Product / political value** | MOSTLY-DEMO (sellable) | The insight (credit + pulse + karyakarta + targeting) is a genuine painkiller. But all 4 legs are empty/unbuilt today. **No evidence any real politician has ever logged in.** FOCUS.md's 5 go-to-market questions are still blank. |
| **n8n automation** | PARTLY-REAL | Intake (JS-01) genuinely works on live traffic. JS-03 dispatch bugs from Jul-7 are **already fixed (Session 65/70, execution 7762 fully green)**. Still broken: JS-08 Watchdog alert routing (so failures are silent), dead Gmail, and `src/lib/n8n-webhook.ts` posts to WB-02/03/04 paths that **don't exist** on any live workflow. |
| **Frontend / UX** | PARTLY-REAL | MLA/Analytics/Governance/Overview are genuinely wired to Supabase. But the **home Dashboard** carries a frozen fake "AI Brain — Live" widget (`processedToday:47` forever), 2 contradictory hardcoded response-time numbers, 2 fake sidebar pills, and a **Bulk-AI-Categorization dialog that fabricates results and lies "saved"**. These are why the founder's gut says "demo." |

---

## 2. Done this session (verified)
- ✅ **Security holes closed** (migrations `security_hardening_revoke_anon_and_enable_rls_v2`): revoked anon/public EXECUTE on `register_complaint`, `get_citizen_telegram`, `upsert_citizen_profile` (both overloads); enabled RLS on `election_results_ac` + `election_results_booth`. Verified: anon=false, RLS=on, **service_role still works (bot unaffected)**.
- ✅ **Unauth webhook locked**: `src/app/api/webhook/complaint/route.ts` now fail-closed behind `n8nSecretOk` (live bot uses `/complaints/register`, unaffected).

## 3. Unresolved / risks + priority for next phase

### 🔴 P0 — do before showing anyone real
1. **Get ONE real user generating real data.** Pick Bandwan or Balarampur (geo already done). Get one BDO/MLA office to hand out the WhatsApp number for 2 weeks. Watch inflow move off zero. *Everything else is downstream of this.*
2. **Kill the "demo feel" (½ day, huge trust payoff):** delete the frozen `aiStats` "AI Brain — Live" card (`DashboardView.tsx:79-97, 631-748`); remove/wire the fake Bulk-AI-Categorization dialog (`ComplaintsView.tsx:373-425`); fix the 2 contradictory hardcoded response-time numbers + the 2 fake sidebar pills (`page.tsx:680-687`).
3. **Fix JS-08 Watchdog alerting** — set a real `telegramChatId` on the ADMIN row the watchdog queries, so failures stop being invisible.

### 🟠 P1 — before real citizens depend on it
4. Wire ONE real block officer's real phone into `users` (replace a `+919900000XXX` placeholder) + fix ONE non-bouncing dept email; run 10 fresh complaints intake→assign→resolve→rate on non-founder numbers.
5. Reconnect the dead **Gmail** credential (dept emails still not sending).
6. Delete the dead cascade code (`src/lib/n8n-webhook.ts` → nonexistent WB-02/03/04 paths) so dashboard actions stop silently 404-ing.
7. Rotate the **GitHub PAT** out of the git remote URL; delete/repair the stale `supabase-migration.sql` landmine.

### 🟡 P2 — hygiene / scale
8. Answer FOCUS.md's 5 questions (who pays, positioning) — the real blocker, not code.
9. Fix the 5 failing tests (`info-embeddings-breaker-bypass`). Add a shared `getSupabaseAdmin()` + scope helper so new routes stop copy-pasting raw Supabase. `groupBy()` will get slow past a few thousand real rows.

---

## The honest bottom line
You did **not** build a fake app. You built a real, well-architected system — and then filled it with demo data because you had no real users to fill it with. That is a *sales problem wearing an engineering costume.* Stop building. Get one real office live for 30 days. The product will tell you what to build next.
