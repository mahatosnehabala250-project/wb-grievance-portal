# West Bengal AI Grievance Portal — n8n Workflow Specification v3.0

> **Version**: 3.0.0 (June 2025)
> **Previous**: v2.0 (n8n-workflow-new.md), v1.0 (n8n-workflow-prompt.md)
> **Status**: SDK-Based Rebuild Specification
> **n8n Instance**: `https://n8n.srv1347095.hstgr.cloud`
> **MCP Endpoint**: `https://n8n.srv1347095.hstgr.cloud/mcp-server/http` (JWT auth)
> **Supabase**: `https://sxdtipaspfolrpqrwadt.supabase.co`
> **Portal**: `https://wb-grievance-portal.vercel.app`

---

## CHANGELOG — v1.0 → v2.0 → v3.0

| # | Area | v1.0 | v2.0 | v3.0 (THIS) | Reason |
|---|------|------|------|-------------|--------|
| 1 | **Build Method** | Manual JSON | Manual JSON via n8n-mcp.com | **n8n Workflow SDK** | SDK validates, compiles, prevents null connections |
| 2 | **MCP Server** | None | n8n-mcp.com (3rd party) | **Instance-level MCP v1.1.0** | Official n8n MCP, 18 tools, direct SDK support |
| 3 | **Validation** | None | Manual (failed for WB-01/02) | **`validate_workflow` tool** | Catches errors before deployment |
| 4 | **Testing** | None | None | **`test_workflow` + `prepare_test_pin_data`** | Test with simulated data before going live |
| 5 | **DB Access** | Next.js API only | Supabase REST direct | **Supabase REST direct (confirmed)** | service_role key, 50% faster |
| 6 | **Error Handling** | Basic try/catch | Error Trigger nodes | **SDK `.onError()` + Error Trigger** | Production-grade |
| 7 | **WB-04** | Separate workflow | Merged into WB-03 | **Merged into WB-03** | Reduces complexity |
| 8 | **Credentials** | Not addressed | `newCredential('Name')` | **`newCredential()` in SDK** | Auto-assigned on creation |
| 9 | **Existing WFs** | N/A | 5/7 deployed (2 broken) | **7/7 exist, ALL broken** | JSON approach created invalid triggers |
| 10 | **SLA Views** | Client-side calc | Supabase `sla_at_risk` view | **Supabase views + API** | DB handles complexity |

---

## 1. ARCHITECTURE OVERVIEW

### 1.1 v3.0 Design Philosophy

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         v3.0 ARCHITECTURE                                   │
│                                                                              │
│  ┌──────────────┐        ┌─────────────────┐        ┌──────────────────┐    │
│  │  WhatsApp    │◄──────►│      n8n        │◄──────►│    Supabase      │    │
│  │  Meta API    │        │   Workflows      │        │   PostgreSQL     │    │
│  │              │        │   WB-01 to WB-08 │        │   + REST API     │    │
│  └──────────────┘        └────────┬────────┘        └──────────────────┘    │
│                                   │                                          │
│                    ┌──────────────┼──────────────┐                           │
│                    ▼              ▼              ▼                           │
│             ┌──────────┐  ┌───────────┐  ┌───────────┐                      │
│             │ Next.js  │  │ Dashboard │  │ WhatsApp  │                      │
│             │ Portal   │  │ Stats API │  │ Citizens  │                      │
│             │ (Vercel) │  │           │  │           │                      │
│             └──────────┘  └───────────┘  └───────────┘                      │
│                                                                              │
│  KEY: n8n MCP Server v1.1.0 provides 18 tools for SDK-based build pipeline   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Build Pipeline (v3.0)

```
1. get_sdk_reference      → Learn SDK patterns & syntax
2. search_nodes           → Find needed nodes (whatsapp, http, code, etc.)
3. get_node_types         → Get exact TypeScript parameter definitions
4. Write SDK Code         → TypeScript using @n8n/workflow-sdk
5. validate_workflow      → Check for errors (FIX until valid)
6. create_workflow_from_code → Deploy to n8n
7. prepare_test_pin_data  → Generate test data schemas
8. test_workflow          → Test with simulated data
9. publish_workflow       → Activate for production
```

