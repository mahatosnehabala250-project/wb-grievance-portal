// Feature: sahayak-multi-agent-router, Property 1: CEO Router determinism and decision precedence
//
// Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 19.2
// Design reference: design.md §CEO Router, §Property 1
//
// This suite covers Property 1 from the design doc: for any
// (message, last_intent, last_activity_at, language) input, decide(...) is
// referentially transparent (deterministic) and respects the documented
// decision precedence:
//   1. defensive stale belt (now - last_activity_at > 30 min -> treat as idle)
//   2. state lock        (donor_pending_response | seeker_confirming -> blood)
//   3. state prefix      (complaint_* | blood_* | donor_*)
//   4. ticket regex      (WB-YYYY-XXXXX -> info)
//   5. greeting on idle  (-> welcome)
//   6. idle keywords     (blood -> donor -> complaint precedence)
//   7. default           (-> welcome / unknown_no_state)
//
// It also confirms the two code paths described in the task are equivalent:
//   (a) a session already reset upstream by Prepare Context (idle + fresh)
//   (b) a session still stale at the router level (defensive belt branch)
// produce byte-identical decisions and rationale for equivalent inputs.

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  decide,
  KEYWORDS,
  TICKET_RE,
  STALE_MS,
  type SessionInput,
  type MessageInput,
} from '../../src/lib/router/ceoRouter';

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/** Fixed reference "now" so the stale-belt branch is fully deterministic. */
const NOW = new Date('2026-02-01T12:00:00.000Z');

/** All last_intent enum values from Requirement 1.2. */
const ALL_INTENTS = [
  'idle',
  'welcome',
  'complaint_collecting',
  'complaint_confirming',
  'blood_collecting',
  'blood_confirming',
  'donor_pending_response',
  'seeker_confirming',
  'donor_registration',
  'donor_confirming',
  'status_check',
  'info_query',
] as const;

const NON_IDLE_INTENTS = ALL_INTENTS.filter((i) => i !== 'idle');

/** Mirrors the (unexported) matchAny in the implementation. Stateless: none
 *  of the KEYWORDS regexes use the /g flag, so .test() is side-effect free. */
function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

// Multilingual keyword token pools (en / hi-roman / hi-devanagari / bn-roman /
// bn-bangla). Each token is chosen to deterministically match its category's
// regexes in src/lib/router/ceoRouter.ts.
const BLOOD_TOKENS = [
  'blood',
  'blod',
  'need blood',
  'emergency blood',
  'urgent blood',
  'blood needed',
  'blood required',
  'blood chahiye',
  'khoon',
  'rakt',
  'raqt',
  'raktt',
  'khoon chahiye',
  'rakt chahiye',
  'rokto lagbe',
  'blood lagbe',
  'A+',
  'O-',
  'B-',
  'AB+',
  'B positive',
  'रक्त',
  'खून',
  'रक्त चाहिए',
  'রক্ত',
  'ব্লাড',
  'রক্ত লাগবে',
];

const DONOR_TOKENS = [
  'donor',
  'become a donor',
  'become donor',
  'register as donor',
  'i want to donate',
  'donor banna',
  'raktdaan karna',
  'rokto dite',
  'donor hote chai',
  'रक्तदाता',
  'डोनर बनना',
  'रक्तदान करना',
  'ডোনার',
  'রক্তদাতা',
];

const COMPLAINT_TOKENS = [
  'complaint',
  'grievance',
  'problem',
  'issue',
  'road',
  'no water',
  'electricity',
  'pension',
  'school',
  'ration',
  'samasya',
  'shikayat',
  'sadak',
  'bijli',
  'समस्या',
  'शिकायत',
  'सड़क',
  'पानी',
  'সমস্যা',
  'অভিযোগ',
  'রাস্তা',
];

const GREETING_TOKENS = [
  'hi',
  'hii',
  'hello',
  'helo',
  'hey',
  'hai',
  'hola',
  'namaste',
  'namaskar',
  'pranam',
  'salaam',
  'adab',
  'good morning',
  'good evening',
  'good afternoon',
  'good night',
  'नमस्ते',
  'नमस्कार',
  'हैलो',
  'प्रणाम',
  'আদাব',
  'নমস্কার',
  'হ্যালো',
  'হাই',
  'নমস্তে',
];

