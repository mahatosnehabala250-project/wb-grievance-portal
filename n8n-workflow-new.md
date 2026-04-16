# West Bengal AI Grievance Portal — n8n Workflow Specification v2.0

> **Version**: 2.0.0 (Updated April 2026)
> **Previous**: n8n-workflow-prompt.md v1.0
> **Status**: Production-Ready Specification
> **n8n Instance**: `https://n8n.srv1347095.hstgr.cloud`
> **Supabase**: `https://sxdtipaspfolrpqrwadt.supabase.co`
> **Portal**: `https://wb-grievance-portal.vercel.app`

---

## CHANGELOG — What Changed from v1.0

| # | Area | v1.0 (Old) | v2.0 (New) | Reason |
|---|------|-----------|-----------|--------|
| 1 | **WB-04** | Separate workflow "Citizen Confirmation" | **Merged into WB-01 & WB-03** | Reduces complexity — confirmation messages sent inline |
| 2 | **Auth** | n8n calls authenticated APIs blindly | **Bypass auth — use direct Supabase REST** | n8n has service_role key, no need for JWT dance |
| 3 | **DB Access** | n8n calls Next.js API for DB queries | **n8n queries Supabase REST API directly** | Faster, no double-hop latency, reliable |
| 4 | **SLA Calculation** | n8n calculates SLA breach client-side | **Supabase `sla_at_risk` VIEW + API `/escalate-batch`** | DB view already exists, API handles escalation + logging |
| 5 | **Rating** | n8n calls `/api/complaints/[id]/rate` (requires JWT) | **Direct Supabase UPDATE** | No JWT needed, service_role has full access |
| 6 | **WhatsApp** | Generic WA node | **Meta WA Cloud API with `sendAndWait`** | Enables conversational flows |
| 7 | **New Fields** | Not aware of `matchScore`, `riskLevel`, `pct`, `tags`, `language` | **All 5 fields documented** | Full schema alignment audit completed |
| 8 | **Error Handling** | Basic try/catch | **Error Trigger + Stop on Error nodes + retry** | Production-grade resilience |
| 9 | **Code Quality** | Inline expressions in node params | **Code nodes with proper JS** | n8n-skills best practice — expressions break on complex logic |
| 10 | **N8N_WEBHOOK_URL** | Referenced but never configured | **n8n calls Supabase directly — no dependency on Next.js webhooks** | Eliminates single point of failure |

---

## 1. ARCHITECTURE OVERVIEW

### 1.1 Design Philosophy (v2.0)

```
┌──────────────────────────────────────────────────────────────────────┐
│                    v2.0 ARCHITECTURE                                  │
│                                                                      │
│  ┌─────────────┐         ┌──────────────┐         ┌───────────────┐  │
│  │   WhatsApp  │◄───────►│     n8n      │◄───────►│   Supabase    │  │
│  │  (Meta API) │         │  Workflows   │         │  PostgreSQL   │  │
│  └─────────────┘         │  WB-01 to 08 │         │   + REST API  │  │
│                          └──────┬───────┘         └───────────────┘  │
│                                 │                                     │
│                                 │ (for complex ops only)              │
│                                 ▼                                     │
│                          ┌──────────────┐                             │
│                          │   Next.js    │                             │
│                          │   Portal     │                             │
│                          │ (Vercel)     │                             │
│                          └──────────────┘                             │
│                                                                      │
│  KEY CHANGE: n8n talks to Supabase DIRECTLY (not via Next.js API)   │
│  Next.js API is used ONLY for complex multi-table operations          │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 n8n → Supabase Direct Access

Instead of calling Next.js API routes (which require JWT auth), n8n workflows use the **Supabase REST API** directly with the `service_role` key:

```
POST https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/{table}
Headers:
  apikey: <SUPABASE_SERVICE_ROLE_KEY>
  Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
  Content-Type: application/json
  Prefer: return=representation