### 1.3 n8n → Supabase Direct Access

n8n workflows use **Supabase REST API** with `service_role` key:

```
GET/PATCH/POST https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/{table}
Headers:
  apikey: <SUPABASE_SERVICE_ROLE_KEY>
  Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
  Content-Type: application/json
  Prefer: return=representation
```

### 1.4 When n8n Calls Next.js API

| Next.js Endpoint | Reason |
|---|---|
| `/api/webhook/complaint` | Creates complaint + logs activity + generates ticketNo + cascades |
| `/api/complaints/escalate-batch` | Multi-table: escalate + log activity + cascade notifications |

---

## 2. N8N INSTANCE MCP — 18 Tools Reference

**Endpoint**: `POST https://n8n.srv1347095.hstgr.cloud/mcp-server/http`
**Auth**: `Authorization: Bearer <JWT>` (Accept: `application/json, text/event-stream`)

### 2.1 Workflow Lifecycle Tools

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `validate_workflow` | Validate SDK code → returns valid/errors | `code` (string) |
| `create_workflow_from_code` | Deploy validated code to n8n | `code`, `name?`, `description?` |
| `update_workflow` | Update existing workflow with new code | `workflowId`, `code` |
| `publish_workflow` | Activate a workflow | `workflowId` |
| `unpublish_workflow` | Deactivate a workflow | `workflowId` |
| `archive_workflow` | Archive/delete a workflow | `workflowId` |

### 2.2 Execution & Testing Tools

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `execute_workflow` | Run a workflow (webhook/chat/form input) | `workflowId`, `inputs?`, `executionMode?` |
| `get_execution` | Get execution results | `workflowId`, `executionId`, `includeData?` |
| `test_workflow` | Test with simulated pin data | `workflowId`, `pinData` |
| `prepare_test_pin_data` | Generate test data schemas | `workflowId` |

### 2.3 Discovery Tools

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `search_workflows` | Find existing workflows | `query?`, `limit?` |
| `get_workflow_details` | Get workflow info + triggers | `workflowId` |
| `search_nodes` | Find n8n nodes by name | `queries` (string[]) |
| `get_node_types` | Get TypeScript type definitions | `nodeIds` (with discriminators) |
| `get_suggested_nodes` | Curated node recommendations | `categories` (string[]) |
| `get_sdk_reference` | SDK documentation | `section?` (patterns/expressions/etc.) |

### 2.4 Organization Tools

| Tool | Purpose |
|------|---------|
| `search_projects` | Find projects by name |
| `search_folders` | Find folders within a project |

### 2.5 Resources

| URI | Description |
|-----|-------------|
| `n8n://workflow-sdk/reference` | Full SDK reference doc |

---

## 3. N8N WORKFLOW SDK — Quick Reference

### 3.1 Import Statement

```javascript
import { workflow, node, trigger, sticky, placeholder, newCredential,
         ifElse, switchCase, merge, splitInBatches, nextBatch, expr,
         languageModel, memory, tool, outputParser, fromAi } from '@n8n/workflow-sdk';
```

### 3.2 Core Patterns

**Linear Chain:**
```javascript
export default workflow('id', 'Workflow Name')
  .add(startTrigger)
  .to(processData)
  .to(saveResult);
```

**Conditional (IF/ELSE):**
```javascript
const checkValid = ifElse({ version: 2.2, config: { name: 'Check', parameters: {...} } });
export default workflow('id', 'name')
  .add(startTrigger)
  .to(checkValid
    .onTrue(successPath.to(saveData))
    .onFalse(errorHandler));
```

**Multi-way Switch:**
```javascript
const router = switchCase({ version: 3.2, config: { name: 'Route', parameters: {...} } });
export default workflow('id', 'name')
  .add(startTrigger)
  .to(router
    .onCase(0, pathA)
    .onCase(1, pathB)
    .onCase(2, pathC));  // fallback
```

