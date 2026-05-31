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
- [x] 1. Webhook signature verification — /api/webhook/whatsapp-verify (GET handshake + POST HMAC). Enforces when WHATSAPP_APP_SECRET set.
- [ ] 2. Rate limit wired into the live workflow (helper + SQL fn already exist; needs a node call in JS-01)
- [x] 3a. consent tables + RLS + record_consent/erase/retention RPCs (locked to service_role)
- [x] 3b. consent record/status route (/api/consent) + erase route (/api/privacy/erase)
- [x] 3c. retention cron (/api/cron/data-retention, daily 04:00 UTC in vercel.json)
- [x] 4. pii_audit_log table + auto-audit inside the RPCs
- [x] 5. guardrail apply route (/api/guardrail/apply — strips progress_signal, repair-only, never empty)

## Deployed & tested (2026-05-31)
- All routes live on production and verified: consent (401 without secret, record+status with secret),
  guardrail/apply (strips progress_signal, returns clean reply), privacy/erase (401 guard),
  whatsapp-verify (enforcing — WHATSAPP_APP_SECRET is set).
- DB: citizen_consent + pii_audit_log tables, record_consent/erase_citizen_data/run_data_retention
  RPCs, all REVOKEd from anon/authenticated, granted to service_role only.
- Env set on Vercel: RETENTION_DAYS=365 (N8N_WEBHOOK_SECRET, CRON_SECRET, WHATSAPP_APP_SECRET already present).

## Wired into the live JS-01 workflow (2026-06-01)
- [x] Consent tool: `RecordConsent` (httpRequestTool) added to AI Agent (POST /api/consent).
- [x] Erasure tool: `EraseMyData` (httpRequestTool) added to AI Agent (POST /api/privacy/erase).
- [x] DPDP consent + erasure instructions added to the AI Agent systemMessage.
- [x] Output guardrail: `Guardrail` httpRequest node inserted between AI Agent and Send Reply.
  - Flow is now `... → AI Agent → Guardrail → Send Reply`.
  - Guardrail posts `{ reply: $json.output, language: Prepare Context.language }` to
    `/api/guardrail/apply` with `onError: continueRegularOutput` + `neverError` response
    (so a guardrail outage can never drop the citizen reply).
  - Send Reply textBody reads `$json.data.reply` (httpRequest v4.2 body) with fallbacks to
    `$json.body.data.reply` and the raw `$('AI Agent').output`, then a Bengali safe line.
  - Verified: workflow validates (23 nodes, 22 connections, 0 errors); live guardrail endpoint
    returns 200 and strips the progress_signal block.

## Remaining (optional P0)
- [ ] Rate-limit check on inbound (helper `src/lib/rateLimit/check.ts` + `rate_limit_check` SQL fn
      exist; needs a node call in JS-01 on the inbound path). Not yet wired.

## Notes
- JS-01 workflow id: YsUZwu99ckTnzekR (live). Do not break.
- All n8n-facing routes use X-N8N-SECRET auth (existing pattern).
