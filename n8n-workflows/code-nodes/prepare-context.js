/**
 * Prepare Context — n8n Code Node (self-contained)
 *
 * Source: src/lib/sessions/prepareContext.ts
 * Position in workflow: after Upsert Session, before CEO Router
 *
 * This file is self-contained. No require/import — runs in n8n's sandboxed VM.
 *
 * Responsibility (Req 1.7-1.9):
 *   - Reads the session from $json.session (already loaded by Upsert Session)
 *   - Performs the 30-minute stale-session check
 *   - On stale: calls POST /api/sessions/prepare-context to atomically reset
 *     session fields and insert routing_decisions audit row
 *   - On fresh: calls POST /api/sessions/prepare-context to bump last_activity_at
 *   - Returns { ...$json, session, was_reset, prev_last_intent } to CEO Router
 *
 * The actual DB writes (UPDATE conversation_sessions, INSERT routing_decisions)
 * are performed server-side by the /api/sessions/prepare-context endpoint which
 * uses the shared prepareContext.ts logic.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §Components → Prepare Context
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirements 1.7, 1.8, 1.9
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const STALE_MS = 30 * 60 * 1000; // 30 minutes in milliseconds

// ─── Configuration ───────────────────────────────────────────────────────────
// These are set as workflow-level static data or environment variables in n8n.
// $env is available in n8n Code Nodes for reading environment variables.

const API_BASE_URL = $env.API_BASE_URL || 'https://wb-grievance-portal.vercel.app';
const N8N_SECRET = $env.N8N_WEBHOOK_SECRET || '';

// ─── Input ───────────────────────────────────────────────────────────────────
// $json is the input item from the previous node (Upsert Session).
// Expected shape:
//   $json.phone     — session_id (WhatsApp phone number)
//   $json.trace_id  — UUIDv7 from Parse Message
//   $json.session   — conversation_sessions row loaded by Upsert Session
//   $json.message   — { text, original_text } from Parse Message
//   $json.parsed    — alternative location for message data

const phone = $json.phone || ($json.parsed && $json.parsed.phone) || '';
const traceId = $json.trace_id || ($json.parsed && $json.parsed.trace_id) || null;
const session = $json.session || {};
const messageText = ($json.message && $json.message.text)
  || ($json.parsed && $json.parsed.text)
  || '';

// ─── Stale-Session Check (in-memory first, then persist via API) ─────────────

let wasReset = false;
let prevLastIntent = session.last_intent || null;

const nowMs = Date.now();
const nowIso = new Date(nowMs).toISOString();

// Compute staleness from last_activity_at
const lastActivityAt = session.last_activity_at || null;
const lastActivityMs = lastActivityAt ? new Date(lastActivityAt).getTime() : 0;
const isStale = lastActivityMs > 0 && (nowMs - lastActivityMs > STALE_MS);

if (isStale) {
  // ─── Stale: reset session fields in-memory (Req 1.8) ────────────────────
  prevLastIntent = session.last_intent || 'idle';

  session.last_intent = 'idle';
  session.collected_data = {};
  session.flow_stack = [];
  session.last_activity_at = nowIso;

  wasReset = true;
} else {
  // ─── Fresh: just bump last_activity_at in-memory ────────────────────────
  session.last_activity_at = nowIso;
}

// ─── Persist via API endpoint ────────────────────────────────────────────────
// Call POST /api/sessions/prepare-context to perform the atomic DB operations:
//   - On stale: UPDATE conversation_sessions (reset) + INSERT routing_decisions
//   - On fresh: UPDATE conversation_sessions (bump last_activity_at)

try {
  const response = await $http.request({
    method: 'POST',
    url: `${API_BASE_URL}/api/sessions/prepare-context`,
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-SECRET': N8N_SECRET,
    },
    body: {
      phone: phone,
      message_text: messageText,
      trace_id: traceId,
      session: $json.session || {},
    },
  });

  // If the API call succeeds, use its response to ensure consistency
  if (response && response.body && response.body.ok) {
    const apiResult = response.body;
    // Prefer the server-side session state (authoritative after DB write)
    if (apiResult.session) {
      Object.assign(session, apiResult.session);
    }
    wasReset = apiResult.was_reset ?? wasReset;
    prevLastIntent = apiResult.prev_last_intent ?? prevLastIntent;
  }
} catch (err) {
  // If the API call fails, we still proceed with the in-memory computation.
  // The session state was already computed above — the CEO Router can still
  // make a correct decision. The DB write will be retried by the workflow's
  // error handler or the next message from this user.
  // Log the error for observability but don't block the flow.
  console.warn('[Prepare Context] API call failed, using in-memory state:', err.message || err);
}

// ─── Output ──────────────────────────────────────────────────────────────────
// Forward everything to the CEO Router with the enriched session state.

return [{
  json: {
    ...$json,
    session: session,
    was_reset: wasReset,
    prev_last_intent: prevLastIntent,
    // Convenience fields for downstream nodes (e.g., conditional routing/log nodes)
    _stale_reset_log: wasReset ? {
      session_id: phone,
      message_text: (messageText || '').slice(0, 200),
      last_intent_before: prevLastIntent,
      agent_dispatched: null,
      reason: 'session_stale_reset',
      trace_id: traceId,
    } : null,
  },
}];
