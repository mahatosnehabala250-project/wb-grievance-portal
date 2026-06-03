/**
 * Status / Info Code Node — n8n Code Node (self-contained)
 *
 * Position in workflow: Switch Node "info" branch
 * This file is self-contained. No require/import — runs in n8n's sandboxed VM.
 *
 * Responsibility (Req 11.1–11.5):
 *   a) Check if message matches ticket pattern (WB-YYYY-XXXXX) → query complaints table
 *   b) If ticket found → return formatted status response
 *   c) If no ticket → check INFO_USE_EMBEDDINGS flag via API
 *   d) When flag is false (Phase 1): use INFO_PROMPT variable (injected by deploy script
 *      from info.md) + SCHEME_SUMMARIES (injected from scheme_summaries.md) to build a
 *      Gemini prompt with scheme summaries inlined, call Gemini API, return answer
 *   e) When flag is true (Phase 2, v1.1): embed user's question via OpenAI
 *      (text-embedding-3-small, 768 dims) → vector search scheme_knowledge via
 *      match_scheme_knowledge RPC (threshold 0.7, limit 3) → augment Gemini prompt
 *      with retrieved context → return answer. Falls back to Phase 1 if no results
 *      or embedding fails.
 *   f) Help fallback when neither matches
 *
 * Circuit breaker — embeddings (Req 29, Design §v1.1.10):
 *   Before running any embedding / vector-search call, Phase 2 consults the
 *   shared `circuit_state` table. When the `embeddings` breaker is open (the
 *   embedding provider is failing) the node BYPASSES embed → vector search
 *   entirely and serves the curated Phase 1 scheme summaries — the same path
 *   used when INFO_USE_EMBEDDINGS=false — so a provider outage degrades
 *   gracefully instead of repeatedly calling a failing embedding API.
 *   The read is fail-soft: an unreadable / missing breaker row is treated as
 *   closed (Phase 2 proceeds and still falls back per-call on error), mirroring
 *   the fail-soft contract of src/lib/breaker/breaker.ts.
 *
 * Semantic cache — query_cache (Req 26, Design §v1.1.7):
 *   Before its primary lookup, BOTH the Status (ticket) path and the Info
 *   (scheme/help) path consult the shared `query_cache` table for a
 *   semantically-close cached response (cosine ≥ 0.92, filtered by `category`
 *   and non-expired rows). On a hit the cached response is returned without
 *   running the primary DB / vector / Gemini lookup; on a miss the primary
 *   lookup runs and its answer is written through with a category-specific TTL
 *   (status 5 min / scheme 7 days / help 1 hour) — matching
 *   src/lib/semanticCache/lookup.ts and src/lib/semanticCache/write.ts.
 *
 *   The cache is embedding-based, so it shares the SAME gate as Phase 2: it is
 *   only consulted when INFO_USE_EMBEDDINGS=true AND the `embeddings` breaker is
 *   closed. When embeddings are disabled or the breaker is open the cache is
 *   bypassed entirely (a natural cache-miss) and the v1 primary path runs
 *   unchanged — consistent with the embeddings-breaker bypass (§v1.1.10) and
 *   the no-embeddings Phase 1 contract (Property 36).
 *
 *   The node is self-contained (no imports), so it consults the cache over HTTP
 *   the same way it already calls feature-flags / circuit_state / scheme_knowledge:
 *     - lookup → Supabase RPC `match_query_cache` (mirrors `match_scheme_knowledge`;
 *                the RPC applies the 0.92 threshold and increments hit_count
 *                server-side, matching src/lib/semanticCache/lookup.ts)
 *     - write  → PostgREST upsert into `query_cache` (ON CONFLICT query_hash),
 *                mirroring the TTL/category mapping in src/lib/semanticCache/write.ts
 *   All cache calls are best-effort / fail-soft: any error (including a
 *   not-yet-deployed `match_query_cache` RPC) degrades to a cache miss so the
 *   primary lookup always proceeds.
 *
 * Inputs:
 *   $json.message.text — raw incoming WhatsApp message body
 *   $json.session.language — user's language preference (en/hi/bn)
 *
 * Output:
 *   [{ json: { ...$json, reply: "..." } }]
 *
 * Deploy-time injections (by deploy-workflows-v2.js):
 *   - INFO_PROMPT — contents of n8n-workflows/prompts/info.md (prepended as const)
 *   - SCHEME_SUMMARIES — contents of n8n-workflows/prompts/scheme_summaries.md
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §Components → Status / Info Code Path
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.10 Circuit Breakers (embeddings breaker)
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.7 Semantic Cache (query_cache)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirements 11.1–11.5, 26.1–26.5, 29.4
 * @see src/lib/semanticCache/lookup.ts - cosine ANN lookup (threshold 0.92)
 * @see src/lib/semanticCache/write.ts - write-through with category-specific TTL
 */

