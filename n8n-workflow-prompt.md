# West Bengal Grievance Portal — n8n Workflow Engineering Prompt

> **Purpose**: This document is a complete specification for building all 8 n8n workflows
> for the WB Grievance Management System. Use it as the single source of truth when
> constructing, debugging, or extending workflows.

---

## 1. Project Configuration

| Component | Value |
|---|---|
| **Supabase URL** | `https://sxdtipaspfolrpqrwadt.supabase.co` |
| **Supabase API Key** | Use `SUPABASE_SERVICE_ROLE_KEY` (from `.env` — full read/write) |
| **Frontend Portal** | `https://wb-grievance-portal.vercel.app` |
| **n8n Instance** | `https://n8n.srv1347095.hstgr.cloud` |
| **WhatsApp Phone Number ID** | `1125704830617135` |
| **Webhook Base URL** | `https://n8n.srv1347095.hstgr.cloud/webhook/` |
| **Timezone** | IST (Asia/Kolkata, UTC+5:30) |

### Webhook Endpoint Summary

All n8n webhooks are mounted under `{N8N_WEBHOOK_URL}/{path}`:

| Webhook Path | Triggered By | Target n8n Workflow |
|---|---|---|
| `POST /auto-assign` | Next.js (new complaint created) | WB-02 Auto-Assign |
| `POST /notify-citizen` | Next.js (status change / SLA batch) | WB-03 Notifications |
| `POST /notify-officer` | Next.js (assignment / urgency escalation) | WB-03 Notifications |

### Next.js API Endpoints Called by n8n

| Endpoint | Method | Used By | Purpose |
|---|---|---|---|
| `/api/webhook/complaint` | POST | WB-01 | Create complaint from WhatsApp |
| `/api/complaints/escalate-batch` | POST | WB-07 | Batch-escalate SLA-breached complaints |
| `/api/complaints/[id]/rate` | PATCH | WB-06 | Submit citizen satisfaction rating (1-5) |
| `/api/n8n/stats` | GET | WB-08 | Fetch daily report statistics |
| `/api/reports/weekly` | GET | WB-08 | Fetch weekly summary data |

---

## 2. Database Schema — All 5 Tables

> **CRITICAL**: All column names use **camelCase**. The Prisma `@@map` directive maps
> model names to lowercase plural table names. When writing Supabase queries in n8n,
> always use the table name from `@@map` and column names as defined below.

### 2.1 `users` (Model: `User`)

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | Auto-generated CUID primary key |
| `username` | `String` | `@unique` | Login username |
| `passwordHash` | `String` | required | Bcrypt hashed password |
| `role` | `String` | required | One of: `ADMIN`, `BLOCK`, `DISTRICT`, `STATE` |
| `name` | `String` | required | Display name |
| `block` | `String` | required | Officer's block (e.g. "Krishnanagar") |
| `email` | `String?` | nullable | Email address |
| `district` | `String?` | nullable | Officer's district |
| `subdivision` | `String?` | nullable | Officer's subdivision (e.g. "Krishnanagar Sadar") |
| `isActive` | `Boolean` | `@default(true)` | Whether user is active |
| `whatsappPhone` | `String?` | nullable | WhatsApp number for notifications (e.g. `+919876543210`) |
| `telegramChatId` | `String?` | nullable | Telegram chat ID |
| `isDistrictHead` | `Boolean` | `@default(false)` | `true` for DISTRICT/STATE heads |
| `notifyVia` | `String` | `@default("both")` | `"whatsapp"`, `"telegram"`, `"both"`, `"none"` |
| `createdAt` | `DateTime` | `@default(now())` | Auto-set creation timestamp |
| `updatedAt` | `DateTime` | `@updatedAt` | Auto-updated timestamp |

### 2.2 `complaints` (Model: `Complaint`)

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | Auto-generated CUID primary key |
| `ticketNo` | `String` | `@unique` | Format: `WB-01001` (auto-increment) |
| `citizenName` | `String?` | nullable | Citizen's name |
| `phone` | `String?` | nullable | Citizen's phone number |
| `issue` | `String` | required | Brief issue summary |
| `category` | `String` | required | One of the 10 categories (see §2.6) |
| `village` | `String?` | nullable | Village/locality within block |
| `block` | `String` | required | Block name |
| `subdivision` | `String?` | nullable | Auto-derived from SUBDIVISION_MAP |
| `district` | `String` | required | District name |
| `urgency` | `String` | `@default("MEDIUM")` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `status` | `String` | `@default("OPEN")` | `OPEN`, `IN_PROGRESS`, `RESOLVED`, `REJECTED` |
| `description` | `String?` | nullable | Detailed description |
| `resolution` | `String?` | nullable | Resolution notes |
| `assignedToId` | `String?` | nullable | FK to `users.id` |
| `assignedOfficerName` | `String?` | nullable | Display name of assigned officer |
| `source` | `String` | `@default("WHATSAPP")` | `WHATSAPP`, `MANUAL`, `WEB` |
| `n8nProcessed` | `Boolean` | `@default(false)` | Whether n8n has processed this complaint |
| `satisfactionRating` | `Int?` | nullable | 1-5 rating after resolution |
| `escalatedAt` | `DateTime?` | nullable | When urgency was last escalated |
| `resolvedAt` | `DateTime?` | nullable | When marked as resolved |
| `createdAt` | `DateTime` | `@default(now())` | Auto-set creation timestamp |
| `updatedAt` | `DateTime` | `@updatedAt` | Auto-updated timestamp |

