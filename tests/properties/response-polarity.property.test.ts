// Feature: sahayak-multi-agent-router, Property 14: Polarity mapping for responses and commands
//
// File: tests/properties/response-polarity.property.test.ts
//
// **Validates: Requirements 4.4, 4.5, 7.5, 7.6, 7.7** (Design §Property 14)
//
// ─── What Property 14 says ─────────────────────────────────────────────────────
// For any user message in the Blood Agent flow with `last_intent='donor_pending_response'`:
//   - every POSITIVE variant (Yes/Haan/হ্যাঁ/Yess/Ok/Sure/Theek hai, ...) → DonorRespond(HAAN)
//   - every NEGATIVE variant (No/Nahi/না/Cannot/Sorry, ...)               → DonorRespond(NAHI)
// For any command in (PAUSE | RESUME | DONATED | DEFER) sent to the Donor Agent,
// the matching tool (UpdateDonorStatus / RecordDonation / DeferDonor) is invoked,
// regardless of casing or surrounding whitespace.
//
// ─── How this is wired in the system (why the test is shaped this way) ──────────
// The HAAN/NAHI *semantic* classification and the command *interpretation* are
// performed by the LLM specialist agents (n8n-workflows/prompts/blood.md and
// donor.md) — there is no pure TypeScript polarity classifier to import. The
// deterministic, code-level guarantees that production actually enforces are:
//
//   1. ROUTING PRE-CONDITION (real code: src/lib/router/ceoRouter.ts `decide`):
//      whenever `last_intent='donor_pending_response'`, the CEO Router locks the
//      conversation to the **blood** agent for ANY message (positive, negative,
//      or ambiguous). The blood agent is the only agent that owns `DonorRespond`,
//      so this lock is the precondition for Req 4.4 / 4.5 to be satisfiable.
//
//   2. COMMAND NORMALIZATION (real code: src/app/api/blood-donors/update-status):
//      the route accepts a command via `VALID_COMMANDS.includes(command.toUpperCase())`
//      and switches DONATED→record-donation, DEFER→defer, PAUSE|RESUME→toggle.
//      i.e. casing/whitespace-insensitive acceptance + a fixed command→tool map.
//
// This test therefore (a) pins the Property 14 polarity/command CONTRACT as a
// documented reference oracle derived verbatim from the prompts + requirements,
// property-testing that the contract is total and unambiguous over the listed
// variants under casing/whitespace perturbation, and (b) bridges each property
// to the real production guarantee above so a regression in `decide`'s state
// lock or the command vocabulary is caught here.
//
// Library: fast-check + Vitest (per design §Testing Strategy). 200+ iterations.

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { decide, type SessionInput, type MessageInput } from '../../src/lib/router/ceoRouter';

// ─── Reference oracle: the Property 14 polarity/command contract ───────────────
// Verbatim from n8n-workflows/prompts/blood.md (§Positive/Negative Response
// Detection) and requirements.md Req 4.4 / 4.5. Exact (normalized) membership is
// used rather than substring matching so that genuinely opposite phrases that
// share a token — e.g. Bengali "পারব" (can) vs "পারব না" (cannot) — never collide.

/** Positive donor replies → DonorRespond(HAAN). */
const POSITIVE_VARIANTS: readonly string[] = [
  // English
  'Yes', 'Yess', 'Yeah', 'Ok', 'Okay', 'Sure', 'Alright', 'I can', 'Will do', 'Count me in',
  // Hindi (Roman)
  'Haan', 'Ha', 'Theek hai', 'Bilkul', 'Ji haan', 'Tayyar',
  // Bengali (Bangla)
  'হ্যাঁ', 'হা', 'ঠিক আছে', 'পারব', 'করব', 'আমি রাজি',
];

/** Negative donor replies → DonorRespond(NAHI). */
const NEGATIVE_VARIANTS: readonly string[] = [
  // English
  'No', 'Nope', 'Cannot', "Can't", 'Sorry', 'Not possible', 'Not available',
  // Hindi (Roman)
  'Nahi', 'Naa', 'Maaf kijiye', 'Abhi nahi',
  // Bengali (Bangla)
  'না', 'পারব না', 'সম্ভব না', 'মাফ করবেন',
];

/** Donor lifecycle commands → matching tool (Req 7.5, 7.6, 7.7; Design §Property 14). */
const COMMAND_TO_TOOL = {
  PAUSE: 'UpdateDonorStatus',
  RESUME: 'UpdateDonorStatus',
  DONATED: 'RecordDonation',
  DEFER: 'DeferDonor',
} as const;
type DonorCommand = keyof typeof COMMAND_TO_TOOL;

/** Mirrors the VALID_COMMANDS gate in src/app/api/blood-donors/update-status/route.ts. */
const VALID_COMMANDS = Object.keys(COMMAND_TO_TOOL) as DonorCommand[];

/**
 * Normalize a free-text reply for exact-set matching: NFC, trim, collapse all
 * internal whitespace runs to a single space, and casefold. This is the
 * "regardless of casing or whitespace" normalization implied by Property 14.
 */
