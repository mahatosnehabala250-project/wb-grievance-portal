# Kiro Changes Tracking File
**Purpose:** Single source of truth for all code changes, bug fixes, and feature implementations. Updated by Kiro between Claude handoffs.

---

## Active Context (Last Updated: Jun 11, 2026 — Claude Session 5)

### Latest Status
- **Last Commit:** `f4bab78` - docs: log scope-filter column-name fix + snake/camel note
- **Deployment:** Vercel auto-deploy active
- **Frontend:** http://localhost:3000 (dev) / Vercel production (live)
- **Backend:** Supabase + n8n workflows
- **Current Work:** Telegram notification fixes (JS-04 + JS-12)

---

## Running Issues & Fixes

### Issue #1: Complaint Rating Not Saving (FIXED ✅)
**Problem:** User rate complaint #039 but #033 rating saved instead
**Root Cause:** Frontend issue with form state binding
**Fix Applied:** [Need Claude to investigate - mark for next session]
**Status:** Awaiting verification

### Issue #2: Telegram Notifications Not Flowing (FIXED ✅)
**Problem:** 
- Telegram API error: "Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 139"
- Root cause: Bengali text + emoji in reply message breaking Telegram's markdown UTF-8 parser
- Flow failed at "Send Success Reply" node in JS-12

**Root Cause:** 
- Telegram's strict markdown entity parsing cannot handle multi-byte UTF-8 characters (Bengali) mixed with emojis
- When Telegram tries to parse markdown, byte offsets get miscalculated for non-ASCII chars

**Fix Applied (Jun 11):**
1. Removed all emoji from reply text in "Save Link + Build Reply" node
2. Simplified reply to plain Bengali text only
3. Set `parseMode: "MarkdownV2"` on Send nodes (auto-disables markdown if no markdown present)
4. Changed reply format to plain text, no special characters

**Fix Commit:** `f869996`

**Action Needed:** Test with real Telegram link — status change should now send without errors

### Issue #3: Frontend Validation Issue (BLOCKED 🚫)
**Problem:** Direct complaint "Annapurna Bhandar dhuke nai" blocked by guardrails
**Issue:** AI agent correctly understood complaint but response blocked
- User got: "One moment please — I am checking..."
- Then complaint intake started after "Ok"
- Should start immediately for valid complaints

**Root Cause:** Guardrail overly conservative on valid complaints

**Action Needed:** Review JS-01 guardrail configuration in n8n

### Issue #4: Geography Validation (OPEN ❓)
**Test Case:** 
- Village: Dhabani, District: Purulia, Block: Huradiya
- User said GP "pata nahi" → then gave "Kamta Jangidiri"
- Kamta Jangidiri is Manbazar block, NOT Huradiya

**Current Status:** Unknown if system rejected or accepted wrong GP-Block combo

**Action Needed:** Check `validate-geography()` in complaint intake; implement cross-validation

---

## Recent Commits (Last 5)

| Commit | Message | Files Changed |
|--------|---------|----------------|
| `f4bab78` | docs: log scope-filter column-name fix | KIRO_CHANGELOG.md, SESSION_CONTEXT.md |
| `264e596` | fix(governance): scope filter DB column names | src/lib/jwt.ts, src/components/GovernanceDashboardView.tsx |
| `bd0b24f` | docs: log GP/Karyakarta 0-complaints fix | KIRO_CHANGELOG.md |
| `e4a9fa8` | fix(governance): add gp_code/gp_name/assigned_villages to Prisma | prisma/schema.prisma, src/app/api/auth/me/route.ts |
| `8ef0fe8` | fix(governance): coordinators nav focused | src/app/page.tsx, src/components/GovernanceDashboardView.tsx |

---

## Key Files to Watch

### Frontend (React/Next.js)
- **Page:** `src/app/page.tsx` — Main nav + role-based rendering
- **Dashboard:** `src/components/GovernanceDashboardView.tsx` — GP/Block scope filters
- **Complaint Form:** `src/app/(dashboard)/complaints/new/page.tsx` — Intake UI
- **Auth Store:** `src/lib/auth-store.ts` — User role + scope data

### Backend (API Routes)
- **Login:** `src/app/api/auth/login/route.ts` — Returns role_level, gp_code, assigned_villages
- **Me Endpoint:** `src/app/api/auth/me/route.ts` — User profile + governance fields
- **Complaints API:** `src/app/api/complaints/route.ts` — Scope filtering on query
- **Dashboard API:** `src/app/api/complaints/dashboard/route.ts` — Aggregated data

### Database (Supabase)
- **Table:** `public.users` — role_level, gp_code, gp_name, assigned_villages columns
- **Enum:** role_level — CITIZEN, KARYAKARTA, GP_COORD, BLOCK_COORD, MLA, MP, DISTRICT_LEAD, STATE_LEAD, ADMIN
- **Complaints Table:** ticket_no (PK), citizen_name, village, gp_code, assembly_constituency, status

