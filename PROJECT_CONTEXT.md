# 🏛️ JanSeva — AI Context Bootstrap

> **Hello AI!** Read this file FIRST before doing anything in this repo.
> This file is the entry point for any AI tool (Cursor, Claude, ChatGPT, Copilot, Lovable, Bolt, Kiro, Windsurf, etc.)

---

## 🎯 What is this project?

**JanSeva (West Bengal AI Public Support System)** — A production-grade citizen grievance management portal for West Bengal, India, with an integrated blood donor matching system (Rakta Sahayak).

Citizens send WhatsApp messages, AI agents categorize and route grievances to government officers (GP / BDO / Department), and a separate sub-system matches blood requests with eligible donors using a tiered cascade.

**Owner:** Snehabala Mahato
**Brand:** NeuroSetu AI
**Production URL:** Deployed via Vercel
**n8n Instance:** https://n8n.srv1347095.hstgr.cloud/
**Supabase Project:** `sxdtipaspfolrpqrwadt` (region: ap-south-1, Mumbai)

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React, TypeScript, Tailwind CSS, shadcn/ui |
| Backend / API | Next.js API Routes |
| Database | Supabase (PostgreSQL 17), Prisma ORM |
| Automation | n8n (15+ workflows on self-hosted Hostinger instance) |
| AI / LLM | Google Gemini (via n8n LangChain nodes), OpenAI embeddings |
| Communication | WhatsApp Business API, Gmail (officer comms) |
| Hosting | Vercel (frontend) + Hostinger (n8n) |
| Auth | Supabase Auth + OTP for donors |
| Storage | Supabase Storage (certificates, PDFs) |

---

## 📍 Where to find detailed context

| Topic | Location |
|---|---|
| 📐 Architecture overview | `.ai-context/ARCHITECTURE.md` |
| 🗄️ Full database schema | `.ai-context/DATABASE_SCHEMA.md` |
| 🔄 All n8n workflows | `.ai-context/N8N_WORKFLOWS.md` |
| 🔌 API endpoints | `.ai-context/API_ENDPOINTS.md` |
| 🎯 Current focus / WIP | `.ai-context/CURRENT_STATE.md` |
| 📝 Architecture decisions | `.ai-context/DECISIONS.md` |
| 📋 Active specs | `.kiro/specs/` |
| 🧪 Live data | Supabase REST: `ai_project_context` table |

---

## 🚦 Active Spec (Currently Being Built)

**`.kiro/specs/sahayak-multi-agent-router/`**

Re-architecting the single JS-01 AI agent into a CEO Router + 4 specialist agents (Complaint, Blood, Donor, Status/Info). Includes:
- Smart Donor Cascade (tiered notification, no spam)
- Medical eligibility tracking (NACO/NBTC compliant cooldowns)
- Race condition handling
- Donation certificates
- Frontend dashboards + donor self-service portal

Read `.kiro/specs/sahayak-multi-agent-router/requirements.md` for full requirements.

---

## 🌐 Connected MCPs (for AI tools)

```json
{
  "mcpServers": {
    "wb-grievance-context": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://gitmcp.io/mahatosnehabala250-project/wb-grievance-portal"]
    },
    "supabase": {
      "serverUrl": "https://mcp.supabase.com/mcp?project_ref=sxdtipaspfolrpqrwadt"
    },
    "n8n": "(via API at https://n8n.srv1347095.hstgr.cloud/api/v1/)"
  }
}
```

Any AI with MCP support can auto-discover this project's full context via `gitmcp.io`.

---

## 📐 Naming Conventions

| Item | Convention | Example |
|---|---|---|
| n8n workflows | `JS-NN: Name` | `JS-01: Sahayak Multi-Agent` |
| Ticket numbers | `WB-YYYY-XXXXX` | `WB-2026-00123` |
| API routes | `/api/<resource>/<action>` | `/api/complaints/register` |
| DB tables | `snake_case` plural | `blood_donors`, `conversation_sessions` |
| React components | `PascalCase` | `ComplaintCard.tsx` |
| Branch naming | `feat/`, `fix/`, `chore/` | `feat/multi-agent-router` |
| Commit format | Conventional Commits | `feat: add cascade engine` |

---

## 🗣️ Communication Style

- WhatsApp messages: **Hinglish + Bengali support**, conversational tone (NOT formal)
- UI: **English primary**, with Bengali/Hindi translations for citizen-facing pages
- Code comments: **English**
- Internal docs: **English with Hinglish allowed for clarity**

---

## 🚨 Critical Rules for AI

1. **NEVER expose API keys, tokens, or secrets** in code or commits.
2. **Medical compliance is mandatory** — cooldowns, deferrals, screening must follow NACO/NBTC guidelines (see `.ai-context/MEDICAL_RULES.md`).
3. **PII protection** — donor phone numbers must be masked in non-admin views.
4. **No deletes on `donation_history`** — audit trail must be immutable.
5. **n8n workflows are deployed via** `deploy-workflows-v2.js` — do NOT manually edit production workflows in the n8n UI.
6. **All blood request notifications use the cascade engine** (JS-15B) — never broadcast directly to all matching donors.
7. **Session state is the source of truth for routing** — never let an AI agent guess intent when `last_intent` is set.

---

## 🔄 Auto-sync to Supabase

This file is mirrored to Supabase for AI tools without GitHub access:

```bash
# Read full context via REST API:
curl "https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/ai_project_context?key=eq.bootstrap" \
  -H "apikey: <SUPABASE_ANON_KEY>"
```

---

## 📞 Contacts

- **Project Owner:** Snehabala Mahato
- **Repo:** `mahatosnehabala250-project/wb-grievance-portal`
- **n8n Admin:** https://n8n.srv1347095.hstgr.cloud/
- **Supabase Dashboard:** https://supabase.com/dashboard/project/sxdtipaspfolrpqrwadt

---

> **Last updated:** 2026-05-26
> **Maintained by:** AI agents (auto-updated on each spec/workflow change)