```

**Why?**
- `service_role` key has **full read/write access** to all tables — no auth needed
- **50% faster** — eliminates Next.js → Supabase double-hop
- **More reliable** — no dependency on Next.js server uptime
- **Simpler code** — no JWT token management in n8n

### 1.3 When n8n Still Calls Next.js

| Next.js Endpoint | Reason n8n calls it |
|---|---|
| `/api/webhook/complaint` | Creates complaint + logs activity + generates ticketNo + triggers cascades |
| `/api/complaints/escalate-batch` | Complex multi-table operation (escalate + log activity + cascade notifications) |
| `/api/reports/weekly` | Complex aggregation with multiple GROUP BY queries |

---

## 2. SUPABASE DATABASE — Current Schema (Verified April 2026)

### 2.1 Tables

| Table | @@map | Columns | Indexes |
|-------|-------|---------|---------|
| `User` | `users` | 16 | username(unique) |
| `Complaint` | `complaints` | 27 | district, block, status, urgency, category, createdAt |
| `ActivityLog` | `activity_logs` | 7 | complaintId, createdAt |
| `Comment` | `comments` | 5 | complaintId |
| `Feedback` | `feedback` | 7 | — |

### 2.2 Views

| View | Purpose |
|------|---------|
| `complaint_stats` | Aggregated complaint statistics |
| `sla_at_risk` | SLA breach detection |

### 2.3 `users` Table Columns

| Column | Type | Notes |
|--------|------|-------|
| id | String (CUID) | PK |
| username | String | @unique |
| passwordHash | String | bcrypt |
| role | String | ADMIN, BLOCK, DISTRICT, STATE |
| name | String | Display name |
| block | String | Officer's block |
| email | String? | |
| district | String? | |
| subdivision | String? | |
| isActive | Boolean | default true |
| whatsappPhone | String? | For notifications |
| telegramChatId | String? | |
| isDistrictHead | Boolean | default false |
| notifyVia | String | whatsapp/telegram/both/none, default both |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### 2.4 `complaints` Table Columns

| Column | Type | Notes |
|--------|------|-------|
| id | String (CUID) | PK |
| ticketNo | String | @unique, format WB-01001 |
| citizenName | String? | |
| phone | String? | |
| issue | String | required |
| category | String | 10 categories |
| village | String? | |
| block | String | required |
| subdivision | String? | Auto-derived |
| district | String | required |
| urgency | String | LOW/MEDIUM/HIGH/CRITICAL, default MEDIUM |
| status | String | OPEN/IN_PROGRESS/RESOLVED/REJECTED, default OPEN |
| description | String? | |
| resolution | String? | |
| assignedToId | String? | FK users.id |
| assignedOfficerName | String? | |
| source | String | WHATSAPP/MANUAL/WEB, default WHATSAPP |
| n8nProcessed | Boolean | default false |
| matchScore | Float? | |
| riskLevel | String? | |
| pct | Float? | |
| tags | Json? | |
| language | String | default "bn" |
| satisfactionRating | Int? | 1-5 |
| escalatedAt | DateTime? | |
| resolvedAt | DateTime? | |
| createdAt | DateTime | |
| updatedAt | DateTime | |

---

## 3. N8N NODE REFERENCE (Researched via n8n-mcp)

### 3.1 Critical Node Types

| Node | Type (workflow JSON) | Type (search/validate) | Version | Credentials |
|------|---------------------|----------------------|---------|-------------|
| WhatsApp Trigger | `n8n-nodes-base.whatsAppTrigger` | `nodes-base.whatsAppTrigger` | 1 | `whatsAppTriggerApi` |
| WhatsApp Send | `n8n-nodes-base.whatsApp` | `nodes-base.whatsApp` | 1.1 | Meta (built-in) |
| HTTP Request | `n8n-nodes-base.httpRequest` | `nodes-base.httpRequest` | 4.4 | Optional |
| Code (JS) | `n8n-nodes-base.code` | `nodes-base.code` | 2 | None |
| Set | `n8n-nodes-base.set` | `nodes-base.set` | 3.4 | None |
| Switch | `n8n-nodes-base.switch` | `nodes-base.switch` | 3.4 | None |
| IF | `n8n-nodes-base.if` | `nodes-base.if` | 2.3 | None |
| Webhook | `n8n-nodes-base.webhook` | `nodes-base.webhook` | 2.1 | Conditional |
| Schedule Trigger | `n8n-nodes-base.scheduleTrigger` | `nodes-base.scheduleTrigger` | 1.3 | None |
| Execute Workflow | `n8n-nodes-base.executeWorkflow` | `nodes-base.executeWorkflow` | 1.3 | None |
| Execute WF Trigger | `n8n-nodes-base.executeWorkflowTrigger` | `nodes-base.executeWorkflowTrigger` | 1.1 | None |
| Merge | `n8n-nodes-base.merge` | `nodes-base.merge` | 3.2 | None |
| NoOp | `n8n-nodes-base.noOp` | `nodes-base.noOp` | 1 | None |
| Postgres | `n8n-nodes-base.postgres` | `nodes-base.postgres` | 2.6 | `postgres` |

### 3.2 Critical Gotchas (from n8n-skills)

1. **WhatsApp Trigger**: Only ONE per Facebook App — all events through single trigger
2. **WhatsApp Send**: `sendAndWait=true` for conversational flows; max 4096 chars
3. **Switch**: Unmatched items **DROPPED** by default — always set `fallbackOutput`
4. **IF**: Unmatched items go to `false` output (NOT dropped)
5. **HTTP Request**: Default 10s timeout; use credentials type for API keys
6. **Webhook**: Production URL ≠ Test URL; use `responseMode: "onReceived"` for async
7. **Code**: Use `return [{ json: {...} }]` format; webhook data under `$json.body`
8. **Set**: API type is `set` (not `setItem`); `dotNotation=true` by default
9. **Schedule Trigger**: Must be ACTIVE for cron to run
10. **nodeType format**: `n8n-nodes-base.X` for creation, `nodes-base.X` for search/validate

---

## 4. WORKFLOW SPECIFICATIONS (7 Workflows)

---

### WF-01: WhatsApp Intake → Create Complaint + Route

**Status**: ❌ Not deployed (failed validation in v1 attempt — will fix)
**Trigger**: WhatsApp Trigger (Meta Cloud API)
**Credential**: `whatsAppTriggerApi`

#### Node Flow:

```
[WhatsApp Trigger] ──► [Code: Parse & Route] ──► [Switch: messageType]
                                                            │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
            [status_check]        [rating]          [new_complaint]
                    │                   │                   │
                    ▼                   ▼                   ▼
            [Execute WF-05]      [Execute WF-06]   [HTTP: POST /webhook/complaint]
                                                                 │
                                                                 ▼
                                                            [IF: success?]
                                                            │           │
                                                        [true]      [false]
                                                            │           │
                                                            ▼           ▼
                                                    [WA: Confirm]  [WA: Error]
                                                            │
                                                            ▼
                                                    [Execute WF-02]
