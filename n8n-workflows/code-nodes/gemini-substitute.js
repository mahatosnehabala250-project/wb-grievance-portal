/**
 * Gemini-Substitute Code Node — n8n Code Node body (self-contained, no require/import).
 *
 * Task 27.4 — Design §v1.1.10 Circuit Breakers (Req 29.2, 29.3)
 *
 * PURPOSE
 * -------
 * When the `gemini` circuit breaker is open (`circuit_state.gemini = 'open'`),
 * the specialist AI Agent nodes cannot call Gemini. This Code Node is inserted as
 * a pre-check BEFORE each specialist agent branch (complaint / blood / donor).
 * It reads `circuit_state.gemini` via Supabase REST and, if open, returns a
 * localized template reply from `templates/agent_template_replies.md` keyed by
 * `(agent, session.last_intent, nextMissingField)` and `session.language`.
 *
 * PLACEMENT IN JS-01v2
 * --------------------
 * The Switch Node routes to one of three "Gemini Check" Code Nodes (one per
 * specialist agent branch). Each Gemini Check node:
 *   1. Reads circuit_state.gemini via Supabase REST (1-second in-process cache).
 *   2. If OPEN  → sets $json.reply to the template reply and $json.gemini_open=true.
 *      The downstream IF node routes to Send Reply directly (bypassing the AI Agent).
 *   3. If CLOSED/HALF_OPEN → passes through unchanged ($json.gemini_open=false).
 *      The downstream IF node routes to the AI Agent as normal.
 *
 * OUTPUT CONTRACT
 * ---------------
 * Always returns exactly one item. Fields added/modified:
 *   $json.gemini_open   : boolean — true when breaker is open
 *   $json.reply         : string  — template reply (only when gemini_open=true)
 *   $json.progress_signal : { advanced_flow: false } — only when gemini_open=true
 *
 * TEMPLATE REPLIES
 * ----------------
 * The canonical YAML block from templates/agent_template_replies.md is inlined
 * below as a JS object (parsed once at module load). This avoids any file-system
 * dependency inside the n8n sandbox. The deploy pipeline (deploy-workflows-v2.js)
 * may optionally regenerate this file from the canonical source.
 *
 * SUPABASE REST CALL
 * ------------------
 * Uses the Supabase REST API (no pg driver — n8n Code Nodes run in a sandboxed VM).
 * Endpoint: GET <SUPABASE_URL>/rest/v1/circuit_state?name=eq.gemini&select=state
 * Auth: apikey header with SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).
 * Fail-soft: any error reading circuit_state treats the breaker as CLOSED so
 * citizen-facing flows are never blocked by an operational problem with the table.
 *
 * @see templates/agent_template_replies.md — canonical fallback replies
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.10
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Req 29.2, 29.3
 */

// ─── Inlined template replies (from templates/agent_template_replies.md) ──────
// Key path: TEMPLATE_REPLIES[agent][intent][slot][language]
// Mirrors the canonical YAML block exactly. Update both files together.

