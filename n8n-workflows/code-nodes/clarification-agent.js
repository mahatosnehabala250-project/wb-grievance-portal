/**
 * Clarification Micro-Agent — n8n Code Node (self-contained, no require/import)
 *
 * Triggered by: Switch Node when CEO Router returns agent='clarification'
 * (i.e. decideHybrid confidence < 0.6 — Design §v1.1.1, Req 20.5)
 *
 * Responsibility:
 *   Sends a localized WhatsApp interactive list message with 5 service buttons
 *   and a "kuch aur" (none of these) escape. The user's button press arrives on
 *   the next turn with last_intent already set by the button payload, so the CEO
 *   Router routes correctly without another clarification round. The "kuch aur"
 *   escape sends a help text and keeps last_intent='idle'.
 *
 *   This node also writes its own routing_decisions row (reason='clarification_*')
 *   via the fire-and-forget observability path (POST /api/routing/log). The write
 *   is best-effort: any failure is swallowed so the citizen-facing reply is never
 *   blocked by an observability problem (Design §Observability — "Observability
 *   writes are fire-and-forget", Req 18.14, 18.16).
 *
 * Supported languages: hi (Hindi/Devanagari), bn (Bengali), en (English/default)
 *
 * Output:
 *   $json.reply        — plain-text fallback body (used by Send Reply node)
 *   $json.interactive  — WhatsApp interactive list payload (used by Send Reply node
 *                        when it detects the 'interactive' key)
 *   $json.agent        — 'clarification' (preserved for observability)
 *   $json.reason       — 'clarification_sent' | 'clarification_none_of_these' |
 *                        'clarification_intent_set'
 *   $json.session_update — { last_intent, active_agent? } for the downstream
 *                        session-save step (keeps last_intent='idle' for the
 *                        list/none paths; sets the chosen service intent on a
 *                        service button press).
 *
 * Requirements: 20.5 — Design §v1.1.1 (Clarification Micro-Agent)
 */

// ─── Configuration (env, read inside the n8n sandbox) ─────────────────────────

const API_BASE_URL = 'https://wb-grievance-portal.vercel.app';
const N8N_SECRET = 'REPLACE_WITH_N8N_WEBHOOK_SECRET';

// ─── Localization strings ─────────────────────────────────────────────────────