**Indexes**: `district`, `block`, `status`, `urgency`, `category`, `createdAt`

### 2.3 `activity_logs` (Model: `ActivityLog`)

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | Auto-generated CUID primary key |
| `complaintId` | `String` | required, FK → `complaints.id` ON DELETE CASCADE | Parent complaint |
| `action` | `String` | required | `CREATED`, `STATUS_CHANGED`, `ASSIGNED`, `RESOLVED`, `REJECTED`, `UNASSIGNED`, `ESCALATED`, `RATED` |
| `description` | `String` | required | Human-readable description of the action |
| `actorId` | `String?` | nullable | FK to `users.id` |
| `actorName` | `String?` | nullable | Display name of who performed the action |
| `metadata` | `String?` | nullable | JSON string for extra data |
| `createdAt` | `DateTime` | `@default(now())` | Auto-set creation timestamp |

**Indexes**: `complaintId`, `createdAt`

### 2.4 `comments` (Model: `Comment`)

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | Auto-generated CUID primary key |
| `complaintId` | `String` | required, FK → `complaints.id` ON DELETE CASCADE | Parent complaint |
| `content` | `String` | required | Comment text |
| `actorId` | `String?` | nullable | FK to `users.id` |
| `actorName` | `String?` | nullable | Display name |
| `createdAt` | `DateTime` | `@default(now())` | Auto-set creation timestamp |

**Indexes**: `complaintId`

### 2.5 `feedback` (Model: `Feedback`)

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `String` | `@id @default(cuid())` | Auto-generated CUID primary key |
| `name` | `String` | required | Feedbacker's name |
| `email` | `String?` | nullable | Email address |
| `message` | `String` | required | Feedback text |
| `category` | `String` | `@default("General")` | Feedback category |
| `rating` | `Int` | `@default(5)` | Rating 1-5 |
| `createdAt` | `DateTime` | `@default(now())` | Auto-set creation timestamp |

### 2.6 Complaint Categories

```
Water Supply | Road Damage | Electricity | Sanitation | Healthcare
Education    | Public Transport | Agriculture | Housing | Other
```

---

## 3. Status Flow

```
  ┌─────────┐     ┌──────────────┐     ┌───────────┐
  │  OPEN   │────▶│ IN_PROGRESS  │────▶│ RESOLVED  │
  └────┬────┘     └──────┬───────┘     └───────────┘
       │                 │
       └─────────────────┘
              │
              ▼
        ┌──────────┐
        │ REJECTED │
        └──────────┘
```

**Valid statuses (4 only — NO `ASSIGNED` status)**:
- `OPEN` — Complaint received, awaiting action
- `IN_PROGRESS` — Officer is actively working on it
- `RESOLVED` — Issue has been resolved (triggers rating prompt)
- `REJECTED` — Complaint was rejected/invalid

**Important**: When a complaint transitions to `RESOLVED`, the `resolvedAt` timestamp
should be set. A `RESOLVED` complaint can receive a satisfaction rating (1-5).

---

## 4. Urgency Levels & SLA Timelines

| Urgency | Label | SLA Window | SLA in Hours | Escalation Rule |
|---|---|---|---|---|
| `CRITICAL` | Critical 🔴 | 4 hours | 4h | Already max — re-alert all levels |
| `HIGH` | High 🟠 | 12 hours | 12h | Escalate to `CRITICAL` |
| `MEDIUM` | Medium 🟡 | 48 hours (2 days) | 48h | Escalate to `HIGH` |
| `LOW` | Low 🔵 | 120 hours (5 days) | 120h | Escalate to `HIGH` |

### SLA Calculation

SLA is measured from `createdAt` to current time. Only active complaints
(status `OPEN` or `IN_PROGRESS`) are checked. Complaints with status
`RESOLVED` or `REJECTED` are excluded from SLA monitoring.

