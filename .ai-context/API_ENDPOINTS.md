# API Endpoints

> All routes under `src/app/api/` (Next.js App Router)
> Base URL: production Vercel URL (per environment)

## Auth & Sessions

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/login` | POST | Admin login (Supabase Auth) |
| `/api/auth/donor-otp` | POST | Donor OTP login (new) |
| `/api/auth/donor-verify` | POST | Donor OTP verification (new) |
| `/api/sessions/save` | POST | n8n tool: save session state |

## Complaints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/complaints/register` | POST | Create new complaint (n8n tool) |
| `/api/complaints/status` | GET | Check ticket status (n8n tool) |
| `/api/complaints/validate-block` | POST | Validate block name (n8n tool) |
| `/api/complaints/check-duplicate` | POST | Check duplicate complaints (n8n tool) |
| `/api/complaints/recent-resolved` | GET | Recent resolved (for AI context) |
| `/api/complaints/[id]` | GET/PATCH | Read/update single complaint |

## Blood Donation

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/blood-requests/create` | POST | Create blood request (n8n tool) |
| `/api/blood-requests/donor-respond` | POST | Donor HAAN/NAHI (n8n tool) |
| `/api/blood-requests/seeker-confirm` | POST | Seeker confirmation (n8n tool) |
| `/api/blood-requests/[id]` | GET | Request details |
| `/api/blood-requests/active` | GET | Active requests (admin dashboard) |
| `/api/blood-requests/escalate` | POST | Manual tier escalation (admin) |
| `/api/blood-donors/register` | POST | Register donor (n8n tool) |
| `/api/blood-donors/update-status` | POST | Pause/Resume/Donated (n8n tool) |
| `/api/blood-donors/record-donation` | POST | **NEW** — Record donation event |
| `/api/blood-donors/defer` | POST | **NEW** — Defer donor (temp/permanent) |
| `/api/blood-donors/me` | GET | **NEW** — Donor self-profile |
| `/api/blood-donors/me/history` | GET | **NEW** — Own donation history |
| `/api/blood/generate-certificate` | POST | **NEW** — Generate PDF cert |
| `/api/blood/verify/[certId]` | GET | **NEW** — Public cert verify |

## Multi-Agent Routing

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/agents/test-route` | POST | **NEW** — Test CEO Router decision (admin) |
| `/api/agents/list` | GET | **NEW** — List all agents + prompts |
| `/api/agents/invocations` | GET | **NEW** — Recent agent runs |
| `/api/routing/decisions` | GET | **NEW** — Routing log with filters |

## Admin / Dashboard

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/dashboard/stats` | GET | Top-level stats |
| `/api/dashboard/officer-scores` | GET | Officer leaderboard |
| `/api/intelligence/runs` | GET | Intelligence engine runs |
| `/api/intelligence/alerts` | GET | Active alerts |

## Chat / WhatsApp

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/chat/messages` | GET/POST | WhatsApp message log |
| `/api/chat/contacts` | GET | Contact list |
| `/api/chat/session/[phone]` | GET | **NEW** — Session state for inspector |
| `/api/chat/session/[phone]/reset` | POST | **NEW** — Reset session (admin) |

## n8n Webhooks (incoming)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/n8n/complaint-status` | POST | Status update from n8n |
| `/api/n8n/blood-request-update` | POST | Blood request state change |
| `/api/n8n/cascade-trigger` | POST | **NEW** — Trigger cascade tier transition |

## Schemes & Knowledge

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/schemes/search` | GET | Search government schemes (RAG) |
| `/api/schemes/[id]` | GET | Scheme details |
| `/api/intelligence/knowledge-sync` | POST | Trigger knowledge sync |

## Reports & Export

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/reports/daily` | GET | Daily ops report |
| `/api/export/complaints` | GET | CSV export |
| `/api/export/donors` | GET | Donor CSV (admin only) |

## Health

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | App health check |

## Standard Response Format

```json
// Success
{
  "ok": true,
  "data": { ... }
}

// Error
{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Block not found",
    "details": { ... }
  }
}
```

## Auth

- Admin endpoints: Supabase Auth JWT in `Authorization: Bearer <token>`
- n8n tool endpoints: shared secret in `X-N8N-SECRET` header (env: `N8N_WEBHOOK_SECRET`)
- Public endpoints: rate-limited via `intake_rate_limits` table
- Donor self-service: OTP-issued JWT in `Authorization: Bearer <token>`