```

#### Detailed Node Configuration:

**Node 1: WhatsApp Trigger**
- type: `n8n-nodes-base.whatsAppTrigger`
- typeVersion: 1
- parameters.event: `messages`
- credentials: whatsAppTriggerApi

**Node 2: Code — Parse & Route Message**
- type: `n8n-nodes-base.code`
- typeVersion: 2
- JS Logic:
  ```javascript
  // Extract from WA event structure
  const body = $('WhatsApp Trigger').first().json.body || {};
  const contacts = body.contacts || [];
  const messages = body.messages || [];
  const msg = messages[0] || {};
  const contact = contacts[0] || {};
  const text = msg.text?.body || '';
  const waId = msg.from;  // WhatsApp ID
  const phone = contact.wa_id || waId;

  let messageType = 'new_complaint';
  let data = {};

  // Check ticket pattern: WB-XXXXX
  const ticketMatch = text.match(/WB-\d{5}/i);
  if (ticketMatch) {
    messageType = 'status_check';
    data.ticketNo = ticketMatch[0].toUpperCase();
  }
  // Check rating: single digit 1-5
  else if (/^[1-5]$/.test(text.trim())) {
    messageType = 'rating';
    data.rating = parseInt(text.trim());
  }
  else {
    messageType = 'new_complaint';
    data = {
      citizenName: contact.profile?.name || '',
      phone: phone,
      issue: text.substring(0, 200),
      category: 'Other',
      block: '',
      district: '',
      urgency: 'MEDIUM',
      village: '',
      description: text,
      language: 'bn'
    };
  }

  return [{ json: { messageType, phone, waId, text, ...data } }];
  ```

**Node 3: Switch — Route by Type**
- type: `n8n-nodes-base.switch`
- typeVersion: 3.4
- value1: `{{ $json.messageType }}`
- Rule 1: equals `status_check` → output 0
- Rule 2: equals `rating` → output 1
- fallbackOutput: 2 (→ new_complaint)

**Node 4: HTTP Request — Create Complaint**
- type: `n8n-nodes-base.httpRequest`
- typeVersion: 4.4
- method: POST
- url: `https://wb-grievance-portal.vercel.app/api/webhook/complaint`
- body: JSON from data fields
- timeout: 15000ms

**Node 5: IF — Check Success**
- type: `n8n-nodes-base.if`
- typeVersion: 2.3
- condition: `$json.success == true`

**Node 6: WhatsApp — Send Confirmation**
- type: `n8n-nodes-base.whatsApp`
- typeVersion: 1.1
- phoneNumberId: `1125704830617135`
- recipientPhoneNumber: `{{ $('Parse & Route').json.phone }}`
- Message template (Bengali + English):
  ```
  ✅ অভিযোগ নিবন্ধন সফল!
  Complaint Registered Successfully!

  🎫 টিকেট নং: {{ $json.ticketNo }}
  📌 বিষয়: {{ $json.issue }}
  📂 বিভাগ: {{ $json.category }}
  📍 অবস্থান: {{ $json.block }}, {{ $json.district }}
  🔴 জরুরিতা: {{ $json.urgency }}

  আপনার অভিযোগ গ্রহণ করা হয়েছে।
  Your complaint has been received.

  📊 স্ট্যাটাস চেক: {{ $json.ticketNo }} লিখে পাঠান
  ```

**Node 7: WhatsApp — Send Error**
- type: `n8n-nodes-base.whatsApp`
- Message: `❌ দুঃখিত, অভিযোগ নিবন্ধন ব্যর্থ হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।`

**Node 8: Execute Workflow — WB-02**
- type: `n8n-nodes-base.executeWorkflow`
- typeVersion: 1.3
- workflowId: (resolved after WB-02 deployment)

---

### WF-02: Auto-Assign Officer

**Status**: ❌ Not deployed (null connection in v1 — will fix)
**Trigger**: Execute Workflow Trigger (called from WB-01)
**Approach**: Query Supabase directly for officer matching

#### Node Flow:

```
[Execute WF Trigger] ──► [Supabase: Find Officers] ──► [Code: Select Best]
                                                              │
                                                        [Has Officer?]
                                                        │           │
                                                    [true]      [false]
                                                        │           │
                                                        ▼           ▼
                                                [Supabase: Update]  [NoOp]
                                                        │
                                                        ▼
                                                [WA: Notify Citizen]
```