### n8n Workflows
- **JS-01:** Citizen AI Agent (complaint intake + guardrails)
- **JS-02:** Priya Triage (AI categorization)
- **JS-03:** Dispatch (officer assignment)
- **JS-04:** Status Broadcaster (Telegram → WhatsApp)
- **JS-12:** Telegram Link Bot (deep linking)

---

## Demo Users (All Password: `Demo@2026`)

| Username | Role | GP | Block | Scope |
|----------|------|-----|-------|-------|
| `gpcoord_demo` | GP_COORD | Kamta Jangidiri | Manbazar | Entire GP |
| `karyakarta_demo` | KARYAKARTA | Kamta Jangidiri | Manbazar | Assigned villages |
| `blockcoord_demo` | BLOCK_COORD | (any) | Manbazar | Entire block |
| `mla_demo` | MLA | (any) | (any) | Manbazar AC |
| `mp_demo` | MP | (any) | (any) | Jhargram LS |
| `dist_demo` | DISTRICT_LEAD | (any) | (any) | Purulia district |
| `state_demo` | STATE_LEAD | (any) | (any) | Entire state |
| `admin_demo` | ADMIN | (any) | (any) | Global |

---

## Next Steps (Prioritized)

### 🔴 CRITICAL
1. **✅ Fix Telegram Notification Flow** (COMPLETED)
   - ✅ Debug JS-04 error (was Telegram markdown UTF-8 issue)
   - ✅ Removed emoji from reply
   - ⏳ Test end-to-end: Status change → Telegram message

2. **Fix Guardrail Sensitivity** 
   - Issue: Valid complaint "Annapurna Bhandar dhuke nai" blocked by guardrails
   - Expected: Should start intake immediately
   - Current: User gets "One moment please..." then has to say "Ok" again
   - Action: Review JS-01 guardrail thresholds; reduce false-positives

3. **Implement Geography Validation**
   - Issue: System accepts invalid GP+Block combos (e.g., Kamta Jangidiri for Huradiya)
   - Expected: Reject with error; user sees message to correct
   - Action: Add GP-Block cross-validation in JS-01

### 🟡 IMPORTANT
4. **Fix Rating Save Bug** 
   - Issue: User rates complaint #039, but #033 rating saved instead
   - Status: ⏳ Needs investigation (not tested yet)

5. **Frontend Field Visibility (User Request)**
   - Add GP Name + Village Name + Assembly Name to complaint card
   - Update complaint table in portal to show all three fields
   - Users want full context when viewing complaints

6. **Admin Portal Visibility**
   - Display Village, GP, Assembly Constituency per complaint
   - Currently shows: name, block only
   - Needed for: proper hierarchy visualization

### 🟢 NICE-TO-HAVE
7. MP Dashboard improvements:
   - Show all assembly constituencies
   - Per-MLA card with complaint drill-down
   - Karyakarta + Village breakdown

---

## Architecture Decisions Made

### Governance Hierarchy
- **9 Roles:** CITIZEN → KARYAKARTA → GP_COORD → BLOCK_COORD → MLA → MP → DISTRICT_LEAD → STATE_LEAD → ADMIN
- **Visibility:** Scope-based on gp_code, block, assembly_constituency, parliamentary_constituency
- **Auto-Routing:** Backend derives MLA + MP from Village → GP → Block → AC → LS mapping

### Frontend Auth Flow
1. User logs in
2. Backend returns JWT + user object (with role_level, gp_code, gp_name, assigned_villages)
3. Auth store parses + sets scopes
4. Page.tsx renders role-specific nav
5. Dashboard component applies scope filters to API calls

### Data Scope Filtering
- **Query:** `src/app/api/complaints/route.ts` uses `scope_filter` from auth store
- **Supabase Adapter:** Treats where-keys as literal DB columns (snake_case only)
- **Column Names:** `gp_code`, `assembly_constituency`, `parliamentary_constituency` (NOT camelCase)

---

## Testing Checklist

- [ ] Login as `gpcoord_demo` → see Kamta Jangidiri complaints only
- [ ] Login as `blockcoord_demo` → see Manbazar block complaints only
- [ ] Login as `admin_demo` → see all complaints
- [ ] Post complaint → auto-routes to correct MLA + MP
- [ ] Rate complaint → rating saves correctly (not shifted)
- [ ] Status change → WhatsApp message sent
- [ ] Telegram link provided → link works + auto-links chat
- [ ] Geography validation → rejects Kamta Jangidiri in Huradiya block
- [ ] Frontend shows Village + GP + Assembly per complaint

---

## Session Handoff Template

**For Claude:**
```
## Context
- Latest commit: [SHA]
- Current issue: [description]
- Files modified: [list]
- n8n errors: [IDs + messages]

## Action Required
1. [Priority 1]
2. [Priority 2]
3. [Priority 3]

## Testing
Run: npm run dev
Check: [specific user flow]
```

---

**Last Updated By:** Kiro (Autopilot)  
**Last Update Time:** Jun 11, 2026, 18:00 UTC