const L10N = {
  hi: {
    body: 'Aap ki madad ke liye main yeh kar sakta hoon — kya chahiye? 🙏',
    header: 'Sahayak Seva',
    footer: 'Ek option chunein',
    buttonLabel: 'Seva chunein',
    sections: [
      {
        title: 'Seva Options',
        rows: [
          {
            id: 'clarification:complaint_collecting',
            title: '📋 Shikayat darj karein',
            description: 'Sadak, paani, bijli, pension, school...',
          },
          {
            id: 'clarification:blood_collecting',
            title: '🩸 Blood chahiye',
            description: 'Blood request banayein',
          },
          {
            id: 'clarification:donor_registration',
            title: '❤️ Donor banna hai',
            description: 'Blood donor ke roop mein register karein',
          },
          {
            id: 'clarification:status_check',
            title: '🔍 Ticket status check karein',
            description: 'Apni shikayat ka status jaanein',
          },
          {
            id: 'clarification:info_query',
            title: 'ℹ️ Scheme ke baare mein',
            description: 'Sarkari yojanaon ki jaankari',
          },
          {
            id: 'clarification:none',
            title: '🔄 Kuch aur',
            description: 'Koi aur madad chahiye',
          },
        ],
      },
    ],
    noneReply:
      'Main aap ki madad karna chahta hoon! 🙏\n\nYeh services available hain:\n1️⃣ Shikayat darj karein — "shikayat" likhein\n2️⃣ Blood request — "blood chahiye" likhein\n3️⃣ Donor registration — "donor banna hai" likhein\n4️⃣ Ticket status — apna ticket number likhein (WB-YYYY-XXXXX)\n5️⃣ Scheme info — "yojana" likhein\n\nKya chahiye? Batayein! 😊',
  },

  bn: {
    body: 'আমি আপনাকে কীভাবে সাহায্য করতে পারি? একটি বিকল্প বেছে নিন 🙏',
    header: 'সহায়ক সেবা',
    footer: 'একটি বিকল্প বেছে নিন',
    buttonLabel: 'সেবা বেছে নিন',
    sections: [
      {
        title: 'সেবা বিকল্প',
        rows: [
          {
            id: 'clarification:complaint_collecting',
            title: '📋 অভিযোগ দায়ের করুন',
            description: 'রাস্তা, জল, বিদ্যুৎ, পেনশন, স্কুল...',
          },
          {
            id: 'clarification:blood_collecting',
            title: '🩸 রক্ত প্রয়োজন',
            description: 'রক্তের অনুরোধ করুন',
          },
          {
            id: 'clarification:donor_registration',
            title: '❤️ ডোনার হতে চাই',
            description: 'রক্তদাতা হিসেবে নিবন্ধন করুন',
          },
          {
            id: 'clarification:status_check',
            title: '🔍 টিকেট স্ট্যাটাস দেখুন',
            description: 'আপনার অভিযোগের অবস্থা জানুন',
          },
          {
            id: 'clarification:info_query',
            title: 'ℹ️ প্রকল্পের তথ্য',
            description: 'সরকারি প্রকল্পের তথ্য জানুন',
          },
          {
            id: 'clarification:none',
            title: '🔄 অন্য কিছু',
            description: 'অন্য কোনো সাহায্য দরকার',
          },
        ],
      },
    ],
    noneReply:
      'আমি আপনাকে সাহায্য করতে চাই! 🙏\n\nউপলব্ধ সেবাসমূহ:\n1️⃣ অভিযোগ দায়ের — "অভিযোগ" লিখুন\n2️⃣ রক্তের অনুরোধ — "রক্ত লাগবে" লিখুন\n3️⃣ ডোনার নিবন্ধন — "ডোনার হতে চাই" লিখুন\n4️⃣ টিকেট স্ট্যাটাস — আপনার টিকেট নম্বর লিখুন (WB-YYYY-XXXXX)\n5️⃣ প্রকল্পের তথ্য — "প্রকল্প" লিখুন\n\nকী দরকার? জানান! 😊',
  },

  en: {
    body: 'I can help you with the following — what do you need? 🙏',
    header: 'Sahayak Services',
    footer: 'Choose one option',
    buttonLabel: 'Choose service',
    sections: [
      {
        title: 'Available Services',
        rows: [
          {
            id: 'clarification:complaint_collecting',
            title: '📋 File a complaint',
            description: 'Road, water, electricity, pension, school...',
          },
          {
            id: 'clarification:blood_collecting',
            title: '🩸 Request blood',
            description: 'Create a blood request',
          },
          {
            id: 'clarification:donor_registration',
            title: '❤️ Register as donor',
            description: 'Sign up as a blood donor',
          },
          {
            id: 'clarification:status_check',
            title: '🔍 Check ticket status',
            description: 'Track your complaint status',
          },
          {
            id: 'clarification:info_query',
            title: 'ℹ️ Scheme information',
            description: 'Learn about government schemes',
          },
          {
            id: 'clarification:none',
            title: '🔄 Something else',
            description: 'I need other help',
          },
        ],
      },
    ],
    noneReply:
      "I'm here to help! 🙏\n\nAvailable services:\n1️⃣ File a complaint — type \"complaint\"\n2️⃣ Blood request — type \"need blood\"\n3️⃣ Donor registration — type \"become donor\"\n4️⃣ Ticket status — type your ticket number (WB-YYYY-XXXXX)\n5️⃣ Scheme info — type \"scheme\"\n\nWhat do you need? Just let me know! 😊",
  },
};

// ─── Button-press intent mapping ──────────────────────────────────────────────
// When the user taps a button, WhatsApp sends the row id as the message body.
// The CEO Router will see last_intent='idle' and the message text matching the
// row id prefix 'clarification:'. We map it to the correct last_intent here so
// the next turn routes correctly.
//
// NOTE: In practice the WhatsApp interactive list reply arrives as a separate
// webhook event. The row id IS the message body for interactive replies.
// The CEO Router's state-prefix rules will fire on the next turn because
// last_intent will have been set by the session save below.

