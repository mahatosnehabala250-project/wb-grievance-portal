# WB AI Public Support System — Complete Architecture v4.0
## Senior Automation Architect Analysis

> **Auditor**: AI Senior Automation Architect (10+ years SaaS, n8n, System Design)
> **Date**: June 2025
> **Scope**: Full-stack system audit — Frontend, Backend, Database, n8n Workflows, AI, SaaS Design
> **Stack**: Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 + Supabase PostgreSQL + n8n + z-ai-web-dev-sdk

---

# PHASE 1: DEEP SYSTEM UNDERSTANDING

## 1.1 Complete System Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════════════════════╗
║                        WB AI PUBLIC SUPPORT SYSTEM v4.0                              ║
╠══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                      ║
║  ┌───────────────────── CITIZEN ENTRY POINTS ────────────────────────┐              ║
║  │                                                                     │              ║
║  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────┐  │              ║
║  │  │  WhatsApp   │  │  Web Ticket  │  │  Feedback  │  │  SMS     │  │              ║
║  │  │  (Meta API) │  │  Tracker     │  │  Form      │  │ (Future) │  │              ║
║  │  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  └────┬─────┘  │              ║
║  │         │                │                 │              │        │              ║
║  └─────────┼────────────────┼─────────────────┼──────────────┼────────┘              ║
║            │                │                 │              │                        ║
║  ══════════╪════════════════╪═════════════════╪══════════════╪════════════            ║
║            ▼                ▼                 ▼              ▼         n8n            ║
║  ┌─────────────────────────────────────────────────────────────────────┐              ║
║  │                      n8n WORKFLOW ENGINE                             │              ║
║  │  ┌──────────────────────────────────────────────────────────────┐   │              ║
║  │  │ WB-01: WhatsApp Intake + AI Router                           │   │              ║
║  │  │   WhatsApp Trigger → AI Classify → Switch → 3 paths          │   │              ║
║  │  │     Path A: WB-XXXXX → Execute WF-05 (Status Check)         │   │              ║
║  │  │     Path B: 1-5 digit → Execute WF-06 (Rating)              │   │              ║
║  │  │     Path C: New complaint → AI Process → POST webhook        │   │              ║
║  │  └──────────────────────────────────────────────────────────────┘   │              ║
║  │  ┌──────────────────────────────────────────────────────────────┐   │              ║
║  │  │ WB-02: Smart Auto-Assignment                                 │   │              ║
║  │  │   Execute Trigger → Supabase Query → AI Match → Assign       │   │              ║
║  │  └──────────────────────────────────────────────────────────────┘   │              ║
║  │  ┌──────────────────────────────────────────────────────────────┐   │              ║
║  │  │ WB-03: Dual Notification Engine (Citizen + Officer)          │   │              ║
║  │  │   Webhook ×2 → Switch (6 sources) → Format → Batch Send     │   │              ║
║  │  └──────────────────────────────────────────────────────────────┘   │              ║
║  │  ┌────────────────────┐  ┌────────────────────┐                  │              ║
║  │  │ WB-05: Status Check │  │ WB-06: Rating       │                  │              ║
║  │  │ Execute Trigger     │  │ Execute Trigger     │                  │              ║
║  │  │ → Supabase → Reply  │  │ → Validate → Update │                  │              ║
║  │  └────────────────────┘  └────────────────────┘                  │              ║
║  │  ┌────────────────────┐  ┌────────────────────┐                  │              ║
║  │  │ WB-07: SLA Monitor │  │ WB-08: Daily Report│                  │              ║
║  │  │ Cron: */2h         │  │ Cron: 9AM IST      │                  │              ║
║  │  │ → Breach Detect    │  │ → Stats → Send     │                  │              ║
║  │  │ → Escalate         │  │ → Admin WA         │                  │              ║
║  │  └────────────────────┘  └────────────────────┘                  │              ║
║  │  ┌──────────────────────────────────────────────────────────────┐   │              ║
║  │  │ WB-09: Global Error Handler (Error Trigger)                 │   │              ║
║  │  │   Catches ALL workflow failures → Log → Admin Alert          │   │              ║
║  │  └──────────────────────────────────────────────────────────────┘   │              ║
║  └───────────┬──────────────────────┬──────────────────────────────────┘              ║
║              │ Supabase REST API    │ HTTP (Next.js API)                            ║
║              │ (service_role key)   │ (fire-and-forget webhooks)                    ║
║              ▼                      ▼                                                   ║
║  ┌──────────────────────────────────────────────────────────────────────┐              ║
║  │                    NEXT.JS APP (Vercel)                              │              ║
║  │                                                                       │              ║
║  │  ┌──────────── 39 API ROUTES ─────────────────────────────────────┐ │              ║
║  │  │ Auth (3) │ Complaints (12) │ n8n (9) │ AI (3) │ Dashboard (4) │ │              ║
║  │  │ Users (4) │ Integrations (5) │ Other (5) │ Webhook (1)         │ │              ║
║  │  └─────────────────────────────────────────────────────────────────┘ │              ║
║  │                                                                       │              ║
║  │  ┌──────────── FRONTEND (SPA) ────────────────────────────────────┐ │              ║
║  │  │ page.tsx (900 lines) → useState<ViewType> routing              │ │              ║
║  │  │ 12 Views: Dashboard, Complaints, Analytics, Live Data,         │ │              ║
║  │  │   N8N, Users, Audit, Settings, Integrations, Deployment...     │ │              ║
║  │  │ Zustand: useAuthStore (JWT) + useI18nStore (en/bn)             │ │              ║
║  │  │ 22 Custom Components + 50+ shadcn/ui primitives                │ │              ║
║  │  └─────────────────────────────────────────────────────────────────┘ │              ║
║  └───────────────────────────┬──────────────────────────────────────────┘              ║
║                              │                                                             ║
║  ┌───────────────────────────▼──────────────────────────────────────────┐              ║
║  │                    DATABASE LAYER                                     │              ║
║  │                                                                       │              ║
║  │  3-Mode Adapter (db.ts):                                             │              ║
║  │    Mode 1: Supabase REST (SupabaseModelAdapter — 660 lines)          │              ║
║  │    Mode 2: Prisma PostgreSQL (PgBouncer)                              │              ║
║  │    Mode 3: Prisma SQLite (local dev)                                 │              ║
║  │                                                                       │              ║
║  │  ┌─────────────────────────────────────────────────────────────────┐ │              ║
║  │  │              SUPABASE POSTGRESQL                                 │ │              ║
║  │  │  ┌────────┐ ┌───────────┐ ┌──────────────┐ ┌─────────┐ ┌────┐ │ │              ║
║  │  │  │ users  │ │complaints │ │ activity_logs │ │comments │ │fdbk│ │ │              ║
║  │  │  │ 16 cols│ │ 27 cols   │ │ 8 cols       │ │ 5 cols  │ │7col│ │ │              ║
║  │  │  │ username│ │ ticketNo  │ │ complaintId  │ │complaint│ │    │ │ │              ║
║  │  │  │ ★unique│ │ ★unique   │ │ FK cascade   │ │ FK casc │ │    │ │ │              ║
║  │  │  └────────┘ └───────────┘ └──────────────┘ └─────────┘ └────┘ │ │              ║
║  │  │  + 2 VIEWS: complaint_stats, sla_at_risk                       │ │              ║
║  │  └─────────────────────────────────────────────────────────────────┘ │              ║
║  └──────────────────────────────────────────────────────────────────────┘              ║
║                                                                                       ║
║  ┌─────────── EXTERNAL SERVICES ────────────────────────────────────────┐              ║
║  │ Supabase │ Meta WhatsApp │ z-ai-web-dev-sdk │ Airtable │ n8n MCP    │              ║
║  └──────────────────────────────────────────────────────────────────────┘              ║
╚══════════════════════════════════════════════════════════════════════════════════════╝
```

## 1.2 Complete User Journey Map

### Journey 1: Citizen Files Complaint via WhatsApp
```
Citizen → WhatsApp "No water in my area for 3 days"
  → Meta Cloud API → n8n WB-01 (WhatsApp Trigger)
  → AI Classification (category, urgency, sentiment)
  → POST /api/webhook/complaint (Next.js)
  → Ticket WB-01001 created in Supabase
  → Citizen receives: "✅ অভিযোগ নিবন্ধন সফল! Ticket: WB-01001"
  → n8n calls WB-02 (Auto-Assign)
  → Block Officer found → complaint.assignedToId set
  → Citizen receives: "📋 Officer Amit assigned"
  → Officer receives: "🔔 New Complaint WB-01001"