**Merge (parallel → converge):**
```javascript
const combine = merge({ version: 3.2, config: { name: 'Combine', parameters: { mode: 'append' } } });
export default workflow('id', 'name')
  .add(trigger1).to(branch1.to(combine.input(0)))
  .add(trigger2).to(branch2.to(combine.input(1)))
  .add(combine).to(finalProcess);
```

**Multiple Triggers:**
```javascript
export default workflow('id', 'name')
  .add(webhookTrigger).to(processWebhook)
  .add(scheduleTrigger).to(processSchedule);
```

**Batch Processing:**
```javascript
const batch = splitInBatches({ version: 3, config: { name: 'Batch', parameters: { batchSize: 10 } } });
export default workflow('id', 'name')
  .add(startTrigger).to(fetchItems)
  .to(batch
    .onDone(finalize)
    .onEachBatch(processItem.to(nextBatch(batch))));
```

### 3.3 Expression Rules

```javascript
// Variables MUST be inside {{ }}
expr('Hello {{ $json.name }}')                    // ✅ Correct
expr('Total: {{ $json.count }} items')             // ✅ Correct
expr('{{ $now.toFormat("MMMM d, yyyy") }}')        // ✅ Correct

// Access other nodes by name
expr("{{ $('Webhook').item.json.phone }}")         // ✅ Correct
expr('{{ $("Fetch Data").all().map(i => i.json) }}') // ✅ Correct

// WRONG — never use $ outside {{ }}
expr('Total: ' + $json.count)                       // ❌ Wrong
```

### 3.4 Credential Rules

```javascript
// ALWAYS use newCredential() for auth
credentials: { whatsAppTriggerApi: newCredential('WhatsApp Business Account') }
credentials: { httpHeaderAuth: newCredential('Supabase Service Role') }
// NEVER hardcode API keys or use placeholder strings
```

### 3.5 Critical SDK Rules

1. Every node MUST have `output` property with sample data
2. Use descriptive node names (Good: "Find Block Officer"; Bad: "HTTP Request")
3. `executeOnce: true` when a node doesn't need upstream items
4. Expressions use `expr()` — always single/double quotes, never backticks
5. `sticky()` for canvas notes (comments are ignored)

---

## 4. CURRENT DEPLOYMENT STATUS

### 4.1 Existing Workflows on n8n (ALL INACTIVE — Need Rebuild)

| WF | Name | ID | Status | triggerCount | Issue |
|----|------|----|--------|-------------|-------|
| WB-01 | WhatsApp Intake | `JtqTiQE6LJuZFl0I` | ❌ Inactive | **0** | Broken — no trigger configured (raw JSON) |
| WB-02 | Auto-Assign | `bMnXIB6xSHRh5DkZ` | ❌ Inactive | **0** | Broken — no trigger configured (raw JSON) |
| WB-03 | Notifications | `LN08yGeqKCqIr4uj` | ❌ Inactive | **0** | Built via raw JSON — needs SDK rebuild |
| WB-05 | Status Check | `Eydrg83DYww48hrV` | ❌ Inactive | **0** | Built via raw JSON — needs SDK rebuild |
| WB-06 | Rating Collection | `fMPfSmzh3Ip0aZwl` | ❌ Inactive | **0** | Built via raw JSON — needs SDK rebuild |
| WB-07 | SLA Escalation | `6cflI9GtvV162RB9` | ❌ Inactive | **0** | Built via raw JSON — needs SDK rebuild |
| WB-08 | Daily Report | `bTqSFtRq25l4XWEB` | ❌ Inactive | **0** | Built via raw JSON — needs SDK rebuild |

### 4.2 Rebuild Strategy

1. **Archive** all 7 existing workflows (they were built with raw JSON and are broken)
2. **Rebuild** all 7 using SDK code via `create_workflow_from_code`
3. **Validate** each workflow before creating
4. **Test** each workflow with `prepare_test_pin_data` + `test_workflow`
5. **Publish** after successful testing

---

## 5. SUPABASE DATABASE — Verified Schema

### 5.1 Tables (5 tables, 2 views)

