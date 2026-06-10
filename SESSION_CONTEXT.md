# WB Grievance Portal — Session Context Summary
Generated: June 2026

---

## Project Overview

**WB Grievance Portal** — West Bengal government grievance management system with:
- WhatsApp/Telegram intake via n8n
- Next.js frontend + Supabase DB
- AI Agent (Sahayak) for complaint processing
- Multi-level governance routing (Block → District → MLA → MP)

---

## MCP Connections (Working)

| MCP Server | Type | Status |
|------------|------|--------|
| GitHub | Docker | ✅ `mahatosnehabala250-project/wb-grievance-portal` |
| n8n | Docker | ✅ `https://n8n.srv1347095.hstgr.cloud/` |
| Supabase | npx | ✅ `sxdtipaspfolrpqrwadt` |
| Context7 Docs | npx | ✅ |
| n8n-workflows Docs | npx | ✅ |
| Airtable | npx | ✅ |

---

## Issues Fixed in This Session

### #1 — Guardrail False Block (Critical)
**Problem:** Valid Bengali complaints were being blocked with "One moment please..." fallback. Root cause: `languageMismatch.ts` only allowed Bengali script for `bn` sessions, but session language was often wrong (`en`/`hi`).

**Fix:** Updated `src/lib/guardrail/rules/languageMismatch.ts` to allow all 3 scripts (Bengali, Devanagari, Latin) for all session languages.

**File:** `src/lib/guardrail/rules/languageMismatch.ts`

---

### #2 — Geography Validation (High)
**Problem:** 
1. Block name mismatch (`Manbazar I` vs `Manbazar-I`) prevented LGD lookup
2. Invalid GP+Block combinations were accepted (e.g., Kamta Jangidiri in Hura block)

**Fixes:**
1. Migration: `lookup_village_coords` — added block normalization (spaces/hyphens equivalent)
2. Migration: `register_complaint` — now rejects invalid GP+Block, derives assembly from GP fallback

**Files:** Database functions (applied via Supabase migrations)

---

### #3 — Telegram Linking (Critical)
**Problems:**
1. Empty phone saved in `citizen_telegram_links` (corrupt row)
2. Success reply never sent (Upsert returned minimal, "message text empty" error)
3. No status query handler

**Fixes:**
1. Deleted corrupt empty-phone rows
2. JS-12 workflow updated:
   - Added guard: if no valid complaint/phone, chain stops (no empty insert)
   - Success reply now from Save node, not Upsert
   - Added status-query branch: send ticket number on Telegram → get status

**File:** `n8n-workflows/JS-12: Telegram Link Bot`

---

### #4 — JS-04 Status Broadcaster
**Status:** Logic correct. "Chat not found" error was caused by #3's broken link. Now fixed, will work with valid Telegram links.

---

### #5 — Frontend Location Fields (Done)
**Problem:** Village, GP, Assembly not visible in admin portal.

**Fixes:**
1. `prisma/schema.prisma` — added gpName, assemblyConstituency, parliamentaryConstituency, villageCode, gpCode
2. `src/lib/types.ts` — added same fields to Complaint type
3. `ComplaintDetailDialog.tsx` — now shows Village, GP, Assembly, Lok Sabha
4. `ComplaintsView.tsx` — "Block" column renamed to "Location", shows GP+village+AC inline
5. CSV export updated

---

## Pending Work

### #6/#7 — MP Command Center + Constituency Visibility
**Status:** NOT BUILT

Required:
- New roles: MP, MLA (currently only ADMIN, BLOCK, DISTRICT, STATE)
- Constituency-based complaint filtering (MLA sees own AC only, MP sees all)
- New dashboard views: MP Command Center with drill-down per constituency
  - Complaints per AC
  - Officers in constituency
  - Karyakartas list
  - Villages, GPs in AC
  - Escalations

---

## Database Schema (Key Tables)

```
complaints
├── ticketNo, citizenName, phone, issue, description
├── block, district, village, subdivision
├── gp_name (mapped to gpName)
├── assembly_constituency (mapped to assemblyConstituency)
├── parliamentary_constituency (mapped to parliamentaryConstituency)
├── village_code, gp_code
├── urgency, status, source, language
└── createdAt, updatedAt, assignedToId

lgd_villages (2711 villages)
├── village_code, village_name, block_code, gp_code
├── assembly_constituency, parliamentary_constituency

lgd_gram_panchayats (137 GPs)
├── gp_code, gp_name, block_code, assembly_constituency

lgd_blocks (156 blocks)
├── block_code, block_name, district_code

citizen_telegram_links
├── phone, telegram_chat_id, is_active, linked_at
```

---

## n8n Workflows (Key)

| Workflow | ID | Purpose |
|----------|-----|---------|
| JS-01: Sahayak | `YsUZwu99ckTnzekR` | Citizen AI Agent (WhatsApp intake) |
| JS-02: Priya Triage | | AI Categorization |
| JS-03: Dispatch | | Officer Assignment |
| JS-04: Status Broadcaster | `zxhMcvjLPbcuEzGz` | Status notifications (Telegram/WhatsApp) |
| JS-12: Telegram Link Bot | `ee8Ttjih5vJ1ZPsK` | Telegram linking + status query |

---

## Key Files Modified

```
src/lib/guardrail/rules/languageMismatch.ts
src/components/ComplaintDetailDialog.tsx
src/components/ComplaintsView.tsx
src/lib/types.ts
prisma/schema.prisma
tests/guardrail/rules.test.ts
```

**Last Commit:** `5bc57e3` — "fix: guardrail false-block, geography validation, Telegram linking, frontend location fields"

---

## ⚠️ Important Note — register_complaint History

This function was overwritten multiple times. Current working version (Claude-restored):
- `RETURNS json`
- Ticket format: `WB-26-PUR-XXXXXX`
- Uses camelCase columns: `ticketNo`, `citizenName`
- Validates GP+Block via `validate_gp_in_block()`
- Auto-derives assembly from LGD village/GP lookup
- Live test confirmed: `WB-26-PUR-001039` (Sumit Kumar, Jangidiri → Bandwan AC → Jhargram MP)

**Do NOT recreate this function** unless you use the exact version from the DB (run `pg_get_functiondef` first).

---

## ✅ Confirmed Working (Post-Fix Tests)

- `WB-26-PUR-001039` — Sumit Kumar, Jangidiri, Manbazar I — Bandwan AC, Jhargram MP ✅
- Invalid GP+Block (Kamta Jangidiri + Hura) → `invalid_gp_block` error ✅
- Assembly auto-fill from village lookup ✅
- Assembly fallback from GP when village not in LGD ✅

---

## Next Steps When Resuming

1. ✅ Vercel deploy done (commit `5bc57e3` pushed)
2. ✅ register_complaint working (Claude restored clean version)
3. Test Telegram flow end-to-end:
   - Fresh complaint → get ticket + Telegram link
   - Click Telegram link → JS-12 links account
   - Status change → JS-04 sends Telegram notification
   - Send ticket on Telegram → get status reply
4. MP Command Center: when ready to build

---

## User Notes

- Intake flow: Name → Village → District → Block → Gram Panchayat → Details (unchanged)
- Assembly auto-derived from GP/village mapping (backend)
- No backfill for old complaints
- Test complaints: Baliguma (Bandwan AC), Jangidiri (Manbazar I → Bandwan AC)