```

### Journey 2: Officer Manages Complaint in Portal
```
Officer logs in (JWT) → DashboardView → ComplaintsView
  → Opens ComplaintDetailDialog
  → Changes status OPEN → IN_PROGRESS
  → Next.js PATCH /api/complaints/[id]
  → Activity log created
  → n8n cascade: POST /wb-notify-citizen → WB-03
  → Citizen receives: "🔄 স্ট্যাটাস আপডেট: IN_PROGRESS"
  → Officer adds resolution → marks RESOLVED
  → resolvedAt set automatically
  → Citizen receives: "✅ সমাধান! Rate 1-5"
  → Citizen replies "4"
  → n8n WB-01 routes to WB-06
  → satisfactionRating = 4 in Supabase
  → "🙏 ধন্যবাদ! ⭐ 4/5 rating received"
```

### Journey 3: Admin Reviews Analytics
```
Admin logs in → AnalyticsView
  → Category chart, District chart, Urgency distribution, Monthly trend
  → Live Data Monitor → real-time activity feed
  → N8NWorkflowsView → see all workflow statuses
  → AuditLogView → full activity timeline
  → UserManagementView → add/edit officers
```

### Journey 4: SLA Breach Automated Escalation
```
Cron triggers WB-07 every 2 hours
  → Query Supabase: breached complaints (status IN (OPEN, IN_PROGRESS))
  → POST /api/complaints/escalate-batch
  → Next.js: escalate urgency, log activity
  → n8n cascade: notify citizen + notify officer
  → Admin receives breach summary report via WhatsApp
```

## 1.3 All Entry Points Identified

| # | Entry Point | Trigger | Auth | Target |
|---|-------------|---------|------|--------|
| 1 | WhatsApp message | Meta webhook → n8n WB-01 | None | n8n → Next.js API |
| 2 | Web portal login | POST /api/auth/login | None | JWT token |
| 3 | Web portal dashboard | Browser → DashboardView | JWT | Next.js SSR |
| 4 | Web ticket tracker | TicketTrackerDialog | None | GET /api/ticket/[no] |
| 5 | Web feedback form | FeedbackDialog | None | POST /api/feedback |
| 6 | Airtable webhook | POST /api/integrations/airtable-webhook | None | Sync to Supabase |
| 7 | SLA cron | n8n Schedule Trigger | None | WB-07 → Next.js API |
| 8 | Daily report cron | n8n Schedule Trigger | None | WB-08 → Next.js API |
| 9 | Status check WA | Citizen sends WB-XXXXX | None | WB-01 → WB-05 |
| 10 | Rating WA | Citizen sends 1-5 | None | WB-01 → WB-06 |
| 11 | Test webhook | POST /api/integrations/test-webhook | None | Creates test data |

## 1.4 End-to-End Data Flow

```
╔═════════════════════════════════════════════════════════════════════════╗
║                     COMPLETE DATA FLOW MAP                               ║
╠═════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  INGESTION LAYER                                                         ║
║  ─────────────────                                                       ║
║  WhatsApp ──► n8n WB-01 ──► Next.js /api/webhook/complaint               ║
║  Web Portal ──► Next.js /api/complaints                                  ║
║  Airtable ──► Next.js /api/integrations/airtable-webhook                  ║
║                                                                          ║
║  PROCESSING LAYER                                                        ║
║  ─────────────────                                                       ║
║  Complaint Created ──► AI Analysis (z-ai-web-dev-sdk)                    ║
║                    ──► Ticket No Generation (WB-XXXXX)                   ║
║                    ──► Auto-Assignment (n8n WB-02)                       ║
║                    ──► Activity Log (CREATED)                            ║
║                    ──► Citizen Notification (n8n WB-03)                  ║
║                    ──► Officer Notification (n8n WB-03)                  ║
║                                                                          ║
║  LIFECYCLE LAYER                                                         ║
║  ─────────────────                                                       ║
║  Status Change ──► Activity Log ──► n8n Notification                     ║
║  Comment Added ──► Activity Log ──► (optional notification)              ║
║  Urgency Escalation ──► Activity Log ──► n8n Cascade                    ║
║  Resolution ──► resolvedAt ──► Rating Prompt ──► satisfactionRating      ║
║                                                                          ║
║  MONITORING LAYER                                                        ║
║  ─────────────────                                                       ║
║  SLA Check (*/2h) ──► Breach Detection ──► Escalation ──► Notification   ║
║  Daily Report (9AM) ──► Stats Aggregation ──► Admin WhatsApp             ║
║  Dashboard API ──► KPI Computation ──► Charts                           ║
║                                                                          ║
║  OUTPUT LAYER                                                            ║
║  ─────────────────                                                       ║
║  WhatsApp Send ──► Citizen/Officer messages (Bengali + English)          ║
║  Web Portal ──► Dashboard, Analytics, Reports                            ║
║  CSV Export ──► Downloadable spreadsheet                                 ║
║  Airtable Sync ──► Bidirectional data replication                        ║
║                                                                          ║
╚═════════════════════════════════════════════════════════════════════════╝
```

---

# PHASE 2: WORKFLOW PLANNING

## 2.1 Workflow Categorization (8 Workflows)

| Category | Workflow ID | Name | Trigger Type | Priority |
|----------|-------------|------|-------------|----------|
| **Data Ingestion** | WB-01 | WhatsApp Intake + AI Router | WhatsApp Trigger | 🔴 Critical |
| **Data Processing** | WB-02 | Smart Auto-Assignment | Execute Workflow Trigger | 🔴 Critical |
| **Notifications** | WB-03 | Dual Notification Engine | 2 Webhooks | 🔴 Critical |
| **Data Processing** | WB-05 | Status Check by Ticket | Execute Workflow Trigger | 🟡 High |
| **Data Processing** | WB-06 | Rating Collection | Execute Workflow Trigger | 🟡 High |
| **Monitoring** | WB-07 | SLA Breach Escalation | Cron (*/2h) | 🔴 Critical |
| **Reporting** | WB-08 | Daily Report | Cron (9AM IST) | 🟢 Medium |
| **Error Handling** | WB-09 | Global Error Handler | Error Trigger | 🟡 High |

**Why 8, not 7?** v2/v3 had 7 workflows (WB-04 merged into WB-03). v4 adds **WB-09** — a dedicated Error Trigger workflow that catches failures from ALL other workflows. This is mandatory for production reliability.

## 2.2 Workflow Dependency Graph

```
                    ┌──────────────┐
                    │  WB-01       │ (WhatsApp Trigger — Entry Point)
                    │  Intake+AI   │
                    └──┬───┬───┬──┘
                       │   │   │
            ┌──────────┘   │   └──────────┐
            ▼              ▼              ▼
     ┌─────────────┐ ┌──────────┐  ┌──────────────┐
     │ WB-05       │ │ WB-06    │  │ POST /webhook│
     │ Status Check│ │ Rating   │  │ /complaint   │
     │ (independent)│ │(indep.) │  │    │         │
     └─────────────┘ └──────────┘  │    ▼         │
                                   │ Next.js API  │
                                   │    │         │
                                   │    ▼         │
                                   │ n8n cascade  │
                                   │    │         │
                                   │    ▼         │
                            ┌──────┴──────┐      │
                            │  WB-02      │      │
                            │  Auto-Assign│      │
                            └──────┬──────┘      │
                                   │             │
                                   ▼             │
                            ┌──────────────┐     │
                            │  WB-03       │◄────┘
                            │  Notifications│◄─── All status/escalation events
                            └──────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
             ┌──────────┐  ┌────────────┐  ┌──────────┐
             │ Citizen  │  │ Officer    │  │ WB-09    │
             │ WhatsApp │  │ WhatsApp   │  │ Errors   │
             └──────────┘  └────────────┘  └──────────┘

     ┌────────────────┐  ┌────────────────┐
     │ WB-07          │  │ WB-08          │
     │ SLA (*/2h)     │  │ Daily (9AM)    │
     │ Independent    │  │ Independent    │
     └────────────────┘  └────────────────┘