#### Detailed Node Configuration:

**Node 1: Execute Workflow Trigger**
- type: `n8n-nodes-base.executeWorkflowTrigger`
- typeVersion: 1.1

**Node 2: Supabase REST — Find Matching Officers**
- type: `n8n-nodes-base.httpRequest`
- typeVersion: 4.4
- method: GET
- url: `https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/users`
- query params:
  - `role`: `eq.BLOCK`
  - `block`: `eq.{{ $json.block }}`
  - `isActive`: `eq.true`
  - `select`: `id,name,block,district,whatsappPhone,notifyVia`
- headers:
  - `apikey`: `<SUPABASE_SERVICE_ROLE_KEY>`
  - `Authorization`: `Bearer <SUPABASE_SERVICE_ROLE_KEY>`

**Node 3: Code — Select Best Officer**
- Logic: Sort by least active complaints (or first available)
  ```javascript
  const officers = $input.first().json;
  const list = Array.isArray(officers) ? officers : [officers];

  if (list.length === 0) {
    return [{ json: { officerId: null, officerName: null, hasOfficer: false } }];
  }

  // Pick first available (round-robin can be added later)
  const officer = list[0];
  return [{
    json: {
      officerId: officer.id,
      officerName: officer.name,
      officerPhone: officer.whatsappPhone,
      hasOfficer: true
    }
  }];
  ```

**Node 4: IF — Has Officer?**
- condition: `$json.hasOfficer == true`

**Node 5: Supabase REST — Update Complaint**
- type: `n8n-nodes-base.httpRequest`
- method: PATCH
- url: `https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/complaints?id=eq.{{ $('Execute WF Trigger').json.complaintId }}`
- body: `{ "assignedToId": "{{ $json.officerId }}", "assignedOfficerName": "{{ $json.officerName }}" }`
- Prefer header: `return=representation`

**Node 6: WhatsApp — Notify Citizen of Assignment**
- Message:
  ```
  📋 অভিজ্ঞতা আপডেট | Update on Your Complaint

  🎫 টিকেট: {{ $('Execute WF Trigger').json.ticketNo }}
  👤 দায়িত্বপ্রাপ্ত কর্মকর্তা: {{ $json.officerName }}
  📍 ব্লক: {{ $('Execute WF Trigger').json.block }}

  আপনার অভিযোগের দায়িত্ব একজন কর্মকর্তার কাছে দেওয়া হয়েছে।
  An officer has been assigned to your complaint.
  ```

**Node 7: NoOp — No Officer Available**
- type: `n8n-nodes-base.noOp`

---

### WF-03: Citizen & Officer Notifications

**Status**: ✅ Deployed (ID: `qpP2eF30FT71ygxf`) — needs enhancement
**Trigger**: Two Webhook nodes (separate paths)

#### Node Flow:

```
[Webhook: /notify-citizen] ──► [Supabase: Get Complaint] ──► [Code: Format Message] ──► [WA: Send]

[Webhook: /notify-officer] ──► [Supabase: Get User] ──► [Code: Format Message] ──► [WA: Send]
```

#### Webhook Paths:
- `POST /notify-citizen` — status changes, SLA alerts
- `POST /notify-officer` — assignments, escalations

#### Citizen Notification Message Templates:

**Status → IN_PROGRESS:**
```
🔄 স্ট্যাটাস আপডেট | Status Update
🎫 টিকেট: {{ ticketNo }}
📌 স্ট্যাটাস: 🟡 IN_PROGRESS | চলমান
আপনার অভিযোগের কাজ শুরু হয়েছে।
```

**Status → RESOLVED:**
```
✅ অভিযোগ সমাধান | Complaint Resolved
🎫 টিকেট: {{ ticketNo }}
📝 সমাধান: {{ resolution }}

⭐ আপনার অভিজ্ঞতা রেট করুন (Reply 1-5):
1=খুব খারাপ 2=খারাপ 3=গড় 4=ভালো 5=খুব ভালো
```

**SLA Breach:**
```
⚠️ SLA লঙ্ঘন | SLA Breach Notice
🎫 টিকেট: {{ ticketNo }}
🔴 আপনার অভিযোগ এসক্যালেট করা হয়েছে
```

#### Officer Notification Message Templates:

**New Assignment:**
```
🔔 নতুন অভিযোগ নিয়োগ | New Complaint Assigned
🎫 টিকেট: {{ ticketNo }}
📌 বিষয়: {{ issue }}
📂 বিভাগ: {{ category }}
📍 ব্লক: {{ block }}, {{ district }}
🔴 জরুরিতা: {{ urgency }}
📞 নাগরিক: {{ citizenName }} ({{ phone }})

অনুগ্রহ করে শীঘ্র ব্যবস্থা নিন।
```