### Escalation Matrix (used by `/api/complaints/escalate-batch`)

```
LOW    ──breach──▶ HIGH
MEDIUM ──breach──▶ HIGH
HIGH   ──breach──▶ CRITICAL
CRITICAL          Already max (skip)
```

---

## 5. Notification Rules — `URGENCY_NOTIFICATION_MAP`

When a notification is sent based on urgency level, these are the targets:

| Urgency | Notification Targets | Description |
|---|---|---|
| `CRITICAL` | Block Officer + District Officer + District Head + Admin | All levels notified instantly |
| `HIGH` | Block Officer + District Officer | Fast action required |
| `MEDIUM` | Block Officer | Standard processing |
| `LOW` | Block Officer | Routine processing |

**Target lookup logic**:
1. Query `users` table where `isActive = true` and `role` matches
2. For `Block Officer`: match `role = 'BLOCK'` AND `block = complaint.block`
3. For `District Officer`: match `role = 'DISTRICT'` AND `district = complaint.district`
4. For `District Head`: match `role = 'DISTRICT'` AND `district = complaint.district` AND `isDistrictHead = true`
5. For `Admin`: match `role = 'ADMIN'`
6. Check each user's `notifyVia` field to determine WhatsApp / Telegram / both / none

---

## 6. Subdivision Map — `SUBDIVISION_MAP`

```
West Bengal District → Block → Subdivision mapping:

Nadia:
  Krishnanagar → Krishnanagar Sadar
  Kaliganj    → Tehatta
  Tehatta     → Tehatta

North 24 Parganas:
  Barasat → Barasat
  Habra   → Habra
  Dunlop  → Barrackpore

Birbhum:
  Bolpur     → Suri Sadar
  Rampurhat  → Rampurhat

Darjeeling:
  Siliguri  → Siliguri
  Kurseong  → Kurseong

Cooch Behar:
  Dinhata     → Dinhata
  Mathabhanga → Mathabhanga
```

**Auto-derivation**: When creating a complaint via webhook, if `subdivision` is not provided,
the system auto-derives it using `SUBDIVISION_MAP[district][block]`. Fallback: use `block` as subdivision.

---

## 7. Workflow Specifications (8 Workflows)

### WF-1: WhatsApp Intake → Create Complaint

**Trigger**: WhatsApp Webhook (incoming message from citizen)

**Flow**:
1. Receive WhatsApp message from citizen
2. Parse the message content using AI (structured extraction)
3. Extract: `citizenName`, `phone`, `issue`, `category`, `block`, `district`, `urgency`, `village`, `description`
4. Send confirmation message to citizen (Bengali + English) with extracted details
5. **POST** to `https://wb-grievance-portal.vercel.app/api/webhook/complaint` with the payload
6. Receive response with `ticketNo` and `id`
7. Send final confirmation to citizen with ticket number
8. Chain to **WF-2** via `toolSubWorkflow` (Execute Workflow node pointing to WB-02)

**POST body to `/api/webhook/complaint`**:
```json
{
  "citizenName": "Rahul Kumar",
  "phone": "+919876543210",
  "issue": "No water supply for 3 days",
  "category": "Water Supply",
  "block": "Krishnanagar",
  "district": "Nadia",
  "urgency": "HIGH",
  "village": "Santinagar",
  "description": "Our area has had no water supply for 3 days..."
}
```

**Required fields**: `issue`, `category`, `block`, `district`
**Optional fields**: `citizenName`, `phone`, `urgency` (default: `MEDIUM`), `village`, `description`, `subdivision`

**API Response** (201):
```json
{
  "success": true,
  "ticketNo": "WB-01001",
  "id": "clxyz...",
  "message": "Complaint WB-01001 registered successfully"
}
```

---

### WF-2: Auto-Assign Officer

**Trigger**: Webhook `POST /auto-assign` (fire-and-forget from Next.js on new complaint)

**Payload received**:
```json
{
  "complaintId": "clxyz...",
  "issue": "No water supply for 3 days",
  "category": "Water Supply",
  "block": "Krishnanagar",
  "district": "Nadia",
  "urgency": "HIGH",
  "timestamp": "2025-01-15T10:30:00Z",
  "source": "new_complaint"
}
```

**Flow**:
1. Query Supabase `users` table for matching officers:
   - `role = 'BLOCK'` AND `block = {{block}}` AND `isActive = true`
   - Sort by: least number of `status = 'OPEN'` OR `status = 'IN_PROGRESS'` complaints assigned
