// Feature: sahayak-multi-agent-router, Property 36: Info path makes zero queries against scheme_knowledge when INFO_USE_EMBEDDINGS=false
//
// Property 36 (Design §Status / Info Code Path Phase 1, §v1.1.16): When the
// `INFO_USE_EMBEDDINGS` feature flag resolves to `false`, the Info Code path makes
// ZERO queries against `scheme_knowledge` — no vector search RPC (`match_scheme_knowledge`),
// no OpenAI embedding call, and no SELECT against `scheme_knowledge`. Instead it inlines the
// curated West Bengal scheme summaries into a single Gemini prompt and returns the answer.
//
// Validates: Requirements 11.3, 11.5
//
// The Info logic lives inside an n8n Code Node body (`n8n-workflows/code-nodes/status-info.js`)
// that is NOT importable as a module: it references the n8n globals `$json`, `$env`, `$http`,
// `console` and ends with a top-level `return await run();`. We load the real file verbatim,
// wrap it in an AsyncFunction with those globals injected, and spy on every `$http.request`
// call. With the flag forced to `false`, no recorded call may touch `scheme_knowledge`,
// the embeddings endpoint, or carry a `query_embedding` body.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ─── Load the real n8n Code Node body ────────────────────────────────────────

const STATUS_INFO_PATH = fileURLToPath(
  new URL('../../n8n-workflows/code-nodes/status-info.js', import.meta.url),
);
const STATUS_INFO_SOURCE = readFileSync(STATUS_INFO_PATH, 'utf8');

