// Feature: sahayak-multi-agent-router, task 18.1: Classifier parse safety
//
// Validates: Requirements 20.2, 20.8 — Design §v1.1.1
//
// This suite asserts two structural invariants of the Gemini Flash classifier
// wrapper that the Hybrid CEO Router depends on (the classifier sits on the
// user-facing path and must never crash it):
//
//   I1. `parseClassifierOutput(text)` ALWAYS returns a well-formed decision for
//       ANY string input — `agent` is one of the five classes and `confidence`
//       is a finite number in [0, 1]. Any malformed input collapses to the safe
//       fallback `{ agent: 'welcome', confidence: 0, rationale: 'parse_failure' }`.
//
//   I2. `classify(input, deps)` ALWAYS resolves (never rejects) to a
//       ClassifierOutput with `agent` ∈ classes, `confidence` ∈ [0,1],
//       `latency_ms >= 0`, and `total_tokens >= 0`, regardless of whatever the
//       (faulty) transport returns or throws.
//
// These are deliberately scoped to the deterministic, code-level guarantees the
// wrapper enforces — not to Gemini's semantic accuracy, which is non-deterministic.

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  classify,
  parseClassifierOutput,
  AGENTS,
  type ClassifierInput,
  type ClassifyDeps,
} from '../../src/lib/router/classifier';

const AGENT_SET = new Set<string>(AGENTS);

function isValidDecision(d: { agent: string; confidence: number }): boolean {
  return (
    AGENT_SET.has(d.agent) &&
    Number.isFinite(d.confidence) &&
    d.confidence >= 0 &&
    d.confidence <= 1
  );
}

// ─── I1: parser total-correctness over arbitrary strings ──────────────────────

describe('Property: parseClassifierOutput is total and shape-safe', () => {
  it('returns a valid decision for any arbitrary string', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const d = parseClassifierOutput(text);
        expect(isValidDecision(d)).toBe(true);
        expect(typeof d.rationale).toBe('string');
        // secondary_agent is either null or a valid class.
        expect(d.secondary_agent === null || AGENT_SET.has(d.secondary_agent as string)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('returns a valid decision for arbitrary JSON-shaped objects', () => {
    const jsonish = fc.record(
      {
        agent: fc.oneof(fc.constantFrom(...AGENTS), fc.string()),
        confidence: fc.oneof(
          fc.double({ min: -10, max: 10, noNaN: false }),
          fc.string(),
          fc.constant(null),
        ),
        secondary_agent: fc.oneof(fc.constantFrom(...AGENTS), fc.string(), fc.constant(null)),
        rationale: fc.oneof(fc.string(), fc.constant(null)),
      },
      { requiredKeys: [] },
    );

    fc.assert(
      fc.property(jsonish, (obj) => {
        const d = parseClassifierOutput(JSON.stringify(obj));
        expect(isValidDecision(d)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

// ─── I2: classify never rejects and always records latency/tokens ─────────────

describe('Property: classify always resolves to a valid ClassifierOutput', () => {
  const inputArb: fc.Arbitrary<ClassifierInput> = fc.record({
    message: fc.string(),
    language: fc.constantFrom('en', 'hi', 'bn'),
    traceId: fc.string({ minLength: 1 }),
  });

  it('resolves to a valid output for any input and any well-formed-ish transport', async () => {
    // A transport whose text payload is arbitrary (may or may not be valid JSON)
    // and whose reported token count is an arbitrary non-negative-ish number.
    const transportArb = fc.record({
      text: fc.string(),
      tokens: fc.oneof(fc.nat({ max: 10000 }), fc.constant(undefined)),
    });

    await fc.assert(
      fc.asyncProperty(inputArb, transportArb, async (input, transport) => {
        const deps: ClassifyDeps = {
          apiKey: 'k',
          fetchImpl: (async () =>
            ({
              ok: true,
              status: 200,
              json: async () => ({
                candidates: [{ content: { parts: [{ text: transport.text }] } }],
                ...(transport.tokens != null
                  ? { usageMetadata: { totalTokenCount: transport.tokens } }
                  : {}),
              }),
            }) as unknown as Response) as unknown as typeof fetch,
        };

        const out = await classify(input, deps);
        expect(isValidDecision(out)).toBe(true);
        expect(out.latency_ms).toBeGreaterThanOrEqual(0);
        expect(out.total_tokens).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(out.total_tokens)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('resolves to the safe fallback when the transport throws arbitrarily', async () => {
    await fc.assert(
      fc.asyncProperty(inputArb, fc.string(), async (input, errMsg) => {
        const deps: ClassifyDeps = {
          apiKey: 'k',
          fetchImpl: (async () => {
            throw new Error(errMsg);
          }) as unknown as typeof fetch,
        };
        const out = await classify(input, deps);
        // Either empty-message short-circuit or network_error — both are welcome/0.
        expect(out.agent).toBe('welcome');
        expect(out.confidence).toBe(0);
        expect(out.latency_ms).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });
});