```

## 2.3 Workflow Interaction Matrix

| Caller | Target | Method | Payload | Response Expected |
|--------|--------|--------|---------|-------------------|
| WB-01 | WB-05 | Execute Sub-workflow | `{ ticketNo, phone }` | Status text |
| WB-01 | WB-06 | Execute Sub-workflow | `{ phone, rating }` | Confirmation |
| WB-01 | Next.js | HTTP POST | Complaint body | `{ ticketNo, id }` |
| Next.js | WB-02 | HTTP POST webhook | `{ complaintId, block, ... }` | 200 OK |
| Next.js | WB-03 | HTTP POST webhook (×2) | Citizen/officer payload | 200 OK |
| WB-07 | Next.js | HTTP POST | Breached complaints | `{ summary }` |
| WB-08 | Next.js | HTTP GET | — | Stats JSON |
| WB-09 | Admin WA | WhatsApp Send | Error details | — |
| Any WF Error | WB-09 | Error Trigger (auto) | Error context | Alert |

---

# PHASE 3: ADVANCED WORKFLOW DESIGN

## 3.1 WB-01: WhatsApp Intake + AI Router

### Trigger
```yaml
Node: WhatsApp Trigger (n8n-nodes-base.whatsAppTrigger, v1)
Credential: whatsAppTriggerApi → newCredential('WhatsApp Business Account')
Output: { contacts: [{ wa_id, profile: { name } }], messages: [{ from, text: { body } }] }
```

### Node-by-Node Flow (11 nodes)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  WB-01: WhatsApp Intake + AI Router                                               │
│                                                                                    │
│  [1] WhatsApp Trigger                                                              │
│       │                                                                            │
│       ▼                                                                            │
│  [2] Code: Parse Message + Detect Intent                                           │
│       │  Extract: phone, waId, text, contactName                                   │
│       │  Regex match: /WB-\d{5}/i → status_check                                  │
│       │  Regex match: /^[1-5]$/ → rating                                          │
│       │  Else → new_complaint                                                      │
│       │                                                                            │
│       ▼                                                                            │
│  [3] Switch: messageType                                                           │
│       │                                                                            │
│       ├── Case 0: status_check ─────────────────────────────────────────────┐      │
│       │     │                                                                │      │
│       │     ▼                                                                │      │
│       │  [4] Execute Sub-workflow: WB-05 (Status Check)                      │      │
│       │       Returns status text → end                                       │      │
│       │                                                                        │      │
│       ├── Case 1: rating ─────────────────────────────────────────────────┐      │
│       │     │                                                             │      │
│       │     ▼                                                             │      │
│       │  [5] Execute Sub-workflow: WB-06 (Rating Collection)              │      │
│       │       Returns confirmation → end                                   │      │
│       │                                                                   │      │
│       └── Case 2: new_complaint                                            │      │
│             │                                                              │      │
│             ▼                                                              │      │
│       [6] HTTP Request: POST /api/ai/process-complaint                     │      │
│             │  Body: { text: "<message>" }                                  │      │
│             │  Response: { category, urgency, sentiment, summary,          │      │
│             │             language, keywords }                              │      │
│             ▼                                                              │      │
│       [7] Set: Normalize Complaint Data                                     │      │
│             │  citizenName, phone, issue, category,                        │      │
│             │  urgency, block, district, language                          │      │
│             │  (AI may not return all fields — use defaults)                │      │
│             ▼                                                              │      │
│       [8] IF: Has required fields? (issue + category)                       │      │
│             │                                                              │      │
│             ├── TRUE ──────────────────────────────────────────┐           │      │
│             │     │                                            │           │      │
│             │     ▼                                            │           │      │
│             │  [9] HTTP Request: POST /api/webhook/complaint   │           │      │
│             │       Body: { citizenName, phone, issue,         │           │      │
│             │              category, block, district, urgency,  │           │      │
│             │              village, description, language }    │           │      │
│             │       Response: { success, ticketNo, id }        │           │      │
│             │     │                                            │           │      │
│             │     ▼                                            │           │      │
│             │  [10] IF: success?                                │           │      │
│             │       │                                          │           │      │
│             │       ├── TRUE                                   │           │      │
│             │       │     ▼                                    │           │      │
│             │       │  [11] WhatsApp: Send Confirmation         │           │      │
│             │       │    "✅ অভিযোগ নিবন্ধন সফল!                 │           │      │
│             │       │     Ticket: {{ ticketNo }}                │           │      │
│             │       │     Category: {{ category }}              │           │      │
│             │       │     স্ট্যাটাস: WB-XXXXX লিখে পাঠান"        │           │      │
│             │       │     │                                    │           │      │
│             │       │     ▼                                    │           │      │
│             │       │  [12] Execute Sub-workflow: WB-02         │           │      │
│             │       │    (Auto-assign officer)                  │           │      │
│             │       │                                          │           │      │
│             │       └── FALSE                                 │           │      │
│             │             ▼                                    │           │      │
│             │       [13] WhatsApp: Send Error                  │           │      │
│             │            "❌ ত্রুটি হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন" │           │      │
│             │                                                  │           │      │
│             └── FALSE ────────────────────────────────────────┐           │      │
│                   ▼                                           │           │      │
│             [14] WhatsApp: Send Clarification Prompt           │           │      │
│                "অনুগ্রহ করে আপনার অভিযোগের                    │           │      │
│                 বিষয়, বিভাগ, ব্লক, জেলা উল্লেখ করুন।        │           │      │
│                 Please mention: issue, category, block,        │           │      │
│                 district"                                      │           │      │
│                                                                │           │      │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### Error Handling
- [6] AI call timeout (15s) → Fallback to category="Other", urgency="MEDIUM"
- [9] Webhook call timeout (10s) → Retry once, then send error WA message
- [11/13/14] WA send failure → Log error, no retry (Meta handles delivery)

---

## 3.2 WB-02: Smart Auto-Assignment

### Trigger
```yaml
Node: Execute Workflow Trigger (n8n-nodes-base.executeWorkflowTrigger, v1.1)
Called from: WB-01 after complaint creation
Input: { complaintId, issue, category, block, district, urgency }
```

### Node-by-Node Flow (8 nodes)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  WB-02: Smart Auto-Assignment                                               │
│                                                                               │
│  [1] Execute Workflow Trigger                                                 │
│       │  Input: { complaintId, issue, category, block, district, urgency }   │
│       ▼                                                                       │
│  [2] HTTP Request: GET Supabase users                                        │
│       │  URL: /rest/v1/users                                                │
│       │  Query: role=eq.BLOCK, block=eq.{{block}}, isActive=eq.true         │
│       │  Select: id, name, block, whatsappPhone, notifyVia                  │
│       ▼                                                                       │
│  [3] IF: Officers found?                                                     │
│       │                                                                       │
│       ├── TRUE                                                               │
│       │     │                                                                 │
│       │     ▼                                                                 │
│       │  [4] Code: Select Best Officer                                       │
│       │     │  Logic:                                                        │
│       │     │  1. Sort by least active complaints (need sub-query)           │
│       │     │  2. Prefer officers with matching category experience         │
│       │     │  3. Fallback: random selection from available                 │
│       │     │  Output: { officerId, officerName, officerPhone }             │
│       │     │                                                                 │
│       │     ▼                                                                 │
│       │  [5] HTTP Request: PATCH Supabase complaints                         │
│       │     │  URL: /rest/v1/complaints?id=eq.{{complaintId}}               │
│       │     │  Body: { assignedToId, assignedOfficerName, status: OPEN }    │
│       │     │                                                                 │
│       │     ▼                                                                 │
│       │  [6] HTTP Request: POST Supabase activity_logs                       │
│       │     │  Body: { complaintId, action: "ASSIGNED",                     │
│       │     │         description: "Assigned to {{officerName}}",           │
│       │     │         actorId: officerId, actorName: officerName }          │
│       │     │                                                                 │
│       │     ▼                                                                 │
│       │  [7] WhatsApp: Send Assignment Confirmation to Citizen              │
│       │     "📋 অভিজ্ঞতা আপডেট | Update on Your Complaint                    │
│       │      Ticket: {{ ticketNo }}                                          │
│       │      Officer: {{ officerName }}                                      │
│       │      Block: {{ block }}"                                             │
│       │     │                                                                 │
│       │     ▼                                                                 │
│       │  [8] WhatsApp: Send New Complaint Alert to Officer                   │
│       │     "🔔 নতুন অভিযোগ নিয়োগ | New Complaint Assigned                 │
│       │      Ticket: {{ ticketNo }}                                          │
│       │      Issue: {{ issue }}                                              │
│       │      Category: {{ category }}                                        │
│       │      Urgency: {{ urgency }}                                          │
│       │      Citizen: {{ citizenName }} ({{ phone }})                        │
│       │      অনুগ্রহ করে শীঘ্র ব্যবস্থা নিন।"                               │
│       │                                                                       │
│       └── FALSE                                                              │
│             │                                                                 │
│             ▼                                                                 │
│       [9] Code: Prepare Admin Alert                                          │
│             │  Output: { message: "⚠️ No officer found for                  │
│             │    block={{block}}, district={{district}}.                     │
│             │    Complaint {{ complaintId }} needs manual assignment." }     │
│             ▼                                                                 │
│       [10] HTTP Request: GET Supabase users (Admin)                          │
│             │  Query: role=eq.ADMIN, isActive=eq.true                       │
│             ▼                                                                 │
│       [11] Loop Over Items + WhatsApp: Send Admin Alert                      │
│             "⚠️ UNASSIGNED COMPLAINT                                         │
│              No BLOCK officer found for: {{ block }}, {{ district }}          │
│              Complaint: {{ complaintId }}                                     │
│              Manual assignment required."                                     │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3.3 WB-03: Dual Notification Engine

### Trigger
```yaml
Node 1: Webhook (POST /wb-notify-citizen) — citizen notifications
Node 2: Webhook (POST /wb-notify-officer) — officer notifications
Method: Multiple Triggers in single workflow
```

### Node-by-Node Flow (14 nodes)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  WB-03: Dual Notification Engine                                              │
│                                                                                 │
│  ═══ CITIZEN NOTIFICATION PATH ═══                                             │
│                                                                                 │
│  [T1] Webhook: /wb-notify-citizen                                              │
│        │  Input: { complaintId, status, timestamp, source }                    │
│        │  OR: { type: "sla_batch", complaints: [...], source }                 │
│        ▼                                                                        │
│  [1] Switch: source                                                            │
│        │                                                                        │
│        ├── Case 0: status_change ────────────────────────────────────┐         │
│        │     │                                                        │         │
│        │     ▼                                                        │         │
│        │  [2] HTTP Request: GET Supabase complaints                   │         │
│        │     │  Query: id=eq.{{complaintId}}                          │         │
│        │     │  Select: ticketNo, phone, issue, status, resolution,   │         │
│        │     │          urgency, category, block, district            │         │
│        │     ▼                                                        │         │
│        │  [3] IF: Phone exists?                                       │         │
│        │     │                                                        │         │
│        │     ├── TRUE                                                 │         │
│        │     │     ▼                                                  │         │
│        │     │  [4] Code: Format Citizen Message                      │         │
│        │     │     │  Switch on status:                               │         │
│        │     │     │   OPEN → Acknowledgment                          │         │
│        │     │     │   IN_PROGRESS → Work started                     │         │
│        │     │     │   RESOLVED → Resolved + Rating prompt (1-5)      │         │
│        │     │     │   REJECTED → Rejection notice                    │         │
│        │     │     ▼                                                  │         │
│        │     │  [5] WhatsApp: Send to Citizen                         │         │
│        │     │                                                        │         │
│        │     └── FALSE → NoOp (silent)                                 │         │
│        │                                                              │         │
│        └── Case 1: sla_breach_batch ───────────────────────────┐      │         │
│              │                                                   │      │         │
│              ▼                                                   │      │         │
│        [6] Code: Extract phones from batch                       │      │         │
│              │  complaints[].citizenPhone → [{ phone, ticketNo, │      │         │
│              │   riskLevel }]                                    │      │         │
│              ▼                                                   │      │         │
│        [7] Loop Over Items (Split in Batches, batchSize: 10)     │      │         │
│              │                                                   │      │         │
│              ▼                                                   │      │         │
│        [8] IF: Phone exists?                                     │      │         │
│              │                                                   │      │         │
│              ├── TRUE                                            │      │         │
│              │     ▼                                             │      │         │
│              │  [9] WhatsApp: Send SLA Breach Notice              │      │         │
│              │     "⚠️ SLA লঙ্ঘন | Ticket: {{ ticketNo }}"        │      │         │
│              │                                                   │      │         │
│              └── FALSE → Next Batch                              │      │         │
│                                                                 │         │
│  ═══ OFFICER NOTIFICATION PATH ═══                               │         │
│                                                                 │         │
│  [T2] Webhook: /wb-notify-officer                                │         │
│        │  Input: { complaintId, assignedToId, timestamp, source }│         │
│        │  OR: { complaintId, escalation: true, previousUrgency,  │         │
│        │        newUrgency, reason, source }                      │         │
│        ▼                                                         │         │
│  [10] Switch: source                                            │         │
│        │                                                         │         │
│        ├── Case 0: assignment ───────────────────────────┐       │         │
│        │     │                                             │       │         │
│        │     ▼                                             │       │         │
│        │  [11] Code: Build notification targets           │       │         │
│        │     │  Based on URGENCY_NOTIFICATION_MAP:        │       │         │
│        │     │   CRITICAL → Block + District + Head + Admin│       │         │
│        │     │   HIGH → Block + District                  │       │         │
│        │     │   MEDIUM/LOW → Block only                  │       │         │
│        │     │  Query Supabase users for each target      │       │         │
│        │     ▼                                             │       │         │
│        │  [12] Loop + WhatsApp: Send to each target       │       │         │
│        │     "🔔 নতুন অভিযোগ নিয়োগ | New Complaint"       │       │         │
│        │                                                    │       │         │
│        └── Case 1: urgency_escalation ────────────────┐     │       │         │
│              │                                         │     │       │         │
│              ▼                                         │     │       │         │
│        [13] Code: Build escalation targets             │     │       │         │
│              │  Same URGENCY_NOTIFICATION_MAP logic     │     │       │         │
│              ▼                                         │     │       │         │
│        [14] Loop + WhatsApp: Send escalation alert     │     │       │         │
│              "🚨 এসক্যালেশন সতর্কতা | Escalation Alert  │     │       │         │
│               Ticket: {{ ticketNo }}                  │     │       │         │
│               Urgency: {{ previous }} → {{ new }}"     │     │       │         │
│                                                          │       │         │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3.4 WB-05: Status Check by Ticket

### Trigger: Execute Workflow Trigger (from WB-01)
### Flow (5 nodes):
```
[1] Execute WF Trigger → [2] HTTP: GET Supabase complaints?ticketNo=eq.{{ticketNo}}
  → [3] IF: Found? → [4a] Code: Format Status → [5a] WA: Send Status
                   → [4b] WA: "❌ Ticket not found"
