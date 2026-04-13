/**
 * n8n Webhook Helper
 *
 * Server-side utility for sending notifications to n8n webhooks.
 * All calls are fire-and-forget — failures are logged but never thrown,
 * so they never block the main API response.
 */

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';

/**
 * Send a POST request to an n8n webhook path.
 * Errors are caught and logged — this function never throws.
 */
async function sendN8NWebhook(webhookPath: string, payload: Record<string, unknown>): Promise<void> {
  if (!N8N_WEBHOOK_URL) {
    console.warn('[n8n-webhook] N8N_WEBHOOK_URL is not configured — skipping webhook call');
    return;
  }

  const url = `${N8N_WEBHOOK_URL.replace(/\/+$/, '')}/${webhookPath.replace(/^\/+/, '')}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

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
      console.log(`[n8n-webhook] Successfully notified ${webhookPath}`);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.warn(`[n8n-webhook] Timeout (5000ms) calling ${url}`);
    } else {
      console.warn(`[n8n-webhook] Error calling ${url}:`, error);
    }
  }
}

/**
 * Notify n8n that a complaint's status has changed.
 * Fire-and-forget — call without await.
 */
export function notifyN8NStatusChange(complaintId: string, status: string): void {
  sendN8NWebhook('status-change', {
    complaintId,
    status,
    timestamp: new Date().toISOString(),
  }).catch(() => {
    // Double safety — should never throw, but just in case
  });
}

/**
 * Notify n8n that a complaint has been assigned to an officer.
 * Fire-and-forget — call without await.
 */
export function notifyN8NAssignment(complaintId: string, officerId: string): void {
  sendN8NWebhook('assignment-change', {
    complaintId,
    assignedToId: officerId,
    timestamp: new Date().toISOString(),
  }).catch(() => {
    // Double safety — should never throw, but just in case
  });
}
