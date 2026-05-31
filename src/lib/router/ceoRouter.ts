/**
 * CEO Router (rule-based, no AI) + Hybrid CEO Router (v1.1).
 *
 * Pure deterministic function that decides which specialist agent should
 * handle an incoming WhatsApp message. Reads only the inputs it is given —
 * no I/O, no LLM, no DB. Designed to run in < 50 ms inside the n8n Code Node.
 *
 * Decision precedence (Requirements 2.1 - 2.13, 21.6):
 *   0. Cancel keyword check (Req 21.6): if message matches the cancel-keyword
 *      pattern, return { agent: 'cancel', reason: 'cancel_keyword' } immediately
 *      so the caller (n8n CEO Router Code Node) can pop the flow stack and
 *      resume the next frame or fall through to idle routing.
 *   1. Defensive stale belt: now - last_activity_at > 30 min AND last_intent
 *      !== 'idle' → treat as if last_intent='idle'. The real stale-session
 *      reset happens upstream in Prepare Context (task 2.5); this re-check
 *      is a safety belt only and never throws.
 *   2. State lock: last_intent === 'donor_pending_response' || 'seeker_confirming'
 *      → blood agent (Req 2.2-2.3).
 *   3. State prefix: complaint_* / blood_* / donor_* (Req 2.4-2.6).
 *   4. Ticket regex `WB-YYYY-XXXXX` against message.original_text → info
 *      (Req 2.10). Runs before idle keyword check.
 *   5. Greeting on idle → welcome with no AI (Req 2.11).
 *   6. Idle keywords in en/hi/bn → blood → donor → complaint, in that order
 *      (Req 2.7-2.9). Blood comes first because critical urgency must never
 *      be misclassified.
 *   7. Default fallback → welcome with reason='unknown_no_state'.
 *
 * v1.1 Hybrid Router (`decideHybrid`):
 *   Runs v1 `decide(...)` first. If the rule fires confidently (any decision
 *   other than the default 'unknown_no_state' fallback), or the session is in
 *   a hot-state that must never see the classifier (HOT_STATES), or
 *   opts.ruleOnlyRouting is true, the rule decision is returned immediately.
 *   Otherwise, `lookupOrClassify` is called (cache → Gemini Flash). If the
 *   classifier confidence is < 0.6, the decision routes to 'clarification'.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §CEO Router pseudocode
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.1 Hybrid CEO Router
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.2 Flow Stack and Multi-Intent
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §Components → Prepare Context
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirements 2.1 - 2.13, 20.1, 20.5, 20.6, 21.6
 */

import { lookupOrClassify, DbClient, Lang } from './cache';
import { cancelKeywordMatch, deriveLastIntent, peek, type Frame } from '../flowStack/manager';

export interface RouterDecision {
  agent: 'complaint' | 'blood' | 'donor' | 'info' | 'welcome' | 'cancel';
  reason: string;
  /** Ordered list of rule names evaluated; last entry is the matched rule. */
  rulesEvaluated: string[];
  intent_hint?: string;
}

export interface SessionInput {
  last_intent: string;
  last_activity_at: string | null;
  language: 'en' | 'hi' | 'bn';
}

export interface MessageInput {
  /** Pre-lowercased text from the Parse step (used for keyword match). */
  text: string;
  /** Case-preserved original text (used for ticket regex). */
  original_text: string;
}

export const STALE_MS = 30 * 60 * 1000;

/** WB-YYYY-XXXXX ticket format, case-insensitive (Req 2.10). */
export const TICKET_RE = /\bWB-\d{4}-\d{5}\b/i;

/**
 * Multilingual keyword table. Each category is an array of regexes; if any
 * regex matches the lowercased message text, the category is considered hit.
 * Coverage: English, Hindi (Devanagari + Roman), Bengali (Bangla + Roman),
 * common typos, and blood-group shorthand.
 */