| Table | @@map | Columns | Indexes |
|-------|-------|---------|---------|
| User | `users` | 16 | username(unique) |
| Complaint | `complaints` | 27 | district, block, status, urgency, category, createdAt |
| ActivityLog | `activity_logs` | 8 | complaintId, createdAt |
| Comment | `comments` | 5 | complaintId |
| Feedback | `feedback` | 7 | — |

### 5.2 Views

| View | Purpose |
|------|---------|
| `complaint_stats` | Aggregated statistics |
| `sla_at_risk` | SLA breach detection |

### 5.3 complaints Table (27 columns — ALL verified)

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | CUID | auto | PK |
| ticketNo | String | auto | WB-XXXXX format |
| citizenName | String? | null | |
| phone | String? | null | |
| issue | String | required | |
| category | String | — | 10 categories |
| village | String? | null | |
| block | String | required | |
| subdivision | String? | auto | SUBDIVISION_MAP |
| district | String | required | |
| urgency | String | MEDIUM | LOW/MEDIUM/HIGH/CRITICAL |
| status | String | OPEN | OPEN/IN_PROGRESS/RESOLVED/REJECTED |
| description | String? | null | |
| resolution | String? | null | |
| assignedToId | String? | null | FK users.id |
| assignedOfficerName | String? | null | |
| source | String | WHATSAPP | WHATSAPP/MANUAL/WEB |
| n8nProcessed | Boolean | false | |
| matchScore | Float? | null | AI score 0-100 |
| riskLevel | String? | null | |
| pct | Float? | null | SLA breach % |
| tags | String? | null | JSON array |
| language | String | bn | bn/en/hi |
| satisfactionRating | Int? | null | 1-5 |
| escalatedAt | DateTime? | null | |
| resolvedAt | DateTime? | null | |
| createdAt | DateTime | now() | |
| updatedAt | DateTime | auto | |

---

## 6. WORKFLOW SPECIFICATIONS (7 Workflows)

---

### WF-01: WhatsApp Intake → Create Complaint + Route

**Trigger**: WhatsApp Trigger (Meta Cloud API)
**Credential**: `whatsAppTriggerApi` → `newCredential('WhatsApp Business Account')`
**Purpose**: Receive WhatsApp messages, route to status check / rating / new complaint

#### Node Flow:

```
[WhatsApp Trigger] → [Code: Parse & Route] → [Switch: messageType]
                                                       │
                           ┌───────────────────────────┼───────────────────┐
                           ▼                           ▼                   ▼
                    [status_check]                [rating]          [new_complaint]
                           │                           │                   │
                           ▼                           ▼                   ▼
                    [Execute WF-05]              [Execute WF-06]   [HTTP: /webhook/complaint]
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

#### SDK Code Pattern:

```javascript
import { workflow, node, trigger, ifElse, switchCase, expr, newCredential } from '@n8n/workflow-sdk';

const waTrigger = trigger({
  type: 'n8n-nodes-base.whatsAppTrigger',
  version: 1,
  config: {
    name: 'WhatsApp Trigger',
    credentials: { whatsAppTriggerApi: newCredential('WhatsApp Business Account') },
    position: [240, 300]
  },
  output: [{ body: { contacts: [{ wa_id: '919876543210' }], messages: [{ text: { body: 'WB-01001' }, from: '919876543210' }] } }]
});

const parseRoute = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse & Route Message',
    parameters: {
      jsCode: `const body = $('WhatsApp Trigger').first().json.body || {};
const contacts = body.contacts || [];
const messages = body.messages || [];
const msg = messages[0] || {};
const contact = contacts[0] || {};
const text = msg.text?.body || '';
const waId = msg.from;
const phone = contact.wa_id || waId;

let messageType = 'new_complaint';
let data = {};

const ticketMatch = text.match(/WB-\\d{5}/i);
if (ticketMatch) {
  messageType = 'status_check';
  data.ticketNo = ticketMatch[0].toUpperCase();
} else if (/^[1-5]$/.test(text.trim())) {
  messageType = 'rating';
  data.rating = parseInt(text.trim());
} else {
  messageType = 'new_complaint';
  data = { citizenName: contact.profile?.name || '', phone, issue: text.substring(0, 200), category: 'Other', block: '', district: '', urgency: 'MEDIUM', village: '', description: text, language: 'bn' };
}

return [{ json: { messageType, phone, waId, text, ...data } }];`
    },
    position: [480, 300]
  },
  output: [{ messageType: 'new_complaint', phone: '919876543210', waId: '919876543210', text: 'No water supply', citizenName: 'Rahul', issue: 'No water supply', category: 'Other', block: '', district: '', urgency: 'MEDIUM' }]
});

