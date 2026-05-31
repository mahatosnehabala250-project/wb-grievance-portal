/**
 * Output Guardrail — n8n Code Node (self-contained, no require/import).
 *
 * Task 23.3 — Design §v1.1.6 Output Guardrail (Req 25.8, 25.10).
 *
 * PLACEMENT IN JS-01v2
 * --------------------
 * Inserted between every specialist agent reply and the Send Reply WhatsApp
 * node. Each AI-agent branch (Complaint / Blood / Donor Agent) feeds this node
 * instead of going straight to Send Reply; this node forwards a (possibly
 * repaired or substituted) $json.reply onward to Send Reply.
 *
 * Mirrors src/lib/guardrail/check.ts + rules/* exactly (kept in sync by hand;
 * the TS modules are the source of truth and are unit/property tested). All
 * checks are pure regex/string/Set — no LLM, no DB, no network on the hot path
 * (Req 25.1, 25.9).
 *
 * RULE ORDER (sequential, short-circuit on substitute-grade):
 *   1. length cap        — repair (truncate)
 *   2. url allowlist     — repair (strip)
 *   3. json/tool leak    — repair (strip)
 *   4. pii leak          — repair (mask)
 *   5. refusal text      — substitute (block)
 *   6. language mismatch — substitute (block)
 * Repair-then-recheck (single re-pass) escalates a residual violation to a block.
 *
 * OUTPUT CONTRACT
 * ---------------
 *   $json.reply              : string  — the reply to actually send (orig/repaired/fallback)
 *   $json.guardrail_action   : 'pass' | 'repaired' | 'blocked'
 *   $json.guardrail_violations : string[] — rule ids that fired
 *
 * On a non-pass action this node fires a best-effort POST /api/guardrail/log
 * (truncating before/after to 1000 chars) — fire-and-forget, never blocks the
 * citizen reply (Design §Observability).
 *
 * @see src/lib/guardrail/check.ts, src/lib/guardrail/rules/*
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.6
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 25
 */

// ─── Config ────────────────────────────────────────────────────────────────
const API_BASE_URL = $env.API_BASE_URL || 'https://wb-grievance-portal.vercel.app';
const N8N_SECRET = $env.N8N_WEBHOOK_SECRET || '';

const DEFAULT_MAX_CHARS = 1000;
const ELLIPSIS = '...';

const FALLBACK_LINES = {
  hi: 'Ek minute ruko, main fir se check karta hoon. Aap ki query process ho rahi hai.',
  en: 'One moment please — I am checking on this and will get back to you shortly.',
  bn: 'Ek minute opekkha korun, ami abar dekhchi. Apnar onurodh process hocche.',
};

// ─── Rule: length cap (Req 25.5) ─────────────────────────────────────────────
function enforceLength(reply, maxChars) {
  const text = reply || '';
  if (text.length <= maxChars) return { violated: false, repaired: text };
  const budget = Math.max(0, maxChars - ELLIPSIS.length);
  let cut = text.slice(0, budget);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > budget * 0.6) cut = cut.slice(0, lastSpace);
  return { violated: true, repaired: cut.replace(/\s+$/, '') + ELLIPSIS };
}

// ─── Rule: URL allowlist (Req 25.6) ──────────────────────────────────────────
const URL_RE = /(https?:\/\/[^\s]+)/gi;
const ALLOWED_DOMAINS = ['wb-grievance-portal.gov.in', 'wa.me', 'supabase.co'];
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); }
  catch {
    const m = /^https?:\/\/([^/?#\s]+)/i.exec(url);
    return m ? m[1].toLowerCase() : null;
  }
}
function isAllowedHost(host) {
  for (const d of ALLOWED_DOMAINS) {
    if (host === d || host.endsWith('.' + d)) return true;
  }
  return false;
}
function checkUrls(reply) {
  const text = reply || '';
  let violated = false;
  const repaired = text.replace(URL_RE, (raw) => {
    const url = raw.replace(/[).,;:!?'"\]]+$/, '');
    const trailing = raw.slice(url.length);
    const host = hostOf(url);
    if (host && isAllowedHost(host)) return raw;
    violated = true;
    return trailing;
  });
  if (!violated) return { violated: false, repaired: text };
  const cleaned = repaired.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:!?])/g, '$1');
  return { violated: true, repaired: cleaned };
}