const TEMPLATE_REPLIES = {
  complaint: {
    complaint_collecting: {
      naam: {
        hi: "Namaste! Aap ki complaint register karne mein madad karunga. Pehle aap ka pura naam batayein?",
        bn: "নমস্কার! আপনার অভিযোগ নথিভুক্ত করতে সাহায্য করব। প্রথমে আপনার পুরো নাম বলুন।",
        en: "Hello! I'll help register your complaint. First, please tell me your full name."
      },
      gaon: {
        hi: "Aap ka gaon ya mohalla kaun sa hai?",
        bn: "আপনার গ্রাম বা এলাকার নাম কী?",
        en: "Which village or locality are you from?"
      },
      jela: {
        hi: "Aap kis jela (district) se hain?",
        bn: "আপনি কোন জেলা থেকে?",
        en: "Which district are you from?"
      },
      block: {
        hi: "Aap ka block kaun sa hai?",
        bn: "আপনার ব্লকের নাম কী?",
        en: "Which block do you belong to?"
      },
      gram_panchayat: {
        hi: "Aap ki gram panchayat kaun si hai?",
        bn: "আপনার গ্রাম পঞ্চায়েতের নাম কী?",
        en: "Which gram panchayat is yours?"
      },
      samasya: {
        hi: "Aap ki samasya kya hai? Thoda detail mein batayein.",
        bn: "আপনার সমস্যাটি কী? একটু বিস্তারিত করে বলুন।",
        en: "What is your problem? Please describe it in a little detail."
      },
      category: {
        hi: "Ye samasya kis vibhag ki hai? (road, water, electricity, pension, school, health, ration, housing, student, other)",
        bn: "এই সমস্যাটি কোন বিভাগের? (road, water, electricity, pension, school, health, ration, housing, student, other)",
        en: "Which category is this complaint? (road, water, electricity, pension, school, health, ration, housing, student, other)"
      },
      college_name: {
        hi: "Aap ke college ka naam kya hai?",
        bn: "আপনার কলেজের নাম কী?",
        en: "What is the name of your college?"
      },
      default: {
        hi: "Aap ki complaint aage badhane ke liye kripya agli jaankari batayein.",
        bn: "আপনার অভিযোগ এগিয়ে নিতে অনুগ্রহ করে পরবর্তী তথ্যটি দিন।",
        en: "To continue your complaint, please provide the next detail."
      }
    },
    complaint_confirming: {
      default: {
        hi: "Aap ki complaint ke details:\n${summary}\nKya ye sab sahi hai? Haan ya Nahi batayein.",
        bn: "আপনার অভিযোগের তথ্য:\n${summary}\nসব ঠিক আছে? হ্যাঁ বা না বলুন।",
        en: "Your complaint details:\n${summary}\nIs everything correct? Please reply Yes or No."
      }
    }
  },

  blood: {
    blood_collecting: {
      blood_group: {
        hi: "Kis blood group ki zaroorat hai? (A+, A-, B+, B-, AB+, AB-, O+, O-)",
        bn: "কোন ব্লাড গ্রুপ দরকার? (A+, A-, B+, B-, AB+, AB-, O+, O-)",
        en: "Which blood group is needed? (A+, A-, B+, B-, AB+, AB-, O+, O-)"
      },
      units: {
        hi: "Kitne units khoon chahiye? (1-10)",
        bn: "কত ইউনিট রক্ত দরকার? (1-10)",
        en: "How many units of blood are needed? (1-10)"
      },
      hospital: {
        hi: "Kis hospital mein khoon chahiye?",
        bn: "কোন হাসপাতালে রক্ত দরকার?",
        en: "At which hospital is the blood needed?"
      },
      urgency: {
        hi: "Kitni jaldi chahiye? critical (2 ghante), urgent (24 ghante), ya routine (3+ din)?",
        bn: "কত দ্রুত দরকার? critical (২ ঘণ্টা), urgent (২৪ ঘণ্টা), নাকি routine (৩+ দিন)?",
        en: "How urgent is it? critical (2 hours), urgent (24 hours), or routine (3+ days)?"
      },
      contact_phone: {
        hi: "Sampark ke liye ek phone number batayein.",
        bn: "যোগাযোগের জন্য একটি ফোন নম্বর দিন।",
        en: "Please share a contact phone number."
      },
      district: {
        hi: "Hospital kis jela (district) mein hai?",
        bn: "হাসপাতালটি কোন জেলায়?",
        en: "Which district is the hospital in?"
      },
      block: {
        hi: "Hospital kis block mein hai?",
        bn: "হাসপাতালটি কোন ব্লকে?",
        en: "Which block is the hospital in?"
      },
      default: {
        hi: "Blood request aage badhane ke liye kripya agli jaankari batayein.",
        bn: "ব্লাড রিকোয়েস্ট এগিয়ে নিতে অনুগ্রহ করে পরবর্তী তথ্যটি দিন।",
        en: "To continue the blood request, please provide the next detail."
      }
    },
    blood_confirming: {
      default: {
        hi: "Aap ke blood request ke details:\n${summary}\nKya ye sahi hai? Confirm karein — Haan ya Nahi.",
        bn: "আপনার ব্লাড রিকোয়েস্টের তথ্য:\n${summary}\nঠিক আছে? নিশ্চিত করুন — হ্যাঁ বা না।",
        en: "Your blood request details:\n${summary}\nIs this correct? Please confirm — Yes or No."
      }
    }
  },

  donor: {
    donor_registration: {
      naam: {
        hi: "Donor banne ke liye dhanyavaad! Aap ka pura naam batayein?",
        bn: "ডোনার হওয়ার জন্য ধন্যবাদ! আপনার পুরো নাম বলুন।",
        en: "Thank you for becoming a donor! Please tell me your full name."
      },
      blood_group: {
        hi: "Aap ka blood group kya hai? (A+, A-, B+, B-, AB+, AB-, O+, O-)",
        bn: "আপনার ব্লাড গ্রুপ কী? (A+, A-, B+, B-, AB+, AB-, O+, O-)",
        en: "What is your blood group? (A+, A-, B+, B-, AB+, AB-, O+, O-)"
      },
      gender: {
        hi: "Aap ka gender batayein (male/female/other)?",
        bn: "আপনার লিঙ্গ বলুন (male/female/other)?",
        en: "Please tell me your gender (male/female/other)."
      },
      date_of_birth: {
        hi: "Aap ki janm tithi batayein (DD/MM/YYYY)?",
        bn: "আপনার জন্ম তারিখ বলুন (DD/MM/YYYY)?",
        en: "Please share your date of birth (DD/MM/YYYY)."
      },
      weight_kg: {
        hi: "Aap ka weight kitna hai (kg mein)?",
        bn: "আপনার ওজন কত (কেজিতে)?",
        en: "What is your weight (in kg)?"
      },
      district: {
        hi: "Aap kis jela (district) se hain?",
        bn: "আপনি কোন জেলা থেকে?",
        en: "Which district are you from?"
      },
      block: {
        hi: "Aap ka block kaun sa hai?",
        bn: "আপনার ব্লকের নাম কী?",
        en: "Which block do you belong to?"
      },
      last_donated_date: {
        hi: "Aap ne aakhri baar kab khoon diya tha? (DD/MM/YYYY ya 'pata nahi')",
        bn: "আপনি শেষবার কবে রক্ত দিয়েছিলেন? (DD/MM/YYYY বা 'জানি না')",
        en: "When did you last donate blood? (DD/MM/YYYY or 'don't know')"
      },
      last_donation_type: {
        hi: "Aakhri donation kis type ka tha? (whole_blood/platelets/plasma/double_red)",
        bn: "শেষ দানটি কোন ধরনের ছিল? (whole_blood/platelets/plasma/double_red)",
        en: "What type was your last donation? (whole_blood/platelets/plasma/double_red)"
      },
      default: {
        hi: "Donor registration aage badhane ke liye kripya agli jaankari batayein.",
        bn: "ডোনার রেজিস্ট্রেশন এগিয়ে নিতে অনুগ্রহ করে পরবর্তী তথ্যটি দিন।",
        en: "To continue donor registration, please provide the next detail."
      }
    },
    donor_confirming: {
      default: {
        hi: "Aap ke details:\n${summary}\nKya ye sab sahi hai? Haan ya Nahi?",
        bn: "আপনার তথ্য:\n${summary}\nসব ঠিক আছে? হ্যাঁ বা না?",
        en: "Your details:\n${summary}\nIs everything correct? Yes or No?"
      }
    }
  }
};