// ... Switch, HTTP Request, IF, WA Send nodes follow same pattern
```

---

### WF-02: Auto-Assign Officer

**Trigger**: Execute Workflow Trigger (called from WB-01)
**Purpose**: Query Supabase for matching officer, assign, notify citizen

#### Node Flow:

```
[Execute WF Trigger] → [HTTP: Supabase GET users] → [Code: Select Best] → [IF: Has Officer?]
                                                                               │           │
                                                                           [true]      [false]
                                                                               │           │
                                                                               ▼           ▼
                                                                    [HTTP: Supabase    [NoOp]
                                                                     PATCH complaints]
                                                                               │
                                                                               ▼
                                                                    [WA: Notify Citizen]
```

**Key Logic**: Query `users` where `role=eq.BLOCK`, `block=eq.{{block}}`, `isActive=eq.true`. Pick officer with least active complaints. PATCH `complaints` to set `assignedToId` + `assignedOfficerName`.

---

### WF-03: Citizen & Officer Notifications

**Trigger**: Two Webhook nodes (dual webhook workflow)
**Purpose**: Send WhatsApp notifications for status changes, assignments, escalations

#### Node Flow:

```
[Webhook: /wb-notify-citizen]  → [Code: Route by source]  → [Switch]
                                                               │
                                              ┌────────────────┼────────────────┐
                                              ▼                ▼                ▼
                                       [status_change]  [sla_batch]    [escalation]
                                              │                │                │
                                              ▼                ▼                ▼
                                     [Supabase: Get    [Loop: Each    [Supabase: Get
                                      complaint]         complaint]     complaint]
                                              │                │                │
                                              ▼                ▼                ▼
                                     [Code: Format]     [Code: Format]  [Code: Format]
                                              │                │                │
                                              ▼                ▼                ▼
                                     [WA: Send]          [WA: Send]     [WA: Send]

[Webhook: /wb-notify-officer]  → [Code: Route by source]  → [Switch]
                                                               │
                                              ┌────────────────┼────────────────┐
                                              ▼                                 ▼
                                       [assignment]                        [escalation]
                                              │                                 │
                                              ▼                                 ▼
                                     [Supabase: Get                     [Supabase: Get
                                      user + complaint]                  user + complaint]
                                              │                                 │
                                              ▼                                 ▼
                                     [Code: Format +                    [Code: Format +
                                      Notify Targets]                     Notify Targets]
                                              │                                 │
                                              ▼                                 ▼
                                     [Loop + WA Send]                    [Loop + WA Send]
```

**Key Feature**: `URGENCY_NOTIFICATION_MAP` determines additional targets:
- CRITICAL → Block + District + District Head + Admin
- HIGH → Block + District
- MEDIUM/LOW → Block only

---

### WF-05: Status Check by Ticket Number

**Trigger**: Execute Workflow Trigger (called from WB-01)
**Purpose**: Citizen sends WB-XXXXX → query Supabase → reply with status

#### Node Flow:

```
[Execute WF Trigger] → [HTTP: Supabase GET by ticketNo] → [IF: Found?] → [Code: Format Status] → [WA: Send]
                                                                    │
                                                                    ▼
                                                               [WA: Not Found]
```

---

### WF-06: Rating Collection

**Trigger**: Execute Workflow Trigger (called from WB-01)
**Purpose**: Citizen replies 1-5 → find resolved complaint by phone → update rating

#### Node Flow:

```
[Execute WF Trigger] → [Code: Validate 1-5] → [IF: Valid?] → [HTTP: Supabase GET resolved by phone] → [HTTP: Supabase PATCH rating] → [WA: Thank You]
                                                        │
                                                        ▼
                                                   [WA: Invalid Rating]
