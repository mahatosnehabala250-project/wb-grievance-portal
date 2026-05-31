// Feature: sahayak-multi-agent-router, Property 25: Guardrail idempotence
//
// Validates: Requirement 25 (25.8 repair-then-recheck) — Design §v1.1.6, §Property 25
//
// Property 25: running the guardrail on its own output is a fixed point. For any
// reply, let r1 = checkReply(reply). Then checkReply(r1.reply) must:
//   - return action 'pass' (no further violation), AND
//   - return the identical string (r2.reply === r1.reply).
// This guarantees every repair fully removes/normalizes the offending substring
// so the same rule cannot fire again, and substituted fallbacks are themselves
// always clean.

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { checkReply, FALLBACK_LINES } from '../../src/lib/guardrail/check';

const LANGS = ['en', 'hi', 'bn'] as const;

// Fragments that exercise each rule category, mixed into arbitrary replies.
const VIOLATION_FRAGMENTS = [
  'call 9876543210 now',
  'email me at officer@example.com',
  'As an AI, I cannot do that',
  'I am unable to help',
  'visit https://evil.example.com/x',
  'see https://wb-grievance-portal.gov.in/status', // allowed — should survive
  '{"agent":"blood","confidence":0.9}',
  '```json\n{"x":1}\n```',
  'calling RegisterComplaint and function_call: x',
  'আপনার অভিযোগ নথিভুক্ত হয়েছে', // Bengali script
  'आपकी शिकायत दर्ज', // Devanagari
  'a normal helpful reply hai',
  'X'.repeat(2200), // length overflow
];

const arbReply: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...VIOLATION_FRAGMENTS), { minLength: 1, maxLength: 4 })
  .map((parts) => parts.join(' '));

describe('Property 25 — Guardrail idempotence (Req 25.8)', () => {
  it('check(check(reply)) is a fixed point: second pass passes and is unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(arbReply, fc.constantFrom(...LANGS), async (reply, language) => {
        const r1 = await checkReply(reply, { language });
        const r2 = await checkReply(r1.reply, { language });

        // Second pass must be clean (no residual violation) ...
        expect(r2.action).toBe('pass');
        // ... and a true fixed point on the string.
        expect(r2.reply).toBe(r1.reply);
        expect(r2.violations).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('a clean reply passes unchanged on the first call', async () => {
    const clean = 'Aap ki shikayat WB-2026-00042 darj ho gayi. Dhanyavaad!';
    const res = await checkReply(clean, { language: 'hi' });
    expect(res.action).toBe('pass');
    expect(res.reply).toBe(clean);
  });

  it('substituted fallback lines are themselves clean (no re-violation)', async () => {
    for (const lang of LANGS) {
      const res = await checkReply(FALLBACK_LINES[lang], { language: lang });
      expect(res.action).toBe('pass');
      expect(res.reply).toBe(FALLBACK_LINES[lang]);
    }
  });
});