```

---

## 3.5 WB-06: Rating Collection

### Trigger: Execute Workflow Trigger (from WB-01)
### Flow (7 nodes):
```
[1] Execute WF Trigger → [2] IF: rating 1-5?
  → [3a] HTTP: GET Supabase complaints?phone=eq.{{phone}}&status=eq.RESOLVED&order=createdAt.desc&limit=1
    → [4a] IF: Found resolved complaint?
      → [5a] HTTP: PATCH complaints satisfactionRating={{rating}} → [6a] WA: "🙏 ধন্যবাদ! ⭐ {{rating}}/5"
      → [5b] WA: "No resolved complaint found for rating"
  → [3b] WA: "Invalid rating. Please reply 1-5"
```

---

## 3.6 WB-07: SLA Breach Escalation

### Trigger: Schedule Trigger (cron: `0 */2 * * *`, timezone: Asia/Kolkata)
### Flow (6 nodes):
```
[1] Schedule: Every 2 hours
  → [2] HTTP: GET Supabase sla_at_risk view (or direct query)
  → [3] IF: Has breached complaints?
    → [4a] HTTP: POST /api/complaints/escalate-batch { complaints: [...] }
      → [5a] IF: summary.total > 0?
        → [6a] HTTP: GET Supabase users (role=ADMIN)
          → [7a] Loop + WA: Send breach report to admins
        → [6b] NoOp
    → [4b] NoOp
