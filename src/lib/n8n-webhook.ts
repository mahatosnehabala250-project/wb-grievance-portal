import { createClient } from '@supabase/supabase-js';

/**
 * The portal's one outbound automation call: telling a worker a complaint is
 * theirs.
 *
 * Everything else the portal used to "send" went to /auto-assign,
 * /notify-citizen and /notify-officer — paths that answer 404 on the live n8n.
 * That work belongs to database triggers instead (trg_js02_triage on insert,
 * trg_js04_status_update on any status change), so those calls are gone.
 *
 * Manual assignment was the gap no trigger covered: trg_js03_dispatch fires
 * only when n8nProcessed flips true on a REGISTERED complaint, which a
 * hand-assignment never does. An MLA could give a case to a named worker and
 * that worker would never hear about it.
 *
 * The URL comes from `n8n_webhook_config`, the same table the database triggers
 * read through get_webhook_url(). It used to come from an N8N_WEBHOOK_URL
 * environment variable that is not in .env.example and was never set in
 * production — so sendN8NWebhook logged a warning and returned, and every
 * cascade this file exposed had been silently doing nothing. One place to
 * configure a webhook is the point; two, one of them undocumented, is how this
 * went unnoticed.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TIMEOUT_MS = 8000;

/** The configured, enabled URL for a webhook key, or null if there is none. */
async function webhookUrl(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('n8n_webhook_config')
    .select('url')
    .eq('key', key)
    .eq('enabled', true)
    .maybeSingle();

  if (error || !data?.url) {
    console.error(`[n8n-webhook] no enabled URL configured for "${key}"`);
    return null;
  }
  return String(data.url);
}

/**
 * Fire-and-forget, but never silent: a failure here means a field worker was
 * not told about their complaint, which is worth a log line even though the
 * caller cannot wait for it.
 */
async function post(key: string, body: Record<string, unknown>): Promise<void> {
  const url = await webhookUrl(key);
  if (!url) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[n8n-webhook] ${key} responded ${res.status}`);
    }
  } catch (err) {
    console.error(`[n8n-webhook] ${key} failed:`, err instanceof Error ? err.message : err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tell the person a complaint was just handed to.
 *
 * JS-26 is deliberately narrow: it notifies the assignee the portal chose. It
 * does NOT reuse JS-03, which runs its own auto-assignment and would overwrite
 * that choice.
 */
export function notifyN8NAssignment(complaintId: string, assignedToId: string): void {
  void post('notify_assignee', {
    complaintId,
    assignedToId,
    timestamp: new Date().toISOString(),
    source: 'manual_assignment',
  });
}