2. Pick the top officer (AI smart match or round-robin fallback)
3. **PATCH** `/api/complaints/[id]` to set `assignedToId` and `assignedOfficerName`
4. Cascade notification via Next.js (the PATCH endpoint internally calls `notifyN8NAssignment`)
5. Log activity: action = `ASSIGNED`

**Assignment Logic (Priority)**:
1. Same block + same category experience (if possible)
2. Same block + least active complaints
3. Same district as fallback
4. If no officer found, leave unassigned — admin will manually assign

---

### WF-3: Citizen & Officer Notifications

**Trigger**: Two webhook paths:
- `POST /notify-citizen` — citizen notifications (status changes, SLA alerts)
- `POST /notify-officer` — officer notifications (assignments, escalations)

#### 3a. Citizen Notification Payload (`/notify-citizen`):
```json
{
  "complaintId": "clxyz...",
  "status": "IN_PROGRESS",
  "timestamp": "2025-01-15T12:00:00Z",
  "source": "status_change"
}
```

Batch SLA variant:
```json
{
  "type": "sla_batch",
  "complaints": [
    { "id": "cl1", "ticketNo": "WB-01001", "riskLevel": "high", "citizenPhone": "+91..." }
  ],
  "timestamp": "2025-01-15T14:00:00Z",
  "source": "sla_breach_batch"
}
```

**Flow for status_change**:
1. Query `complaints` by `complaintId` to get full details + `phone`
2. Look up citizen phone from `phone` field
3. Send WhatsApp message based on new status (see §8 Message Templates)
4. If status is `RESOLVED`, append rating prompt (1-5 reply)

#### 3b. Officer Notification Payload (`/notify-officer`):

Assignment variant:
```json
{
  "complaintId": "clxyz...",
  "assignedToId": "cluser...",
  "timestamp": "2025-01-15T10:35:00Z",
  "source": "assignment"
}
```

Escalation variant:
```json
{
  "complaintId": "clxyz...",
  "escalation": true,
  "previousUrgency": "HIGH",
  "newUrgency": "CRITICAL",
  "reason": "SLA Breach",
  "timestamp": "2025-01-15T23:00:00Z",
  "source": "urgency_escalation"
}
```

**Flow**:
1. Query `users` by `assignedToId` to get officer details
2. Check officer's `notifyVia` field (`"whatsapp"`, `"telegram"`, `"both"`, `"none"`)
3. Based on urgency, determine additional notification targets using `URGENCY_NOTIFICATION_MAP`
4. Send WhatsApp message to all target officers (see §8 Message Templates)
5. For `CRITICAL` urgency: also notify District Head + Admin

---

### WF-4: Citizen Confirmation (Merged into WF-1 / WF-2)

> This workflow is **not standalone**. Citizen confirmation is handled:
> - **After WF-1**: Acknowledge complaint receipt with ticket number
> - **After WF-2**: Notify citizen of officer assignment
>
> No separate workflow needed. Messages are sent inline within WF-1 and WF-2 flows.

---

### WF-5: Status Check by Ticket Number

**Trigger**: Citizen sends a WhatsApp message containing a ticket number pattern (e.g., `WB-01001`)

**Flow**:
1. Detect ticket number pattern in incoming WhatsApp message (`WB-XXXXX`)
2. Query Supabase `complaints` table: `SELECT * FROM complaints WHERE "ticketNo" = 'WB-01001'`
3. If not found: send "Ticket not found" message
4. If found: format and send status message (see §8 Message Templates)
5. Include: ticket number, category, current status, assigned officer, filed date, last update

**Query**:
```sql
SELECT c.*, u.name as officer_name
FROM complaints c
LEFT JOIN users u ON c."assignedToId" = u.id
WHERE c."ticketNo" = 'WB-01001'
```

---

### WF-6: Rating Collection

**Trigger**: Citizen replies with a single digit (1-5) after receiving a RESOLVED notification

**Flow**:
1. After citizen receives RESOLVED notification (from WF-3), a rating prompt is sent
2. Citizen replies with a digit: `1`, `2`, `3`, `4`, or `5`
3. Parse the digit from WhatsApp reply
4. Validate it's 1-5; if invalid, re-send the rating prompt
5. **PATCH** `https://wb-grievance-portal.vercel.app/api/complaints/[id]/rate` with `{ "rating": N }`
   - **Note**: This endpoint requires `Authorization: Bearer <token>` — for n8n,
     use a service account token or call Supabase directly to update `satisfactionRating`
6. Send thank-you message to citizen (see §8 Message Templates)

**Direct Supabase update** (alternative to authenticated API):
```sql
UPDATE complaints SET "satisfactionRating" = 4 WHERE id = 'clxyz...'
```