// ─── Rule: json / tool leak (Req 25.7) ───────────────────────────────────────
const TOOL_NAMES = ['ValidateBlock','CheckDuplicate','RegisterComplaint','CreateBloodRequest','DonorRespond','SeekerConfirm','SaveSessionState','RegisterDonor','UpdateDonorStatus','RecordDonation','DeferDonor'];
const TOOL_SENTINELS = ['function_call', 'system:', 'tools:'];
const FENCE_RE = /```[a-zA-Z0-9]*[\s\S]*?(?:```|$)/g;
const JSON_OBJ_RE = /\{[^{}]*"[^"]*"\s*:[^{}]*\}/g;
const TOKEN_RE = new RegExp(
  TOOL_SENTINELS.concat(TOOL_NAMES).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'gi'
);
function detectJsonLeak(reply) {
  const text = reply || '';
  const violated = /```/.test(text) || JSON_OBJ_RE.test(text) || new RegExp(TOKEN_RE.source, 'i').test(text);
  // reset lastIndex on the global regex used above
  JSON_OBJ_RE.lastIndex = 0;
  if (!violated) return { violated: false, repaired: text };
  let repaired = text.replace(FENCE_RE, '').replace(JSON_OBJ_RE, '').replace(TOKEN_RE, '');
  repaired = repaired.replace(/[ \t]{2,}/g, ' ').replace(/ *\n{3,} */g, '\n\n').trim();
  return { violated: true, repaired };
}

// ─── Rule: PII leak (Req 25.2) ───────────────────────────────────────────────
const PHONE_CC = /(\+?91[\s-]?)([6-9]\d{9})\b/g;
const PHONE_BARE = /\b[6-9]\d{9}\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
function maskTen(core) { return core.slice(0, 2) + 'X'.repeat(core.length - 4) + core.slice(-2); }
function detectPiiLeak(reply) {
  const text = reply || '';
  const violated = /(\+?91[\s-]?)?[6-9]\d{9}\b/.test(text) || /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text);
  if (!violated) return { violated: false, repaired: text };
  let repaired = text.replace(EMAIL, '[email hidden]');
  repaired = repaired.replace(PHONE_CC, (_m, cc, core) => cc + maskTen(core));
  repaired = repaired.replace(PHONE_BARE, (m) => maskTen(m));
  return { violated: true, repaired };
}

// ─── Rule: refusal text (Req 25.4) ───────────────────────────────────────────
const REFUSAL_PHRASES = ['i cannot','i can not',"i can't",'as an ai','i am unable to',"i'm unable to","i don't have",'i do not have',"i'm sorry, but i",'i am sorry, but i','as a language model','as an artificial intelligence'];
function detectRefusal(reply) {
  const text = reply || '';
  const hay = text.toLowerCase();
  for (const p of REFUSAL_PHRASES) {
    if (hay.includes(p)) return { violated: true };
  }
  return { violated: false };
}

// ─── Rule: language mismatch (Req 25.3) ──────────────────────────────────────
const ALLOWED_SCRIPTS = { en: ['latin'], hi: ['latin', 'devanagari'], bn: ['latin', 'bengali'] };
function countMatches(text, re) { const m = text.match(re); return m ? m.length : 0; }
function checkLanguage(reply, lang) {
  const text = reply || '';
  const counts = {
    devanagari: countMatches(text, /[\u0900-\u097F]/g),
    bengali: countMatches(text, /[\u0980-\u09FF]/g),
    latin: countMatches(text, /[A-Za-z]/g),
  };
  const total = counts.devanagari + counts.bengali + counts.latin;
  if (total === 0) return { violated: false };
  let dominant = 'latin', best = -1;
  for (const s of ['devanagari', 'bengali', 'latin']) {
    if (counts[s] > best) { best = counts[s]; dominant = s; }
  }
  const allowed = ALLOWED_SCRIPTS[lang] || ALLOWED_SCRIPTS.en;
  return { violated: allowed.indexOf(dominant) === -1 };
}

// ─── Umbrella check (mirrors src/lib/guardrail/check.ts) ──────────────────────
function normalizeLang(l) { return (l === 'hi' || l === 'bn' || l === 'en') ? l : 'en'; }

function runGuardrail(reply, lang, maxChars) {
  const violations = [];
  let current = reply || '';
  let repaired = false;

  const len = enforceLength(current, maxChars);
  if (len.violated) { violations.push('length_cap'); current = len.repaired; repaired = true; }

  const url = checkUrls(current);
  if (url.violated) { violations.push('url_allowlist'); current = url.repaired; repaired = true; }

  const json = detectJsonLeak(current);
  if (json.violated) { violations.push('json_leak'); current = json.repaired; repaired = true; }

  const pii = detectPiiLeak(current);
  if (pii.violated) { violations.push('pii_leak'); current = pii.repaired; repaired = true; }

  if (detectRefusal(current).violated) {
    violations.push('refusal_text');
    return { action: 'blocked', reply: FALLBACK_LINES[lang], violations };
  }
  if (checkLanguage(current, lang).violated) {
    violations.push('language_mismatch');
    return { action: 'blocked', reply: FALLBACK_LINES[lang], violations };
  }

  if (repaired) {
    const residual =
      enforceLength(current, maxChars).violated ||
      checkUrls(current).violated ||
      detectJsonLeak(current).violated ||
      detectPiiLeak(current).violated;
    if (residual || current.trim().length === 0) {
      return { action: 'blocked', reply: FALLBACK_LINES[lang], violations };
    }
  }

  if (violations.length === 0) return { action: 'pass', reply: current, violations };
  return { action: 'repaired', reply: current, violations };
}

// ─── Best-effort violation logger (fire-and-forget) ───────────────────────────
async function logViolation(fields) {
  if (!N8N_SECRET) return;
  try {
    await $http.request({
      method: 'POST',
      url: `${API_BASE_URL}/api/guardrail/log`,
      headers: { 'Content-Type': 'application/json', 'X-N8N-SECRET': N8N_SECRET, 'X-Trace-Id': fields.trace_id || '' },
      body: fields,
      timeout: 3000,
    });
  } catch (err) {
    console.warn('[Guardrail] violation log failed (non-blocking):', (err && err.message) || err);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const item = $input.first().json;
const session = item.session || {};
const lang = normalizeLang(session.language || 'hi');
// AI Agent nodes emit their text on `$json.output`; code-node branches and the
// Gemini-substitute set `$json.reply`. Read both so the guardrail actually
// inspects the AI agent's real reply (not an empty string).
const originalReply = item.reply || item.output || '';

const result = runGuardrail(originalReply, lang, DEFAULT_MAX_CHARS);

if (result.action !== 'pass') {
  await logViolation({
    session_id: item.phone || session.session_id || null,
    agent_invocation_id: item.agent_invocation_id || null,
    trace_id: item.trace_id || null,
    rule_name: result.violations.join(',') || 'unknown',
    original_reply: (originalReply || '').slice(0, 1000),
    repaired_reply: result.action === 'blocked' ? null : (result.reply || '').slice(0, 1000),
    action: result.action,
    severity: result.action === 'blocked' ? 'high' : 'medium',
  });
}

return [{
  json: {
    ...item,
    // Write the guardrailed text to BOTH fields so the Send Reply node (which
    // reads `$json.reply || $json.output`) always sends the checked version.
    reply: result.reply,
    output: result.reply,
    guardrail_action: result.action,
    guardrail_violations: result.violations,
    guardrail_blocked: result.action === 'blocked',
  },
}];