// Neutral noise tokens that must NOT match any keyword/greeting category, so
// pure-noise messages exercise the default -> welcome fallback.
const NOISE_TOKENS = [
  'thanks',
  'okay',
  'hmm',
  'xyz',
  'foobar',
  'lorem',
  'test message',
  'please',
  'kindly',
  'sir',
  'madam',
  '...',
  '??',
  'update',
];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ticketArb = fc
  .tuple(fc.integer({ min: 2020, max: 2099 }), fc.integer({ min: 0, max: 99999 }))
  .map(([year, serial]) => `WB-${year}-${String(serial).padStart(5, '0')}`);

const keywordTokenArb = fc.constantFrom(
  ...BLOOD_TOKENS,
  ...DONOR_TOKENS,
  ...COMPLAINT_TOKENS,
);

const noiseTokenArb = fc.constantFrom(...NOISE_TOKENS);
const greetingArb = fc.constantFrom(...GREETING_TOKENS);

const segmentArb = fc.oneof(
  { weight: 6, arbitrary: keywordTokenArb },
  { weight: 2, arbitrary: noiseTokenArb },
  { weight: 1, arbitrary: ticketArb },
);

const composedArb = fc
  .array(segmentArb, { minLength: 1, maxLength: 4 })
  .map((parts) => parts.join(' '));

/**
 * Biased multilingual message generator. Produces the `{ text, original_text }`
 * shape that decide() consumes — `text` is the lowercased keyword-match input
 * (as the upstream Parse step produces) and `original_text` preserves case for
 * the ticket regex.
 */
const messageArb: fc.Arbitrary<MessageInput> = fc
  .oneof(
    { weight: 5, arbitrary: composedArb },
    // greeting-only (the greeting regexes are anchored ^...$, so they only fire
    // when the greeting is the entire message)
    { weight: 2, arbitrary: greetingArb },
    // ticket-only
    { weight: 1, arbitrary: ticketArb },
    // greeting + ticket: greeting can no longer anchor-match, so ticket must win
    {
      weight: 1,
      arbitrary: greetingArb.chain((g) => ticketArb.map((t) => `${g} ${t}`)),
    },
    // pure noise -> default welcome
    { weight: 1, arbitrary: noiseTokenArb },
  )
  .map((original) => ({ original_text: original, text: original.toLowerCase() }));

const languageArb = fc.constantFrom<'en' | 'hi' | 'bn'>('en', 'hi', 'bn');

const lastIntentArb = fc.constantFrom(...ALL_INTENTS);
const nonIdleIntentArb = fc.constantFrom(...NON_IDLE_INTENTS);

/** Activity offsets in minutes, deliberately straddling the 30-min boundary. */
const activityOffsetArb = fc.oneof(
  { weight: 1, arbitrary: fc.constantFrom(0, 15, 29, 30, 31, 45, 120) },
  { weight: 2, arbitrary: fc.integer({ min: 0, max: 240 }) },
);

const lastActivityArb: fc.Arbitrary<string | null> = fc.oneof(
  { weight: 8, arbitrary: activityOffsetArb.map((mins) => new Date(NOW.getTime() - mins * 60_000).toISOString()) },
  { weight: 1, arbitrary: fc.constant<null>(null) },
);

const sessionArb: fc.Arbitrary<SessionInput> = fc.record({
  last_intent: lastIntentArb,
  last_activity_at: lastActivityArb,
  language: languageArb,
});

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