**State management**: n8n should track the pending rating state using:
- A static data store or
- The `n8nProcessed` flag on the complaint
- Or check if `satisfactionRating IS NULL` and status is `RESOLVED`

---

### WF-7: SLA Breach Escalation (Every 2 Hours)

**Trigger**: Cron schedule — every 2 hours (0 */2 * * *)

**Timezone**: IST (Asia/Kolkata)

**Flow**:
1. Query Supabase for all active complaints where SLA is breached:

```sql
SELECT c.id, c."ticketNo", c.urgency, c."createdAt", c.status,
       c.phone, c."assignedToId"
FROM complaints c
WHERE c.status IN ('OPEN', 'IN_PROGRESS')
  AND c."satisfactionRating" IS NULL
  AND (
    (c.urgency = 'CRITICAL' AND c."createdAt" < NOW() - INTERVAL '4 hours')
    OR (c.urgency = 'HIGH' AND c."createdAt" < NOW() - INTERVAL '12 hours')
    OR (c.urgency = 'MEDIUM' AND c."createdAt" < NOW() - INTERVAL '48 hours')
    OR (c.urgency = 'LOW' AND c."createdAt" < NOW() - INTERVAL '120 hours')
  )
```

2. For each breached complaint, determine `riskLevel` based on current urgency:
   - `CRITICAL` → already at max, skip escalation but re-alert
   - `HIGH` → risk = `high`, escalate to CRITICAL
   - `MEDIUM` → risk = `medium`, escalate to HIGH
   - `LOW` → risk = `low`, escalate to HIGH

3. Build batch payload:
```json
{
  "complaints": [
    { "id": "cl1", "ticketNo": "WB-01001", "riskLevel": "high" },
    { "id": "cl2", "ticketNo": "WB-01002", "riskLevel": "medium" }
  ],
  "report": "SLA Breach Report — 2025-01-15 14:00 IST: 2 complaints breached"
}
```

4. **POST** to `https://wb-grievance-portal.vercel.app/api/complaints/escalate-batch`

5. The API handles:
   - Escalating urgency for each complaint
   - Logging `ESCALATED` activity
   - Cascading notifications to WB-03 (citizen) and WB-04 (officer) automatically

**API Response**:
```json
{
  "success": true,
  "summary": {
    "total": 2,
    "escalated": 1,
    "alreadyCritical": 0,
    "notFound": 0,
    "failed": 1
  },
  "results": [
    { "id": "cl1", "success": true, "previousUrgency": "HIGH", "newUrgency": "CRITICAL" },
    { "id": "cl2", "success": false, "error": "..." }
  ],
  "report": "..."
}
```

6. If `summary.total > 0`, send a daily summary alert to all Admin users

---

### WF-8: Daily Report (Every Day at 9 AM IST)

**Trigger**: Cron schedule — daily at 09:00 IST (`0 9 * * *`, timezone: Asia/Kolkata)

**Flow**:
1. Query Supabase for daily statistics:
```sql
-- Total complaints by status
SELECT status, COUNT(*) as count FROM complaints
WHERE "createdAt" >= CURRENT_DATE - INTERVAL '1 day'
GROUP BY status;

-- Total complaints by urgency
SELECT urgency, COUNT(*) as count FROM complaints
WHERE "createdAt" >= CURRENT_DATE - INTERVAL '1 day'
GROUP BY urgency;

-- Total complaints by category
SELECT category, COUNT(*) as count FROM complaints
WHERE "createdAt" >= CURRENT_DATE - INTERVAL '1 day'
GROUP BY category;

-- SLA breaches
SELECT COUNT(*) as breached FROM complaints
WHERE status IN ('OPEN', 'IN_PROGRESS')
  AND (
    (urgency = 'CRITICAL' AND "createdAt" < NOW() - INTERVAL '4 hours')
    OR (urgency = 'HIGH' AND "createdAt" < NOW() - INTERVAL '12 hours')
    OR (urgency = 'MEDIUM' AND "createdAt" < NOW() - INTERVAL '48 hours')
    OR (urgency = 'LOW' AND "createdAt" < NOW() - INTERVAL '120 hours')
  );

-- Resolved yesterday
SELECT COUNT(*) as resolved_yesterday FROM complaints
WHERE status = 'RESOLVED'
  AND "resolvedAt" >= CURRENT_DATE - INTERVAL '1 day';

-- Avg satisfaction rating
SELECT AVG("satisfactionRating") as avg_rating FROM complaints
WHERE "satisfactionRating" IS NOT NULL
  AND "resolvedAt" >= CURRENT_DATE - INTERVAL '7 days';
```