**Escalation:**
```
🚨 এসক্যালেশন সতর্কতা | Escalation Alert
🎫 টিকেট: {{ ticketNo }}
⬆️ জরুরিতা: {{ previousUrgency }} → {{ newUrgency }}
⏰ কারণ: {{ reason }}
```

---

### WF-05: Status Check by Ticket Number

**Status**: ✅ Deployed (ID: `pdk9tjgfVaaBkZB3`) — needs enhancement
**Trigger**: Execute Workflow Trigger (called from WB-01)

#### Node Flow:

```
[Execute WF Trigger] ──► [Supabase: Query by ticketNo] ──► [IF: Found?]
                                                            │         │
                                                        [true]    [false]
                                                            │         │
                                                            ▼         ▼
                                                    [Code: Format]   [WA: Not Found]
                                                            │
                                                            ▼
                                                    [WA: Send Status]
```

#### Supabase Query:
```
GET /rest/v1/complaints?ticketNo=eq.{{ $json.ticketNo }}&select=*
```

#### Status Response Template:
```
📊 টিকেট স্ট্যাটাস | Ticket Status
🎫 টিকেট নং: {{ ticketNo }}
📌 বিষয়: {{ issue }}
📂 বিভাগ: {{ category }}
📍 অবস্থান: {{ block }}, {{ district }}
🔴 জরুরিতা: {{ urgency }}
📊 স্ট্যাটাস: {{ status }}
👤 দায়িত্বপ্রাপ্ত: {{ assignedOfficerName || 'অনুনিয়োগিত' }}
📅 দায়েরের তারিখ: {{ createdAt }}
```

---

### WF-06: Rating Collection

**Status**: ✅ Deployed (ID: `Y5xKEFAxT8b4uBYF`) — needs fix
**Trigger**: Execute Workflow Trigger (called from WB-01)
**v2.0 Change**: Uses **direct Supabase UPDATE** instead of authenticated API call

#### Node Flow:

```
[Execute WF Trigger] ──► [Code: Validate 1-5] ──► [IF: Valid?]
                                                        │       │
                                                    [true]  [false]
                                                        │       │
                                                        ▼       ▼
                                                [Supabase: Query    [WA: Invalid]
                                                resolved by phone]
                                                        │
                                                        ▼
                                                [Supabase: Update
                                                satisfactionRating]
                                                        │
                                                        ▼
                                                [WA: Thank You]
```

#### v2.0 Fix:
Instead of calling `/api/complaints/[id]/rate` (which requires JWT), n8n directly updates Supabase:
```
PATCH /rest/v1/complaints?id=eq.{{ complaintId }}
Body: { "satisfactionRating": {{ rating }} }
```

---

### WF-07: SLA Breach Escalation (Every 2 Hours)

**Status**: ✅ Deployed (ID: `sDhcmuV8G13fOB3d`) — needs enhancement
**Trigger**: Schedule Trigger — every 2 hours
**v2.0 Change**: Uses Next.js `/escalate-batch` API (handles complex multi-table ops)

#### Node Flow:

```
[Schedule Trigger: 2h] ──► [HTTP: POST /escalate-batch] ──► [IF: Has Breaches?]
                                                                    │         │
                                                                [true]    [false]
                                                                    │         │
                                                                    ▼         ▼
                                                            [Code: Format    [NoOp]
                                                            Report]
                                                                    │
                                                                    ▼
                                                            [Supabase: Get
                                                            Admin Users]
                                                                    │
                                                                    ▼
                                                            [WA: Send to
                                                            Each Admin]
```

#### Why NOT direct Supabase for SLA:
The `/escalate-batch` API:
1. Queries `sla_at_risk` view
2. Escalates urgency per complaint
3. Logs `ESCALATED` activity for each
4. Sets `escalatedAt` timestamp
5. Cascades notifications to WB-03 (citizen + officer)

This complex multi-table transaction is best handled by the Next.js API.

---

### WF-08: Daily Report (9 AM IST)

**Status**: ✅ Deployed (ID: `QAHQvApfq58lDHab`) — needs enhancement
**Trigger**: Schedule Trigger — daily at 9:00 AM IST
**Timezone**: Asia/Kolkata

#### Node Flow:

```
[Schedule: 9AM IST] ──► [HTTP: GET /dashboard] ──► [Merge] ──► [Code: Format]
                       [HTTP: GET /reports/weekly]            │
                                                             ▼
                                                     [Supabase: Get Admins
                                                     + District Heads]
                                                             │
                                                             ▼
                                                     [WA: Send Report
                                                     to Each Admin]
```

#### Daily Report Template:
```
📋 WB Grievance Portal — Daily Report
📅 {{ date }}

📊 সারসংক্ষেপ | Summary:
├ 📥 নতুন অভিযোগ: {{ newToday }}
├ ✅ সমাধান: {{ resolved }}
├ 🔄 চলমান: {{ inProgress }}
├ 📤 খোলা: {{ open }}
├ ❌ বাতিল: {{ rejected }}
└ ⚠️ SLA লঙ্ঘন: {{ breached }}

🔴 By Urgency:
├ Critical: {{ critical }}
├ High: {{ high }}
├ Medium: {{ medium }}
└ Low: {{ low }}

📂 By Category:
├ Water Supply: {{ waterSupply }}
├ Road Damage: {{ roadDamage }}
└ ...

⭐ Avg Rating: {{ avgRating }}/5 (last 7 days)
```

