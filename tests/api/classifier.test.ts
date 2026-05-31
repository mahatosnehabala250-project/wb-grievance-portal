// Unit tests for the Gemini Flash intent classifier wrapper (task 18.1).
//
// Validates: Requirements 20.2, 20.7, 20.8 — Design §v1.1.1
//
// These tests exercise the injectable `classify(input, deps)` contract with a
// fake `fetchImpl` and a controllable `now()` clock, so no live API is touched.
// They cover:
//   - the design ClassifierOutput shape (agent / confidence / secondary_agent /
//     rationale / latency_ms / total_tokens)
//   - strict JSON parsing of a well-formed Gemini response
//   - the safe fallback `{ agent: 'welcome', confidence: 0, rationale: 'parse_failure' }`
//     on malformed / unparseable output
//   - latency_ms and total_tokens recording on every call (Req 20.8)
//   - never-throw behavior on transport / timeout / non-200 errors

import { describe, it, expect, vi } from 'vitest';
import {
  classify,
  buildPrompt,
  parseClassifierOutput,
  AGENTS,
  type ClassifierInput,
  type ClassifyDeps,
} from '../../src/lib/router/classifier';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INPUT: ClassifierInput = {
  message: 'mujhe khoon chahiye, emergency hai',
  language: 'hi',
  traceId: 'trace-123',
};

/** Build a fake Gemini `generateContent` response wrapping a text payload. */
function geminiResponse(text: string, totalTokens?: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
      ...(totalTokens != null
        ? { usageMetadata: { totalTokenCount: totalTokens } }
        : {}),
    }),
  };
}

/** A `fetchImpl` that resolves to the given response and records the request. */
function fakeFetch(response: unknown, sink?: { url?: string; init?: RequestInit }) {
  return (async (url: string, init: RequestInit) => {
    if (sink) {
      sink.url = url;
      sink.init = init;
    }
    return response as Response;
  }) as unknown as typeof fetch;
}

const BASE_DEPS: ClassifyDeps = { apiKey: 'test-key' };

// ─── Happy path ─────────────────────────────────────────────────────────────

describe('classify — well-formed Gemini response', () => {
  it('maps a strict JSON response to the design ClassifierOutput shape', async () => {
    const sink: { url?: string; init?: RequestInit } = {};
    const out = await classify(INPUT, {
      ...BASE_DEPS,
      fetchImpl: fakeFetch(
        geminiResponse(
          '{"agent":"blood","confidence":0.92,"secondary_agent":"info","rationale":"asks for blood urgently"}',
          57,
        ),
        sink,
      ),
    });

    expect(out.agent).toBe('blood');
    expect(out.confidence).toBeCloseTo(0.92);
    expect(out.secondary_agent).toBe('info');
    expect(out.rationale).toBe('asks for blood urgently');
    expect(out.total_tokens).toBe(57);
    expect(typeof out.latency_ms).toBe('number');
    expect(out.latency_ms).toBeGreaterThanOrEqual(0);

    // The key is passed on the query string and the model receives the prompt body.
    expect(sink.url).toContain('key=test-key');
    expect(String(sink.init?.body)).toContain('deterministic classifier');
  });

  it('normalizes a missing secondary_agent to null and synthesizes a rationale', async () => {
    const out = await classify(INPUT, {
      ...BASE_DEPS,
      fetchImpl: fakeFetch(geminiResponse('{"agent":"donor","confidence":0.7}')),
    });

    expect(out.agent).toBe('donor');
    expect(out.confidence).toBeCloseTo(0.7);
    expect(out.secondary_agent).toBeNull();
    expect(out.rationale).toBe('classified_as_donor');
  });

  it('clamps out-of-range confidence into [0, 1]', async () => {
    const high = await classify(INPUT, {
      ...BASE_DEPS,
      fetchImpl: fakeFetch(geminiResponse('{"agent":"complaint","confidence":4.2}')),
    });
    const low = await classify(INPUT, {
      ...BASE_DEPS,
      fetchImpl: fakeFetch(geminiResponse('{"agent":"complaint","confidence":-3}')),
    });

    expect(high.confidence).toBe(1);
    expect(low.confidence).toBe(0);
  });

  it('tolerates a stray ```json code fence around the JSON', async () => {
    const out = await classify(INPUT, {
      ...BASE_DEPS,
      fetchImpl: fakeFetch(
        geminiResponse('```json\n{"agent":"info","confidence":0.6}\n```'),
      ),
    });
    expect(out.agent).toBe('info');
    expect(out.confidence).toBeCloseTo(0.6);
  });
});

// ─── Parse failures → safe fallback ───────────────────────────────────────────

