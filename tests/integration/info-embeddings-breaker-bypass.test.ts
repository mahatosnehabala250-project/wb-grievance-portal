// Feature: sahayak-multi-agent-router, Task 27.5 — Embedding-bypass branch in Info Code Node
//
// Req 29.4 / Design §v1.1.10 (embeddings breaker row): When the shared
// `circuit_state.embeddings` breaker is OPEN, the Info Code Node MUST bypass
// the embed → vector-search path entirely (even when INFO_USE_EMBEDDINGS=true)
// and serve the curated Phase 1 scheme summaries instead — the same path used
// when INFO_USE_EMBEDDINGS=false. This degrades gracefully during an embedding
// provider outage rather than repeatedly calling a failing embedding API.
//
// The read is fail-soft: a missing / unreadable `circuit_state` row is treated
// as closed (Phase 2 proceeds), mirroring src/lib/breaker/breaker.ts.
//
// Like the Property 36 test, the Info logic lives inside an n8n Code Node body
// (`n8n-workflows/code-nodes/status-info.js`) that is NOT importable as a module:
// it references the n8n globals `$json`, `$env`, `$http`, `console` and ends with a
// top-level `return await run();`. We load the real file verbatim, wrap it in an
// AsyncFunction with those globals injected, and spy on every `$http.request` call.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ─── Load the real n8n Code Node body ────────────────────────────────────────

const STATUS_INFO_PATH = fileURLToPath(
  new URL('../../n8n-workflows/code-nodes/status-info.js', import.meta.url),
);
const STATUS_INFO_SOURCE = readFileSync(STATUS_INFO_PATH, 'utf8');

const AsyncFunction = Object.getPrototypeOf(async function () {
  /* noop */
}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

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
  json: { reply?: string; [k: string]: unknown };
}

const FEATURE_FLAG_RE = /\/api\/feature-flags\/INFO_USE_EMBEDDINGS/i;
const GEMINI_RE = /generativelanguage\.googleapis\.com/i;
const COMPLAINTS_RE = /\/api\/complaints\/by-ticket\//i;
const CIRCUIT_STATE_RE = /\/rest\/v1\/circuit_state/i;
const EMBEDDING_RE = /api\.openai\.com\/v1\/embeddings/i;
const SCHEME_KNOWLEDGE_RE = /scheme_knowledge/i;

/** Did this call touch the embedding / vector-search path? */
function touchesEmbeddingPath(call: HttpCall): boolean {
  const url = String(call.url ?? '');
  if (EMBEDDING_RE.test(url)) return true;
  if (SCHEME_KNOWLEDGE_RE.test(url)) return true; // table SELECT + match RPC
  const bodyStr = call.body ? JSON.stringify(call.body) : '';
  if (/query_embedding|text-embedding/i.test(bodyStr)) return true;
  return false;
}

/**
 * Build a fake `$http`. `breakerState` is the value returned for the
 * circuit_state read: 'open' | 'closed' | 'half_open' | null (no row).
 */
function makeHttp(opts: {
  flagValue: string;
  breakerState: string | null;
  calls: HttpCall[];
}) {
  const { flagValue, breakerState, calls } = opts;
  return {
    request: async (req: HttpCall) => {
      calls.push(req);
      const url = String(req.url ?? '');

      if (FEATURE_FLAG_RE.test(url)) {
        return { body: { ok: true, value: flagValue } };
      }
      if (CIRCUIT_STATE_RE.test(url)) {
        // PostgREST returns an array of rows; empty array when no row matches.
        return { body: breakerState === null ? [] : [{ state: breakerState }] };
      }
      if (GEMINI_RE.test(url)) {
        return {
          body: { candidates: [{ content: { parts: [{ text: 'Yeh rahi yojana ki jankari.' }] } }] },
        };
      }
      if (COMPLAINTS_RE.test(url)) {
        return { body: { ok: false } };
      }
      if (/\/rest\/v1\/scheme_knowledge/i.test(url)) {
        return { body: [{ id: 'sk-1' }] };
      }
      if (EMBEDDING_RE.test(url)) {
        return { body: { data: [{ embedding: new Array(768).fill(0) }] } };
      }
      if (/match_scheme_knowledge/i.test(url)) {
        return { body: [{ title: 'Kanyashree', content: 'Education support.', similarity: 0.92 }] };
      }
      return { body: {} };
    },
  };
}