export const KEYWORDS: {
  blood: RegExp[];
  donor: RegExp[];
  complaint: RegExp[];
  greeting: RegExp[];
} = {
  blood: [
    // English (incl. typo "blod")
    /\bblood\b/i,
    /\bblod\b/i,
    /\bneed\s+blood\b/i,
    /\b(emergency|sos|urgent)\s+blood\b/i,
    /\bblood\s+(needed|required|request|chahiye|chaahiye|lagbe|please)\b/i,
    // Hindi Roman (incl. typo "raktt")
    /\b(khoon|khun|raqt|rakt|raktt|raktdaata|raktdata)\b/i,
    /\b(khoon|raqt|rakt)\s+(chahiye|chaahiye|ki\s+zaroorat|ki\s+jaroorat)\b/i,
    // Bengali Roman
    /\b(rokto|rokta)\s+(lagbe|chai|proyojon|dorkar)\b/i,
    /\bblood\s+lagbe\b/i,
    // Blood-group shorthand: A+, B-, AB+, O- (and "B positive" style)
    /\b(a|b|ab|o)\s*[+\-](?=\s|$|[^\w+\-])/i,
    /\b(a|b|ab|o)\s+(positive|negative|pos|neg)\b/i,
    // Hindi Devanagari
    /(रक्त|खून|खुन)/u,
    /(रक्त|खून)\s*(चाहिए|की\s*ज़रूरत|की\s*जरूरत)/u,
    // Bengali Bangla
    /(রক্ত|খুন|ব্লাড)/u,
    /(রক্ত|খুন|ব্লাড)\s*(লাগবে|প্রয়োজন|চাই|দরকার)/u,
  ],
  donor: [
    // English
    /\bdonor\b/i,
    /\bbecome\s+(a\s+)?donor\b/i,
    /\bregister\s+(as\s+)?(a\s+)?donor\b/i,
    /\bi\s+want\s+to\s+donate(\s+blood)?\b/i,
    /\b(blood\s+)?donate\s+blood\b/i,
    // Hindi Roman
    /\bdonor\s+(banna|banaa|banna\s+hai|registration|register|ban(na)?\s+chahta)\b/i,
    /\b(blood|raqt|khoon|rakt)\s+donate\s+karna\b/i,
    /\braktdaan\s+(karna|dena|deni|karenge|karunga|karna\s+hai)\b/i,
    // Bengali Roman
    /\b(rokto|rokta)\s+(dite|daan|donate)\b/i,
    /\bdonor\s+hote\s+chai\b/i,
    // Hindi Devanagari
    /(रक्तदाता|डोनर|डोनार)/u,
    /(रक्तदान\s*(करना|दूँगा|देंगे|करूँगा|चाहता\s+हूँ|करना\s+है))/u,
    /(डोनर\s*बनना)/u,
    // Bengali Bangla
    /(ডোনার|ডোনর|রক্তদাতা)/u,
    /(রক্তদান\s*কর(তে|বো|বেন))/u,
    /(দাতা\s*হতে)/u,
  ],
  complaint: [
    // English
    /\b(complaint|complaints|grievance|problem|issue)\b/i,
    /\b(road|water|electricity|power|pension|school|college|hostel|scholarship|ration|sewage|drainage|garbage|sanitation|toilet|hospital)\b/i,
    /\bno\s+(water|electricity|power|light)\b/i,
    /\b(road|water|pension|electricity|bijli|pani)\s+(kharab|nahi|broken|repair|cut|band|nai|nei)\b/i,
    // Hindi Roman
    /\b(samasya|shikayat|shikaayat|sikayat|pareshani|abhijog)\b/i,
    /\b(sadak|sarak|rasta|paani|pani|bijli|bijlee|skool|skul|skole|raashan|chhatravritti|panchayat)\b/i,
    /\b(rasta|sadak|paani|pani|bijli|pension|raashan|ration|scholarship|skool)\s+(nahi|kharab|band|nai|nei|tuti)\b/i,
    // Bengali Roman
    /\b(rasta\s+kharap|jol\s+nei|biduyat\s+nei|abhijog|sikkha)\b/i,
    // Hindi Devanagari
    /(समस्या|शिकायत|परेशानी)/u,
    /(सड़क|पानी|बिजली|पेंशन|स्कूल|राशन|छात्रवृत्ति|शौचालय)/u,
    // Bengali Bangla
    /(সমস্যা|অভিযোগ)/u,
    /(রাস্তা|জল|পানি|বিদ্যুৎ|পেনশন|স্কুল|রেশন|বৃত্তি|শৌচাগার)/u,
    /(রাস্তা|জল|বিদ্যুৎ|পানি)\s*(খারাপ|নেই|নাই)/u,
  ],
  greeting: [
    // English (incl. "hii", "helo")
    /^(hi+|hii+|hello+|helo+|hey+|hai+|hola)[!.,\s]*$/i,
    /^(namaste|namaskar|namaskaar|namashkar|namashkaar|pranam|salaam|salam|adab|aadab)[!.,\s]*$/i,
    /^good\s+(morning|evening|afternoon|night)[!.,\s]*$/i,
    // Bengali Bangla
    /^(নমস্কার|হ্যালো|হাই|নমস্তে|আদাব|সালাম)[!.,\s]*$/u,
    // Hindi Devanagari
    /^(नमस्ते|नमस्कार|हैलो|प्रणाम|आदाब|सलाम)[!.,\s]*$/u,
  ],
};

