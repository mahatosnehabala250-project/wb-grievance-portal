# Phase 1 — Government-Ready Production (P0: Security + DPDP + Guardrail)

Goal: make JS-01 (the live WhatsApp citizen agent) legally and operationally
safe for a West Bengal government deployment. JS-01 stays live throughout;
each piece is additive.

## Scope (P0 — legally required before public launch)

### 1. WhatsApp webhook signature verification
- Verify `X-Hub-Signature-256` (HMAC-SHA256 with the Meta app secret) on the
  inbound webhook so only Meta can trigger the workflow.
- New env: `WHATSAPP_APP_SECRET`.
- Route: `POST /api/webhook/whatsapp-verify` (n8n calls it before processing).

### 2. Per-phone rate limiting (anti-abuse)
- Already coded in `src/lib/rateLimit/check.ts` + `rate_limit_check` SQL fn.
- Wire `wa_inbound` bucket (30 msgs / 5 min) into the inbound path.

### 3. DPDP Act 2023 — consent + privacy
- `citizen_consent` table: phone, consent_given, consent_text_version, ts, withdrawn_at.
- First-contact consent ask (one line) before storing PII.
- `POST /api/consent/record`, `GET /api/consent/status`.
- Right to erasure: `POST /api/consent/erase` (deletes/anonymises citizen PII).
- Data retention: cron auto-anonymises resolved complaints + sessions older than N days.

### 4. Audit log
- `pii_audit_log` table: who/when/what PII was read or written.
- Helper `src/lib/audit/log.ts`, wired into PII-writing routes.

### 5. Output guardrail (safe mode)
- `src/lib/guardrail/check.ts` exists. Add a "repair-only, never block" wrapper
  and a `POST /api/guardrail/apply` the workflow can call before Send Reply.

## Status
- [ ] 1. Webhook signature verification
- [ ] 2. Rate limit wired
- [ ] 3a. consent tables + RLS
- [ ] 3b. consent record/status/erase routes
- [ ] 3c. retention cron
- [ ] 4. audit log table + helper
- [ ] 5. guardrail apply route

## Notes
- JS-01 workflow id: YsUZwu99ckTnzekR (live). Do not break.
- All n8n-facing routes use X-N8N-SECRET auth (existing pattern).