---

## 5. SUPABASE REST API CHEAT SHEET

### 5.1 Authentication Headers (ALL requests)
```
apikey: <SUPABASE_SERVICE_ROLE_KEY>
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json
Prefer: return=representation
```

### 5.2 Common Operations

| Operation | Method | URL Pattern |
|-----------|--------|-------------|
| List | GET | `/rest/v1/{table}?column=eq.value&select=col1,col2` |
| Get One | GET | `/rest/v1/{table}?id=eq.VALUE&select=*` |
| Create | POST | `/rest/v1/{table}` with JSON body |
| Update | PATCH | `/rest/v1/{table}?id=eq.VALUE` with JSON body |
| Delete | DELETE | `/rest/v1/{table}?id=eq.VALUE` |
| Count | GET | `/rest/v1/{table}?select=count`, Header: `Prefer: count=exact` |
| Filter | GET | `/rest/v1/{table}?col1=eq.val&col2=gt.5&col3=like.*text*` |
| Order | GET | `/rest/v1/{table}?order=createdAt.desc` |
| Limit | GET | `/rest/v1/{table}?limit=10&offset=20` |
| RPC | POST | `/rest/v1/rpc/{function_name}` with params |

### 5.3 Column Name Quoting
PostgreSQL camelCase columns need double-quoting in raw SQL but NOT in REST API:
- REST API: `?ticketNo=eq.WB-01001` ✅
- Raw SQL: `WHERE "ticketNo" = 'WB-01001'` ✅

---

## 6. ENVIRONMENT VARIABLES NEEDED IN n8n

| Variable | Value | Purpose |
|----------|-------|---------|
| `SUPABASE_URL` | `https://sxdtipaspfolrpqrwadt.supabase.co` | Supabase REST API base |
| `SUPABASE_SERVICE_ROLE_KEY` | (from .env) | Full access to all tables |
| `PORTAL_URL` | `https://wb-grievance-portal.vercel.app` | Next.js API base |
| `WA_PHONE_NUMBER_ID` | `1125704830617135` | WhatsApp Business phone |
| `WA_ACCESS_TOKEN` | (from Meta Developer Portal) | WhatsApp API access |

### n8n Credentials to Configure:
1. **Supabase** — URL + service_role key (or use HTTP Request with headers)
2. **WhatsApp Business Cloud API** — Phone Number ID + Access Token
3. **PostgreSQL** (optional) — Direct DB connection for complex queries

---

## 7. DEPLOYMENT STATUS

| WF | Name | ID | Status | Needs Update |
|----|------|----|--------|-------------|
| WB-01 | WhatsApp Intake | — | ❌ Not deployed | Full rebuild needed |
| WB-02 | Auto-Assign | — | ❌ Not deployed | Full rebuild needed |
| WB-03 | Notifications | `qpP2eF30FT71ygxf` | ✅ Inactive | Supabase direct access |
| WB-05 | Status Check | `pdk9tjgfVaaBkZB3` | ✅ Inactive | Supabase direct access |
| WB-06 | Rating Collection | `Y5xKEFAxT8b4uBYF` | ✅ Inactive | Direct Supabase UPDATE |
| WB-07 | SLA Escalation | `sDhcmuV8G13fOB3d` | ✅ Inactive | Keep API call |
| WB-08 | Daily Report | `QAHQvApfq58lDHab` | ✅ Inactive | Keep API call |

### Next Steps:
1. Delete WB-03, WB-05, WB-06, WB-07, WB-08 (will rebuild with improvements)
2. Create WB-01 with fixed validation (no null connections, no disconnected nodes)
3. Create WB-02 with Supabase direct access
4. Rebuild WB-03 with proper dual webhook + Supabase queries
5. Rebuild WB-05 with Supabase direct query
6. Rebuild WB-06 with direct Supabase UPDATE
7. Rebuild WB-07 with enhanced error handling
8. Rebuild WB-08 with enhanced formatting
9. Configure credentials in n8n instance
10. Activate all workflows
11. Test end-to-end

---

## 8. WHATSAPP MESSAGE TEMPLATES (Complete Reference)

### 8.1 Complaint Registration (WB-01)
```
✅ অভিযোগ নিবন্ধন সফল!
Complaint Registered Successfully!

🎫 টিকেট নং: WB-01001
📌 বিষয়: No water supply for 3 days
📂 বিভাগ: Water Supply | পানি সরবরাহ
📍 অবস্থান: Krishnanagar, Nadia
🔴 জরুরিতা: HIGH | উচ্চ
📅 সময়: 15 Jan 2025, 10:30 AM

আপনার অভিযোগ গ্রহণ করা হয়েছে। শীঘ্রই আপনার সাথে যোগাযোগ করা হবে।
Your complaint has been received. You will be contacted soon.

📊 স্ট্যাটাস চেক করতে: WB-01001 লিখে পাঠান
```