```

---

## 3.7 WB-08: Daily Report

### Trigger: Schedule Trigger (cron: `0 9 * * *`, timezone: Asia/Kolkata)
### Flow (6 nodes):
```
[1] Schedule: Daily 9 AM IST
  → [2] HTTP: GET /api/n8n/stats
  → [3] Code: Format daily report
    │  Include: newToday, resolved, inProgress, open, breached, avgRating
  → [4] HTTP: GET Supabase users (role=eq.ADMIN&isActive=eq.true OR role=eq.DISTRICT&isDistrictHead=eq.true)
  → [5] Loop Over Items (Split in Batches, batchSize: 5)
  → [6] WhatsApp: Send formatted report
```

---

## 3.8 WB-09: Global Error Handler (NEW)

### Trigger: Error Trigger (n8n-nodes-base.errorTrigger, v1)
### Flow (4 nodes):
```
[1] Error Trigger → catches ALL workflow execution errors
  → [2] Code: Format error context
    │  Extract: workflow name, node name, error message, timestamp
  → [3] HTTP: POST Supabase activity_logs (log error for audit trail)
    │  Body: { action: "WORKFLOW_ERROR", description: "..." }
  → [4] WhatsApp: Send to admin
    │  "🚨 WORKFLOW ERROR
    │   Workflow: {{ workflowName }}
    │   Node: {{ nodeName }}
    │   Error: {{ errorMessage }}
    │   Time: {{ timestamp }}"
  → [5] IF: Critical error? (SLA/Assignment related)
    → [6] NoOp (add PagerDuty/Slack future integration)
```

---

# PHASE 4: SAAS ARCHITECTURE DESIGN

## 4.1 Multi-Tenant Architecture (Per-District Separation)

```
┌─────────────────────────────────────────────────────────────────┐
│                    MULTI-TENANT DESIGN                            │
│                                                                   │
│  Current: Flat single-tenant (all districts share one DB)        │
│  Target: Logical multi-tenancy via district_id partition key     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Tenant Isolation Strategy:                              │    │
│  │                                                           │    │
│  │  1. ROW-LEVEL SECURITY (RLS) on Supabase                 │    │
│  │     - complaints: WHERE district = current_user.district  │    │
│  │     - users: WHERE district = current_user.district       │    │
│  │     - BLOCK users see ONLY their block                    │    │
│  │     - DISTRICT users see ONLY their district              │    │
│  │     - ADMIN/STATE see ALL                                 │    │
│  │                                                           │    │
│  │  2. API-LEVEL FILTERING (already implemented)            │    │
│  │     - JWT payload includes: { role, block, district }     │    │
│  │     - Each API route applies role-based WHERE clause      │    │
│  │                                                           │    │
│  │  3. n8n SCOPING                                          │    │
│  │     - WB-02 assignment scoped by block + district         │    │
│  │     - WB-03 notifications scoped by urgency hierarchy     │    │
│  │     - WB-07/08 reports scoped by district                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Future Scale: Physical Multi-Tenancy                    │    │
│  │                                                           │    │
│  │  Option A: Supabase Projects per District                │    │
│  │    - Full isolation, separate billing                     │    │
│  │    - Complex to manage, higher cost                      │    │
│  │                                                           │    │
│  │  Option B: Schema-per-tenant in same cluster              │    │
│  │    - nadia.complaints, birbhum.complaints                │    │
│  │    - Medium isolation, shared resources                  │    │
│  │                                                           │    │
│  │  Option C: Row-Level Security (RECOMMENDED for v1-v3)    │    │
│  │    - Single schema, RLS policies for isolation           │    │
│  │    - Simplest to implement, good enough for <100K rows  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 4.2 Authentication & RBAC

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTH ARCHITECTURE                              │
│                                                                   │
│  Current: Custom JWT (HS256, jose library, 24h expiry)           │
│  Token storage: localStorage (frontend) + httpOnly cookie         │
│                                                                   │
│  ┌─────────────────────────────────────────────────────┐        │
│  │  Role Hierarchy (4 roles):                           │        │
│  │                                                       │        │
│  │  ADMIN ──────► Full system access                    │        │
│  │    ├── All complaints (read/write)                   │        │
│  │    ├── All users (CRUD)                              │        │
│  │    ├── All analytics/reports                         │        │
│  │    ├── n8n workflows management                      │        │
│  │    ├── Audit log access                              │        │
│  │    └── System configuration                          │        │
│  │                                                       │        │
│  │  STATE ──────► State-level oversight                  │        │
│  │    ├── All complaints (read-only)                    │        │
│  │    ├── Dashboard + analytics                         │        │
│  │    └── Audit log access                              │        │
│  │                                                       │        │
│  │  DISTRICT ───► District-level management             │        │
│  │    ├── District complaints (read/write)              │        │
│  │    ├── District dashboard/analytics                  │        │
│  │    └── Can escalate to CRITICAL                      │        │
│  │                                                       │        │
│  │  BLOCK ──────► Block-level operations                │        │
│  │    ├── Block complaints (read + create)              │        │
│  │    ├── Assigned complaints (update status/resolution)│        │
│  │    └── Comment on assigned complaints                │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                   │
│  ⚠️ IDENTIFIED GAPS:                                              │
│  1. No Next.js middleware.ts — auth checked per-route only       │
│  2. Hardcoded JWT fallback secret                                 │
│  3. Export endpoint exposes token in URL query string            │
│  4. No CSRF protection                                            │
│  5. 14+ public endpoints with NO authentication                  │
│                                                                   │
│  🔧 RECOMMENDED FIXES:                                            │
│  1. Add src/middleware.ts for global auth enforcement            │
│  2. Remove hardcoded JWT secret, require env var                 │
│  3. Move export token to Authorization header                     │
│  4. Add rate limiting (express-rate-limit or upstash/ratelimit)  │
│  5. Add HMAC signature validation for public webhooks            │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 4.3 Scalable Database Design

