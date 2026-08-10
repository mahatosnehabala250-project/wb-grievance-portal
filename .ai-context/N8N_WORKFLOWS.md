# n8n Workflows

> Self-hosted n8n at: `https://n8n.srv1347095.hstgr.cloud/`
> Workflow JSONs in repo: `n8n-workflows/`
> Deployment: `node deploy-workflows-v2.js`
> Validation: `node validate-workflows.js`

## All Workflows (15 active + new ones planned)

| ID | Workflow | Purpose | Status |
|---|---|---|---|
| JS-01 | **Sahayak Multi-Agent** (CEO Router) | Main WhatsApp entry point — routes to specialist agents | 🚧 Re-architecting |
| JS-02 | Priya Triage — AI Categorization | Categorizes complaints via AI | ✅ Active |
| JS-03 | Dispatch — Officer Assignment + Dept Email | Routes complaints to officers via email | ✅ Active |
| JS-04 | Status Broadcaster — Citizen Notifications | Sends status updates to citizens | ✅ Active |
| JS-05 | SLA Guardian — Escalation Engine | Escalates breached SLAs | ✅ Active |
| JS-07 | SchemeGyaan Seeder — Embedding Generator | One-time scheme embeddings (RAG) | ⚪ Inactive |
| JS-08 | Watchdog — Global Error Handler | Catches errors from all workflows | ✅ Active |
| JS-09 | Intelligence Engine — D3+D4+D5 | Analytics, alerts, baselines | ✅ Active |
| JS-10 | Knowledge Sync — Scheme PDF/Web Ingestion | Ingests new scheme docs | ✅ Active |
| JS-11 | Weekly Auto-Sync — WB Govt Scheme Crawler | Weekly scheme updates | ✅ Active |
| JS-12 | Email Dispatcher — GP + BDO + Dept | Officer email notifications | ✅ Active |
| JS-13 | Gmail Reply Scanner — Auto Match + Update | Tracks officer email replies | ✅ Active |
| JS-14 | Auto Follow-up — Reminder + Escalation | Citizen reminders | ✅ Active |
| JS-15 | Rakta Sahayak — Blood Donor Matching | Matches blood requests to donors | ✅ Active (current) |
| **JS-15B** | **Donor Cascade Engine** *(new)* | Tiered notification (Tier 1→4) | 🆕 To build |
| JS-16 | Rakta — Donor Accepted + Seeker Confirm | 15-min seeker confirmation | ✅ Active |

## JS-01: Sahayak Multi-Agent (Re-architected)

**Trigger:** WhatsApp Cloud API webhook
**Pattern:** Single workflow with Switch Node routing

### Node Structure
```
WhatsApp Trigger
    ↓
Parse Message (Code Node — extract phone, text, language detection)
    ↓
Upsert Session (HTTP → conversation_sessions)
    ↓
Prepare Context (Code Node — load history, last_intent, collected_data)
    ↓
CEO Router (Code Node — rule-based, no AI)
    ↓
Switch Node — routes by `agent` field
    ↓
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│Complaint │  Blood   │  Donor   │  Status  │ Welcome  │
│ Agent    │  Agent   │  Agent   │  Code    │  Code    │
│ (AI)     │  (AI)    │  (AI)    │ (no AI)  │ (no AI)  │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴────┬─────┘
     └──────────┴──────────┴──────────┴──────────┘
                          ↓
                    Send Reply (WhatsApp)
                          ↓
                    Log to agent_invocations
```

### Tools per Agent

**Complaint Agent:**
- ValidateBlock
- CheckDuplicate
- RegisterComplaint
- SaveSessionState

**Blood Agent:**
- CreateBloodRequest
- DonorRespond
- SeekerConfirm
- SaveSessionState

**Donor Agent:**
- RegisterDonor
- UpdateDonorStatus
- CheckDuplicate
- RecordDonation *(new)*
- DeferDonor *(new)*
- SaveSessionState

**Status Code Path (no AI):**
- Direct query to `complaints` table
- For scheme info: Gemini call with `scheme_knowledge` embeddings

## JS-15: Rakta Sahayak (current)

