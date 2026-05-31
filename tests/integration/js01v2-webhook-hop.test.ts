// Feature: sahayak-multi-agent-router, Task 7.8
// Integration test — end-to-end JS-01v2 webhook hop (code-level).
//
// Requirements: 12.2, NFR Performance — Design §JS-01v2 Node Map, §Testing Strategy → Integration tests.
//
// What this test protects
// -----------------------
// The design (§JS-01v2 Node Map) specifies the single-workflow multi-agent hop a
// WhatsApp message takes:
//
//   WhatsApp Trigger → Parse Message → Upsert Session → Prepare Context
//                    → CEO Router → Switch → {Complaint|Blood|Donor|Status|Welcome|Fallback}
//                    → Send Reply → Fire Observability → End
//
// A live n8n instance is not available in CI, so this test exercises the HOP at
// the code level in two complementary ways:
//
//   (1) STRUCTURAL — load the committed JS-01v2.json (READ-ONLY) and assert the
//       node graph is wired end-to-end exactly as the design's Node Map requires:
//       the linear pre-router chain, the single Switch branching point with its
//       five configured agent outputs + one default branch, every branch feeding
//       Send Reply, and Send Reply → Fire Observability → End.
//
//   (2) BEHAVIOURAL — drive the real decision logic end-to-end by composing the
//       actual production pieces: replicate the Parse Message lowercasing, run the
//       real `decide(...)` from src/lib/router/ceoRouter.ts, then map its `agent`
//       output through the ACTUAL Switch-node configuration parsed from the
//       workflow JSON to the concrete branch node. For a set of representative
//       inbound messages (blood keyword, donor keyword, complaint, ticket number
//       WB-YYYY-XXXXX, greeting, and a donor_pending_response state-lock) we assert
//       the routing decision (agent + reason), the Switch outputKey, the resolved
//       branch node, and — for the deterministic code-node branches — the produced
//       reply.
//
// NOTE: this test only READS n8n-workflows/JS-01v2.json — it never mutates it,
// ceoRouter.ts, or vitest.config.ts.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  decide,
  type SessionInput,
  type MessageInput,
  type RouterDecision,
} from '../../src/lib/router/ceoRouter';

// ---------------------------------------------------------------------------
// Workflow JSON types (minimal — only what we assert on)
// ---------------------------------------------------------------------------

interface SwitchRule {
  value2: string;
  outputKey: string;
}

interface N8nNode {
  id: string;
  name: string;
  type: string;
  parameters: {
    jsCode?: string;
    rules?: { rules?: SwitchRule[] };
    fallbackOutput?: string;
  } & Record<string, unknown>;
}

interface ConnectionTarget {
  node: string;
  type: string;
  index: number;
}

interface N8nWorkflow {
  nodes: N8nNode[];
  connections: Record<string, { main?: ConnectionTarget[][] }>;
}

// p95 reply-latency budget from design.md §Performance:
//   "WhatsApp message in -> reply out (p95) | < 4 s".
const P95_REPLY_BUDGET_MS = 4000;

let workflow: N8nWorkflow;
let switchNode: N8nNode;

beforeAll(() => {
  const workflowPath = fileURLToPath(
    new URL('../../n8n-workflows/JS-01v2.json', import.meta.url)
  );
  workflow = JSON.parse(readFileSync(workflowPath, 'utf-8')) as N8nWorkflow;
  const sw = workflow.nodes.find((n) => n.name === 'Switch');
  if (!sw) throw new Error('Switch node not found in JS-01v2.json');
  switchNode = sw;
});

// ---------------------------------------------------------------------------
// Helpers — compose the production pieces into a code-level "hop"
// ---------------------------------------------------------------------------

/** Direct outgoing `main` targets of a node, by name. */
function mainTargets(nodeName: string): string[] {
  const conn = workflow.connections[nodeName];
  if (!conn?.main) return [];
  return conn.main.flat().map((c) => c.node);
}