```
┌─────────────────────────────────────────────────────────────────┐
│                 DATABASE SCALABILITY PLAN                         │
│                                                                   │
│  CURRENT STATE:                                                   │
│  - 5 tables + 2 views in Supabase PostgreSQL                    │
│  - ~10-20 complaint records (dev)                                │
│  - 3-mode adapter (Supabase REST / Prisma PG / SQLite)          │
│                                                                   │
│  SCALABILITY CONCERNS (when data grows):                          │
│                                                                   │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ 1. Dashboard API fetches ALL complaints for KPIs    │        │
│  │    FIX: Use Supabase RPC functions for aggregation  │        │
│  │    Example: rpc/get_dashboard_stats()               │        │
│  │    - Single SQL query with COUNT, AVG, GROUP BY     │        │
│  │    - Returns pre-computed stats in <50ms            │        │
│  │                                                       │        │
│  │ 2. GroupBy in Supabase adapter is in-memory         │        │
│  │    FIX: Replace with SQL GROUP BY via RPC            │        │
│  │    or use Supabase views (complaint_stats, sla_at_risk)│       │
│  │                                                       │        │
│  │ 3. Weekly report fires 14 sequential DB queries     │        │
│  │    FIX: Single CTE query for daily trend             │        │
│  │    WITH daily AS (                                    │        │
│  │      SELECT DATE(created_at), COUNT(*), status       │        │
│  │      FROM complaints                                  │        │
│  │      WHERE created_at >= NOW() - INTERVAL '7 days'   │        │
│  │      GROUP BY DATE(created_at), status               │        │
│  │    ) SELECT * FROM daily ORDER BY date;              │        │
│  │                                                       │        │
│  │ 4. Ticket number race condition                      │        │
│  │    FIX: Use database SEQUENCE instead of COUNT()     │        │
│  │    CREATE SEQUENCE ticket_seq START 10001;           │        │
│  │    ticketNo = 'WB-' || LPAD(nextval('ticket_seq'), 5, '0')│    │
│  │                                                       │        │
│  │ 5. No connection pooling configured                  │        │
│  │    FIX: Enable Supavisor (Supabase built-in)         │        │
│  │    Already has PgBouncer support in db.ts             │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                   │
│  RECOMMENDED Supabase RPC Functions:                              │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ rpc/get_dashboard_stats(district?)                  │        │
│  │ rpc/get_weekly_report(district?)                    │        │
│  │ rpc/get_leaderboard(limit?, district?)              │        │
│  │ rpc/get_sla_breached_complaints()                   │        │
│  │ rpc/escalate_breach_complaints(ids[])               │        │
│  │ rpc/auto_assign_officer(complaint_id)               │        │
│  │ rpc/get_next_ticket_number()                        │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                   │
│  INDEX OPTIMIZATION:                                              │
│  - complaints: (status, createdAt) composite — for SLA queries   │
│  - complaints: (block, status) composite — for officer lists     │
│  - complaints: (phone, status) composite — for rating lookup     │
│  - activity_logs: (complaintId, createdAt) — already exists      │
│                                                                   │
│  VOLUME ESTIMATES:                                                │
│  ┌────────────────┬───────────┬──────────────┬───────────┐      │
│  │ Metric         │ Month 1   │ Month 6      │ Month 12  │      │
│  ├────────────────┼───────────┼──────────────┼───────────┤      │
│  │ Complaints     │ 500       │ 5,000        │ 50,000    │      │
│  │ Activity Logs  │ 2,000     │ 20,000       │ 200,000   │      │
│  │ Comments       │ 1,000     │ 10,000       │ 100,000   │      │
│  │ Users          │ 50        │ 200          │ 500       │      │
│  │ n8n executions │ 3,000     │ 30,000       │ 300,000   │      │
│  └────────────────┴───────────┴──────────────┴───────────┘      │
│                                                                   │
│  At 50K complaints, Supabase Free Tier (500MB) may be tight.     │
│  Recommend Pro Tier ($25/mo) with 8GB storage.                   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 4.4 API Design (Frontend ↔ Backend ↔ n8n)

```
┌─────────────────────────────────────────────────────────────────┐
│                    API ARCHITECTURE                               │
│                                                                   │
│  THREE API CONSUMERS:                                             │
│  1. Frontend (React SPA) — authenticated via JWT                 │
│  2. n8n Workflows — uses Supabase REST (service_role)            │
│  3. External (Airtable, Meta webhook) — public endpoints          │
│                                                                   │
│  API ROUTE CATEGORIES (39 total):                                 │
│  ┌─────────────────┬──────┬──────────────────────────────────┐  │
│  │ Category        │ Count│ Auth Requirement                  │  │
│  ├─────────────────┼──────┼──────────────────────────────────┤  │
│  │ Auth            │   3  │ Public login, JWT-protected me   │  │
│  │ Complaints      │  12  │ 9 JWT, 3 public (webhook/search)  │  │
│  │ n8n             │   9  │ All public (called from n8n)      │  │
│  │ AI              │   3  │ All public (no auth)              │  │
│  │ Integration     │   5  │ All public (Airtable, test)       │  │
│  │ Dashboard       │   4  │ 3 JWT, 1 public (health)          │  │
│  │ Users           │   4  │ All JWT/Admin                     │  │
│  │ Other           │   5  │ Mixed                             │  │
│  └─────────────────┴──────┴──────────────────────────────────┘  │
│                                                                   │
│  ⚠️ SECURITY CONCERN: 14+ public endpoints!                      │
│  n8n endpoints are INTENTIONALLY public (called from n8n server) │
│  BUT they need IP whitelist or HMAC signature validation.         │
│                                                                   │
│  🔧 RECOMMENDED:                                                  │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ PUBLIC ENDPOINT PROTECTION STRATEGY:                 │        │
│  │                                                       │        │
│  │ 1. HMAC Signature for n8n webhooks:                  │        │
│  │    n8n → POST /wb-notify-citizen                      │        │
│  │    Header: X-N8N-Signature = HMAC(body, SHARED_KEY)  │        │
│  │    Next.js: Verify signature before processing        │        │
│  │                                                       │        │
│  │ 2. IP whitelist for n8n endpoints:                    │        │
│  │    const ALLOWED_IPS = ['n8n-server-ip'];             │        │
│  │    Applied via middleware.ts                          │        │
│  │                                                       │        │
│  │ 3. Rate limiting on public endpoints:                 │        │
│  │    /api/webhook/complaint → 10/min per IP            │        │
│  │    /api/complaints/search → 30/min per IP            │        │
│  │    /api/feedback → 5/min per IP                      │        │
│  │                                                       │        │
│  │ 4. Request size limits:                              │        │
│  │    Webhook body: max 10KB                            │        │
│  │    Comment: max 2000 chars (already enforced)         │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

# PHASE 5: AI + AUTOMATION LAYER

## 5.1 AI Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI AUTOMATION LAYER                            │
│                                                                   │
│  AI PROVIDER: z-ai-web-dev-sdk (backend)                         │
│                                                                   │
│  ┌─────────────────────────────────────────────────────┐        │
│  │  AI USE CASES IN THE SYSTEM:                         │        │
│  │                                                       │        │
│  │  ┌──────────────────────────────────────────────┐   │        │
│  │  │ 1. COMPLAINT CLASSIFICATION (WB-01 → AI API)│   │        │
│  │  │    Input: Raw WhatsApp text                   │   │        │
│  │  │    Output: {                                  │   │        │
│  │  │      category: "Water Supply",                │   │        │
│  │  │      urgency: "HIGH",                         │   │        │
│  │  │      sentiment: "negative",                   │   │        │
│  │  │      summary: "No water for 3 days",          │   │        │
│  │  │      language: "bn",                          │   │        │
│  │  │      keywords: ["water", "supply", "3 days"]  │   │        │
│  │  │      department: "Public Health Engineering"   │   │        │
│  │  │    }                                          │   │        │
│  │  │    Model: z-ai-web-dev-sdk LLM                │   │        │
│  │  │    Timeout: 15 seconds                        │   │        │
│  │  │    Fallback: category="Other", urgency="MEDIUM"│  │        │
│  │  └──────────────────────────────────────────────┘   │        │
│  │                                                       │        │
│  │  ┌──────────────────────────────────────────────┐   │        │
│  │  │ 2. SMART REPLY GENERATION                     │   │        │
│  │  │    Input: Complaint + status change context   │   │        │
│  │  │    Output: Bilingual (EN + BN) reply text     │   │        │
│  │  │    Used by: WB-03 (notification formatting)   │   │        │
│  │  │    Currently: Template-based (not AI)         │   │        │
│  │  │    Enhancement: AI-generated empathetic reply │   │        │
│  │  └──────────────────────────────────────────────┘   │        │
│  │                                                       │        │
│  │  ┌──────────────────────────────────────────────┐   │        │
│  │  │ 3. DUPLICATE DETECTION                        │   │        │
│  │  │    Input: New complaint text + phone          │   │        │
│  │  │    Logic: Search recent complaints (30 days)  │   │        │
│  │  │    by same phone, similar issue text          │   │        │
│  │  │    Enhancement: AI similarity scoring         │   │        │
│  │  │    Threshold: 0.85 → flag as duplicate       │   │        │
│  │  └──────────────────────────────────────────────┘   │        │
│  │                                                       │        │
│  │  ┌──────────────────────────────────────────────┐   │        │
│  │  │ 4. PRIORITY INTELLIGENCE                      │   │        │
│  │  │    Input: Full complaint context              │   │        │
│  │  │    Output: Refined urgency based on:          │   │        │
│  │  │      - Keywords ("emergency", "danger")       │   │        │
│  │  │      - Sentiment analysis                     │   │        │
│  │  │      - Historical resolution time for similar │   │        │
│  │  │      - Number of affected people              │   │        │
│  │  └──────────────────────────────────────────────┘   │        │
│  │                                                       │        │
│  │  ┌──────────────────────────────────────────────┐   │        │
│  │  │ 5. OFFICER MATCHING (WB-02 Enhancement)      │   │        │
│  │  │    Current: Round-robin by least active       │   │        │
│  │  │    Enhancement: AI matching based on:         │   │        │
│  │  │      - Historical category expertise          │   │        │
│  │  │      - Resolution success rate                │   │        │
│  │  │      - Current workload balance               │   │        │
│  │  │      - Geographic proximity                   │   │        │
│  │  └──────────────────────────────────────────────┘   │        │
│  │                                                       │        │
│  │  ┌──────────────────────────────────────────────┐   │        │
│  │  │ 6. BULK CATEGORIZATION (Current: MOCK)       │   │        │
│  │  │    Status: Returns random data, not real AI   │   │        │
│  │  │    Fix: Implement real z-ai-web-dev-sdk calls │   │        │
│  │  └──────────────────────────────────────────────┘   │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                   │
│  ┌─────────────────────────────────────────────────────┐        │
│  │  n8n AI NODES AVAILABLE:                             │        │
│  │                                                       │        │
│  │  - @n8n/n8n-nodes-langchain.agent (v3.1)            │        │
│  │    Full AI agent with tool calling capability       │        │
│  │    Can use: OpenAI, Anthropic, DeepSeek, Mistral    │        │
│  │                                                       │        │
│  │  - @n8n/n8n-nodes-langchain.lmChatOpenAi (v1.3)    │        │
│  │    Direct LLM chat completion                       │        │
│  │                                                       │        │
│  │  - @n8n/n8n-nodes-langchain.outputParserStructured  │        │
│  │    Force JSON schema output from LLM                │        │
│  │    PERFECT for: complaint classification            │        │
│  │                                                       │        │
│  │  - n8n-nodes-base.aiTransform (v1)                  │        │
│  │    "Modify data based on plain English instructions" │        │
│  │                                                       │        │
│  │  DECISION: Use Next.js AI API (z-ai-web-dev-sdk)    │        │
│  │  for classification (already implemented).           │        │
│  │  Add n8n AI Agent for future conversational AI.     │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 5.2 Prompt Design for Complaint Classification

