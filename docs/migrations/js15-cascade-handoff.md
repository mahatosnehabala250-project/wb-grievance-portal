# JS-15 → JS-15B Cascade Handoff (Manual n8n Change)

> **Task 8.2** — After JS-15 sends Tier 1 notifications, add an HTTP Request node that triggers JS-15B via the cascade-trigger API endpoint.

## What to do

In the n8n editor, open the **JS-15: Rakta Sahayak** workflow and add a single HTTP Request node **after** the Tier 1 WhatsApp send completes, **before** the workflow ends.

This node calls `POST /api/n8n/cascade-trigger` which:
1. Marks `cascade_tier = 1` on the blood request (idempotent — safe to retry)
2. Fires JS-15B's webhook to begin the tiered cascade (Tier 2, 3, 4 waits)

JS-15 continues to handle Tier 1 exactly as before. JS-15B takes over subsequent tiers.

## Where to place it

```
... → [Send Tier 1 WhatsApp (existing)] → [Trigger JS-15B Cascade ← ADD THIS] → [End / NoOp]
```

Wire the new node's input from the last node that completes Tier 1 sends. Wire its output to the workflow end (or a NoOp node).

## HTTP Request Node Configuration (copy-paste ready)

Add a new **HTTP Request** node with these settings:

| Field | Value |
|-------|-------|
| **Name** | `Trigger JS-15B Cascade` |
| **Method** | `POST` |
| **URL** | `={{$env.API_BASE_URL}}/api/n8n/cascade-trigger` |
| **Authentication** | None (secret is in headers) |
| **Send Headers** | ✅ Enabled |
| **Continue On Fail** | ✅ Enabled (cascade failure must not break Tier 1) |

### Headers

| Name | Value |
|------|-------|
| `Content-Type` | `application/json` |
| `X-N8N-SECRET` | `={{$env.N8N_WEBHOOK_SECRET}}` |

### Body (JSON)

```json
{
  "blood_request_id": "={{ $json.blood_request_id }}"
}
```

> **Note:** `$json.blood_request_id` should already be available in the execution context from the blood request creation step earlier in JS-15. Adjust the expression if your node output uses a different path (e.g., `$('Create Blood Request').item.json.id`).

## Environment Variables Required

Make sure these are set in your n8n instance:

| Variable | Example | Description |
|----------|---------|-------------|
| `API_BASE_URL` | `https://your-app.vercel.app` | Base URL of the Next.js app |
| `N8N_WEBHOOK_SECRET` | `your-shared-secret` | Shared secret for n8n ↔ API auth |

## Verification

After adding the node:

1. Trigger a test blood request with `urgency = "routine"`
2. Confirm Tier 1 WhatsApp messages still send normally
3. Check the API logs — you should see `[n8n/cascade-trigger]` confirming `cascade_tier` was set to 1
4. Confirm JS-15B's webhook fires (check JS-15B execution history in n8n)

## Idempotency

The `/api/n8n/cascade-trigger` endpoint is idempotent — if `cascade_tier > 0` already, it returns a no-op response. Safe to retry on transient failures.