/**
 * Whether `Send Reply` is reachable from `startNode` by following `main`
 * connections. The v1.1 AI-agent branches reach Send Reply indirectly
 * (Gemini Check → IF Gemini Open → {Send Reply | Agent → Send Reply}), so a
 * direct-target check is insufficient. BFS with a visited set guards cycles.
 */
function reachesSendReply(startNode: string): boolean {
  const seen = new Set<string>();
  const queue = [startNode];
  while (queue.length) {
    const node = queue.shift()!;
    if (node === 'Send Reply') return true;
    if (seen.has(node)) continue;
    seen.add(node);
    queue.push(...mainTargets(node));
  }
  return false;
}

/**
 * Replicate the Parse Message Code Node's text handling: the lowercased `text`
 * is used for keyword matching, while `original_text` is case-preserved for the
 * ticket regex. Mirrors n8n-workflows/JS-01v2.json → "Parse Message".
 */
function parseMessage(rawText: string, phone: string) {
  return {
    phone,
    message: {
      text: (rawText || '').toLowerCase(),
      original_text: rawText,
    } as MessageInput,
    trace_id: '11111111-1111-1111-1111-111111111111',
  };
}

/**
 * Resolve the Switch Node exactly as n8n would: match `$json.agent` against each
 * configured rule's `value2`; the matched rule's connection-output index maps to
 * a concrete branch node. An unmatched agent falls through to the default
 * (fallback) output, which is the connection-output appended after all rules.
 */
function switchRoute(agent: string): {
  outputKey: string | null;
  branchNode: string;
  isDefault: boolean;
} {
  const rules = switchNode.parameters.rules?.rules ?? [];
  const switchTargets = workflow.connections['Switch']?.main ?? [];
  const idx = rules.findIndex((r) => r.value2 === agent);

  if (idx === -1) {
    // Default / fallback output is the one after the last configured rule.
    const fallbackBranch = switchTargets[rules.length]?.[0]?.node;
    return { outputKey: null, branchNode: fallbackBranch, isDefault: true };
  }

  const branchNode = switchTargets[idx]?.[0]?.node;
  return { outputKey: rules[idx].outputKey, branchNode, isDefault: false };
}

/** Execute a Code Node body that only depends on `$json` (Welcome/Status/Fallback). */
function runCodeNode(
  nodeName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $json: any
): Array<{ json: { reply?: string } & Record<string, unknown> }> {
  const node = workflow.nodes.find((n) => n.name === nodeName);
  if (!node) throw new Error(`${nodeName} not found`);
  const jsCode = node.parameters.jsCode ?? '';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function('$json', jsCode);
  return fn($json);
}

/**
 * Run the full code-level hop for one inbound message:
 *   Parse Message → (Prepare Context produces `session`) → CEO Router decide()
 *   → Switch → branch node.
 * Returns the routing decision, the Switch routing result, and the composed
 * `$json` that flows into the branch node.
 */
function runHop(
  rawText: string,
  session: SessionInput,
  now: Date,
  phone = '+919876543210'
) {
  const parsed = parseMessage(rawText, phone);
  const decision: RouterDecision = decide(session, parsed.message, now);
  const route = switchRoute(decision.agent);
  // What Prepare Context + CEO Router hand to the Switch branch:
  const $json = {
    ...parsed,
    session,
    prev_last_intent: session.last_intent,
    agent: decision.agent,
    reason: decision.reason,
  };
  return { decision, route, $json };
}

// The five agent values the CEO Router can emit (Design §CEO Router output contract).
const ROUTER_AGENTS = ['complaint', 'blood', 'donor', 'info', 'welcome'] as const;

const FRESH = '2026-02-01T10:00:00.000Z';
const NOW = new Date('2026-02-01T10:00:30.000Z'); // 30 s after activity → fresh