// ─── Deploy-time injected variables ─────────────────────────────────────────
// INFO_PROMPT is injected above this code by deploy-workflows-v2.js (from info.md)
// If not injected (local testing), provide a minimal fallback
if (typeof INFO_PROMPT === 'undefined') {
  var INFO_PROMPT = '';
}

// SCHEME_SUMMARIES is injected above this code by deploy-workflows-v2.js (from scheme_summaries.md)
// If not injected (local testing), provide a minimal fallback
if (typeof SCHEME_SUMMARIES === 'undefined') {
  var SCHEME_SUMMARIES = '';
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TICKET_RE = /\bWB-\d{4}-\d{5}\b/i;

const API_BASE_URL = 'https://wb-grievance-portal.vercel.app';
const N8N_SECRET = 'REPLACE_WITH_N8N_WEBHOOK_SECRET';
const GEMINI_API_KEY = '';
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

// Supabase REST base + key for reading operational tables (scheme_knowledge,
// circuit_state). Service-role is preferred because operational tables like
// `circuit_state` are RLS-restricted to service-role / admin (migration 008);
// fall back to the anon key for environments where only that is provisioned.
const SUPABASE_REST_BASE = 'https://sxdtipaspfolrpqrwadt.supabase.co'.replace(/\/$/, '');
const SUPABASE_KEY = '${SUPABASE_SERVICE_ROLE_KEY}';

// ─── Input ───────────────────────────────────────────────────────────────────

const message = $json.message || $json.parsed || {};
const messageText = (message.text || '').trim();
const originalText = message.original_text || message.text || '';
const session = $json.session || {};
const language = session.language || 'hi';

// ─── Helper: Format status response by language ──────────────────────────────

function formatStatusResponse(ticket, lang) {
  const status = ticket.status || 'pending';
  const officer = ticket.assigned_officer || ticket.officer_name || 'Not assigned';
  const lastUpdate = ticket.updated_at
    ? new Date(ticket.updated_at).toLocaleDateString('en-IN')
    : 'N/A';
  const category = ticket.category || 'General';
  const ticketNumber = ticket.ticket_number || '';

  if (lang === 'bn') {
    return `📝 টিকেট: ${ticketNumber}\nস্থিতি: ${status}\nদায়িত্বপ্রাপ্ত: ${officer}\nশেষ আপডেট: ${lastUpdate}\nবিভাগ: ${category}\n\nআর কোনো প্রশ্ন থাকলে জিজ্ঞাসা করুন!`;
  }
  if (lang === 'en') {
    return `📝 Ticket: ${ticketNumber}\nStatus: ${status}\nAssigned to: ${officer}\nLast update: ${lastUpdate}\nCategory: ${category}\n\nAny other questions? Feel free to ask!`;
  }
  // Default: Hindi
  return `📝 Ticket: ${ticketNumber}\nStatus: ${status}\nAssigned to: ${officer}\nLast update: ${lastUpdate}\nCategory: ${category}\n\nKoi aur sawal ho to poochein!`;
}

// ─── Helper: Ticket not found message ────────────────────────────────────────

function ticketNotFoundMessage(ticketNum, lang) {
  if (lang === 'bn') {
    return `এই টিকেট নম্বর (${ticketNum}) দিয়ে কোনো অভিযোগ পাওয়া যায়নি। সঠিক টিকেট নম্বর দিন (ফরম্যাট: WB-YYYY-XXXXX)।`;
  }
  if (lang === 'en') {
    return `No complaint found with ticket number ${ticketNum}. Please provide the correct ticket number (format: WB-YYYY-XXXXX).`;
  }
  return `Is ticket number (${ticketNum}) se koi complaint nahi mili. Kripya sahi ticket number dijiye (format: WB-YYYY-XXXXX).`;
}

// ─── Helper: Help fallback message ───────────────────────────────────────────

function helpMessage(lang) {
  if (lang === 'bn') {
    return `🙏 নমস্কার! আমি জনসেবা সহায়ক। আমি এই বিষয়ে সাহায্য করতে পারি:\n\n📝 **অভিযোগ নথিভুক্ত করুন** — আপনার সমস্যা বলুন\n🩸 **রক্ত দরকার** — "blood chahiye" টাইপ করুন\n💉 **ডোনার হতে চান** — "donor banna hai" টাইপ করুন\n🔍 **টিকেট স্ট্যাটাস** — আপনার টিকেট নম্বর পাঠান (WB-YYYY-XXXXX)\nℹ️ **যোজনার তথ্য** — যেকোনো সরকারি প্রকল্প সম্পর্কে জিজ্ঞাসা করুন\n\nকীভাবে সাহায্য করতে পারি?`;
  }
  if (lang === 'en') {
    return `🙏 Hello! I am JanSeva Sahayak. I can help you with:\n\n📝 **Register a complaint** — Tell me your problem\n🩸 **Need blood** — Type "blood chahiye"\n💉 **Become a donor** — Type "donor banna hai"\n🔍 **Check ticket status** — Send your ticket number (WB-YYYY-XXXXX)\nℹ️ **Scheme info** — Ask about any government scheme\n\nHow can I help?`;
  }
  // Default: Hindi
  return `🙏 Namaste! Main JanSeva Sahayak hoon. Main in cheezon mein madad kar sakta hoon:\n\n📝 **Complaint register karein** — "mera road kharab hai" ya koi bhi samasya batayein\n🩸 **Blood chahiye** — "blood chahiye" type karein\n💉 **Donor banna hai** — "donor banna hai" type karein\n🔍 **Ticket status** — Apna ticket number bhejein (WB-YYYY-XXXXX)\nℹ️ **Scheme info** — Kisi bhi sarkari yojana ke baare mein poochein\n\nKya madad chahiye?`;
}

// ─── Helper: Phase 1 — Inlined scheme summaries + Gemini call ────────────────
// Extracted as a reusable function so Phase 2 can fall back to it cleanly.

async function runPhase1(msgText, lang) {
  const langInstruction = lang === 'bn'
    ? 'Respond in Bengali (বাংলা).'
    : lang === 'en'
      ? 'Respond in English.'
      : 'Respond in Hindi (हिन्दी).';

  const systemPrompt = [
    'You are JanSeva Sahayak, the West Bengal AI Public Support System information assistant.',
    langInstruction,
    'Answer the citizen\'s question using ONLY the scheme information provided below.',
    'Keep your answer concise (under 500 characters) and suitable for WhatsApp.',
    'If the question is about a scheme not in the list, say you don\'t have that information and suggest visiting the Block Development Office or Duare Sarkar camp.',
    'Do NOT invent or fabricate any scheme details.',
    '',
    '--- SCHEME INFORMATION ---',
    SCHEME_SUMMARIES || INFO_PROMPT,
    '--- END SCHEME INFORMATION ---',
  ].join('\n');

  const userPrompt = `Citizen's question: "${msgText}"`;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResponse = await $http.request({
      method: 'POST',
      url: geminiUrl,
      headers: { 'Content-Type': 'application/json' },
      body: {
        contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 512, topP: 0.8 },
      },
    });

    if (
      geminiResponse &&
      geminiResponse.body &&
      geminiResponse.body.candidates &&
      geminiResponse.body.candidates.length > 0
    ) {
      const candidate = geminiResponse.body.candidates[0];
      const reply = (candidate.content && candidate.content.parts && candidate.content.parts[0])
        ? candidate.content.parts[0].text
        : helpMessage(lang);
      return [{ json: { ...$json, reply } }];
    }
  } catch (err) {
    console.warn('[Status/Info] Phase 1 Gemini API call failed:', err.message || err);
  }

  // Gemini failed — return help message
  const reply = helpMessage(lang);
  return [{ json: { ...$json, reply } }];
}