const BUTTON_INTENT_MAP = {
  'clarification:complaint_collecting': 'complaint_collecting',
  'clarification:blood_collecting': 'blood_collecting',
  'clarification:donor_registration': 'donor_registration',
  'clarification:status_check': 'status_check',
  'clarification:info_query': 'info_query',
  'clarification:none': 'idle',
};

// Map a chosen last_intent to its owning specialist agent (for active_agent).
function intentToActiveAgent(chosenIntent) {
  if (chosenIntent.startsWith('complaint')) return 'complaint';
  if (chosenIntent.startsWith('blood')) return 'blood';
  if (chosenIntent.startsWith('donor')) return 'donor';
  if (chosenIntent === 'status_check' || chosenIntent === 'info_query') return 'info';
  return 'ceo';
}

// ─── Helper: fire-and-forget routing_decisions write (Req 20.5, 18.14) ────────
// Writes a routing_decisions row with reason='clarification_*' via the existing
// POST /api/routing/log endpoint (which truncates message_text to 200 chars,
// validates the enum, and stamps the trace_id). Best-effort: never throws, so
// the citizen-facing reply path is never blocked by an observability failure.
//
// agent_dispatched is intentionally null — 'clarification' is not one of the
// dispatchable specialist agents (complaint|blood|donor|info|welcome), and the
// endpoint explicitly allows null (stale-reset / clarification rows).

async function logRoutingDecision(fields) {
  if (!N8N_SECRET) {
    // No secret configured — skip the observability write (fail-soft).
    return;
  }
  try {
    await $http.request({
      method: 'POST',
      url: `${API_BASE_URL}/api/routing/log`,
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-SECRET': N8N_SECRET,
      },
      body: {
        session_id: fields.session_id,
        message_text: fields.message_text,
        last_intent_before: fields.last_intent_before,
        agent_dispatched: null,
        reason: fields.reason,
        trace_id: fields.trace_id,
        // Req 20.7: clarification is reached only after the Gemini classifier ran
        // and returned low confidence, so classifier_used=true.
        classifier_used: true,
        confidence: typeof fields.confidence === 'number' ? fields.confidence : null,
      },
    });
  } catch (err) {
    // Observability is fire-and-forget — swallow any error.
    console.warn('[Clarification] routing_decisions log failed (non-blocking):', err.message || err);
  }
}

// ─── Main logic ───────────────────────────────────────────────────────────────