// ===========================================================================
// (1) STRUCTURAL — the JS-01v2 node graph is wired for the full hop
//     (Design §JS-01v2 Node Map)
// ===========================================================================
describe('JS-01v2 graph — the webhook hop is wired end-to-end', () => {
  it('pre-router chain is linear: WhatsApp Trigger → Parse Message → Upsert Session → Prepare Context → CEO Router → Switch', () => {
    expect(mainTargets('WhatsApp Trigger')).toEqual(['Parse Message']);
    expect(mainTargets('Parse Message')).toEqual(['Upsert Session']);
    expect(mainTargets('Upsert Session')).toEqual(['Prepare Context']);
    expect(mainTargets('Prepare Context')).toEqual(['CEO Router']);
    expect(mainTargets('CEO Router')).toEqual(['Switch']);
  });

  it('Switch is the single branching point with the configured agent outputs + one default branch', () => {
    expect(switchNode.type).toBe('n8n-nodes-base.switch');
    const rules = switchNode.parameters.rules?.rules ?? [];
    // The five CEO Router agents plus the v1.1 clarification branch (Design §v1.1.1)
    // are configured as Switch rules, in order.
    const EXPECTED_RULES = [...ROUTER_AGENTS, 'clarification'];
    expect(rules.map((r) => r.value2)).toEqual(EXPECTED_RULES);
    expect(rules.map((r) => r.outputKey)).toEqual(EXPECTED_RULES);
    // A default (fallback) output exists for any unmatched agent (Reliability NFR).
    expect(switchNode.parameters.fallbackOutput).toBeTruthy();
    // N configured branches + 1 default branch are all connected.
    const switchTargets = workflow.connections['Switch']?.main ?? [];
    expect(switchTargets.length).toBe(rules.length + 1);
  });

  it('each Switch branch routes to its expected node and every branch feeds Send Reply', () => {
    // v1.1 node map (Design §v1.1.1): the three AI-agent branches route through a
    // "Gemini Check - X" circuit-breaker pre-check Code Node first; the info/welcome/
    // clarification branches go straight to their deterministic Code Nodes.
    const expectedBranches: Record<string, string> = {
      complaint: 'Gemini Check - Complaint',
      blood: 'Gemini Check - Blood',
      donor: 'Gemini Check - Donor',
      info: 'Status Code',
      welcome: 'Welcome Code',
      clarification: 'Clarification',
    };
    for (const agent of Object.keys(expectedBranches)) {
      const { branchNode, isDefault } = switchRoute(agent);
      expect(isDefault, `${agent} must be a configured (non-default) branch`).toBe(false);
      expect(branchNode).toBe(expectedBranches[agent]);
      // Each branch eventually feeds the single Send Reply node (reply path closes).
      expect(reachesSendReply(branchNode), `${branchNode} → … → Send Reply`).toBe(true);
    }
    // The default branch is the Fallback Code node, which also feeds Send Reply.
    const fallback = switchRoute('__unconfigured__');
    expect(fallback.isDefault).toBe(true);
    expect(fallback.branchNode).toBe('Fallback Code');
    expect(mainTargets('Fallback Code')).toContain('Send Reply');
  });

  it('tail of the hop: Send Reply → Fire Observability → End', () => {
    expect(mainTargets('Send Reply')).toContain('Fire Observability');
    expect(mainTargets('Fire Observability')).toEqual(['End']);
  });
});