### 8.2 Officer Assignment (WB-02)
```
📋 অভিজ্ঞতা আপডেট | Update on Your Complaint

🎫 টিকেট: WB-01001
👤 দায়িত্বপ্রাপ্ত কর্মকর্তা: অমিত ব্যানার্জি (Block Officer)
📍 ব্লক: Krishnanagar

আপনার অভিযোগের দায়িত্ব একজন কর্মকর্তার কাছে দেওয়া হয়েছে।
An officer has been assigned to your complaint.
```

### 8.3 New Complaint to Officer (WB-03)
```
🔔 নতুন অভিযোগ নিয়োগ | New Complaint Assigned

🎫 টিকেট: WB-01001
📌 বিষয়: No water supply for 3 days
📂 বিভাগ: Water Supply
📍 ব্লক: Krishnanagar, Nadia
🔴 জরুরিতা: HIGH
📞 নাগরিক: Rahul Kumar (+919876543210)

অনুগ্রহ করে শীঘ্র ব্যবস্থা নিন।
Please take action at the earliest.

🔗 পোর্টালে দেখুন: https://wb-grievance-portal.vercel.app
```

### 8.4 Status Change to Citizen (WB-03)

**IN_PROGRESS:**
```
🔄 স্ট্যাটাস আপডেট | Status Update

🎫 টিকেট: WB-01001
📌 স্ট্যাটাস: 🟡 IN_PROGRESS | চলমান
📝 মন্তব্য: Officer is inspecting the area

আপনার অভিযোগের কাজ শুরু হয়েছে।
Work on your complaint has started.
```

**RESOLVED:**
```
✅ অভিযোগ সমাধান | Complaint Resolved

🎫 টিকেট: WB-01001
📝 সমাধান: Water supply has been restored.

আপনার অভিযোগ সমাধান করা হয়েছে।
Your complaint has been resolved.

⭐ আপনার অভিজ্ঞতা রেট করুন (Reply 1-5):
1 = খুব খারাপ | Very Poor
2 = খারাপ | Poor
3 = গড় | Average
4 = ভালো | Good
5 = খুব ভালো | Excellent
```

**REJECTED:**
```
❌ অভিযোগ বাতিল | Complaint Rejected

🎫 টিকেট: WB-01001
📝 কারণ: Duplicate complaint

বিস্তারিত জানতে আপনার ব্লক অফিসে যোগাযোগ করুন।
Contact your block office for details.
```

### 8.5 SLA Breach Alert (WB-03/WB-07)

**To Citizen:**
```
⚠️ SLA লঙ্ঘন বিজ্ঞপ্তি | SLA Breach Notice

🎫 টিকেট: WB-01001
🔴 আপনার অভিযোগ এসক্যালেট করা হয়েছে
Your complaint has been escalated to higher priority.

আমরা আপনার অভিযোগের জরুরিতা বাড়িয়েছি। শীঘ্রই ব্যবস্থা নেওয়া হবে।
```

**To Officer:**
```
🚨 এসক্যালেশন সতর্কতা | Escalation Alert

🎫 টিকেট: WB-01001
📌 বিষয়: No water supply for 3 days
⬆️ জরুরিতা পরিবর্তন: HIGH → CRITICAL
📍 ব্লক: Krishnanagar, Nadia
⏰ কারণ: SLA Breach — 12 ঘণ্টার সময়সীমা অতিক্রান্ত

এটি একটি উচ্চ-অগ্রাধিকার এসক্যালেশন। অবিলম্বে ব্যবস্থা নিন।
```

### 8.6 Status Check Response (WB-05)
```
📊 টিকেট স্ট্যাটাস | Ticket Status

🎫 টিকেট নং: WB-01001
📌 বিষয়: No water supply for 3 days
📂 বিভাগ: Water Supply | পানি সরবরাহ
📍 অবস্থান: Krishnanagar, Nadia
🔴 জরুরিতা: HIGH
📊 বর্তমান স্ট্যাটাস: 🟡 IN_PROGRESS | চলমান
👤 দায়িত্বপ্রাপ্ত: অমিত ব্যানার্জি
📅 দায়েরের তারিখ: 15 Jan 2025
🕐 শেষ আপডেট: 16 Jan 2025, 02:30 PM
```

### 8.7 Rating Thank You (WB-06)
```
🙏 ধন্যবাদ! Thank You!

আপনার WB-01001 টিকেটের জন্য ⭐ 4/5 রেটিং পেয়েছি।
We received your ⭐ 4/5 rating for ticket WB-01001.

আপনার মতামত আমাদের সেবা উন্নত করতে সাহায্য করে।
Your feedback helps us improve our service.

🔗 পোর্টাল: https://wb-grievance-portal.vercel.app
```