const ENV = {
  API_BASE_URL: 'https://wb-grievance-portal.test',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.test',
  N8N_WEBHOOK_SECRET: 'test-secret',
  GEMINI_API_KEY: 'test-gemini-key',
  GEMINI_MODEL: 'gemini-1.5-flash',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  SUPABASE_ANON_KEY: 'test-anon-key',
  OPENAI_API_KEY: 'test-openai-key',
};

async function runInfoNode(opts: {
  messageText: string;
  language: string;
  flagValue: string;
  breakerState: string | null;
  env?: Record<string, string>;
}): Promise<{ output: NodeOutputItem[]; calls: HttpCall[] }> {
  const calls: HttpCall[] = [];
  const $json = {
    message: { text: opts.messageText, original_text: opts.messageText },
    session: { language: opts.language },
  };
  const $http = makeHttp({ flagValue: opts.flagValue, breakerState: opts.breakerState, calls });
  const silentConsole = { warn: () => {}, log: () => {}, error: () => {} };
  const output = (await runNodeBody(
    $json,
    opts.env ?? ENV,
    $http,
    silentConsole,
  )) as NodeOutputItem[];
  return { output, calls };
}

const INFO_QUERY = 'Tell me about the Kanyashree scheme eligibility';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Info Code Node — embeddings circuit breaker bypass (Req 29.4)', () => {
  it('bypasses embeddings and serves Phase 1 when circuit_state.embeddings = open (flag=true)', async () => {
    const { output, calls } = await runInfoNode({
      messageText: INFO_QUERY,
      language: 'en',
      flagValue: 'true',
      breakerState: 'open',
    });

    // No embedding / vector-search call may have happened.
    expect(calls.filter(touchesEmbeddingPath)).toEqual([]);
    // The breaker was consulted.
    expect(calls.some((c) => CIRCUIT_STATE_RE.test(String(c.url)))).toBe(true);
    // Phase 1 still produces a reply via Gemini with inlined summaries.
    expect(calls.some((c) => GEMINI_RE.test(String(c.url)))).toBe(true);
    expect(output).toHaveLength(1);
    expect(typeof output[0].json.reply).toBe('string');
  });

  it('proceeds with Phase 2 (touches scheme_knowledge) when breaker = closed (flag=true)', async () => {
    const { calls } = await runInfoNode({
      messageText: INFO_QUERY,
      language: 'en',
      flagValue: 'true',
      breakerState: 'closed',
    });
    expect(calls.filter(touchesEmbeddingPath).length).toBeGreaterThan(0);
  });

  it('treats a missing circuit_state row as closed (Phase 2 proceeds)', async () => {
    const { calls } = await runInfoNode({
      messageText: INFO_QUERY,
      language: 'en',
      flagValue: 'true',
      breakerState: null,
    });
    expect(calls.filter(touchesEmbeddingPath).length).toBeGreaterThan(0);
  });

  it('treats half_open as allowing the embedding probe (Phase 2 proceeds)', async () => {
    const { calls } = await runInfoNode({
      messageText: INFO_QUERY,
      language: 'en',
      flagValue: 'true',
      breakerState: 'half_open',
    });
    expect(calls.filter(touchesEmbeddingPath).length).toBeGreaterThan(0);
  });

  it('does not consult the breaker at all on the Phase 1 path (flag=false)', async () => {
    const { calls } = await runInfoNode({
      messageText: INFO_QUERY,
      language: 'en',
      flagValue: 'false',
      breakerState: 'open',
    });
    // Flag is off → never reaches Phase 2, so no circuit_state read and no embeddings.
    expect(calls.some((c) => CIRCUIT_STATE_RE.test(String(c.url)))).toBe(false);
    expect(calls.filter(touchesEmbeddingPath)).toEqual([]);
  });

  it('fails soft to Phase 2 when no Supabase key is provisioned (cannot read breaker)', async () => {
    const envNoKey = {
      ...ENV,
      SUPABASE_SERVICE_ROLE_KEY: '',
      SUPABASE_ANON_KEY: '',
    };
    const { calls } = await runInfoNode({
      messageText: INFO_QUERY,
      language: 'en',
      flagValue: 'true',
      breakerState: 'open', // would bypass IF it could read, but no key → cannot read
      env: envNoKey,
    });
    // With no key the node never issues the circuit_state read and proceeds (fail-soft).
    expect(calls.some((c) => CIRCUIT_STATE_RE.test(String(c.url)))).toBe(false);
    expect(calls.filter(touchesEmbeddingPath).length).toBeGreaterThan(0);
  });
});
