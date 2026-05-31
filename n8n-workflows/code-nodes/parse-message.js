// Parse Message — n8n Code Node (FIRST node in JS-01v2).
//
// Extracts phone + text from the WhatsApp Cloud API webhook payload and assigns
// ONE trace_id (UUIDv7) per inbound message. Uses the SAME robust extraction as
// JS-01 (handles entry→changes→value unwrap AND the already-unwrapped shape the
// n8n WhatsApp Trigger delivers), then adds v1.1 fields: trace_id, lowercased
// `text` (for keyword routing) + case-preserved `original_text` (for ticket regex).
//
// Self-contained (n8n sandbox: no import/require). Emits ONE item per text
// message; skips status callbacks and non-text messages.

const UUID7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid7(s) { return typeof s === 'string' && UUID7_RE.test(s); }
function randomBytes(out) {
  const g = (typeof globalThis !== 'undefined') ? globalThis : {};
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') { g.crypto.getRandomValues(out); return out; }
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}
const HEX = [];
for (let i = 0; i < 256; i++) HEX.push((i + 256).toString(16).slice(1));
function uuid7(now) {
  if (now == null) now = Date.now();
  const b = new Uint8Array(16);
  const ts = Math.max(0, Math.floor(now));
  b[0] = Math.floor(ts / 1099511627776) & 255;
  b[1] = Math.floor(ts / 4294967296) & 255;
  b[2] = Math.floor(ts / 16777216) & 255;
  b[3] = Math.floor(ts / 65536) & 255;
  b[4] = Math.floor(ts / 256) & 255;
  b[5] = ts & 255;
  const rand = randomBytes(new Uint8Array(10));
  for (let i = 0; i < 10; i++) b[6 + i] = rand[i];
  b[6] = (b[6] & 15) | 112;
  b[8] = (b[8] & 63) | 128;
  return (
    HEX[b[0]] + HEX[b[1]] + HEX[b[2]] + HEX[b[3]] + '-' +
    HEX[b[4]] + HEX[b[5]] + '-' +
    HEX[b[6]] + HEX[b[7]] + '-' +
    HEX[b[8]] + HEX[b[9]] + '-' +
    HEX[b[10]] + HEX[b[11]] + HEX[b[12]] + HEX[b[13]] + HEX[b[14]] + HEX[b[15]]
  );
}
function inboundTraceId(m) {
  const headers = (m && (m.headers || m.header)) || (m && m.body && m.body.headers);
  if (headers && typeof headers === 'object') {
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'x-trace-id' && isUuid7(String(headers[k]).trim())) return String(headers[k]).trim();
    }
  }
  if (m && isUuid7(String(m.trace_id || '').trim())) return String(m.trace_id).trim();
  return null;
}

const items = $input.all();
const out = [];
for (const it of items) {
  const raw = (it.json && it.json.body) || it.json || {};
  let body = raw;
  // Unwrap the full Cloud-API envelope if present (entry → changes → value).
  if (raw.entry && Array.isArray(raw.entry)) {
    for (const entry of raw.entry) {
      for (const change of (entry.changes || [])) {
        if (change.field === 'messages' && change.value) { body = change.value; break; }
      }
    }
  }
  // Skip delivery/read status callbacks (no user message).
  if (body.statuses && !body.messages) continue;
  if (!body.messages || body.messages.length === 0) continue;

  for (const msg of body.messages) {
    // Accept text messages and interactive (button/list) replies.
    let rawText = '';
    if (msg.type === 'text' && msg.text && msg.text.body) rawText = msg.text.body;
    else if (msg.type === 'interactive' && msg.interactive) {
      const inter = msg.interactive;
      rawText = (inter.button_reply && (inter.button_reply.id || inter.button_reply.title))
        || (inter.list_reply && (inter.list_reply.id || inter.list_reply.title)) || '';
    } else if (msg.button && msg.button.text) rawText = msg.button.text;
    rawText = (rawText || '').trim();
    if (!rawText) continue;

    const phone = msg.from || body.from || '';
    const trace_id = inboundTraceId(it.json) || uuid7();

    out.push({
      json: {
        phone,
        message: { text: rawText.toLowerCase(), original_text: rawText },
        trace_id,
        message_id: msg.id || null,
        raw: it.json,
      },
    });
  }
}

// Defensive: if nothing parsed, still emit a single empty item so downstream
// nodes fail gracefully rather than the workflow stopping with 0 items.
if (out.length === 0) {
  return [{ json: { phone: '', message: { text: '', original_text: '' }, trace_id: uuid7(), skip: true } }];
}
return out;
