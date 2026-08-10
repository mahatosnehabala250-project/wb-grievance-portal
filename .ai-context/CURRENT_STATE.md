# Current State (What's Happening Now)

> **Last updated:** 2026-05-26
> **Update this file** whenever you start/finish a major change.

## 🚧 Active Work

### Multi-Agent Router Re-Architecture
**Spec:** `.kiro/specs/sahayak-multi-agent-router/`
**Status:** Requirements complete (19 requirements), Design phase next

**What's being built:**
1. CEO Router (rule-based JavaScript Code Node) replacing single AI agent
2. 4 specialist agents: Complaint, Blood, Donor, Status/Info
3. Smart Donor Cascade (JS-15B — tiered notification)
4. Race condition handling (Postgres advisory locks)
5. Medical eligibility (gender-based cooldowns, deferrals, screening)
6. Donation certificates (PDF + QR verify)
7. Frontend: agent observability dashboard, blood ops dashboard, donor self-service portal

**Why:**
The single-agent JS-01 hit its ceiling — "Yess" responses got misrouted between complaint/blood/donor flows. Multi-agent with deterministic routing solves this. Plus, mass-broadcasting blood requests to 100 donors caused spam and race conditions — cascade engine fixes that.

## ✅ Recently Completed

- **Rakta Sahayak basic flow** — JS-15 + JS-16 deployed (2026-05-25)
- **WhatsApp Chat Dashboard** in admin UI (2026-05-01)
- **NeuroSetu AI branding** added to login + dashboard (2026-05-01)
- **AI Project Context system** — this folder + Supabase `ai_project_context` table (2026-05-26)

## 🎯 Next Up (after current spec)

- Officer-facing mobile app (PWA) for handling assigned complaints on the go
- Multilingual TTS for citizens who can't read (audio replies)
- Predictive SLA breach (ML on `intelligence_runs`)
- Integration with Aadhaar e-KYC for verified citizen profiles
- WhatsApp interactive messages (buttons, lists) for cleaner UX

## 🐛 Known Issues / Tech Debt

- `find_matching_donors` RPC needs index on `(blood_group, district, next_eligible_date)` for performance at scale
- `blood_donors` lacks `latitude/longitude` — can't do true distance-based matching yet (only district + block)
- Officer email replies parsed via regex in JS-13 — fragile, should move to NLP
- `conversation_sessions.session_id` is plain phone — should hash for privacy at rest
- No automated tests yet for n8n workflows — manual smoke testing only

## 📊 Production Stats (rough)

- Active complaints: tracked via `complaint_stats`
- Registered donors: query `blood_donors` (active count)
- Daily WhatsApp messages: query `whatsapp_messages` for last 24h
- Officer response rate: see `officer_score_dashboard`

Run `SELECT * FROM dashboard_stats_view` for current numbers.
