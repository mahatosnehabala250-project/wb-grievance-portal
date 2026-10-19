# JanSeva — Project Overview

## What problem does it solve?

Citizens in West Bengal struggle to file grievances with local government (Panchayat, Block Development Office, district departments). Calls are often unanswered, paper forms are inaccessible to villagers, and follow-ups are ad-hoc. Separately, **emergency blood requirements** (accidents, surgery, thalassemia patients) often fail because there's no fast way to find a compatible willing donor nearby.

**JanSeva** solves both via a single WhatsApp number:
- Citizens send a message, AI categorizes the grievance, auto-routes to the right officer, tracks SLA, sends status updates.
- Blood seekers send a request, AI matches eligible donors via tiered cascade, handles confirmations, generates donation certificates.

## Who uses it?

| User Type | What they do |
|---|---|
| **Citizen (grievance)** | WhatsApp the bot → file complaint → receive ticket → track status |
| **Blood seeker** | WhatsApp the bot → request blood → get matched with donor → confirm |
| **Blood donor** | Register via WhatsApp → receive matched requests → confirm donation |
| **Government Officer (BDO/GP/Dept)** | Receive auto-assigned cases via email → resolve → status update |
| **Admin (NeuroSetu team)** | Web dashboard to monitor, escalate, audit |

## High-Level Architecture

```
                    [Citizen / Donor / Seeker]
                           |
                  WhatsApp Business API
                           |
                           v
                  ┌────────────────────┐
                  │   n8n: JS-01       │
                  │ Sahayak Multi-Agent│
                  └─────────┬──────────┘
                            │
              ┌─────────────┼─────────────┐
              v             v             v
        [Complaint]   [Blood/Donor]   [Status/Info]
              │             │             │
              v             v             v
                   ┌───────────────┐
                   │   Supabase    │
                   │  PostgreSQL   │
                   └───────┬───────┘
                           │
                  ┌────────┴─────────┐
                  v                  v
          [Next.js Dashboard]  [Officer Email Routing]
```

## What's deployed today

- ✅ 15+ n8n workflows (JS-01 through JS-16)
- ✅ Next.js dashboard at production URL
- ✅ Supabase database with 35+ tables
- ✅ WhatsApp Business API integration
- ✅ Officer email routing (Gmail)
- ✅ Blood donor matching (basic, single-tier)

## What's WIP (active spec)

- 🚧 Multi-agent CEO Router (replacing single JS-01)
- 🚧 Smart Donor Cascade (4-tier notification)
- 🚧 Medical eligibility tracking (gender-based cooldowns)
- 🚧 Race condition handling for donor acceptances
- 🚧 Donation certificate generation
- 🚧 Frontend: agent observability dashboard, blood ops dashboard, donor self-service portal

See `.kiro/specs/sahayak-multi-agent-router/requirements.md`.