async function run() {
  const session = $json.session || {};
  const lang = (session.language || 'hi').toLowerCase();
  const phone = $json.phone || session.session_id || '';
  const traceId = $json.trace_id || '';
  const prevLastIntent = session.last_intent || 'idle';
  const confidence = typeof $json.confidence === 'number' ? $json.confidence : null;

  const strings = L10N[lang] || L10N.en;

  // Detect if this invocation is a button-press response (interactive reply)
  // rather than the initial clarification trigger.
  const incomingText = ($json.message && ($json.message.text || $json.message.original_text || '')) || '';
  const incomingButtonId = ($json.message && $json.message.button_id) || '';

  // Check if the incoming message is a button press from a previous clarification
  const buttonId = incomingButtonId || (BUTTON_INTENT_MAP[incomingText] !== undefined ? incomingText : null);

  if (buttonId && BUTTON_INTENT_MAP[buttonId] !== undefined) {
    // ── Button press path ──────────────────────────────────────────────────────
    const chosenIntent = BUTTON_INTENT_MAP[buttonId];
    const isNone = chosenIntent === 'idle';

    if (isNone) {
      // "Kuch aur" / none-of-these path: send help text, keep last_intent='idle'.
      // Write routing_decisions row with reason='clarification_none_of_these'.
      await logRoutingDecision({
        session_id: phone,
        message_text: incomingText,
        last_intent_before: prevLastIntent,
        reason: 'clarification_none_of_these',
        trace_id: traceId,
        confidence,
      });

      return [{
        json: {
          ...$json,
          agent: 'clarification',
          reason: 'clarification_none_of_these',
          reply: strings.noneReply,
          clarification_button_pressed: buttonId,
          clarification_chosen_intent: 'idle',
          // Keep last_intent='idle' (Design §v1.1.1 "Fallback when user picks kuch aur").
          session_update: { last_intent: 'idle', active_agent: 'ceo' },
        },
      }];
    }

    // Service button pressed: set last_intent to the chosen service and let the
    // next CEO Router invocation handle it. We return a brief acknowledgement
    // and set the session intent so the next message routes correctly.
    const intentLabels = {
      complaint_collecting: { hi: 'Shikayat darj karna shuru karte hain...', bn: 'অভিযোগ দায়ের শুরু করছি...', en: 'Starting complaint registration...' },
      blood_collecting:     { hi: 'Blood request banate hain...', bn: 'রক্তের অনুরোধ শুরু করছি...', en: 'Starting blood request...' },
      donor_registration:   { hi: 'Donor registration shuru karte hain...', bn: 'ডোনার নিবন্ধন শুরু করছি...', en: 'Starting donor registration...' },
      status_check:         { hi: 'Apna ticket number batayein (WB-YYYY-XXXXX):', bn: 'আপনার টিকেট নম্বর দিন (WB-YYYY-XXXXX):', en: 'Please share your ticket number (WB-YYYY-XXXXX):' },
      info_query:           { hi: 'Kaunsi yojana ke baare mein jaanna chahte hain?', bn: 'কোন প্রকল্প সম্পর্কে জানতে চান?', en: 'Which scheme would you like to know about?' },
    };

    const ackMsg = (intentLabels[chosenIntent] || {})[lang] || (intentLabels[chosenIntent] || {}).en || 'Processing...';

    // Write routing_decisions row with reason='clarification_intent_set'.
    await logRoutingDecision({
      session_id: phone,
      message_text: incomingText,
      last_intent_before: prevLastIntent,
      reason: 'clarification_intent_set',
      trace_id: traceId,
      confidence,
    });

    return [{
      json: {
        ...$json,
        agent: 'clarification',
        reason: 'clarification_intent_set',
        reply: ackMsg,
        clarification_button_pressed: buttonId,
        clarification_chosen_intent: chosenIntent,
        // Signal to the session-save step (downstream) to update last_intent so
        // the next CEO Router invocation routes directly to the chosen service.
        session_update: {
          last_intent: chosenIntent,
          active_agent: intentToActiveAgent(chosenIntent),
        },
      },
    }];
  }

  // ── Initial clarification trigger path ────────────────────────────────────────
  // CEO Router returned agent='clarification' because confidence < 0.6.
  // Build and return the WhatsApp interactive list payload.

  // WhatsApp Cloud API interactive list message payload
  // https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
  const interactivePayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: {
        type: 'text',
        text: strings.header,
      },
      body: {
        text: strings.body,
      },
      footer: {
        text: strings.footer,
      },
      action: {
        button: strings.buttonLabel,
        sections: strings.sections,
      },
    },
  };

  // Plain-text fallback for Send Reply node (used when interactive is not supported)
  const plainTextFallback = [
    strings.body,
    '',
    strings.sections[0].rows
      .map((r, i) => `${i + 1}. ${r.title}`)
      .join('\n'),
  ].join('\n');

  // Write routing_decisions row with reason='clarification_sent'.
  await logRoutingDecision({
    session_id: phone,
    message_text: incomingText,
    last_intent_before: prevLastIntent,
    reason: 'clarification_sent',
    trace_id: traceId,
    confidence,
  });

  return [{
    json: {
      ...$json,
      agent: 'clarification',
      reason: 'clarification_sent',
      // The Send Reply node uses $json.reply for plain text.
      // When $json.interactive is present, the Send Reply node should use the
      // interactive payload instead (requires Send Reply node to check for this key).
      reply: plainTextFallback,
      interactive: interactivePayload,
      trace_id: traceId,
      // Keep last_intent='idle' after sending the list — the button press on the
      // NEXT turn sets the concrete service intent (Design §v1.1.1 pseudo-prompt).
      session_update: { last_intent: 'idle', active_agent: 'ceo' },
    },
  }];
}

// ─── Execute ─────────────────────────────────────────────────────────────────

return await run();
