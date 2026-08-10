/**
 * n8n Webhook Helper — Cross-Workflow Cascade System
 *
 * Server-side utility for sending notifications to n8n webhooks.
 * All calls are fire-and-forget — failures are logged but never thrown,
 * so they never block the main API response.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                    WORKFLOW CASCADE MAP                            │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │  Next.js Event          →  n8n Webhook       →  Workflow           │
 * │  ─────────────────────────────────────────────────────────────────  │
 * │  New Complaint Created  →  /auto-assign       →  WB-02 (Assign)    │
 * │  Status Changed         →  /notify-citizen    →  WB-03 (Notify)    │
 * │  Officer Assigned       →  /notify-officer    →  WB-04 (Notify)    │
 * │  Urgency Escalated      →  /notify-officer    →  WB-04 (Alert)     │
 * │  SLA Batch Escalation   →  /notify-citizen    →  WB-03 (Alert)     │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * n8n Internal Chains (toolSubWorkflow):
 *   WB-01 (WhatsApp Intake) ──tool──→ WB-02 (Auto-Assign)
 */

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';

/* ══════════════════════════════════════════════════════════════
   CORE WEBHOOK SENDER
   ══════════════════════════════════════════════════════════════ */

/**
 * Send a POST request to an n8n webhook path.
 * Errors are caught and logged — this function never throws.
 */
async function sendN8NWebhook(
  webhookPath: string,
  payload: Record<string, unknown>,
  timeoutMs = 5000
): Promise<void> {
  if (!N8N_WEBHOOK_URL) {
    console.warn('[n8n-webhook] N8N_WEBHOOK_URL is not configured — skipping webhook call');
    return;
  }

  const url = `${N8N_WEBHOOK_URL.replace(/\/+$/, '')}/${webhookPath.replace(/^\/+/, '')}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(
        `[n8n-webhook] Non-OK response from ${url}: ${response.status} ${response.statusText}`
      );
    } else {
      console.log(`[n8n-webhook] ✅ Successfully notified ${webhookPath}`);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.warn(`[n8n-webhook] Timeout (${timeoutMs}ms) calling ${url}`);
    } else {
      console.warn(`[n8n-webhook] Error calling ${url}:`, error);
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   NOTIFICATION FUNCTIONS — Call these from Next.js API routes
   ══════════════════════════════════════════════════════════════ */

/**
 * Tell the person a complaint was just handed to.
 *
 * This is the only cascade the portal still owns. The others posted to
 * /auto-assign, /notify-citizen and /notify-officer — paths that answer 404 on
 * the live n8n, and have for as long as anyone can tell, silently, because
 * every call was fire-and-forget with an empty catch. Their work is done by
 * database triggers instead (trg_js02_triage on insert, trg_js04_status_update
 * on any status change), so removing them loses nothing and stops the portal
 * pretending to send messages that never left.
 *
 * Manual assignment was the one thing no trigger covered: trg_js03_dispatch
 * fires only when n8nProcessed flips true on a REGISTERED complaint, which a
 * hand-assignment never does. So an MLA could give a complaint to a named
 * worker and that worker would never hear about it.
 *
 * JS-26 is deliberately narrow: it notifies the assignee the portal chose. It
 * does NOT reuse JS-03, which runs its own auto-assignment and would overwrite
 * that choice.
 */
export function notifyN8NAssignment(complaintId: string, assignedToId: string): void {
  sendN8NWebhook('js-notify-assignee', {
    complaintId,
    assignedToId,
    timestamp: new Date().toISOString(),
    source: 'manual_assignment',
  }).catch(() => {});
}