describe('classify — malformed output collapses to the safe fallback', () => {
  it('returns welcome/0/parse_failure on non-JSON text', async () => {
    const out = await classify(INPUT, {
      ...BASE_DEPS,
      fetchImpl: fakeFetch(geminiResponse('I think this is a blood request!')),
    });
    expect(out).toMatchObject({
      agent: 'welcome',
      confidence: 0,
      secondary_agent: null,
      rationale: 'parse_failure',
    });
  });

  it('returns parse_failure when the agent value is not one of the five classes', async () => {
    const out = await classify(INPUT, {
      ...BASE_DEPS,
      fetchImpl: fakeFetch(geminiResponse('{"agent":"banking","confidence":0.9}')),
    });
    expect(out.agent).toBe('welcome');
    expect(out.confidence).toBe(0);
    expect(out.rationale).toBe('parse_failure');
  });

  it('returns parse_failure when the response shape is unexpected (no candidates)', async () => {
    const out = await classify(INPUT, {
      ...BASE_DEPS,
      fetchImpl: fakeFetch({ ok: true, status: 200, json: async () => ({}) } as unknown as Response),
    });
    expect(out.rationale).toBe('parse_failure');
    expect(out.agent).toBe('welcome');
  });

  it('still records latency_ms and total_tokens=0 on the fallback path (Req 20.8)', async () => {
    let t = 1000;
    const out = await classify(INPUT, {
      ...BASE_DEPS,
      now: () => (t += 5), // start=1005, end=1010 → 5ms
      fetchImpl: fakeFetch(geminiResponse('garbage')),
    });
    expect(out.total_tokens).toBe(0);
    expect(out.latency_ms).toBe(5);
  });
});

// ─── Transport / config failures never throw ──────────────────────────────────

describe('classify — failure modes resolve to a safe fallback (never throw)', () => {
  it('returns no_api_key fallback when no key is configured', async () => {
    const out = await classify(INPUT, { apiKey: '', fetchImpl: fakeFetch(geminiResponse('x')) });
    expect(out.agent).toBe('welcome');
    expect(out.rationale).toBe('no_api_key');
    expect(out.total_tokens).toBe(0);
  });

  it('short-circuits empty messages without calling fetch', async () => {
    const spy = vi.fn();
    const out = await classify(
      { message: '   ', language: 'en', traceId: 't' },
      { ...BASE_DEPS, fetchImpl: spy as unknown as typeof fetch },
    );
    expect(spy).not.toHaveBeenCalled();
    expect(out.rationale).toBe('empty_message');
    expect(out.agent).toBe('welcome');
  });

  it('returns an http_<status> fallback on a non-200 response', async () => {
    const out = await classify(INPUT, {
      ...BASE_DEPS,
      fetchImpl: fakeFetch({ ok: false, status: 429, json: async () => ({}) } as unknown as Response),
    });
    expect(out.agent).toBe('welcome');
    expect(out.rationale).toBe('http_429');
  });

  it('returns a network_error fallback when fetch rejects', async () => {
    const out = await classify(INPUT, {
      ...BASE_DEPS,
      fetchImpl: (async () => {
        throw new Error('socket hang up');
      }) as unknown as typeof fetch,
    });
    expect(out.agent).toBe('welcome');
    expect(out.rationale).toBe('network_error');
  });

  it('returns a timeout fallback when the request is aborted', async () => {
    const out = await classify(INPUT, {
      ...BASE_DEPS,
      timeoutMs: 5,
      fetchImpl: ((url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal | undefined;
          signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        })) as unknown as typeof fetch,
    });
    expect(out.agent).toBe('welcome');
    expect(out.rationale).toBe('timeout');
  });
});

// ─── Prompt & parser units ────────────────────────────────────────────────────

describe('buildPrompt', () => {
  it('embeds the language hint and the NFC-normalized message, JSON-only', () => {
    const prompt = buildPrompt('road kharab', 'bn');
    expect(prompt).toContain('Message language hint: bn');
    expect(prompt).toContain('road kharab');
    expect(prompt).toContain('Return JSON only');
    expect(prompt).toContain('"secondary_agent"');
  });
});

describe('parseClassifierOutput', () => {
  it('returns parse_failure for null / empty input', () => {
    expect(parseClassifierOutput(null).rationale).toBe('parse_failure');
    expect(parseClassifierOutput('   ').rationale).toBe('parse_failure');
  });

  it('accepts every valid agent class', () => {
    for (const agent of AGENTS) {
      const d = parseClassifierOutput(`{"agent":"${agent}","confidence":0.5}`);
      expect(d.agent).toBe(agent);
    }
  });
});