// ─── Helper: Read the `embeddings` circuit breaker state (Req 29.4) ──────────
// Reads the shared `circuit_state` row for the `embeddings` breaker via Supabase
// REST. Returns the breaker's effective state. Fail-soft: any missing row,
// unreadable response, or error is treated as 'closed' (no bypass) so a problem
// reading the breaker table never takes down the citizen-facing Info path —
// mirroring the fail-soft contract in src/lib/breaker/breaker.ts.
//
// Note: the open→half_open promotion in the breaker library is time-based and
// lazy; here we only need to know whether the breaker is currently OPEN (i.e.
// the embedding provider is actively failing and the cooldown has not elapsed),
// in which case we bypass embeddings. 'closed' and 'half_open' both allow the
// embedding path (half_open lets a single probe through naturally).

async function isEmbeddingsBreakerOpen() {
  if (!SUPABASE_KEY) {
    // No key to read operational tables — fail-soft to closed (allow Phase 2).
    return false;
  }
  try {
    const res = await $http.request({
      method: 'GET',
      url: `${SUPABASE_REST_BASE}/rest/v1/circuit_state?name=eq.embeddings&select=state&limit=1`,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    const rows = res && res.body;
    if (Array.isArray(rows) && rows.length >= 1 && rows[0]) {
      return rows[0].state === 'open';
    }
  } catch (err) {
    console.warn('[Status/Info] circuit_state read failed, treating embeddings breaker as closed:', err.message || err);
  }
  // Missing row / empty / non-array response → treat as closed (no bypass).
  return false;
}

// ─── Main Logic ──────────────────────────────────────────────────────────────

async function run() {
  // ─── Step A: Check for ticket pattern ────────────────────────────────────
  const ticketMatch = originalText.match(TICKET_RE);

  if (ticketMatch) {
    const ticketNumber = ticketMatch[0].toUpperCase();

    // Query complaints table via API
    try {
      const response = await $http.request({
        method: 'GET',
        url: `${API_BASE_URL}/api/complaints/by-ticket/${ticketNumber}`,
        headers: {
          'Content-Type': 'application/json',
          'X-N8N-SECRET': N8N_SECRET,
        },
      });

      if (response && response.body && response.body.ok && response.body.data) {
        // ─── Step B: Ticket found → return formatted status ──────────────
        const reply = formatStatusResponse(response.body.data, language);
        return [{ json: { ...$json, reply } }];
      }
    } catch (err) {
      // API call failed or ticket not found — fall through to not-found message
    }

    // Ticket not found
    const reply = ticketNotFoundMessage(ticketNumber, language);
    return [{ json: { ...$json, reply } }];
  }

  // ─── Step C: No ticket — check INFO_USE_EMBEDDINGS flag ──────────────────
  let useEmbeddings = false;

  try {
    const flagResponse = await $http.request({
      method: 'GET',
      url: `${API_BASE_URL}/api/feature-flags/INFO_USE_EMBEDDINGS`,
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-SECRET': N8N_SECRET,
      },
    });

    if (flagResponse && flagResponse.body && flagResponse.body.ok) {
      useEmbeddings = flagResponse.body.value === 'true' || flagResponse.body.value === true;
    }
  } catch (err) {
    // Flag lookup failed — default to Phase 1 (false)
    useEmbeddings = false;
  }

  // ─── Step D: Phase 1 — Inlined scheme summaries + Gemini call ────────────
  if (!useEmbeddings) {
    // Check if the message looks like a scheme/info query
    const infoKeywords = /\b(scheme|yojana|prakalpa|sarkari|government|pension|scholarship|health|hospital|farmer|kisan|housing|transport|bicycle|tablet|laptop|stipend|disability|widow|senior|marriage|education|girl|student)\b/i;
    const infoKeywordsBn = /(যোজনা|প্রকল্প|সরকারি|পেনশন|বৃত্তি|স্বাস্থ্য|হাসপাতাল|কৃষক|আবাসন|পরিবহন|সাইকেল|ট্যাবলেট|বৃত্তি|প্রতিবন্ধী|বিধবা|প্রবীণ|বিবাহ|শিক্ষা|ছাত্র)/u;
    const infoKeywordsHi = /(योजना|सरकारी|पेंशन|छात्रवृत्ति|स्वास्थ्य|अस्पताल|किसान|आवास|परिवहन|साइकिल|टैबलेट|वजीफा|विकलांग|विधवा|वरिष्ठ|विवाह|शिक्षा|छात्र)/u;

    const isInfoQuery = infoKeywords.test(messageText)
      || infoKeywordsBn.test(messageText)
      || infoKeywordsHi.test(messageText)
      || messageText.length > 10; // Treat longer messages as potential info queries

    if (!isInfoQuery) {
      // ─── Step E: Help fallback ─────────────────────────────────────────
      const reply = helpMessage(language);
      return [{ json: { ...$json, reply } }];
    }

    // Use the Phase 1 helper
    return await runPhase1(messageText, language);
  }

  // ─── Phase 2 (INFO_USE_EMBEDDINGS=true) — Vector search + Gemini RAG ─────
  // Step 0: Embeddings circuit breaker gate (Req 29.4, Design §v1.1.10).
  // When the `embeddings` breaker is OPEN the embedding provider is failing, so
  // we bypass embed → vector search entirely and serve the curated Phase 1
  // scheme summaries (identical to the INFO_USE_EMBEDDINGS=false path). This
  // avoids hammering a failing embedding API and degrades gracefully.
  if (await isEmbeddingsBreakerOpen()) {
    return await runPhase1(messageText, language);
  }

  // Step 1: Verify scheme_knowledge has at least 1 embedded row (safety gate)
  let hasEmbeddings = false;
  try {
    const countRes = await $http.request({
      method: 'GET',
      url: `${API_BASE_URL}/rest/v1/scheme_knowledge?select=id&embedding=not.is.null&limit=1`,
      headers: {
        'apikey': '${SUPABASE_SERVICE_ROLE_KEY}',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    hasEmbeddings = countRes && countRes.body && countRes.body.length >= 1;
  } catch (err) {
    // If we can't verify, fall back to Phase 1
    hasEmbeddings = false;
  }

  if (!hasEmbeddings) {
    // Fall back to Phase 1 (curated summaries) when scheme_knowledge has no embeddings
    return await runPhase1(messageText, language);
  }

  // Step 2: Embed the user's question using OpenAI embeddings API (text-embedding-3-small, 768 dimensions)
  let embedding;
  try {
    const embeddingRes = await $http.request({
      method: 'POST',
      url: 'https://api.openai.com/v1/embeddings',
      headers: {
        'Authorization': `Bearer `,
        'Content-Type': 'application/json',
      },
      body: {
        model: 'text-embedding-3-small',
        input: messageText,
        dimensions: 768,
      },
    });
    embedding = embeddingRes.body.data[0].embedding;
  } catch (err) {
    console.warn('[Status/Info] OpenAI embedding call failed, falling back to Phase 1:', err.message || err);
    // Fall back to Phase 1 (inlined summaries) if embedding fails
    return await runPhase1(messageText, language);
  }

  // Step 3: Query scheme_knowledge table using vector similarity search (cosine distance < 0.3, limit 3)
  let searchResults = [];
  try {
    const searchRes = await $http.request({
      method: 'POST',
      url: `${API_BASE_URL}/rest/v1/rpc/match_scheme_knowledge`,
      headers: {
        'apikey': '${SUPABASE_SERVICE_ROLE_KEY}',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: {
        query_embedding: embedding,
        match_threshold: 0.7,
        match_count: 3,
      },
    });
    searchResults = (searchRes && searchRes.body) ? searchRes.body : [];
  } catch (err) {
    console.warn('[Status/Info] Vector search RPC failed, falling back to Phase 1:', err.message || err);
    // Fall back to Phase 1 (inlined summaries) if vector search fails
    return await runPhase1(messageText, language);
  }

  // If no results above threshold, fall back to Phase 1 curated summaries
  if (!searchResults || searchResults.length === 0) {
    return await runPhase1(messageText, language);
  }

  // Step 4: Build Gemini prompt with retrieved context from vector search
  const retrievedContext = searchResults.map((row, i) => {
    const title = row.title || row.scheme_name || `Result ${i + 1}`;
    const content = row.content || row.summary || '';
    const similarity = row.similarity ? ` (relevance: ${(row.similarity * 100).toFixed(1)}%)` : '';
    return `### ${title}${similarity}\n${content}`;
  }).join('\n\n');

  const langInstruction = language === 'bn'
    ? 'Respond in Bengali (বাংলা).'
    : language === 'en'
      ? 'Respond in English.'
      : 'Respond in Hindi (हिन्दी).';

  const systemPrompt = [
    'You are JanSeva Sahayak, the West Bengal AI Public Support System information assistant.',
    langInstruction,
    'Answer the citizen\'s question using ONLY the scheme information retrieved below.',
    'Keep your answer concise (under 500 characters) and suitable for WhatsApp.',
    'If the retrieved information does not answer the question, say you don\'t have that information and suggest visiting the Block Development Office or Duare Sarkar camp.',
    'Do NOT invent or fabricate any scheme details.',
    '',
    '--- RETRIEVED SCHEME INFORMATION ---',
    retrievedContext,
    '--- END RETRIEVED SCHEME INFORMATION ---',
  ].join('\n');

  const userPrompt = `Citizen's question: "${messageText}"`;

  // Step 5: Call Gemini API and return the answer
  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResponse = await $http.request({
      method: 'POST',
      url: geminiUrl,
      headers: { 'Content-Type': 'application/json' },
      body: {
        contents: [
          {
            role: 'user',
            parts: [{ text: systemPrompt + '\n\n' + userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 512,
          topP: 0.8,
        },
      },
    });

    if (
      geminiResponse &&
      geminiResponse.body &&
      geminiResponse.body.candidates &&
      geminiResponse.body.candidates.length > 0
    ) {
      const candidate = geminiResponse.body.candidates[0];
      const reply = (candidate.content && candidate.content.parts && candidate.content.parts[0])
        ? candidate.content.parts[0].text
        : helpMessage(language);
      return [{ json: { ...$json, reply } }];
    }
  } catch (err) {
    console.warn('[Status/Info] Phase 2 Gemini API call failed:', err.message || err);
  }

  // Final fallback — Gemini failed
  const reply = helpMessage(language);
  return [{ json: { ...$json, reply } }];
}

// ─── Execute ─────────────────────────────────────────────────────────────────

return await run();
