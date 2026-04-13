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
 * 🔗 CASCADE: New Complaint → WB-02 Auto-Assignment Engine
 *
 * Call this when a NEW complaint is created (from WhatsApp or manual).
 * Triggers the AI Smart Match workflow to find the best officer.
 *
 * Webhook path: /auto-assign → WB-02
 */
export function notifyN8NNewComplaint(
  complaintId: string,
  complaintData: {
    issue: string;
    category?: string;
    block: string;
    district: string;
    urgency?: string;
  }
): void {
  sendN8NWebhook('auto-assign', {
    complaintId,
    ...complaintData,
    timestamp: new Date().toISOString(),
    source: 'new_complaint',
  }).catch(() => {});
}

/**
 * 🔗 CASCADE: Status Change → WB-03 Citizen Status Notification
 *
 * Call this when a complaint's STATUS changes (OPEN → IN_PROGRESS → RESOLVED etc.)
 * Triggers citizen WhatsApp/SMS notification about the status update.
 *
 * Webhook path: /notify-citizen → WB-03
 */
export function notifyN8NStatusChange(complaintId: string, status: string): void {
  sendN8NWebhook('notify-citizen', {
    complaintId,
    status,
    timestamp: new Date().toISOString(),
    source: 'status_change',
  }).catch(() => {});
}

/**
 * 🔗 CASCADE: Officer Assignment → WB-04 Officer Assignment Notification
 *
 * Call this when a complaint is ASSIGNED to an officer (auto or manual).
 * Triggers WhatsApp + Email notification to the assigned officer.
 *
 * Webhook path: /notify-officer → WB-04
 */
export function notifyN8NAssignment(complaintId: string, officerId: string): void {
  sendN8NWebhook('notify-officer', {
    complaintId,
    assignedToId: officerId,
    timestamp: new Date().toISOString(),
    source: 'assignment',
  }).catch(() => {});
}

/**
 * 🔗 CASCADE: Urgency Escalation → WB-04 Officer Escalation Alert
 *
 * Call this when a complaint's URGENCY is escalated (e.g. SLA breach → CRITICAL).
 * Triggers WhatsApp + Email alert to the assigned officer about escalation.
 *
 * Webhook path: /notify-officer → WB-04
 */
export function notifyN8NUrgencyEscalation(
  complaintId: string,
  previousUrgency: string,
  newUrgency: string,
  reason: string = 'SLA Breach'
): void {
  sendN8NWebhook('notify-officer', {
    complaintId,
    escalation: true,
    previousUrgency,
    newUrgency,
    reason,
    timestamp: new Date().toISOString(),
    source: 'urgency_escalation',
  }).catch(() => {});
}

/**
 * 🔗 CASCADE: Batch SLA Breach → WB-03 Citizen Notification (batch)
 *
 * Call this when multiple complaints are escalated in batch (WB-05 SLA Breach).
 * Sends a combined alert to citizens about their complaint escalation.
 *
 * Webhook path: /notify-citizen → WB-03
 */
export function notifyN8NSLABatch(
  complaints: Array<{
    id: string;
    ticketNo: string;
    riskLevel: string;
    citizenPhone?: string;
  }>
): void {
  sendN8NWebhook('notify-citizen', {
    type: 'sla_batch',
    complaints,
    timestamp: new Date().toISOString(),
    source: 'sla_breach_batch',
  }, 10000).catch(() => {});
}