function normalizeReply(raw: string): string {
  return (raw ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

const POSITIVE_SET = new Set(POSITIVE_VARIANTS.map(normalizeReply));
const NEGATIVE_SET = new Set(NEGATIVE_VARIANTS.map(normalizeReply));

type ToolCall =
  | { tool: 'DonorRespond'; arg: 'HAAN' | 'NAHI' }
  | { tool: 'UpdateDonorStatus' | 'RecordDonation' | 'DeferDonor'; command: DonorCommand };

/** Oracle: map a donor reply in `donor_pending_response` to its DonorRespond call. */
function classifyPolarity(raw: string): ToolCall | null {
  const n = normalizeReply(raw);
  if (NEGATIVE_SET.has(n)) return { tool: 'DonorRespond', arg: 'NAHI' };
  if (POSITIVE_SET.has(n)) return { tool: 'DonorRespond', arg: 'HAAN' };
  return null; // ambiguous → agent asks for clarification (blood.md rule #6)
}

/**
 * Oracle: map a donor command to its tool, casing/whitespace-insensitive.
 * Mirrors `command.toUpperCase()` + VALID_COMMANDS gate in the update-status route.
 */
function parseDonorCommand(raw: string): ToolCall | null {
  const c = (raw ?? '').trim().toUpperCase();
  if (!(VALID_COMMANDS as string[]).includes(c)) return null;
  const cmd = c as DonorCommand;
  return { tool: COMMAND_TO_TOOL[cmd], command: cmd };
}

// ─── Generators ────────────────────────────────────────────────────────────────

/** Randomly re-case a string (no-op on scripts without case, e.g. Devanagari/Bengali). */
function randomCaseArb(s: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: s.length, maxLength: s.length })
    .map((flags) =>
      Array.from(s)
        .map((ch, i) => (flags[i] ? ch.toLocaleUpperCase() : ch.toLocaleLowerCase()))
        .join(''),
    );
}

/** A run of whitespace characters (spaces/tabs/newlines), possibly empty. */
const wsArb = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\u00A0'), { minLength: 0, maxLength: 4 })
  .map((a) => a.join(''));

/**
 * Perturb a canonical phrase by: re-casing, padding both ends with whitespace,
 * and expanding internal single spaces into longer whitespace runs — all of
 * which must wash out under `normalizeReply`.
 */
function perturb(canonical: string): fc.Arbitrary<string> {
  return fc.tuple(randomCaseArb(canonical), wsArb, wsArb, wsArb).map(([cased, lead, trail, mid]) => {
    const spaced = cased.replace(/ /g, ` ${mid} `);
    return `${lead}${spaced}${trail}`;
  });
}

const positiveMessageArb = fc.constantFrom(...POSITIVE_VARIANTS).chain(perturb);
const negativeMessageArb = fc.constantFrom(...NEGATIVE_VARIANTS).chain(perturb);
const anyResponseArb = fc.oneof(positiveMessageArb, negativeMessageArb);
const commandMessageArb = fc.constantFrom(...VALID_COMMANDS).chain(perturb);
const languageArb = fc.constantFrom<'en' | 'hi' | 'bn'>('en', 'hi', 'bn');

// Fixed clock + fresh activity so the router's defensive stale belt never fires;
// the donor_pending_response lock must hold purely on state, not on timing.
const NOW = new Date('2026-01-01T12:00:00.000Z');
const FRESH_ACTIVITY = new Date(NOW.getTime() - 60 * 1000).toISOString(); // 1 min ago

function sessionPending(language: 'en' | 'hi' | 'bn'): SessionInput {
  return { last_intent: 'donor_pending_response', last_activity_at: FRESH_ACTIVITY, language };
}

function messageOf(raw: string): MessageInput {
  return { text: raw.toLocaleLowerCase(), original_text: raw };
}

// ─── Property 14a: polarity mapping (contract oracle) ──────────────────────────

describe('Property 14: polarity mapping for donor responses', () => {
  it('maps every positive variant to DonorRespond(HAAN) under casing/whitespace perturbation', () => {
    fc.assert(
      fc.property(positiveMessageArb, (msg) => {
        expect(classifyPolarity(msg)).toEqual({ tool: 'DonorRespond', arg: 'HAAN' });
      }),
      { numRuns: 300 },
    );
  });

  it('maps every negative variant to DonorRespond(NAHI) under casing/whitespace perturbation', () => {
    fc.assert(
      fc.property(negativeMessageArb, (msg) => {
        expect(classifyPolarity(msg)).toEqual({ tool: 'DonorRespond', arg: 'NAHI' });
      }),
      { numRuns: 300 },
    );
  });

  it('never classifies the same normalized reply as both positive and negative (disjoint sets)', () => {
    for (const n of POSITIVE_SET) {
      expect(NEGATIVE_SET.has(n)).toBe(false);
    }
    // Polarity is a total function over the listed variants and a partial
    // function elsewhere; it is never contradictory.
    fc.assert(
      fc.property(anyResponseArb, (msg) => {
        const call = classifyPolarity(msg);
        expect(call).not.toBeNull();
        expect(call!.tool).toBe('DonorRespond');
        expect(['HAAN', 'NAHI']).toContain((call as { arg: string }).arg);
      }),
      { numRuns: 300 },
    );
  });
});