2. Format the daily report (see §8 Message Templates)
3. Send via WhatsApp to all `ADMIN` users where `isActive = true` and `notifyVia` includes `whatsapp`
4. Also send to all `DISTRICT` users where `isDistrictHead = true`

---

## 8. WhatsApp Message Templates (Bengali + English)

### 8.1 Complaint Registration Confirmation (WF-1)

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

### 8.2 Officer Assignment Notification (WF-2 / WF-3)

**To Citizen:**
```
📋 অভিজ্ঞতা আপডেট | Update on Your Complaint

🎫 টিকেট: WB-01001
👤 দায়িত্বপ্রাপ্ত কর্মকর্তা: অমিত ব্যানার্জি (Block Officer)
📍 ব্লক: Krishnanagar

আপনার অভিযোগের দায়িত্ব একজন কর্মকর্তার কাছে দেওয়া হয়েছে।
An officer has been assigned to your complaint.
```

**To Officer:**
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

🔗 পোর্টালে দেখুন: https://wb-grievance-portal.vercel.app/complaints/clxyz...
```

### 8.3 Status Change Notification (WF-3)

**Status → IN_PROGRESS:**
```
🔄 স্ট্যাটাস আপডেট | Status Update

🎫 টিকেট: WB-01001
📌 স্ট্যাটাস: 🟡 IN_PROGRESS | চলমান
📝 মন্তব্য: Officer is inspecting the area

আপনার অভিযোগের কাজ শুরু হয়েছে।
Work on your complaint has started.
```

**Status → RESOLVED:**
```
✅ অভিযোগ সমাধান | Complaint Resolved

🎫 টিকেট: WB-01001
📝 সমাধান: Water supply has been restored in Santinagar area.

আপনার অভিযোগ সমাধান করা হয়েছে।
Your complaint has been resolved.

⭐ আপনার অভিজ্ঞতা রেট করুন (Reply 1-5):
1 = খুব খারাপ | Very Poor
2 = খারাপ | Poor
3 = গড় | Average
4 = ভালো | Good
5 = খুব ভালো | Excellent

যেকোনো একটি সংখ্যা (1-5) লিখে পাঠান।
Reply with a number (1-5).
```

**Status → REJECTED:**
```
❌ অভিযোগ বাতিল | Complaint Rejected

🎫 টিকেট: WB-01001
📝 কারণ: Duplicate complaint / area not under our jurisdiction

বিস্তারিত জানতে আপনার ব্লক অফিসে যোগাযোগ করুন।
Contact your block office for details.
```

### 8.4 SLA Breach / Escalation Alert (WF-3 / WF-7)

**To Citizen:**
```
⚠️ SLA লঙ্ঘন বিজ্ঞপ্তি | SLA Breach Notice

🎫 টিকেট: WB-01001
🔴 আপনার অভিযোগ এসক্যালেট করা হয়েছে
Your complaint has been escalated to higher priority.

আমরা আপনার অভিযোগের জরুরিতা বাড়িয়েছি। শীঘ্রই ব্যবস্থা নেওয়া হবে।
We have increased the priority of your complaint. Action will be taken soon.
```

**To Officer (Escalation):**
```
🚨 এসক্যালেশন সতর্কতা | Escalation Alert

🎫 টিকেট: WB-01001
📌 বিষয়: No water supply for 3 days
⬆️ জরুরিতা পরিবর্তন: HIGH → CRITICAL
📍 ব্লক: Krishnanagar, Nadia
⏰ কারণ: SLA Breach — 12 ঘণ্টার সময়সীমা অতিক্রান্ত

এটি একটি উচ্চ-অগ্রাধিকার এসক্যালেশন। অবিলম্বে ব্যবস্থা নিন।
This is a high-priority escalation. Take immediate action.
```

### 8.5 Status Check Response (WF-5)

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

### 8.6 Rating Thank You (WF-6)

```
🙏 ধন্যবাদ! Thank You!

আপনার WB-01001 টিকেটের জন্য ⭐ 4/5 রেটিং পেয়েছি।
We received your ⭐ 4/5 rating for ticket WB-01001.

আপনার মতামত আমাদের সেবা উন্নত করতে সাহায্য করে।
Your feedback helps us improve our service.

🔗 পোর্টাল: https://wb-grievance-portal.vercel.app
```

### 8.7 Daily Report (WF-8)

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
├ Other: 18
└ ...

⭐ গড় রেটিং: 4.2/5 (গত ৭ দিনে | last 7 days)
```

---