```
SYSTEM PROMPT (for z-ai-web-dev-sdk):
──────────────────────────────────────
You are a West Bengal government grievance classification AI.
Classify citizen complaints into the EXACT category and urgency level.

CATEGORIES (choose ONE):
- Water Supply | Road Damage | Electricity | Sanitation | Healthcare
- Education | Public Transport | Agriculture | Housing | Other

URGENCY LEVELS:
- CRITICAL: Life-threatening, affects many people, emergency
- HIGH: Affects daily life significantly, needs quick action
- MEDIUM: Moderate inconvenience, standard processing
- LOW: Minor issue, routine processing

RESPOND IN JSON ONLY:
{
  "category": "<exact category name>",
  "urgency": "<CRITICAL|HIGH|MEDIUM|LOW>",
  "sentiment": "<positive|neutral|negative>",
  "summary": "<brief 1-line English summary>",
  "language": "<bn|en|hi>",
  "keywords": ["<key1>", "<key2>"],
  "suggested_block": "<block name or null>",
  "suggested_district": "<district name or null>"
}

COMPLAINT TEXT: {{ text }}
──────────────────────────────────────
```

---

# PHASE 6: DATA PIPELINE & RELIABILITY

## 6.1 Data Validation at Every Critical Step

```
┌─────────────────────────────────────────────────────────────────┐
│               VALIDATION CHECKPOINTS                             │
│                                                                   │
│  ┌─ INGESTION ──────────────────────────────────────────────┐  │
│  │                                                             │  │
│  │  [V1] WhatsApp Message (WB-01)                             │  │
│  │    ✓ Phone format: /^91\d{10}$/ or /^\d{10}$/            │  │
│  │    ✓ Text not empty, max 2000 chars                        │  │
│  │    ✓ Language detection (bn/en/hi)                         │  │
│  │    ✓ Spam detection (repeated messages, known spam)        │  │
│  │                                                             │  │
│  │  [V2] Web Complaint (POST /api/complaints)                 │  │
│  │    ✓ issue: required, min 5 chars                          │  │
│  │    ✓ category: must be in CATEGORIES[]                     │  │
│  │    ✓ block: required, must exist in SUBDIVISION_MAP        │  │
│  │    ✓ district: required, must be valid WB district         │  │
│  │    ✓ urgency: must be LOW|MEDIUM|HIGH|CRITICAL             │  │
│  │                                                             │  │
│  │  [V3] AI Classification (POST /api/ai/process-complaint)   │  │
│  │    ✓ Response has all required fields                      │  │
│  │    ✓ category is valid                                     │  │
│  │    ✓ urgency is valid                                      │  │
│  │    ✓ Timeout fallback (15s → defaults)                     │  │
│  │                                                             │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ PROCESSING ────────────────────────────────────────────┐  │
│  │                                                             │  │
│  │  [V4] Auto-Assignment (WB-02)                              │  │
│  │    ✓ Complaint exists in Supabase                          │  │
│  │    ✓ Officer is active and has WhatsApp configured        │  │
│  │    ✓ Assignment doesn't exceed max concurrent (20/BLK)     │  │
│  │    ✓ If no officer: escalate to admin                      │  │
│  │                                                             │  │
│  │  [V5] Status Change (PATCH /api/complaints/[id])           │  │
│  │    ✓ Status transition is valid (OPEN→IN_PROGRESS, etc.)   │  │
│  │    ✓ Only assigned officer or admin can change status      │  │
│  │    ✓ resolvedAt set when status=RESOLVED                   │  │
│  │    ✓ Activity log created for every change                 │  │
│  │                                                             │  │
│  │  [V6] Rating (WB-06)                                        │  │
│  │    ✓ Rating is integer 1-5                                  │  │
│  │    ✓ Complaint is RESOLVED                                 │  │
│  │    ✓ Not already rated (satisfactionRating IS NULL)        │  │
│  │    ✓ Rating submitted within 7 days of resolution          │  │
│  │                                                             │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ OUTPUT ────────────────────────────────────────────────┐  │
│  │                                                             │  │
│  │  [V7] WhatsApp Send                                         │  │
│  │    ✓ Phone number includes country code                    │  │
│  │    ✓ Message length < 4096 chars (WA limit)                │  │
│  │    ✓ Rate limit: max 60 msgs/hour per recipient           │  │
│  │    ✓ Error logged, not thrown                              │  │
│  │                                                             │  │
│  │  [V8] CSV Export                                            │  │
│  │    ✓ User has permission for exported data scope           │  │
│  │    ✓ Max 10,000 rows per export                            │  │
│  │    ✓ Sanitize PII (phone, email) option                    │  │
│  │                                                             │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 6.2 Error Handling & Retry Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│               ERROR HANDLING MATRIX                              │
│                                                                   │
│  ┌──────────────────┬──────────┬──────────┬────────────────┐  │
│  │ Error Type       │ Action   │ Retry    │ Notify          │  │
│  ├──────────────────┼──────────┼──────────┼────────────────┤  │
│  │ WA Send Fail     │ Log      │ No       │ Silent (Meta   │  │
│  │                  │          │          │ retries)        │  │
│  │ Supabase Query   │ Retry    │ 3x       │ WB-09 if 3x   │  │
│  │ Fail             │          │ exp back │ fails           │  │
│  │ AI API Timeout   │ Fallback │ No       │ Log + default  │  │
│  │ (15s)            │ defaults │          │ values          │  │
│  │ Next.js API      │ Log      │ 1x       │ WB-09          │  │
│  │ Timeout (5s)     │          │          │                 │  │
│  │ Webhook Fail     │ Log      │ No       │ WB-09          │  │
│  │ (fire&forget)    │          │ (async)  │                 │  │
│  │ Cron Execution   │ Retry    │ 2x       │ WB-09          │  │
│  │ Fail             │          │          │                 │  │
│  │ Invalid Data     │ Reject   │ No       │ WA error msg   │  │
│  │ DB Constraint    │ Log      │ No       │ Admin alert    │  │
│  │ Violation        │          │          │                 │  │
│  └──────────────────┴──────────┴──────────┴────────────────┘  │
│                                                                   │
│  n8n BUILT-IN RETRY:                                             │
│  - HTTP Request node: Retry on fail (settings panel)             │
│  - Continue on fail: Checkbox per node                           │
│  - Error Trigger: Catches unhandled errors → WB-09               │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 6.3 Logging & Monitoring Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│               LOGGING & MONITORING                               │
│                                                                   │
│  ┌─ ACTIVITY LOGS (Database) ──────────────────────────────┐   │
│  │  Every significant action logged to activity_logs:        │   │
│  │    CREATED, STATUS_CHANGED, ASSIGNED, RESOLVED,          │   │
│  │    REJECTED, UNASSIGNED, ESCALATED, RATED, WORKFLOW_ERROR │   │
│  │  Viewable in: AuditLogView (admin access)                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ n8n EXECUTION LOGS ────────────────────────────────────┐   │
│  │  n8n retains execution history:                           │   │
│  │    - Success/failure per node                             │   │
│  │    - Input/output data per node                           │   │
│  │    - Execution duration                                   │   │
│  │  Viewable in: N8NWorkflowsView, n8n admin UI             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ RECOMMENDED ADDITIONS ─────────────────────────────────┐   │
│  │  1. Structured JSON logging (winston/pino)                │   │
│  │  2. Log levels: ERROR, WARN, INFO, DEBUG                 │   │
│  │  3. Alert channels:                                       │   │
│  │     - WB-09 → WhatsApp to admins                          │   │
│  │     - Future: Slack/PagerDuty/Email                       │   │
│  │  4. Health check: GET /api/health (already exists)        │   │
│  │  5. Uptime monitoring: Uptime Robot / BetterUptime        │   │
│  │  6. Performance monitoring: n8n execution times           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

# COMPLETE WORKFLOW SUMMARY TABLE

| WF | Name | Trigger | Nodes | AI? | Key Action | SLA |
|----|------|---------|-------|-----|-----------|-----|
| WB-01 | WhatsApp Intake + AI Router | WhatsApp Trigger | 14 | ✅ Classify | Parse → AI → Route → Create → Confirm | Real-time |
| WB-02 | Smart Auto-Assignment | Execute WF Trigger | 11 | 🔮 Future match | Supabase query → Assign → Notify | <5s |
| WB-03 | Dual Notification Engine | 2 Webhooks | 14 | ❌ | Route 6 sources → Format → Batch Send | <10s |
| WB-05 | Status Check | Execute WF Trigger | 5 | ❌ | Query ticket → Format → Reply | <3s |
| WB-06 | Rating Collection | Execute WF Trigger | 7 | ❌ | Validate → Update → Thank you | <3s |
| WB-07 | SLA Breach Escalation | Cron */2h | 7 | ❌ | Breach detect → Escalate → Alert | 2h cycle |
| WB-08 | Daily Report | Cron 9AM | 6 | ❌ | Stats → Format → Admin report | Daily |
| WB-09 | Global Error Handler | Error Trigger | 4 | ❌ | Catch errors → Log → Admin alert | Real-time |

**Total: 8 workflows, ~68 nodes**

---

# 🔴 CRITICAL ISSUES FOUND (Immediate Action Required)

| # | Issue | Severity | Impact | Fix |
|---|-------|----------|--------|-----|
| 1 | No middleware.ts — auth per-route only | 🔴 Critical | Security bypass possible | Add src/middleware.ts |
| 2 | Hardcoded JWT fallback secret | 🔴 Critical | Token forgery | Remove fallback, require env |
| 3 | 14+ public endpoints, no auth | 🔴 Critical | Data exposure | HMAC signature + IP whitelist |
| 4 | Ticket number race condition | 🔴 Critical | Duplicate tickets | Use DB sequence |
| 5 | Dashboard fetches ALL complaints | 🔴 Critical | OOM at scale | Use RPC aggregation |
| 6 | .env.example has real credentials | 🔴 Critical | Credential leak | Rotate all keys |
| 7 | No rate limiting anywhere | 🟠 High | API abuse | Add rate limiter |
| 8 | Export token in URL query string | 🟠 High | Token in logs | Move to header |
| 9 | ignoreBuildErrors: true | 🟠 High | Hidden TS errors | Set to false |
| 10 | 900-line monolithic page.tsx | 🟠 High | No code splitting | Split into routes |
| 11 | In-memory GroupBy (Supabase) | 🟠 High | OOM at scale | Use SQL/RPC |
| 12 | bulk-categorize is MOCK | 🟡 Medium | Fake AI results | Implement real AI |
| 13 | Dead dependencies (next-auth, etc.) | 🟢 Low | Bundle bloat | Remove unused |

---

# 💡 ARCHITECTURE CHALLENGES & RECOMMENDATIONS

## Challenge 1: Monolithic Frontend
**Current**: Everything in one 900-line `page.tsx` with `useState<ViewType>` routing
**Problem**: No code splitting, all views loaded upfront, poor SEO, can't deep-link
**Recommendation**: Migrate to Next.js App Router file-based routing (`/dashboard`, `/complaints`, `/analytics`)
**Impact**: 60% faster initial load, proper lazy loading, better DX

## Challenge 2: Three-Mode Database Adapter Complexity
**Current**: 660-line `db.ts` with Supabase REST, Prisma PG, and SQLite modes
**Problem**: Complex to maintain, in-memory GroupBy, no connection pooling in SQLite mode
**Recommendation**: Standardize on Supabase REST API (Mode 1) for production. Keep Prisma for local dev only.
**Impact**: Simpler code, better performance, fewer bugs

## Challenge 3: n8n ↔ Next.js Coupling
**Current**: 14+ public endpoints for n8n, fire-and-forget webhooks
**Problem**: No authentication, no verification, no retry guarantee
**Recommendation**: Implement HMAC webhook signatures + dedicated `/api/internal/` prefix with IP whitelist
**Impact**: Secure, reliable integration

## Challenge 4: No Real-Time Updates
**Current**: LiveDataMonitor polls via REST
**Problem**: 3-5 second lag, unnecessary DB load
**Recommendation**: Supabase Realtime subscriptions (built-in) or WebSocket via mini-service
**Impact**: Instant updates, 80% less polling traffic

## Challenge 5: Cost Optimization
**Current**: Every AI call goes to z-ai-web-dev-sdk ($)
**Recommendation**: Cache AI classifications for similar complaints. Use n8n's built-in AI nodes for simple tasks (formatting, summarization) — cheaper than external API.
**Impact**: 40-60% reduction in AI API costs

## Challenge 6: WhatsApp Rate Limits
**Current**: No rate limiting on WA sends
**Problem**: Meta limits to 1000 conversations/day on free tier
**Recommendation**: Implement send queue in n8n (Wait node for throttling), batch citizen notifications
**Impact**: Avoid WA API blocks

---

# BUILD ORDER (Dependency-Aware)

```
Phase 1: FIXES (Next.js codebase)
  Step 1: Add middleware.ts (auth enforcement)
  Step 2: Fix JWT secret (remove fallback)
  Step 3: Add rate limiting
  Step 4: Fix ticket number generation
  Step 5: Create Supabase RPC functions

Phase 2: n8n WORKFLOW BUILD (using MCP SDK)
  Step 6:  Build WB-09 (Error Handler) — no dependencies
  Step 7:  Build WB-05 (Status Check) — no dependencies
  Step 8:  Build WB-06 (Rating) — no dependencies
  Step 9:  Build WB-03 (Notifications) — no dependencies
  Step 10: Build WB-02 (Auto-Assign) — no dependencies
  Step 11: Build WB-01 (Intake + AI Router) — calls WB-02, WB-05, WB-06
  Step 12: Build WB-07 (SLA) — cron, independent
  Step 13: Build WB-08 (Daily Report) — cron, independent

Phase 3: INTEGRATION TESTING
  Step 14: Validate all workflows via MCP
  Step 15: Test with prepare_test_pin_data + test_workflow
  Step 16: Publish all workflows
  Step 17: End-to-end test: WhatsApp → Complaint → Assign → Notify
```

---

*Document generated from: Full codebase analysis (39 API routes, 22 components, 5 tables, 2 views), n8n MCP SDK reference (18 tools), n8n node catalog (50+ nodes researched), Supabase schema audit.*
*Total analysis: ~15,000 lines of code reviewed*
