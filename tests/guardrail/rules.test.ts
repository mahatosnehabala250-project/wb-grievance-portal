// Feature: sahayak-multi-agent-router, Task 23.4 — per-rule guardrail example tests
//
// Validates: Requirements 25.2, 25.3, 25.4, 25.5, 25.6, 25.7 — Design §v1.1.6
//
// One positive (violation) + one negative (clean) example per guardrail rule.
// Rules are pure functions (no I/O, no LLM, no DB); these are deterministic
// unit examples complementing the idempotence property test (23.5).

import { describe, it, expect } from 'vitest';
import {
  detectPiiLeak,
  checkLanguage,
  detectRefusal,
  enforceLength,
  checkUrls,
  detectJsonLeak,
  DEFAULT_MAX_CHARS,
} from '../../src/lib/guardrail/rules';

describe('guardrail rule: PII leak (Req 25.2)', () => {
  it('flags and masks a third-party 10-digit phone number', () => {
    const res = detectPiiLeak('Call the officer at 9876543210 for help.');
    expect(res.violated).toBe(true);
    expect(res.repaired).not.toContain('9876543210');
    expect(res.repaired).toMatch(/98XXXXXX10/);
  });

  it('flags and masks an email address', () => {
    const res = detectPiiLeak('Email officer@example.com please.');
    expect(res.violated).toBe(true);
    expect(res.repaired).toContain('[email hidden]');
    expect(res.repaired).not.toContain('officer@example.com');
  });

  it('passes a clean reply with no PII', () => {
    const res = detectPiiLeak('Aap ki shikayat darj ho gayi hai. Dhanyavaad!');
    expect(res.violated).toBe(false);
    expect(res.repaired).toBe('Aap ki shikayat darj ho gayi hai. Dhanyavaad!');
  });
});

describe('guardrail rule: language mismatch (Req 25.3)', () => {
  it('flags a Bengali-script reply when the session language is Hindi', () => {
    const res = checkLanguage('আপনার অভিযোগ নথিভুক্ত হয়েছে।', 'hi');
    expect(res.violated).toBe(true);
  });

  it('allows a romanized (Latin) Hindi reply for a hi session', () => {
    const res = checkLanguage('Aap ki shikayat darj ho gayi hai.', 'hi');
    expect(res.violated).toBe(false);
  });

  it('allows Devanagari for a hi session', () => {
    const res = checkLanguage('आपकी शिकायत दर्ज हो गई है।', 'hi');
    expect(res.violated).toBe(false);
  });
});

describe('guardrail rule: refusal text (Req 25.4)', () => {
  it('flags a canned model refusal and substitutes a helpful fallback', () => {
    const res = detectRefusal('As an AI, I cannot help with that request.');
    expect(res.violated).toBe(true);
    expect(res.repaired.toLowerCase()).not.toContain('as an ai');
    expect(res.repaired.toLowerCase()).not.toContain('i cannot');
  });

  it('passes a normal helpful reply', () => {
    const res = detectRefusal('Zaroor! Aap ka blood request ban gaya hai.');
    expect(res.violated).toBe(false);
  });
});

describe('guardrail rule: length cap (Req 25.5)', () => {
  it('flags and truncates an over-long reply (ellipsis within budget)', () => {
    const long = 'a '.repeat(DEFAULT_MAX_CHARS); // ~2000 chars
    const res = enforceLength(long, DEFAULT_MAX_CHARS);
    expect(res.violated).toBe(true);
    expect(res.repaired.length).toBeLessThanOrEqual(DEFAULT_MAX_CHARS);
    expect(res.repaired.endsWith('...')).toBe(true);
  });

  it('passes a short reply unchanged', () => {
    const res = enforceLength('Theek hai, ho gaya.', DEFAULT_MAX_CHARS);
    expect(res.violated).toBe(false);
    expect(res.repaired).toBe('Theek hai, ho gaya.');
  });
});

describe('guardrail rule: URL allowlist (Req 25.6)', () => {
  it('flags and strips a non-allowlisted URL', () => {
    const res = checkUrls('Visit https://evil.example.com/phish for details.');
    expect(res.violated).toBe(true);
    expect(res.repaired).not.toContain('evil.example.com');
  });

  it('allows a whitelisted gov / wa.me / supabase URL', () => {
    const res = checkUrls('Track at https://wb-grievance-portal.gov.in/status and https://wa.me/919876543210');
    expect(res.violated).toBe(false);
    expect(res.repaired).toContain('wb-grievance-portal.gov.in');
    expect(res.repaired).toContain('wa.me');
  });
});

describe('guardrail rule: json / tool leak (Req 25.7)', () => {
  it('flags and strips a raw JSON object literal', () => {
    const res = detectJsonLeak('Here is the result {"agent":"blood","confidence":0.9} ok.');
    expect(res.violated).toBe(true);
    expect(res.repaired).not.toContain('"agent"');
  });

  it('flags and strips a registered tool name / sentinel', () => {
    const res = detectJsonLeak('Calling RegisterComplaint now. function_call: done');
    expect(res.violated).toBe(true);
    expect(res.repaired).not.toMatch(/RegisterComplaint/);
    expect(res.repaired).not.toMatch(/function_call/);
  });

  it('flags and strips a fenced code block', () => {
    const res = detectJsonLeak('Reply text\n```json\n{"x":1}\n```\nmore text');
    expect(res.violated).toBe(true);
    expect(res.repaired).not.toContain('```');
  });

  it('passes a clean prose reply', () => {
    const res = detectJsonLeak('Aap ki complaint WB-2026-00042 register ho gayi.');
    expect(res.violated).toBe(false);
  });
});