// AsyncFunction constructor — the node body uses top-level `await`/`return await run();`.
const AsyncFunction = Object.getPrototypeOf(async function () {
  /* noop */
}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

// Compile once. Parameters become the injected n8n globals the body closes over.
const runNodeBody = new AsyncFunction(
  '$json',
  '$env',
  '$http',
  'console',
  STATUS_INFO_SOURCE,
);

// ─── Spy harness ──────────────────────────────────────────────────────────────

interface HttpCall {
  method?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, unknown>;
}

interface NodeOutputItem {
  json: { reply?: string;[k: string]: unknown };
}

/**
 * Does this outbound HTTP call touch `scheme_knowledge` in any way?
 *
 * Phase 2 (the path we must NEVER take when the flag is false) makes three kinds of
 * scheme_knowledge-touching calls:
 *   1. SELECT against the table:   `${API_BASE}/rest/v1/scheme_knowledge?...`
 *   2. OpenAI embedding generation: `https://api.openai.com/v1/embeddings`
 *   3. Vector-search RPC:           `${API_BASE}/rest/v1/rpc/match_scheme_knowledge`
 *      (body carries a `query_embedding`)
 */
function touchesSchemeKnowledge(call: HttpCall): boolean {
  const url = String(call.url ?? '');
  if (/scheme_knowledge/i.test(url)) return true; // covers the table SELECT and the RPC
  if (/api\.openai\.com/i.test(url)) return true; // embedding generation
  if (/\/embeddings\b/i.test(url)) return true; // any embeddings endpoint
  const bodyStr = call.body ? JSON.stringify(call.body) : '';
  if (/query_embedding|"embedding"|text-embedding/i.test(bodyStr)) return true;
  return false;
}

const FEATURE_FLAG_RE = /\/api\/feature-flags\/INFO_USE_EMBEDDINGS/i;
const GEMINI_RE = /generativelanguage\.googleapis\.com/i;
const COMPLAINTS_RE = /\/api\/complaints\/by-ticket\//i;

/**
 * Build a fake `$http` whose responses keep both phases runnable, so the test is not
 * vacuous: if the node erroneously entered Phase 2 it would receive valid-looking
 * embedding/vector responses and proceed — and our spy would record those calls.
 */
function makeHttp(flagValue: string, calls: HttpCall[]) {
  return {
    request: async (opts: HttpCall) => {
      calls.push(opts);
      const url = String(opts.url ?? '');

      // Feature-flag lookup → drives Phase 1 vs Phase 2 selection.
      if (FEATURE_FLAG_RE.test(url)) {
        return { body: { ok: true, value: flagValue } };
      }

      // Gemini generateContent → return a well-formed candidate so Phase 1 produces a reply.
      if (GEMINI_RE.test(url)) {
        return {
          body: {
            candidates: [
              { content: { parts: [{ text: 'Yeh rahi yojana ki jankari.' }] } },
            ],
          },
        };
      }

      // Complaints lookup (ticket branch) → "not found" so flow falls through.
      if (COMPLAINTS_RE.test(url)) {
        return { body: { ok: false } };
      }

      // scheme_knowledge embedded-rows count gate (Phase 2 step 1).
      if (/\/rest\/v1\/scheme_knowledge/i.test(url)) {
        return { body: [{ id: 'sk-1' }] };
      }

      // OpenAI embeddings (Phase 2 step 2).
      if (/api\.openai\.com\/v1\/embeddings/i.test(url)) {
        return { body: { data: [{ embedding: new Array(768).fill(0) }] } };
      }

      // Vector-search RPC (Phase 2 step 3).
      if (/match_scheme_knowledge/i.test(url)) {
        return {
          body: [{ title: 'Kanyashree', content: 'Education support.', similarity: 0.92 }],
        };
      }

      return { body: {} };
    },
  };
}

const ENV = {
  API_BASE_URL: 'https://wb-grievance-portal.test',
  N8N_WEBHOOK_SECRET: 'test-secret',
  GEMINI_API_KEY: 'test-gemini-key',
  GEMINI_MODEL: 'gemini-1.5-flash',
  SUPABASE_ANON_KEY: 'test-anon-key',
  OPENAI_API_KEY: 'test-openai-key',
};

interface RunResult {
  output: NodeOutputItem[];
  calls: HttpCall[];
}

/** Execute the real Info Code Node body against the spy harness. */
async function runInfoNode(opts: {
  messageText: string;
  language: string;
  flagValue: string;
}): Promise<RunResult> {
  const calls: HttpCall[] = [];
  const $json = {
    message: { text: opts.messageText, original_text: opts.messageText },
    session: { language: opts.language },
  };
  const $http = makeHttp(opts.flagValue, calls);
  const silentConsole = { warn: () => {}, log: () => {}, error: () => {} };

  const output = (await runNodeBody($json, ENV, $http, silentConsole)) as NodeOutputItem[];
  return { output, calls };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const TICKET_RE = /\bWB-\d{4}-\d{5}\b/i;

const LANGUAGES = ['en', 'hi', 'bn'] as const;

/** Scheme/info keywords across en/hi/bn that flip the node's `isInfoQuery` branch on. */
const SCHEME_KEYWORDS = [
  'scheme',
  'yojana',
  'prakalpa',
  'Kanyashree',
  'Lakshmir Bhandar',
  'Swasthya Sathi',
  'Krishak Bandhu',
  'pension',
  'scholarship',
  'health',
  'farmer',
  'योजना',
  'पेंशन',
  'छात्रवृत्ति',
  'স্বাস্থ্য',
  'যোজনা',
  'বৃত্তি',
];

/** Hand-written natural-language info queries in en/hi/bn. */
const NATURAL_QUERIES = [
  'Tell me about the Kanyashree scheme',
  'How do I apply for Lakshmir Bhandar?',
  'What is Swasthya Sathi health insurance?',
  'pension scheme eligibility for senior citizens',
  'scholarship for girl students in West Bengal',
  'कन्याश्री योजना के बारे में बताइए',
  'पेंशन कैसे मिलेगी बुजुर्गों को',
  'छात्रवृत्ति की जानकारी दीजिए',
  'স্বাস্থ্য সাথী সম্পর্কে বলুন',
  'লক্ষ্মীর ভাণ্ডার কীভাবে পাব',
  'কৃষক বন্ধু যোজনার তথ্য দিন',
];

/**
 * Arbitrary inbound info / scheme query strings (en/hi/bn). We exclude anything that looks
 * like a ticket number so the generated message stays on the Info path (not the status path);
 * the property holds either way, but this keeps every iteration exercising the branch we care
 * about.
 */
const arbInfoQuery = fc
  .oneof(
    fc.constantFrom(...NATURAL_QUERIES),
    fc
      .tuple(fc.constantFrom(...SCHEME_KEYWORDS), fc.string({ maxLength: 30 }))
      .map(([kw, tail]) => `${kw} ${tail}`.trim()),
    // Longer free-form text — the node treats messages >10 chars as potential info queries.
    fc.string({ minLength: 11, maxLength: 80 }),
  )
  .filter((q) => !TICKET_RE.test(q));

// ─── Property 36 ───────────────────────────────────────────────────────────────

describe('Property 36: Info path makes zero scheme_knowledge queries when INFO_USE_EMBEDDINGS=false', () => {
  it('never queries scheme_knowledge (no vector search, no embedding, no SELECT) for arbitrary info queries', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbInfoQuery,
        fc.constantFrom(...LANGUAGES),
        async (messageText, language) => {
          const { output, calls } = await runInfoNode({
            messageText,
            language,
            flagValue: 'false',
          });

          // Core property: ZERO calls touch scheme_knowledge / embeddings.
          const offending = calls.filter(touchesSchemeKnowledge);
          expect(offending).toEqual([]);

          // The node still produced a single, well-formed reply item.
          expect(output).toHaveLength(1);
          expect(typeof output[0].json.reply).toBe('string');
        },
      ),
      { numRuns: 150 },
    );
  });

  it('treats every non-string-true flag value (false/0/no/"")  as Phase 1 — still zero scheme_knowledge calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbInfoQuery,
        fc.constantFrom(...LANGUAGES),
        fc.constantFrom('false', '', '0', 'no', 'FALSE', 'off'),
        async (messageText, language, flagValue) => {
          const { calls } = await runInfoNode({ messageText, language, flagValue });
          // The node only switches to Phase 2 when value === 'true' (string) or true (bool).
          // Any other value MUST keep it on Phase 1 and never touch scheme_knowledge.
          expect(calls.filter(touchesSchemeKnowledge)).toEqual([]);
        },
      ),
      { numRuns: 120 },
    );
  });

  // ─── Focused anchors ─────────────────────────────────────────────────────────

  it('Phase 1: a clear scheme query calls Gemini but never scheme_knowledge', async () => {
    const { calls, output } = await runInfoNode({
      messageText: 'Tell me about the Kanyashree scheme eligibility',
      language: 'en',
      flagValue: 'false',
    });

    expect(calls.filter(touchesSchemeKnowledge)).toEqual([]);
    // Phase 1 inlines summaries into a single Gemini prompt — confirm Gemini was hit.
    expect(calls.some((c) => GEMINI_RE.test(String(c.url)))).toBe(true);
    expect(typeof output[0].json.reply).toBe('string');
  });

  it('Help fallback: a short greeting makes no scheme_knowledge call and no Gemini call', async () => {
    const { calls, output } = await runInfoNode({
      messageText: 'hi',
      language: 'hi',
      flagValue: 'false',
    });

    expect(calls.filter(touchesSchemeKnowledge)).toEqual([]);
    expect(calls.some((c) => GEMINI_RE.test(String(c.url)))).toBe(false);
    expect(typeof output[0].json.reply).toBe('string');
  });

  // ─── Control: prove the detector is NOT vacuous ────────────────────────────────
  // When the flag is `true` (and the safety gate passes) the SAME node body DOES touch
  // scheme_knowledge. This guards against a false-passing test where the detector simply
  // never matches anything.
  it('control — flag=true takes Phase 2 and DOES touch scheme_knowledge', async () => {
    const { calls } = await runInfoNode({
      messageText: 'Tell me about the Kanyashree scheme eligibility',
      language: 'en',
      flagValue: 'true',
    });

    expect(calls.filter(touchesSchemeKnowledge).length).toBeGreaterThan(0);
  });
});