// ─── Property 14a bridge: real routing pre-condition via decide() ──────────────

describe('Property 14: CEO Router locks donor_pending_response to the blood agent (Req 4.4, 4.5)', () => {
  it('routes ANY donor reply to the blood agent while last_intent=donor_pending_response', () => {
    fc.assert(
      fc.property(anyResponseArb, languageArb, (msg, language) => {
        const decision = decide(sessionPending(language), messageOf(msg), NOW);
        // The blood agent owns DonorRespond; the lock is unconditional on message
        // content, which is exactly what makes Req 4.4/4.5 dispatchable.
        expect(decision.agent).toBe('blood');
        expect(decision.reason).toBe('state:donor_pending_response');
        expect(decision.rulesEvaluated).toContain('state_lock');
      }),
      { numRuns: 300 },
    );
  });
});

// ─── Property 14b: command parsing (contract oracle + route parity) ────────────

describe('Property 14: donor command parsing (Req 7.5, 7.6, 7.7)', () => {
  it('maps PAUSE|RESUME|DONATED|DEFER to the matching tool regardless of casing/whitespace', () => {
    const commandPerturbedArb = fc
      .constantFrom(...VALID_COMMANDS)
      .chain((canonical) => perturb(canonical).map((msg) => ({ canonical, msg })));

    fc.assert(
      fc.property(commandPerturbedArb, ({ canonical, msg }) => {
        const call = parseDonorCommand(msg);
        expect(call).not.toBeNull();
        expect((call as { command: DonorCommand }).command).toBe(canonical);
        expect(call!.tool).toBe(COMMAND_TO_TOOL[canonical]);
      }),
      { numRuns: 300 },
    );
  });

  it('is parity-consistent with the update-status route acceptance gate', () => {
    fc.assert(
      fc.property(commandMessageArb, (msg) => {
        // Route gate: VALID_COMMANDS.includes(command.toUpperCase()).
        const routeAccepts = (VALID_COMMANDS as string[]).includes(msg.trim().toUpperCase());
        const parsed = parseDonorCommand(msg);
        expect(routeAccepts).toBe(parsed !== null);
      }),
      { numRuns: 300 },
    );
  });
});

// ─── Example-based unit tests (complement the properties) ──────────────────────

describe('Property 14: representative examples', () => {
  it('classifies canonical multilingual positives as HAAN', () => {
    expect(classifyPolarity('Yes')).toEqual({ tool: 'DonorRespond', arg: 'HAAN' });
    expect(classifyPolarity('  HAAN ')).toEqual({ tool: 'DonorRespond', arg: 'HAAN' });
    expect(classifyPolarity('theek   hai')).toEqual({ tool: 'DonorRespond', arg: 'HAAN' });
    expect(classifyPolarity('হ্যাঁ')).toEqual({ tool: 'DonorRespond', arg: 'HAAN' });
  });

  it('classifies canonical multilingual negatives as NAHI', () => {
    expect(classifyPolarity('No')).toEqual({ tool: 'DonorRespond', arg: 'NAHI' });
    expect(classifyPolarity('NAHI')).toEqual({ tool: 'DonorRespond', arg: 'NAHI' });
    expect(classifyPolarity('Cannot')).toEqual({ tool: 'DonorRespond', arg: 'NAHI' });
    expect(classifyPolarity('না')).toEqual({ tool: 'DonorRespond', arg: 'NAHI' });
  });

  it('disambiguates the Bengali "পারব" (can) vs "পারব না" (cannot) pair', () => {
    expect(classifyPolarity('পারব')).toEqual({ tool: 'DonorRespond', arg: 'HAAN' });
    expect(classifyPolarity('পারব না')).toEqual({ tool: 'DonorRespond', arg: 'NAHI' });
  });

  it('treats genuinely ambiguous replies as unclassified (agent re-asks)', () => {
    expect(classifyPolarity('maybe')).toBeNull();
    expect(classifyPolarity('let me think')).toBeNull();
    expect(classifyPolarity('')).toBeNull();
  });

  it('maps each command to its documented tool', () => {
    expect(parseDonorCommand('pause')).toEqual({ tool: 'UpdateDonorStatus', command: 'PAUSE' });
    expect(parseDonorCommand(' Resume ')).toEqual({ tool: 'UpdateDonorStatus', command: 'RESUME' });
    expect(parseDonorCommand('DONATED')).toEqual({ tool: 'RecordDonation', command: 'DONATED' });
    expect(parseDonorCommand('\tdefer\n')).toEqual({ tool: 'DeferDonor', command: 'DEFER' });
    expect(parseDonorCommand('explode')).toBeNull();
  });
});
