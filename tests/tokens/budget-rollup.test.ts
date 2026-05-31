// Feature: sahayak-multi-agent-router, Task 7.13 — Budget_Tracker estimator fallback (Req 18.15, 30.8)
//
// Unit tests for the v1.1.11 Budget_Tracker rollup fallback. These verify that
// when agent_invocations.tokens_used is NULL the rollup falls back to the
// task-7.12 token estimator (active for v1.1, no-op for v1) so the per-session
// 24-hour token cap (Req 30.3) stays enforced.
//
// Pure-logic tests — no DB, no network.

import { describe, it, expect } from 'vitest';
import {
  resolveInvocationTokens,
  rollupSessionTokens,
  type InvocationTokenInput,
} from '../../src/lib/tokens/budgetRollup';
import { estimateTotal } from '../../src/lib/tokens/estimateTokens';

const V1 = { estimatorFallbackEnabled: false } as const; // pre-v1.1 (flag off)
const V11 = { estimatorFallbackEnabled: true } as const; // v1.1 (flag on)

describe('resolveInvocationTokens — provider usage always wins', () => {
  it('uses tokens_used when present (v1 and v1.1 alike)', () => {
    const inv: InvocationTokenInput = {
      sessionId: 's1',
      tokensUsed: 1234,
      prompt: 'a very long prompt that would estimate to something else',
      response: 'a long response too',
    };
    expect(resolveInvocationTokens(inv, V1)).toBe(1234);
    expect(resolveInvocationTokens(inv, V11)).toBe(1234);
  });

  it('treats tokens_used = 0 as a real (usable) value, not a fallback trigger', () => {
    const inv: InvocationTokenInput = {
      sessionId: 's1',
      tokensUsed: 0,
      prompt: 'should NOT be estimated',
      response: 'should NOT be estimated',
    };
    expect(resolveInvocationTokens(inv, V11)).toBe(0);
  });
});

describe('resolveInvocationTokens — NULL tokens_used', () => {
  const prompt = 'Please file a complaint about the broken streetlight on MG Road.';
  const response = 'Sure — I have logged complaint #4521 and assigned it to PWD.';

  it('contributes 0 in v1 (fallback disabled — matches SQL SUM skipping NULL)', () => {
    const inv: InvocationTokenInput = { sessionId: 's1', tokensUsed: null, prompt, response };
    expect(resolveInvocationTokens(inv, V1)).toBe(0);
  });

  it('falls back to the local estimator in v1.1 (Req 30.8)', () => {
    const inv: InvocationTokenInput = { sessionId: 's1', tokensUsed: null, prompt, response };
    const expected = estimateTotal('', prompt, response);
    expect(resolveInvocationTokens(inv, V11)).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it('prefers a Logger pre-computed estimatedTokens over re-estimating', () => {
    const inv: InvocationTokenInput = {
      sessionId: 's1',
      tokensUsed: undefined,
      estimatedTokens: 99,
      prompt,
      response,
    };
    expect(resolveInvocationTokens(inv, V11)).toBe(99);
  });

  it('estimates from prompt/response when estimatedTokens is missing', () => {
    const inv: InvocationTokenInput = { sessionId: 's1', tokensUsed: null, prompt, response };
    expect(resolveInvocationTokens(inv, V11)).toBe(estimateTotal('', prompt, response));
  });

  it('handles missing prompt/response gracefully (estimate of empty = 0)', () => {
    const inv: InvocationTokenInput = { sessionId: 's1', tokensUsed: null };
    expect(resolveInvocationTokens(inv, V11)).toBe(0);
    expect(resolveInvocationTokens(inv, V1)).toBe(0);
  });

  it('ignores invalid estimatedTokens (negative/NaN) and re-estimates', () => {
    const inv: InvocationTokenInput = {
      sessionId: 's1',
      tokensUsed: null,
      estimatedTokens: -5,
      prompt,
      response,
    };
    expect(resolveInvocationTokens(inv, V11)).toBe(estimateTotal('', prompt, response));
  });
});

describe('rollupSessionTokens — per-session aggregation', () => {
  it('sums provider + estimated contributions per session (v1.1)', () => {
    const prompt = 'hello there general kenobi';
    const response = 'you are a bold one';
    const invocations: InvocationTokenInput[] = [
      { sessionId: 'sA', tokensUsed: 100 },
      { sessionId: 'sA', tokensUsed: null, prompt, response }, // estimated
      { sessionId: 'sB', tokensUsed: 50 },
    ];

    const totals = rollupSessionTokens(invocations, V11);
    expect(totals.get('sA')).toBe(100 + estimateTotal('', prompt, response));
    expect(totals.get('sB')).toBe(50);
  });

  it('under-counts NULL rows in v1 (estimator off) — only provider usage counts', () => {
    const invocations: InvocationTokenInput[] = [
      { sessionId: 'sA', tokensUsed: 100 },
      { sessionId: 'sA', tokensUsed: null, prompt: 'x'.repeat(400), response: 'y'.repeat(400) },
    ];
    // v1: NULL row skipped -> 100. v1.1: NULL row estimated -> 100 + 200.
    expect(rollupSessionTokens(invocations, V1).get('sA')).toBe(100);
    expect(rollupSessionTokens(invocations, V11).get('sA')).toBe(300);
  });

  it('keeps the 24h cap enforceable: a budget-busting NULL-usage session is detected in v1.1', () => {
    const CAP = 30_000;
    // 30k chars of prompt -> ceil(30000/4) = 7500 tokens per row; 5 rows = 37 500 > CAP.
    const bigPrompt = 'a'.repeat(30_000);
    const invocations: InvocationTokenInput[] = Array.from({ length: 5 }, () => ({
      sessionId: 'runaway',
      tokensUsed: null,
      prompt: bigPrompt,
      response: '',
    }));

    // v1 would see 0 and never trip the cap; v1.1 correctly exceeds it.
    expect(rollupSessionTokens(invocations, V1).get('runaway')).toBe(0);
    expect(rollupSessionTokens(invocations, V11).get('runaway')!).toBeGreaterThan(CAP);
  });

  it('returns an empty map for no invocations', () => {
    expect(rollupSessionTokens([], V11).size).toBe(0);
  });
});