// ─── Field order per agent (for nextMissingField) ─────────────────────────────
// Mirrors the field collection order in each agent's system prompt.

const FIELD_ORDER = {
  complaint: {
    complaint_collecting: ['naam', 'gaon', 'jela', 'block', 'gram_panchayat', 'samasya', 'category', 'college_name']
  },
  blood: {
    blood_collecting: ['blood_group', 'units', 'hospital', 'urgency', 'contact_phone', 'district', 'block']
  },
  donor: {
    donor_registration: ['naam', 'blood_group', 'gender', 'date_of_birth', 'weight_kg', 'district', 'block', 'last_donated_date', 'last_donation_type']
  }
};

// ─── In-process circuit_state cache (~1 second TTL) ───────────────────────────
// Avoids a DB round-trip on every message while bounding staleness to ~1 s.

const _breakerCache = {};
const BREAKER_CACHE_TTL_MS = 1000;

/**
 * Read circuit_state.gemini via Supabase REST.
 * Returns 'open' | 'closed' | 'half_open'. Fail-soft: returns 'closed' on error.
 */
async function readGeminiState() {
  const now = Date.now();
  const cached = _breakerCache['gemini'];
  if (cached && now < cached.expiresAt) {
    return cached.state;
  }

  const supabaseUrl = 'https://sxdtipaspfolrpqrwadt.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHRpcGFzcGZvbHJwcXJ3YWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMDU2MTAsImV4cCI6MjA5MTU4MTYxMH0.18iFpk1gBByljIqRdRJx_ltrado1paCavMyYwIY_Q30';

  if (!supabaseUrl || !supabaseKey) {
    // No credentials configured — treat as closed (fail-soft).
    return 'closed';
  }

  try {
    const url = `${supabaseUrl}/rest/v1/circuit_state?name=eq.gemini&select=state`;
    const resp = await $http.request({
      method: 'GET',
      url,
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Accept': 'application/json'
      },
      timeout: 2000
    });

    // Supabase REST returns an array; take the first row.
    const rows = Array.isArray(resp) ? resp : (resp.data || []);
    const state = (rows[0] && rows[0].state) ? rows[0].state : 'closed';
    const validState = ['open', 'closed', 'half_open'].includes(state) ? state : 'closed';

    _breakerCache['gemini'] = { state: validState, expiresAt: now + BREAKER_CACHE_TTL_MS };
    return validState;
  } catch (_err) {
    // Fail-soft: any error reading circuit_state treats the breaker as closed.
    _breakerCache['gemini'] = { state: 'closed', expiresAt: now + BREAKER_CACHE_TTL_MS };
    return 'closed';
  }
}