```

**v3.0**: Direct Supabase UPDATE (no JWT needed with service_role key)

---

### WF-07: SLA Breach Escalation (Every 2 Hours)

**Trigger**: Schedule Trigger — `0 */2 * * *` (every 2 hours)
**Purpose**: Check SLA breaches, escalate urgency, notify admins

#### Node Flow:

```
[Schedule: 2h] → [HTTP: POST /api/complaints/escalate-batch] → [IF: Has Breaches?] → [Code: Format Report] → [Supabase: Get Admins] → [Loop + WA: Send Report]
                                                                              │
                                                                              ▼
                                                                         [NoOp]
```

**Why calls Next.js**: `/escalate-batch` handles multi-table transaction (escalate + log activity + set escalatedAt + cascade notifications).

---

### WF-08: Daily Report (9 AM IST)

**Trigger**: Schedule Trigger — `0 9 * * *` (daily 9 AM IST, timezone Asia/Kolkata)
**Purpose**: Aggregate stats, send daily report to admins + district heads

#### Node Flow:

```
[Schedule: 9AM IST] → [HTTP: GET /api/dashboard] → [Code: Format Report] → [Supabase: Get Admins + District Heads] → [Loop + WA: Send Report]
```

---

## 7. WHATSAPP MESSAGE TEMPLATES (Bengali + English)

### 7.1 Complaint Registration (WB-01)
```
✅ অভিযোগ নিবন্ধন সফল!
Complaint Registered Successfully!

🎫 টিকেট নং: {{ ticketNo }}
📌 বিষয়: {{ issue }}
📂 বিভাগ: {{ category }}
📍 অবস্থান: {{ block }}, {{ district }}
🔴 জরুরিতা: {{ urgency }}

আপনার অভিযোগ গ্রহণ করা হয়েছে।
Your complaint has been received.

📊 স্ট্যাটাস চেক: {{ ticketNo }} লিখে পাঠান
```

### 7.2 Officer Assignment (WB-02 → Citizen)
```
📋 অভিজ্ঞতা আপডেট | Update on Your Complaint

🎫 টিকেট: {{ ticketNo }}
👤 দায়িত্বপ্রাপ্ত কর্মকর্তা: {{ officerName }}
📍 ব্লক: {{ block }}

আপনার অভিযোগের দায়িত্ব একজন কর্মকর্তার কাছে দেওয়া হয়েছে।
An officer has been assigned to your complaint.
```

### 7.3 New Complaint to Officer (WB-03)
```
🔔 নতুন অভিযোগ নিয়োগ | New Complaint Assigned

🎫 টিকেট: {{ ticketNo }}
📌 বিষয়: {{ issue }}
📂 বিভাগ: {{ category }}
📍 ব্লক: {{ block }}, {{ district }}
🔴 জরুরিতা: {{ urgency }}
📞 নাগরিক: {{ citizenName }} ({{ phone }})

অনুগ্রহ করে শীঘ্র ব্যবস্থা নিন।
Please take action at the earliest.
```

### 7.4 Status Change — RESOLVED (with rating prompt)
```
✅ অভিযোগ সমাধান | Complaint Resolved

🎫 টিকেট: {{ ticketNo }}
📝 সমাধান: {{ resolution }}

⭐ আপনার অভিজ্ঞতা রেট করুন (Reply 1-5):
1 = খুব খারাপ | Very Poor
2 = খারাপ | Poor
3 = গড় | Average
4 = ভালো | Good
5 = খুব ভালো | Excellent
```

### 7.5 SLA Breach to Citizen (WB-03/WB-07)
```
⚠️ SLA লঙ্ঘন | SLA Breach Notice

🎫 টিকেট: {{ ticketNo }}
🔴 আপনার অভিযোগ এসক্যালেট করা হয়েছে
Your complaint has been escalated to higher priority.
```

### 7.6 Daily Report (WB-08)
```
📋 WB Grievance Portal — Daily Report
📅 {{ date }}