function matchAny(text: string, patterns: RegExp[]): boolean {
  for (const re of patterns) {
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Decide which agent should handle the incoming message.
 *
 * Pure: same inputs always produce the same output. `now` is injectable so
 * the stale-belt branch is deterministic in tests.
 */
export function decide(
  session: SessionInput,
  message: MessageInput,
  now: Date = new Date(),
): RouterDecision {
  const rulesEvaluated: string[] = [];
  const text = (message.text || '').trim();
  const original = message.original_text || message.text || '';

  let lastIntent = session?.last_intent || 'idle';
  const lastActivityMs = session?.last_activity_at
    ? new Date(session.last_activity_at).getTime()
    : 0;

  // Rule 0: cancel keyword check — MUST run before all other rules (Req 21.6).
  // If the message matches the cancel-keyword pattern, return immediately so the
  // caller (n8n CEO Router Code Node) can pop the flow stack and resume the next
  // frame or fall through to idle routing.
  rulesEvaluated.push('cancel_keyword');
  if (cancelKeywordMatch(text)) {
    return { agent: 'cancel', reason: 'cancel_keyword', rulesEvaluated };
  }

  // Rule 1: defensive stale belt — never throws (Req 1.6, Req 2.x defensive)
  rulesEvaluated.push('stale_belt');
  if (
    lastActivityMs &&
    now.getTime() - lastActivityMs > STALE_MS &&
    lastIntent !== 'idle'
  ) {
    lastIntent = 'idle';
  }

  // Rule 2: explicit state lock (Req 2.2, 2.3)
  rulesEvaluated.push('state_lock');
  if (lastIntent === 'donor_pending_response') {
    return { agent: 'blood', reason: 'state:donor_pending_response', rulesEvaluated };
  }
  if (lastIntent === 'seeker_confirming') {
    return { agent: 'blood', reason: 'state:seeker_confirming', rulesEvaluated };
  }

  // Rule 3: state prefix dispatch (Req 2.4, 2.5, 2.6)
  rulesEvaluated.push('state_prefix');
  if (lastIntent.startsWith('complaint_')) {
    return { agent: 'complaint', reason: `state_prefix:${lastIntent}`, rulesEvaluated };
  }
  if (lastIntent.startsWith('blood_')) {
    return { agent: 'blood', reason: `state_prefix:${lastIntent}`, rulesEvaluated };
  }
  if (lastIntent.startsWith('donor_')) {
    return { agent: 'donor', reason: `state_prefix:${lastIntent}`, rulesEvaluated };
  }

  // Rule 4: ticket regex on case-preserved original_text (Req 2.10)
  rulesEvaluated.push('ticket_regex');
  if (TICKET_RE.test(original)) {
    return { agent: 'info', reason: 'ticket_pattern_detected', rulesEvaluated };
  }

  // Rule 5: greeting on idle → welcome (Req 2.11)
  rulesEvaluated.push('greeting_idle');
  if (matchAny(text, KEYWORDS.greeting)) {
    return { agent: 'welcome', reason: 'greeting_on_idle', rulesEvaluated };
  }

  // Rule 6: idle keyword routing — blood → donor → complaint (Req 2.7-2.9)
  rulesEvaluated.push('idle_keyword_blood');
  if (matchAny(text, KEYWORDS.blood)) {
    return { agent: 'blood', reason: 'idle_keyword:blood', rulesEvaluated };
  }
  rulesEvaluated.push('idle_keyword_donor');
  if (matchAny(text, KEYWORDS.donor)) {
    return { agent: 'donor', reason: 'idle_keyword:donor', rulesEvaluated };
  }
  rulesEvaluated.push('idle_keyword_complaint');
  if (matchAny(text, KEYWORDS.complaint)) {
    return { agent: 'complaint', reason: 'idle_keyword:complaint', rulesEvaluated };
  }

  // Rule 7: default fallback (Req 2.12 default; Reliability NFR)
  rulesEvaluated.push('default_fallback');
  return { agent: 'welcome', reason: 'unknown_no_state', rulesEvaluated };
}

// ─── v1.1 Hybrid CEO Router ───────────────────────────────────────────────────

/**
 * Hot-state bypass list (Req 20.6, Design §v1.1.1).
 *
 * When `session.last_intent` is one of these values the classifier MUST NOT be
 * invoked — the v1 rule decision is returned immediately. These are high-stakes
 * states where ambiguity is impossible and latency is critical.
 */
export const HOT_STATES: ReadonlySet<string> = new Set([
  'donor_pending_response',
  'seeker_confirming',
  'complaint_confirming',
  'donor_confirming',
]);

/**
 * Extended decision type returned by `decideHybrid`.
 *
 * Adds `classifierUsed` and `confidence` fields required by Req 20.7 so the
 * caller can write them to `routing_decisions`. When the rule path fires,
 * `classifierUsed` is `false` and `confidence` is `1` (fully confident).
 * When the clarification path fires, `agent` is `'clarification'`.
 */
export interface HybridRouterDecision extends RouterDecision {
  /** Extended agent set — adds 'clarification' for the low-confidence path. */
  agent: RouterDecision['agent'] | 'clarification';
  /** Whether the Gemini Flash classifier was consulted (Req 20.7). */
  classifierUsed: boolean;
  /** Classifier confidence in [0, 1]; 1 when rule-only path fires (Req 20.7). */
  confidence: number;
  /** Classifier latency in ms; 0 when rule-only path fires (Req 20.8). */
  classifierLatencyMs: number;
  /** Classifier token cost; 0 when rule-only path fires (Req 20.8). */
  classifierTokens: number;
  /** Whether the decision was served from the classifier cache (Req 20.4). */
  fromCache: boolean;
}

/**
 * Options for `decideHybrid`.
 */
export interface DecideHybridOpts {
  /**
   * When `true`, skip the classifier entirely and return the v1 rule decision
   * regardless of confidence. Used by BudgetGuard (Req 30.4) and circuit
   * breakers (Req 29.3) when the classifier is unavailable or the session has
   * exhausted its token budget.
   */
  ruleOnlyRouting?: boolean;
}

/**
 * Hybrid CEO Router — v1.1 entry point (Req 20.1, Design §v1.1.1).
 *
 * Algorithm:
 *   1. Run v1 `decide(session, message, now)` first (Req 20.1).
 *   2. If the rule fired confidently (reason !== 'unknown_no_state')
 *      OR `session.last_intent` is in HOT_STATES (Req 20.6)
 *      OR `opts.ruleOnlyRouting === true` (Req 29.3, 30.4)
 *      → return the rule decision immediately with `classifierUsed: false`.
 *   3. Otherwise call `lookupOrClassify(message.text, language, traceId, db)`
 *      (cache hit → no Gemini call; miss → Gemini Flash + write-through).
 *   4. If `confidence < 0.6` (Req 20.5) → return `{ agent: 'clarification', ... }`.
 *   5. Else return the classifier decision.
 *
 * The v1 `decide(...)` export is preserved unchanged for backward compatibility.
 *
 * @param session  Session row (same shape as `decide`).
 * @param message  Message inputs (same shape as `decide`).
 * @param opts     Optional routing overrides.
 * @param db       Injectable pg-style DB client for `lookupOrClassify`. When
 *                 omitted (e.g., in tests that only exercise the rule path),
 *                 the classifier path will throw — callers that may reach the
 *                 classifier MUST supply a db client.
 * @param now      Injectable clock for deterministic tests (defaults to `new Date()`).
 */
export async function decideHybrid(
  session: SessionInput,
  message: MessageInput,
  opts: DecideHybridOpts = {},
  db?: DbClient,
  now: Date = new Date(),
): Promise<HybridRouterDecision> {
  // Step 1: run v1 rule-based router.
  const ruleDecision = decide(session, message, now);

  // Step 1a: cancel keyword path (Req 21.6) — if decide() returned 'cancel',
  // the message matched the cancel-keyword pattern. Return immediately with
  // classifierUsed:false and confidence:1 so the caller can pop the flow stack.
  if (ruleDecision.agent === 'cancel') {
    return {
      ...ruleDecision,
      classifierUsed: false,
      confidence: 1,
      classifierLatencyMs: 0,
      classifierTokens: 0,
      fromCache: false,
    };
  }

  // Step 2a: hot-state bypass — classifier must never see these states (Req 20.6).
  const lastIntent = session?.last_intent ?? 'idle';
  if (HOT_STATES.has(lastIntent)) {
    return {
      ...ruleDecision,
      classifierUsed: false,
      confidence: 1,
      classifierLatencyMs: 0,
      classifierTokens: 0,
      fromCache: false,
    };
  }

  // Step 2b: rule fired confidently — any reason other than the default fallback.
  const ruleWasConfident = ruleDecision.reason !== 'unknown_no_state';
  if (ruleWasConfident) {
    return {
      ...ruleDecision,
      classifierUsed: false,
      confidence: 1,
      classifierLatencyMs: 0,
      classifierTokens: 0,
      fromCache: false,
    };
  }

  // Step 2c: caller requested rule-only routing (BudgetGuard / circuit breaker).
  if (opts.ruleOnlyRouting === true) {
    return {
      ...ruleDecision,
      classifierUsed: false,
      confidence: 1,
      classifierLatencyMs: 0,
      classifierTokens: 0,
      fromCache: false,
    };
  }

  // Step 3: no confident rule fired — call the classifier (cache → Gemini Flash).
  if (!db) {
    throw new Error(
      'decideHybrid: db client is required when the classifier path may be reached',
    );
  }

  const language: Lang = (session?.language as Lang) ?? 'en';
  // traceId is not available on SessionInput; callers that need trace correlation
  // should pass it via a wrapper. We use a stable placeholder here so the cache
  // key (which is keyed on the message hash, not the traceId) is unaffected.
  const traceId = 'hybrid-router';

  const classifierResult = await lookupOrClassify(
    message.text,
    language,
    traceId,
    db,
  );

  // Step 4: low-confidence → clarification micro-agent (Req 20.5).
  if (classifierResult.confidence < 0.6) {
    return {
      agent: 'clarification',
      reason: 'low_confidence',
      rulesEvaluated: [...ruleDecision.rulesEvaluated, 'classifier_low_confidence'],
      classifierUsed: true,
      confidence: classifierResult.confidence,
      classifierLatencyMs: 0, // latency not surfaced by lookupOrClassify; callers use agent_invocations
      classifierTokens: 0,
      fromCache: classifierResult.fromCache,
    };
  }

  // Step 5: classifier confident — return its decision.
  const classifierAgent = classifierResult.agent as RouterDecision['agent'];
  return {
    agent: classifierAgent,
    reason: classifierResult.rationale,
    rulesEvaluated: [...ruleDecision.rulesEvaluated, 'classifier'],
    intent_hint: classifierResult.secondary_agent ?? undefined,
    classifierUsed: true,
    confidence: classifierResult.confidence,
    classifierLatencyMs: 0,
    classifierTokens: 0,
    fromCache: classifierResult.fromCache,
  };
}