describe('Property 1: CEO Router determinism and decision precedence', () => {
  it('is referentially transparent — identical inputs always yield identical output', () => {
    fc.assert(
      fc.property(sessionArb, messageArb, (session, message) => {
        const first = decide(session, message, NOW);
        const second = decide(session, message, NOW);
        expect(second).toStrictEqual(first);
      }),
      { numRuns: 400 },
    );
  });

  it('respects the documented decision precedence for every input class', () => {
    fc.assert(
      fc.property(sessionArb, messageArb, (session, message) => {
        const decision = decide(session, message, NOW);

        const text = (message.text || '').trim();
        const original = message.original_text || message.text || '';
        const lastActivityMs = session.last_activity_at
          ? new Date(session.last_activity_at).getTime()
          : 0;
        const stale = !!lastActivityMs && NOW.getTime() - lastActivityMs > STALE_MS;

        // Rule 1: defensive stale belt normalizes a stale non-idle intent to idle.
        let eff = session.last_intent || 'idle';
        if (stale && eff !== 'idle') eff = 'idle';

        // Rule 2: state lock wins over message content (tickets, keywords, greetings).
        if (eff === 'donor_pending_response') {
          expect(decision.agent).toBe('blood');
          expect(decision.reason).toBe('state:donor_pending_response');
          return;
        }
        if (eff === 'seeker_confirming') {
          expect(decision.agent).toBe('blood');
          expect(decision.reason).toBe('state:seeker_confirming');
          return;
        }

        // Rule 3: state prefix dispatch wins over message content.
        if (eff.startsWith('complaint_')) {
          expect(decision.agent).toBe('complaint');
          expect(decision.reason).toBe(`state_prefix:${eff}`);
          return;
        }
        if (eff.startsWith('blood_')) {
          expect(decision.agent).toBe('blood');
          expect(decision.reason).toBe(`state_prefix:${eff}`);
          return;
        }
        if (eff.startsWith('donor_')) {
          expect(decision.agent).toBe('donor');
          expect(decision.reason).toBe(`state_prefix:${eff}`);
          return;
        }

        // Remaining effective intents (idle, welcome, status_check, info_query)
        // all fall through to content-based routing.

        // Rule 4: ticket regex beats greeting and idle keywords.
        if (TICKET_RE.test(original)) {
          expect(decision.agent).toBe('info');
          expect(decision.reason).toBe('ticket_pattern_detected');
          return;
        }

        // Rule 5: greeting on idle beats idle keywords.
        if (matchAny(text, KEYWORDS.greeting)) {
          expect(decision.agent).toBe('welcome');
          expect(decision.reason).toBe('greeting_on_idle');
          return;
        }

        // Rule 6: idle keyword routing, blood -> donor -> complaint precedence.
        if (matchAny(text, KEYWORDS.blood)) {
          expect(decision.agent).toBe('blood');
          expect(decision.reason).toBe('idle_keyword:blood');
          return;
        }
        if (matchAny(text, KEYWORDS.donor)) {
          expect(decision.agent).toBe('donor');
          expect(decision.reason).toBe('idle_keyword:donor');
          return;
        }
        if (matchAny(text, KEYWORDS.complaint)) {
          expect(decision.agent).toBe('complaint');
          expect(decision.reason).toBe('idle_keyword:complaint');
          return;
        }

        // Rule 7: default fallback.
        expect(decision.agent).toBe('welcome');
        expect(decision.reason).toBe('unknown_no_state');
      }),
      { numRuns: 500 },
    );
  });

  it('always returns one of the five valid agents (Req 2.12 output contract)', () => {
    const validAgents = new Set(['complaint', 'blood', 'donor', 'info', 'welcome']);
    fc.assert(
      fc.property(sessionArb, messageArb, (session, message) => {
        const decision = decide(session, message, NOW);
        expect(validAgents.has(decision.agent)).toBe(true);
        expect(typeof decision.reason).toBe('string');
        expect(decision.reason.length).toBeGreaterThan(0);
        // rationale is observable for routing_decisions (Req 2.13)
        expect(Array.isArray(decision.rulesEvaluated)).toBe(true);
        expect(decision.rulesEvaluated.length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });

  it('produces identical decisions whether the session was reset by Prepare Context (a) or by the defensive belt (b) — Req 19.2', () => {
    fc.assert(
      fc.property(
        messageArb,
        languageArb,
        nonIdleIntentArb,
        fc.integer({ min: 31, max: 600 }),
        (message, language, staleIntent, minutesAgo) => {
          // Path (a): Prepare Context already reset the session upstream.
          const postResetSession: SessionInput = {
            last_intent: 'idle',
            last_activity_at: NOW.toISOString(),
            language,
          };
          // Path (b): session is still stale at the router level; the defensive
          // belt must normalize it to the same effective state as path (a).
          const staleSession: SessionInput = {
            last_intent: staleIntent,
            last_activity_at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
            language,
          };

          const fromReset = decide(postResetSession, message, NOW);
          const fromBelt = decide(staleSession, message, NOW);

          // Decision AND rationale (agent, reason, rulesEvaluated) must match.
          expect(fromBelt).toStrictEqual(fromReset);
        },
      ),
      { numRuns: 400 },
    );
  });
});

// ---------------------------------------------------------------------------
// Concrete unit examples (complement the property tests)
// ---------------------------------------------------------------------------

describe('CEO Router — concrete precedence examples', () => {
  const fresh = (last_intent: string): SessionInput => ({
    last_intent,
    last_activity_at: NOW.toISOString(),
    language: 'en',
  });
  const msg = (original: string): MessageInput => ({
    original_text: original,
    text: original.toLowerCase(),
  });

  it('routes a greeting on idle to welcome without an agent (Req 2.11)', () => {
    expect(decide(fresh('idle'), msg('Namaskar'), NOW)).toMatchObject({
      agent: 'welcome',
      reason: 'greeting_on_idle',
    });
  });

  it('routes a ticket number to info, case-insensitively (Req 2.10)', () => {
    expect(decide(fresh('idle'), msg('check wb-2026-04217 please'), NOW)).toMatchObject({
      agent: 'info',
      reason: 'ticket_pattern_detected',
    });
  });

  it('state-locks donor_pending_response to blood regardless of content (Req 2.2)', () => {
    expect(decide(fresh('donor_pending_response'), msg('road is broken'), NOW)).toMatchObject({
      agent: 'blood',
      reason: 'state:donor_pending_response',
    });
  });

  it('state-locks seeker_confirming to blood (Req 2.3)', () => {
    expect(decide(fresh('seeker_confirming'), msg('WB-2026-00001'), NOW)).toMatchObject({
      agent: 'blood',
      reason: 'state:seeker_confirming',
    });
  });

  it('dispatches complaint_* / blood_* / donor_* prefixes (Req 2.4-2.6)', () => {
    expect(decide(fresh('complaint_collecting'), msg('blood'), NOW).agent).toBe('complaint');
    expect(decide(fresh('blood_confirming'), msg('road'), NOW).agent).toBe('blood');
    expect(decide(fresh('donor_registration'), msg('hello'), NOW).agent).toBe('donor');
  });

  it('prefers blood over complaint when both keywords appear on idle (Req 2.7-2.9)', () => {
    expect(decide(fresh('idle'), msg('I need blood, also the road has a problem'), NOW)).toMatchObject({
      agent: 'blood',
      reason: 'idle_keyword:blood',
    });
  });

  it('routes idle donor and complaint keywords correctly', () => {
    expect(decide(fresh('idle'), msg('I want to become a donor'), NOW).agent).toBe('donor');
    expect(decide(fresh('idle'), msg('there is no water in our area'), NOW).agent).toBe('complaint');
  });

  it('falls back to welcome for unrecognized idle messages (Req 2.12)', () => {
    expect(decide(fresh('idle'), msg('thanks foobar'), NOW)).toMatchObject({
      agent: 'welcome',
      reason: 'unknown_no_state',
    });
  });

  it('lets a ticket beat a leading greeting when idle', () => {
    expect(decide(fresh('idle'), msg('hello WB-2026-12345'), NOW).agent).toBe('info');
  });

  it('defensively resets a stale non-idle session before routing (Req 1.6 belt)', () => {
    const stale: SessionInput = {
      last_intent: 'blood_collecting',
      last_activity_at: new Date(NOW.getTime() - 31 * 60_000).toISOString(),
      language: 'en',
    };
    // Without the belt this would dispatch to blood; after reset "hi" greets.
    expect(decide(stale, msg('hi'), NOW)).toMatchObject({
      agent: 'welcome',
      reason: 'greeting_on_idle',
    });
  });

  it('does NOT reset a session exactly at the 30-minute boundary', () => {
    const boundary: SessionInput = {
      last_intent: 'blood_collecting',
      last_activity_at: new Date(NOW.getTime() - STALE_MS).toISOString(),
      language: 'en',
    };
    // 30 min is not > 30 min, so the prefix lock still applies.
    expect(decide(boundary, msg('hi'), NOW).agent).toBe('blood');
  });
});