📊 সারসংক্ষেপ | Summary:
├ 📥 নতুন অভিযোগ: {{ newToday }}
├ ✅ সমাধান: {{ resolved }}
├ 🔄 চলমান: {{ inProgress }}
├ 📤 খোলা: {{ open }}
└ ⚠️ SLA লঙ্ঘন: {{ breached }}

⭐ গড় রেটিং: {{ avgRating }}/5 (গত ৭ দিনে)
```

---

## 8. WORKFLOW CASCADE MAP (v3.0)

```
┌──────────────────────────────────────────────────────────────────────┐
│                    COMPLETE CASCADE MAP v3.0                          │
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
│  │  1. Supabase: GET users (by block)       │                         │
│  │  2. Supabase: PATCH complaints           │                         │
│  │  3. WhatsApp: notify citizen             │                         │
│  └─────────────────────────────────────────┘                         │
│                                                                       │
│  ─── CRON TRIGGERS ──────────────────────────                         │
│                                                                       │
│  ┌─────────────────────────────────────────┐                         │
│  │  WB-07: SLA Breach (every 2h)           │                         │
│  │  1. POST /escalate-batch → Next.js      │                         │
│  │  2. Format breach report                 │                         │
│  │  3. WhatsApp → admins                    │                         │
│  └─────────────────────────────────────────┘                         │
│                                                                       │
│  ┌─────────────────────────────────────────┐                         │
│  │  WB-08: Daily Report (9 AM IST)         │                         │
│  │  1. GET /dashboard                       │                         │
│  │  2. Format daily summary                 │                         │
│  │  3. WhatsApp → admins + district heads   │                         │
│  └─────────────────────────────────────────┘                         │
│                                                                       │
│  ─── WEBHOOK LISTENERS (called by Next.js) ──                         │
│                                                                       │
│  ┌─────────────────────────────────────────┐                         │
│  │  WB-03: Citizen & Officer Notifications │                         │
│  │  Webhook: /wb-notify-citizen             │                         │
│  │  Webhook: /wb-notify-officer             │                         │
│  │  ┌─────────────────────────────────────┐ │                         │
│  │  │ status_change → citizen WA msg      │ │                         │
│  │  │ sla_batch    → citizen WA batch     │ │                         │
│  │  │ assignment   → officer WA msg       │ │                         │
│  │  │ escalation   → officer WA alert     │ │                         │
│  │  └─────────────────────────────────────┘ │                         │
│  └─────────────────────────────────────────┘                         │
│                                                                       │
│  NEXT.js CASCADE (n8n-webhook.ts):                                     │
│  ────────────────────────────────────                                  │
│  New Complaint Created   → POST /wb-auto-assign    → WB-02            │
│  Status Changed          → POST /wb-notify-citizen → WB-03            │
│  Officer Assigned        → POST /wb-notify-officer → WB-03            │
│  Urgency Escalated       → POST /wb-notify-officer → WB-03            │
│  SLA Batch Escalation    → POST /wb-notify-citizen → WB-03            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 9. SUPABASE REST API CHEAT SHEET

### 9.1 Auth Headers (ALL requests)
```
apikey: <SUPABASE_SERVICE_ROLE_KEY>
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json
Prefer: return=representation
```

### 9.2 Common Operations
| Operation | Method | URL Pattern |
|-----------|--------|-------------|
| List | GET | `/rest/v1/{table}?column=eq.value&select=col1,col2` |
| Get One | GET | `/rest/v1/{table}?id=eq.VALUE` |
| Create | POST | `/rest/v1/{table}` + JSON body |
| Update | PATCH | `/rest/v1/{table}?id=eq.VALUE` + JSON body |
| Filter | GET | `?col1=eq.val&col2=gt.5&status=in.(OPEN,IN_PROGRESS)` |
| Order | GET | `?order=createdAt.desc` |
| Limit | GET | `?limit=10&offset=20` |

### 9.3 Column Name Note
REST API uses camelCase WITHOUT quotes: `?ticketNo=eq.WB-01001` ✅

---

## 10. ENVIRONMENT VARIABLES