// ─── nextMissingField ─────────────────────────────────────────────────────────

/**
 * Determine the next field to ask for based on collected_data and the current intent.
 * For *_confirming intents there is no missing field — returns 'default'.
 */
function nextMissingField(agent, intent, collectedData) {
  const agentFields = FIELD_ORDER[agent];
  if (!agentFields) return 'default';
  const fields = agentFields[intent];
  if (!fields) return 'default';

  const data = collectedData || {};
  for (const field of fields) {
    // Skip college_name unless category === 'student'
    if (field === 'college_name' && data.category !== 'student') continue;
    // Skip optional donor fields if they were explicitly skipped
    if ((field === 'last_donated_date' || field === 'last_donation_type') && data[field] === null) continue;
    if (!data[field]) return field;
  }
  return 'default';
}

// ─── buildSummary ─────────────────────────────────────────────────────────────

/**
 * Build a plain-text summary of collected_data for the ${summary} placeholder
 * in confirming-state replies.
 */
function buildSummary(collectedData, language) {
  const data = collectedData || {};
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) {
    const noData = { hi: '(koi data nahi)', bn: '(কোনো তথ্য নেই)', en: '(no data)' };
    return noData[language] || noData.hi;
  }
  return entries.map(([k, v]) => `${k}: ${v}`).join('\n');
}

// ─── Main logic ───────────────────────────────────────────────────────────────

const item = $input.first().json;
const session = item.session || {};
const agent = item.agent || session.active_agent || 'complaint';
const lastIntent = session.last_intent || '';
const language = session.language || 'hi';
const collectedData = session.collected_data || {};

// Read the gemini circuit breaker state (fail-soft, ~1s cache).
const geminiState = await readGeminiState();
const isOpen = geminiState === 'open';

if (!isOpen) {
  // Breaker is closed or half-open — pass through unchanged.
  return [{ json: { ...item, gemini_open: false } }];
}

// ─── Breaker is OPEN — return a template reply ────────────────────────────────

// Determine the intent block to use.
const agentBlock = TEMPLATE_REPLIES[agent];
if (!agentBlock) {
  // Unknown agent — use a generic fallback.
  const fallback = {
    hi: 'Abhi AI service temporarily unavailable hai. Thodi der baad try karein.',
    bn: 'এই মুহূর্তে AI সেবা সাময়িকভাবে অনুপলব্ধ। একটু পরে চেষ্টা করুন।',
    en: 'AI service is temporarily unavailable. Please try again shortly.'
  };
  return [{
    json: {
      ...item,
      gemini_open: true,
      reply: fallback[language] || fallback.hi,
      progress_signal: { advanced_flow: false }
    }
  }];
}

const intentBlock = agentBlock[lastIntent];
if (!intentBlock) {
  // Unknown intent for this agent — use the agent's first intent's default.
  const firstIntent = Object.keys(agentBlock)[0];
  const defaultBlock = agentBlock[firstIntent] && agentBlock[firstIntent].default;
  const fallbackText = defaultBlock
    ? (defaultBlock[language] || defaultBlock.hi)
    : 'Please continue with your request.';
  return [{
    json: {
      ...item,
      gemini_open: true,
      reply: fallbackText,
      progress_signal: { advanced_flow: false }
    }
  }];
}

// Determine the slot (next missing field, or 'default' for confirming states).
const isConfirming = lastIntent.endsWith('_confirming');
const slot = isConfirming ? 'default' : nextMissingField(agent, lastIntent, collectedData);

// Resolve the slot block (fall back to 'default' if the specific slot is missing).
const slotBlock = intentBlock[slot] || intentBlock.default;
if (!slotBlock) {
  return [{
    json: {
      ...item,
      gemini_open: true,
      reply: 'Please continue with your request.',
      progress_signal: { advanced_flow: false }
    }
  }];
}

// Resolve language (fall back to 'hi' as the last-resort language).
let replyText = slotBlock[language] || slotBlock.hi || slotBlock.en || 'Please continue.';

// Interpolate ${summary} placeholder for confirming states.
if (replyText.includes('${summary}')) {
  const summary = buildSummary(collectedData, language);
  replyText = replyText.replace('${summary}', summary);
}

return [{
  json: {
    ...item,
    gemini_open: true,
    reply: replyText,
    progress_signal: { advanced_flow: false }
  }
}];