**Trigger:** Webhook on `blood_requests` insert (via Supabase webhook)
**Nodes:**
1. Blood Request Trigger
2. Fetch Donors → calls `find_matching_donors()` RPC
3. Process Donors (Code Node — ranks and limits)
4. Has Donors? (IF Node)
5. Save Notifications (Code Node)
6. Insert Notifications DB → `blood_donor_responses` rows
7. Notify Seeker Found (WhatsApp)
8. Build Donor Messages (Code Node)
9. WA Donor Notify (WhatsApp send)
10. No Donor Message (Code Node — fallback)
11. Notify Seeker No Donor (WhatsApp)

**Limit:** Top `units_needed * 5` donors notified.

## JS-15B: Donor Cascade Engine (NEW — to build)

**Trigger:** Called by JS-15 after initial Tier 1 send

### Tier Logic
```
WAIT 30 minutes (for routine) | 15 min (urgent) | 30 min (critical for adjacent)
    ↓
Check `blood_requests.donors_confirmed_count` vs `units_needed`
    ↓
IF confirmed >= needed → END (request fulfilled)
ELSE → fetch next tier donors → notify → loop
```

### Tier Schedules

**urgency = 'routine'** (3+ days):
- Tier 1: top 3 immediately (sent by JS-15)
- Tier 2: next 5 after 30 min
- Tier 3: next 10 after 2 hours
- Tier 4: adjacent districts after 6 hours

**urgency = 'urgent'** (24 hrs):
- Tier 1: top 5 immediately
- Tier 2: next 10 after 15 min
- Tier 3: next 20 after 1 hour

**urgency = 'critical'** (2 hrs / SOS):
- Tier 1: ALL matching district donors immediately
- Tier 2: adjacent districts after 30 min

### Idempotency
- Each tier checks `cascade_notifications` for already-notified donors → skips them
- `blood_requests.cascade_tier` tracks current tier — never re-runs same tier

## JS-16: Donor Accepted + Seeker Confirm (current)

**Trigger:** Webhook on first donor `HAAN` response

**Flow:**
1. Donor Accepted Trigger
2. Notify Seeker Donor Found (WhatsApp with donor name + phone)
3. Schedule 15min Confirm (Wait Node)
4. Ask Seeker Confirm (WhatsApp with HAAN/NAHI buttons)

**Future enhancement:** If seeker says NAHI → trigger JS-15B to promote standby donors.

## JS-08: Watchdog (current)

**Trigger:** Global error trigger
**Catches:** All errors from all JS-* workflows
**Actions:**
- Logs to `workflow_errors` table
- Sends fallback WhatsApp to citizen: "Maaf kijiye, kuch takneeki samasya hai."
- Alerts admin via email if critical

## Deployment

```bash
# Edit JSON in n8n-workflows/
# Then deploy to production:
node deploy-workflows-v2.js

# Or validate without deploying:
node validate-workflows.js
```

The deploy script:
1. Reads all JSON files in `n8n-workflows/`
2. POSTs to n8n API at `https://n8n.srv1347095.hstgr.cloud/api/v1/workflows`
3. Activates workflows
4. Writes results to `n8n-workflows/deployment-results.json`

## Tools Reference (HTTP webhooks called by AI agents)

All tools are HTTP endpoints in the Next.js API layer (`src/app/api/`) or Supabase RPCs:

| Tool | Endpoint | Method |
|---|---|---|
| ValidateBlock | `/api/complaints/validate-block` | POST |
| CheckDuplicate | `/api/complaints/check-duplicate` | POST |
| RegisterComplaint | `/api/complaints/register` | POST |
| CheckComplaintStatus | `/api/complaints/status` | GET |
| GetRecentResolved | `/api/complaints/recent-resolved` | GET |
| SaveRating | `/api/feedback/save` | POST |
| SaveSessionState | `/api/sessions/save` | POST |
| RegisterDonor | `/api/blood-donors/register` | POST |
| UpdateDonorStatus | `/api/blood-donors/update-status` | POST |
| RecordDonation *(new)* | `/api/blood-donors/record-donation` | POST |
| DeferDonor *(new)* | `/api/blood-donors/defer` | POST |
| CreateBloodRequest | `/api/blood-requests/create` | POST |
| DonorRespond | `/api/blood-requests/donor-respond` | POST |
| SeekerConfirm | `/api/blood-requests/seeker-confirm` | POST |

Auth: All tools use Supabase service role key (set in n8n credentials).