## 9. Workflow Cascade Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    WORKFLOW CASCADE MAP                            │
├─────────────────────────────────────────────────────────────────────┤
│  Next.js Event          →  n8n Webhook       →  Workflow           │
│  ─────────────────────────────────────────────────────────────────  │
│  New Complaint Created  →  /auto-assign       →  WB-02 (Assign)    │
│  Status Changed         →  /notify-citizen    →  WB-03 (Notify)    │
│  Officer Assigned       →  /notify-officer    →  WB-03 (Notify)    │
│  Urgency Escalated      →  /notify-officer    →  WB-03 (Alert)     │
│  SLA Batch Escalation   →  /notify-citizen    →  WB-03 (Alert)     │
└─────────────────────────────────────────────────────────────────────┘

n8n Internal Chains (toolSubWorkflow):
  WB-01 (WhatsApp Intake) ──tool──→ WB-02 (Auto-Assign)
```

### Cascade Flow — New Complaint Lifecycle

```
Citizen sends WhatsApp message
    │
    ▼
┌──────────────────────────────────────┐
│  WB-01: WhatsApp Intake              │
│  1. Parse message (AI)               │
│  2. POST /api/webhook/complaint      │
│  3. Reply with ticket number          │
│  4. toolSubWorkflow → WB-02          │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  WB-02: Auto-Assign                  │
│  1. Find matching officer            │
│  2. PATCH /api/complaints/[id]       │
│  3. (API internally calls cascades)  │
└──────────┬───────────────────────────┘
           │
           ├──── Next.js calls /notify-citizen (WB-03)
           │         → Citizen gets assignment message
           │
           └──── Next.js calls /notify-officer (WB-03)
                     → Officer gets new complaint alert
```

### Cascade Flow — Status Change

```
Officer changes status in Portal
    │
    ▼
┌──────────────────────────────────────┐
│  Next.js API Route                   │
│  1. Update complaint in DB           │
│  2. Log activity                     │
│  3. notifyN8NStatusChange()          │
│       → POST /notify-citizen         │
│  4. If status = RESOLVED:            │
│       → Rating prompt in message     │
└──────────┬───────────────────────────┘
           ▼
┌──────────────────────────────────────┐
│  WB-03: Citizen Notification         │
│  1. Query complaint + citizen phone  │
│  2. Send status update WhatsApp msg  │
│  3. If RESOLVED → include rating     │
└──────────────────────────────────────┘
```

### Cascade Flow — SLA Breach

```
WF-07 Cron (every 2h)
    │
    ▼
┌──────────────────────────────────────┐
│  WB-07: SLA Breach Engine            │
│  1. Query breached complaints        │
│  2. POST /api/complaints/            │
│       escalate-batch                 │
└──────────┬───────────────────────────┘
           ▼
┌──────────────────────────────────────┐
│  Next.js escalate-batch API          │
│  1. Escalate urgency per complaint   │
│  2. Log ESCALATED activity           │
│  3. notifyN8NStatusChange()          │
│       → /notify-citizen (WB-03)     │
│  4. notifyN8NUrgencyEscalation()     │
│       → /notify-officer (WB-03)     │
└──────────────────────────────────────┘
```

---

## 10. Technical Requirements & Conventions

### 10.1 Database Query Rules

1. **Always use camelCase column names** in Supabase queries — the Prisma schema
   maps them to the actual database columns via `@@map`
2. **Never manually set** `id`, `createdAt`, or `updatedAt` — they are auto-generated
3. **Use CUID format** for `id` fields (auto-generated by `@default(cuid())`)
4. **Table names** in raw SQL use the `@@map` value: `users`, `complaints`,
   `activity_logs`, `comments`, `feedback`
5. **String quoting** in PostgreSQL: use double quotes for column names
   (e.g., `"ticketNo"`, `"createdAt"`, `"assignedToId"`)

### 10.2 Error Handling

1. All n8n webhook calls from Next.js are **fire-and-forget** — failures are logged
   but never throw, so they never block the main API response
2. Webhook timeout: **5000ms** default (10000ms for batch operations)
3. n8n workflows should handle:
   - Missing data gracefully (skip notification if phone is null)
   - Supabase query failures (retry with exponential backoff)
   - WhatsApp API rate limits (queue messages if needed)
   - Empty result sets (don't send notifications for no-op scenarios)

### 10.3 WhatsApp API Integration

1. **Phone Number ID**: `1125704830617135`
2. Use the **WhatsApp Business Cloud API** for sending messages
3. Template messages should use **Bengali first, English below** format
4. Phone numbers must include country code: `+91XXXXXXXXXX`
5. Handle incoming messages: parse for ticket number (WF-5) or rating digit (WF-6)

### 10.4 Supabase Auth in n8n

1. Use `SUPABASE_SERVICE_ROLE_KEY` for all database operations (full access)
2. Supabase URL: `https://sxdtipaspfolrpqrwadt.supabase.co`
3. Use the Supabase REST API or direct PostgreSQL connection
4. For complex queries, use the Supabase REST endpoint with POST method:
   ```
   POST https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/rpc/{function}
   ```