// ===========================================================================
// (2) BEHAVIOURAL — drive real decide() through the real Switch config for
//     representative inbound messages (Design §CEO Router, §Node Map)
// ===========================================================================
describe('JS-01v2 hop — representative inbound messages route to the expected branch', () => {
  interface Case {
    title: string;
    rawText: string;
    session: SessionInput;
    expectedAgent: RouterDecision['agent'];
    expectedReason: string;
    expectedOutputKey: string;
    expectedBranch: string;
    /** Code-node branches produce a deterministic reply we can assert on. */
    expectsCodeReply: boolean;
  }

  const idle = (overrides: Partial<SessionInput> = {}): SessionInput => ({
    last_intent: 'idle',
    last_activity_at: FRESH,
    language: 'en',
    ...overrides,
  });

  const cases: Case[] = [
    {
      title: 'blood keyword (idle) → Blood branch',
      rawText: 'Blood chahiye urgent',
      session: idle(),
      expectedAgent: 'blood',
      expectedReason: 'idle_keyword:blood',
      expectedOutputKey: 'blood',
      expectedBranch: 'Gemini Check - Blood',
      expectsCodeReply: false,
    },
    {
      title: 'donor keyword (idle) → Donor branch',
      rawText: 'I want to become a donor',
      session: idle(),
      expectedAgent: 'donor',
      expectedReason: 'idle_keyword:donor',
      expectedOutputKey: 'donor',
      expectedBranch: 'Gemini Check - Donor',
      expectsCodeReply: false,
    },
    {
      title: 'complaint keyword (idle) → Complaint branch',
      rawText: 'There is no water in my area',
      session: idle(),
      expectedAgent: 'complaint',
      expectedReason: 'idle_keyword:complaint',
      expectedOutputKey: 'complaint',
      expectedBranch: 'Gemini Check - Complaint',
      expectsCodeReply: false,
    },
    {
      title: 'ticket number WB-YYYY-XXXXX → Status/Info Code',
      rawText: 'Status of WB-2026-00042 please',
      session: idle(),
      expectedAgent: 'info',
      expectedReason: 'ticket_pattern_detected',
      expectedOutputKey: 'info',
      expectedBranch: 'Status Code',
      expectsCodeReply: true,
    },
    {
      title: 'greeting (idle) → Welcome Code',
      rawText: 'Hi',
      session: idle(),
      expectedAgent: 'welcome',
      expectedReason: 'greeting_on_idle',
      expectedOutputKey: 'welcome',
      expectedBranch: 'Welcome Code',
      expectsCodeReply: true,
    },
    {
      title: 'donor_pending_response state-lock → Blood branch (regardless of message)',
      rawText: 'Yess',
      session: idle({ last_intent: 'donor_pending_response' }),
      expectedAgent: 'blood',
      expectedReason: 'state:donor_pending_response',
      expectedOutputKey: 'blood',
      expectedBranch: 'Gemini Check - Blood',
      expectsCodeReply: false,
    },
  ];

  for (const c of cases) {
    it(c.title, () => {
      const { decision, route, $json } = runHop(c.rawText, c.session, NOW);

      // CEO Router decision (agent + reason).
      expect(decision.agent).toBe(c.expectedAgent);
      expect(decision.reason).toBe(c.expectedReason);

      // Switch routing: outputKey + resolved branch node match the agent.
      expect(route.isDefault).toBe(false);
      expect(route.outputKey).toBe(c.expectedOutputKey);
      expect(route.branchNode).toBe(c.expectedBranch);

      // The resolved branch reaches the single Send Reply node (reply path closes).
      expect(reachesSendReply(route.branchNode)).toBe(true);

      // For deterministic Code-node branches, execute the body and assert a
      // non-empty citizen reply is produced (the AI-agent branches need Gemini
      // at runtime, so we only assert their wiring above).
      if (c.expectsCodeReply) {
        const out = runCodeNode(route.branchNode, $json);
        expect(Array.isArray(out)).toBe(true);
        expect(typeof out[0].json.reply).toBe('string');
        expect((out[0].json.reply ?? '').length).toBeGreaterThan(0);
      }
    });
  }

  it('every representative decision lands on a configured (non-default) Switch branch', () => {
    for (const c of cases) {
      const { route } = runHop(c.rawText, c.session, NOW);
      expect(route.isDefault, `${c.title} should not hit the default fallback`).toBe(false);
    }
  });

  it('CEO Router only emits agents the Switch is configured to handle (contract holds)', () => {
    // The Switch default branch is defensive; it should never fire for the
    // agents decide() can produce. Confirm the agent set is exactly covered.
    const configured = new Set(
      (switchNode.parameters.rules?.rules ?? []).map((r) => r.value2)
    );
    for (const agent of ROUTER_AGENTS) {
      expect(configured.has(agent)).toBe(true);
    }
  });

  it('the full hop resolves well under the p95 reply budget (pure routing, no I/O)', () => {
    const start = performance.now();
    for (const c of cases) runHop(c.rawText, c.session, NOW);
    const elapsed = performance.now() - start;
    // Routing is pure JS; the whole representative set must be far under p95.
    expect(elapsed).toBeLessThan(P95_REPLY_BUDGET_MS);
  });
});