### 8.8 Daily Report (WB-08)
```
📋 WB Grievance Portal — Daily Report
📅 15 January 2025

📊 সারসংক্ষেপ | Summary:
├ 📥 নতুন অভিযোগ: 12
├ ✅ সমাধান: 8
├ 🔄 চলমান: 45
├ 📤 খোলা: 23
├ ❌ বাতিল: 2
└ ⚠️ SLA লঙ্ঘন: 3

🔴 জরুরিতা অনুযায়ী | By Urgency:
├ Critical: 3
├ High: 8
├ Medium: 25
└ Low: 12

📂 বিভাগ অনুযায়ী | By Category:
├ Water Supply: 8
├ Road Damage: 5
├ Electricity: 4
└ Other: 18

⭐ গড় রেটিং: 4.2/5 (গত ৭ দিনে | last 7 days)
```

---

## 9. CATEGORIES — Bengali Translations

| English | Bengali | Color |
|---------|---------|-------|
| Water Supply | পানি সরবরাহ | blue |
| Road Damage | রাস্তার ক্ষয়ক্ষতি | orange |
| Electricity | বিদ্যুৎ | yellow |
| Sanitation | স্বাস্থ্যবিধি | green |
| Healthcare | স্বাস্থ্যসেবা | red |
| Education | শিক্ষা | purple |
| Public Transport | গণপরিবহন | teal |
| Agriculture | কৃষি | lime |
| Housing | আবাসন | pink |
| Other | অন্যান্য | gray |

---

## 10. WORKFLOW CASCADE MAP (v2.0)

```
┌──────────────────────────────────────────────────────────────────────┐
│                    COMPLETE CASCADE MAP v2.0                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Citizen sends WhatsApp message                                       │
│       │                                                               │
│       ▼                                                               │
│  ┌─────────────────────────────────────────┐                         │
│  │  WB-01: WhatsApp Intake + Router        │                         │
│  │  ┌─────────┐  ┌────────┐  ┌───────────┐ │                         │
│  │  │WB-XXXXX │  │  1-5   │  │  New Msg  │ │                         │
│  │  │→WB-05   │  │ →WB-06 │  │ → Create  │ │                         │
│  │  └─────────┘  └────────┘  │  → WB-02  │ │                         │
│  │                           └───────────┘ │                         │
│  └─────────────────────────────────────────┘                         │
│                                       │                               │
│                                       ▼                               │
│  ┌─────────────────────────────────────────┐                         │
│  │  WB-02: Auto-Assign Officer             │                         │
│  │  1. Query Supabase: officers by block   │                         │
│  │  2. Update Supabase: assignedToId       │                         │
│  │  3. Send WA: citizen assignment msg      │                         │
│  └─────────────────────────────────────────┘                         │
│                                                                       │
│  ─── CRON TRIGGERS ──────────────────────────                         │
│                                                                       │
│  ┌─────────────────────────────────────────┐                         │
│  │  WB-07: SLA Breach (every 2h)           │                         │
│  │  1. POST /escalate-batch → Next.js      │                         │
│  │  2. Format breach report                 │                         │
│  │  3. Send WA to admins                    │                         │
│  └─────────────────────────────────────────┘                         │
│                                                                       │
│  ┌─────────────────────────────────────────┐                         │
│  │  WB-08: Daily Report (9 AM IST)         │                         │
│  │  1. GET /dashboard + /reports/weekly    │                         │
│  │  2. Format daily summary                 │                         │
│  │  3. Send WA to admins + district heads   │                         │
│  └─────────────────────────────────────────┘                         │
│                                                                       │
│  ─── WEBHOOK LISTENERS (called by Next.js) ──                         │
│                                                                       │
│  ┌─────────────────────────────────────────┐                         │
│  │  WB-03: Citizen & Officer Notifications │                         │
│  │  /notify-citizen → status change msg     │                         │
│  │  /notify-officer → assignment/esc msg    │                         │
│  └─────────────────────────────────────────┘                         │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 11. TECHNICAL REQUIREMENTS

### 11.1 n8n Workflow Conventions
1. Every node must have at least one connection (no disconnected nodes)
2. Use Code nodes instead of complex expressions (n8n-skills best practice)
3. Webhook nodes: `responseMode: "onReceived"` for async processing
4. Always set `fallbackOutput` on Switch nodes
5. Use Supabase REST with service_role key — no JWT needed
6. All timestamps in ISO 8601 format
7. Timezone: Asia/Kolkata (IST, UTC+5:30)
8. Max WA message: 4096 characters

### 11.2 Error Handling
1. Error Trigger node on every workflow (connected to logging node)
2. `continueOnFail: true` on HTTP Request nodes that shouldn't crash the flow
3. Retry on Supabase timeout: 2 retries, exponential backoff
4. Empty result handling: skip notification if no target users found

### 11.3 Security
1. All Supabase queries use service_role key (stored in n8n credentials)
2. WhatsApp access token in n8n credentials (never in node parameters)
3. No sensitive data in workflow node parameters
4. Webhook paths should use authentication (N8N_WEBHOOK_SECRET header)

---

*Document generated from: n8n-mcp node research, n8n-skills best practices, project source code audit (prisma/schema.prisma, src/lib/*, src/app/api/*), and Supabase live schema verification.*