### 10.5 n8n Workflow Conventions

1. Each workflow should have a unique name prefix: `WB-01`, `WB-02`, etc.
2. Use **Error Trigger** nodes to catch and log workflow failures
3. Webhook nodes should respond immediately (200) and process async
4. Use **Set** nodes to normalize data before processing
5. Use **Switch** nodes to route by `source` field in webhook payloads
6. Use **Loop** (Items) nodes for batch processing in WF-07
7. All datetime values should use ISO 8601 format
8. Log all significant actions to n8n execution log

---

## 11. Categories — Bengali Translations

| English | Bengali |
|---|---|
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

## 12. Urgency — Bengali Labels

| English | Bengali | Emoji Indicator |
|---|---|---|
| Critical | জরুরি | 🔴 |
| High | উচ্চ | 🟠 |
| Medium | মাধ্যম | 🟡 |
| Low | নিম্ন | 🔵 |

---

## 13. Status — Bengali Labels

| Status | Bengali | Dot Color |
|---|---|---|
| OPEN | খোলা | Red |
| IN_PROGRESS | চলমান | Amber |
| RESOLVED | সমাধান হয়েছে | Green |
| REJECTED | বাতিল | Gray |

---

## 14. Quick Reference — Webhook Payload Schemas

### `/auto-assign`
```json
{
  "complaintId": "string (cuid)",
  "issue": "string",
  "category": "string",
  "block": "string",
  "district": "string",
  "urgency": "string (LOW|MEDIUM|HIGH|CRITICAL)",
  "timestamp": "string (ISO 8601)",
  "source": "new_complaint"
}
```

### `/notify-citizen`
```json
{
  "complaintId": "string (cuid)",
  "status": "string (OPEN|IN_PROGRESS|RESOLVED|REJECTED)",
  "timestamp": "string (ISO 8601)",
  "source": "status_change | sla_breach_batch"
}
```

### `/notify-citizen` (batch variant)
```json
{
  "type": "sla_batch",
  "complaints": [
    { "id": "string", "ticketNo": "string", "riskLevel": "string", "citizenPhone": "string?" }
  ],
  "timestamp": "string (ISO 8601)",
  "source": "sla_breach_batch"
}
```

### `/notify-officer` (assignment)
```json
{
  "complaintId": "string (cuid)",
  "assignedToId": "string (cuid)",
  "timestamp": "string (ISO 8601)",
  "source": "assignment"
}
```

### `/notify-officer` (escalation)
```json
{
  "complaintId": "string (cuid)",
  "escalation": true,
  "previousUrgency": "string",
  "newUrgency": "string",
  "reason": "string",
  "timestamp": "string (ISO 8601)",
  "source": "urgency_escalation"
}
```

### `/api/webhook/complaint` (WF-1 → Next.js)
```json
{
  "citizenName": "string?",
  "phone": "string?",
  "issue": "string (required)",
  "category": "string (required)",
  "block": "string (required)",
  "district": "string (required)",
  "urgency": "string? (default: MEDIUM)",
  "village": "string?",
  "description": "string?",
  "subdivision": "string?"
}
```

### `/api/complaints/escalate-batch` (WF-7 → Next.js)
```json
{
  "complaints": [
    { "id": "string (cuid)", "riskLevel": "low|medium|high|critical" }
  ],
  "report": "string?"
}
```

---

## 15. Workflow Summary Table

| ID | Name | Trigger | Key Action | Cron |
|---|---|---|---|---|
| WB-01 | WhatsApp Intake | WhatsApp Webhook | POST `/api/webhook/complaint` → chain to WB-02 | — |
| WB-02 | Auto-Assign | Webhook `/auto-assign` | Find officer, PATCH complaint | — |
| WB-03 | Notifications | Webhook `/notify-citizen` + `/notify-officer` | Send WhatsApp messages | — |
| WB-04 | *(merged into WB-03)* | — | Citizen confirmation | — |
| WB-05 | Status Check | WhatsApp message with `WB-XXXXX` | Query Supabase, reply status | — |
| WB-06 | Rating Collection | WhatsApp digit reply (1-5) | Update `satisfactionRating` | — |
| WB-07 | SLA Breach | Cron | Query breached, POST `/escalate-batch` | Every 2h |
| WB-08 | Daily Report | Cron | Query stats, send summary to admins | 9 AM IST daily |

---

*Document generated from project source: prisma/schema.prisma, src/lib/n8n-webhook.ts, src/lib/constants.ts*
