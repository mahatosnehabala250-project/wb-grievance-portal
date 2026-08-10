# Architecture

## System Architecture (current)

```
┌─────────────────────────────────────────────────────────────┐
│                    USER LAYER                                │
│  Citizens / Blood Seekers / Donors  →  WhatsApp / Web        │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│              MESSAGING & ENTRY LAYER                         │
│  ┌────────────────────┐    ┌──────────────────┐              │
│  │ WhatsApp Business  │    │  Next.js Web App │              │
│  │  Cloud API         │    │  (citizen + admin)│              │
│  └─────────┬──────────┘    └─────────┬────────┘              │
└────────────┼────────────────────────┼────────────────────────┘
             │                        │
┌────────────┴────────────────────────┴────────────────────────┐
│                  ORCHESTRATION LAYER                          │
│                       n8n (Hostinger)                         │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  JS-01: Sahayak Multi-Agent (CEO Router)             │    │
│  │  ├─ Complaint Agent                                   │    │
│  │  ├─ Blood Agent                                       │    │
│  │  ├─ Donor Agent                                       │    │
│  │  └─ Status/Info Code Path                             │    │
│  └──────────────────────────────────────────────────────┘    │
│  JS-02..16: Triage, Dispatch, Escalation, Cascade, etc.       │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────┴─────────────────────────────────────┐
│                    DATA & AI LAYER                            │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Supabase PG 17  │  │ Google Gemini │  │ OpenAI Embed │     │
│  │ 35+ tables, RLS │  │  (LLM via n8n)│  │ (scheme RAG) │     │
│  └────────┬────────┘  └──────────────┘  └──────────────┘     │
└───────────┼──────────────────────────────────────────────────┘
            │
┌───────────┴──────────────────────────────────────────────────┐
│              EXTERNAL INTEGRATIONS                            │
│  Gmail (officer comms)  •  Vercel (hosting)  •  Hostinger    │
└──────────────────────────────────────────────────────────────┘
```

## Key Architectural Decisions

### 1. Single Workflow with Switch Node (Option C)

For the multi-agent re-architecture, we chose a **single n8n workflow** with a Switch Node routing between agents (instead of separate workflows per agent).

**Why:** Shared session state, atomic deployment, no inter-workflow latency, simpler debugging.

### 2. Rule-Based CEO Router (No AI for Routing)

The CEO Router is a **JavaScript Code Node**, not an AI Agent.

**Why:** Routing must be deterministic and fast (< 50ms). LLM-based routing introduces latency, cost, and unpredictability — especially for ambiguous responses like "Yess" where the user's `last_intent` makes the answer unambiguous.

### 3. Tiered Donor Cascade (Not Mass Broadcast)

When a blood request matches 100+ donors, we notify them in tiers (3 → 5 → 10 → adjacent districts) rather than messaging everyone at once.

**Why:** Avoids donor fatigue, respects WhatsApp rate limits, reduces cost, prevents accept-stampede / race conditions.

### 4. Postgres Advisory Locks for Donor Acceptance

When multiple donors accept simultaneously, we use Postgres advisory locks to atomically check-and-increment `donors_confirmed_count`.

**Why:** Guarantees no over-acceptance even at high concurrency.

### 5. Immutable Donation History

`donation_history` is append-only — no updates, no deletes. Corrections are made via supersede entries.

**Why:** Medical audit trail compliance (5-year retention per Indian medical record norms).

### 6. Gender-Based Cooldown

Whole blood cooldown: Male 90 days, Female 120 days. Implemented in a Postgres function `calculate_next_eligible_date()` triggered on every donation insert.

**Why:** Mandatory per WHO and Indian NACO/NBTC guidelines (women's iron recovery is slower).

### 7. Session State as Source of Truth

`conversation_sessions.last_intent` and `collected_data` drive the entire conversation flow. Agents never guess intent when state is set.

**Why:** Eliminates the "Yess" ambiguity problem and makes flows debuggable.

## Data Flow Examples

### Grievance Filing
```
Citizen WhatsApp message
  → JS-01 CEO Router (intent = complaint)
  → Complaint Agent collects: name, district, block, GP, problem
  → ValidateBlock → CheckDuplicate → RegisterComplaint
  → JS-02 Triage (AI categorization)
  → JS-03 Dispatch (officer assignment + email)
  → Citizen receives ticket number
  → JS-04 Status Broadcaster keeps citizen updated
  → JS-05 SLA Guardian escalates if breached
```

### Blood Request (Critical Urgency)
```
Seeker WhatsApp: "A+ blood chahiye, urgent"
  → JS-01 CEO Router (intent = blood, last_intent = idle)
  → Blood Agent collects: blood_group, units, hospital, urgency, district, block
  → CreateBloodRequest
  → JS-15 finds matching donors via find_matching_donors() RPC
  → JS-15B Cascade Engine:
     • urgency=critical → SOS mode → all matching donors in district notified
  → Donors receive WhatsApp with HAAN/NAHI buttons
  → First donor sends HAAN
  → Postgres advisory lock → donor marked accepted, counter incremented
  → Subsequent HAAN responses → marked standby with thank-you
  → JS-16: Seeker notified, 15-min confirm window
  → If confirmed: request closed, donation_history updated
  → If not confirmed: standby donor auto-promoted
```

### Donor Registration with Eligibility Check
```
User WhatsApp: "donor banna hai"
  → JS-01 CEO Router (intent = donor)
  → Donor Agent collects: name, blood_group, gender, DOB, weight, district, block, last_donated_date, last_donation_type
  → calculate_next_eligible_date() computes cooldown
  → RegisterDonor inserts row with next_eligible_date set
  → Donor pool grows; find_matching_donors() will only surface them after cooldown
```

## Performance Targets

| Operation | Target |
|---|---|
| CEO Router decision | < 50ms |
| WhatsApp reply (p95) | < 4 seconds |
| Status check (Code Node) | < 1 second |
| `find_matching_donors` RPC | < 500ms with 10k+ donors |
| Cascade tier transition | < 2 seconds after wait timeout |

## Scalability Considerations

- **n8n:** Self-hosted on Hostinger; can horizontally scale via worker mode if needed
- **Supabase:** Postgres connection pooling via Supavisor; RLS for tenancy
- **WhatsApp:** Rate-limited by Meta (Cloud API tier limits); cascade design respects this
- **Frontend:** Vercel edge caching; Supabase Realtime for live dashboards