### In n8n:
| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | `https://sxdtipaspfolrpqrwadt.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | (from Supabase Dashboard) |
| `PORTAL_URL` | `https://wb-grievance-portal.vercel.app` |
| `WA_PHONE_NUMBER_ID` | `1125704830617135` |
| `WA_ACCESS_TOKEN` | (from Meta Developer Portal) |

### n8n Credentials to Configure:
1. **WhatsApp Business Account** — Phone Number ID + Access Token
2. **Supabase Service Role** — URL + service_role key (or HTTP headers)

---

## 11. CATEGORIES — Bengali Translations

| English | Bengali |
|---------|---------|
| Water Supply | পানি সরবরাহ |
| Road Damage | রাস্তার ক্ষয়ক্ষতি |
| Electricity | বিদ্যুৎ |
| Sanitation | স্বাস্থ্যবিধি |
| Healthcare | স্বাস্থ্যসেবা |
| Education | শিক্ষা |
| Public Transport | গণপরিবহন |
| Agriculture | কৃষি |
| Housing | আবাসন |
| Other | অন্যান্য |

---

## 12. URGENCY — SLA & Notification Map

| Urgency | SLA | Escalation | Notification Targets |
|---------|-----|-----------|---------------------|
| CRITICAL | 4h | Already max → re-alert | Block + District + District Head + Admin |
| HIGH | 12h | → CRITICAL | Block + District |
| MEDIUM | 48h | → HIGH | Block only |
| LOW | 120h | → HIGH | Block only |

---

## 13. BUILD PLAN — Step by Step

### Phase 1: Cleanup
1. Archive all 7 existing workflows via `archive_workflow`
2. Confirm all workflows archived via `search_workflows`

### Phase 2: Research (per workflow)
1. `search_nodes` for needed node types
2. `get_node_types` for exact TypeScript definitions
3. Write SDK code using patterns from `get_sdk_reference`

### Phase 3: Build & Deploy (per workflow)
1. Write SDK code for workflow
2. `validate_workflow(code)` → fix errors until valid
3. `create_workflow_from_code(code, name, description)`
4. `prepare_test_pin_data(workflowId)` → generate test schemas
5. Generate realistic pin data
6. `test_workflow(workflowId, pinData)` → verify execution
7. `publish_workflow(workflowId)` → activate

### Phase 4: Integration
1. Configure N8N_WEBHOOK_URL in Next.js `.env`
2. Verify cascade webhooks (n8n-webhook.ts functions)
3. End-to-end test: WhatsApp → complaint → assign → notify

### Build Order (dependency-aware):
1. **WB-03** first (no dependencies, webhook listener)
2. **WB-05** (Execute WF Trigger, called from WB-01)
3. **WB-06** (Execute WF Trigger, called from WB-01)
4. **WB-02** (Execute WF Trigger, called from WB-01)
5. **WB-01** last (triggers WB-02, WB-05, WB-06)
6. **WB-07** (cron, independent)
7. **WB-08** (cron, independent)

---

## 14. WORKFLOW SUMMARY TABLE

| WF | Name | Trigger | Nodes | Key Action |
|----|------|---------|-------|-----------|
| WB-01 | WhatsApp Intake + Router | WhatsApp Trigger | ~10 | Parse → Route → Create → Confirm → WB-02 |
| WB-02 | Auto-Assign Officer | Execute WF Trigger | ~7 | Supabase query → Assign → Notify citizen |
| WB-03 | Notifications (Dual) | 2 Webhooks | ~12 | Route by source → Format → Send WA |
| WB-05 | Status Check | Execute WF Trigger | ~5 | Query by ticketNo → Format → Reply |
| WB-06 | Rating Collection | Execute WF Trigger | ~6 | Validate 1-5 → Update Supabase → Thank you |
| WB-07 | SLA Breach | Cron (2h) | ~5 | POST escalate-batch → Report → Admin WA |
| WB-08 | Daily Report | Cron (9 AM) | ~4 | GET dashboard → Format → Admin WA |

**Total: ~49 nodes across 7 workflows**

---

*Generated from: n8n MCP Server v1.1.0, Prisma schema v3.0, Supabase live audit, n8n-webhook.ts*
*Last updated: June 2025*
