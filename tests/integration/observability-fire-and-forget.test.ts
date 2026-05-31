// Feature: sahayak-multi-agent-router, Task 7.11
// Integration test — observability failure does not block the citizen reply.
//
// Requirements: 18.14, 18.16 — Design §Observability — Fire-and-Forget Pattern.
//
// What this test protects
// -----------------------
// The main JS-01v2 reply path must produce / send the citizen-facing WhatsApp
// reply WITHOUT waiting on, and WITHOUT being broken by, the observability
// writes to `routing_decisions` / `agent_invocations`. Per design, observability
// is issued from the "Fire Observability" Code Node that runs *after* the
// `Send Reply` node (graph: <agent|code> → Send Reply → Fire Observability → End)
// and calls the JS-01v2-Observability sub-workflow fire-and-forget.
//
// Because the fire-and-forget behaviour lives inside an n8n Code Node body (not a
// TS route/helper), this test exercises the closest code-level seam: it loads the
// committed workflow JSON (read-only), asserts the structural invariant that
// observability is strictly downstream of the reply send, and then executes the
// EXACT "Fire Observability" node body in a sandbox with a mocked observability
// call that (a) rejects asynchronously, (b) throws synchronously, and (c) never
// resolves. In every case the node must return the citizen reply unchanged and
// must not propagate an error — i.e. an observability failure cannot block or
// delay the reply path.
//
// NOTE: this test only READS n8n-workflows/JS-01v2.json — it never mutates it,
// JS-01v2-Observability.json, or vitest.config.ts.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// p95 reply-latency budget from design.md §Performance:
//   "WhatsApp message in -> reply out (p95) | < 4 s".
// The reply path (and therefore the Fire Observability node) must never approach
// this budget on account of observability — even when observability is failing.
// We assert the node body returns far under this, using a conservative slice of
// the budget to stay non-flaky on slow CI.
const P95_REPLY_BUDGET_MS = 4000;
const NONBLOCKING_THRESHOLD_MS = 1000;

interface N8nNode {
  id: string;
  name: string;
  type: string;
  parameters: { jsCode?: string } & Record<string, unknown>;
  continueOnFail?: boolean;
}

interface N8nWorkflow {
  nodes: N8nNode[];
  connections: Record<string, { main: Array<Array<{ node: string }>> }>;
}

let workflow: N8nWorkflow;
let fireObservabilityNode: N8nNode;

beforeAll(() => {
  const workflowPath = fileURLToPath(
    new URL('../../n8n-workflows/JS-01v2.json', import.meta.url)
  );
  workflow = JSON.parse(readFileSync(workflowPath, 'utf-8')) as N8nWorkflow;
  const node = workflow.nodes.find((n) => n.name === 'Fire Observability');
  if (!node) throw new Error('Fire Observability node not found in JS-01v2.json');
  fireObservabilityNode = node;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Names of every node that produces a citizen reply before Send Reply. */
const REPLY_PRODUCING_NODES = [
  'Complaint Agent',
  'Blood Agent',
  'Donor Agent',
  'Status Code',
  'Welcome Code',
  'Fallback Code',
];

/**
 * Whether `Send Reply` is reachable from `startNode` by following `main`
 * connections. v1.1 inserts an Output Guardrail node between each AI agent and
 * Send Reply (Agent → Guardrail → Send Reply, task 23.3), so a direct-target
 * check is insufficient. BFS with a visited set guards against cycles.
 */
function reachesSendReply(startNode: string): boolean {
  const seen = new Set<string>();
  const queue = [startNode];
  while (queue.length) {
    const node = queue.shift()!;
    if (node === 'Send Reply') return true;
    if (seen.has(node)) continue;
    seen.add(node);
    const conn = workflow.connections[node];
    if (conn?.main) queue.push(...conn.main.flat().map((c) => c.node));
  }
  return false;
}

/** A representative inbound-message execution context reaching Fire Observability. */
function makeContext(reply: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const $json: Record<string, any> = {
    phone: '+919876543210',
    message: { text: 'blood chahiye', original_text: 'blood chahiye' },
    trace_id: '11111111-1111-1111-1111-111111111111',
    agent: 'blood',
    reason: 'idle_keyword:blood',
    prev_last_intent: 'idle',
    session: { last_intent: 'idle' },
    reply,
  };
  const $env = {
    N8N_BASE_URL: 'https://n8n.example.test',
    API_BASE_URL: 'https://wb-grievance-portal.vercel.app',
    N8N_WEBHOOK_SECRET: 'test-secret',
  };
  return { $json, $env };
}

/**
 * Execute the EXACT "Fire Observability" node body in a sandbox.
 * The body is synchronous (it fires the observability HTTP call without
 * awaiting it), so this returns the node's output array directly. `$http` is
 * the injected, test-controlled observability transport.
 */
function runFireObservability(
  jsCode: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: { $json: any; $env: any; $http: any }
) {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function('$json', '$env', '$http', jsCode);
  return fn(ctx.$json, ctx.$env, ctx.$http);
}

// ===========================================================================
// Structural invariant — observability is strictly downstream of the reply send
// (Req 18.14, 18.16): the citizen reply is produced/sent BEFORE observability.
// ===========================================================================
describe('JS-01v2 graph — observability runs after the reply is sent', () => {
  it('every reply-producing branch connects to Send Reply (reply produced first)', () => {
    for (const nodeName of REPLY_PRODUCING_NODES) {
      const conn = workflow.connections[nodeName];
      expect(conn, `${nodeName} should have a connection`).toBeTruthy();
      // AI-agent branches reach Send Reply via the Output Guardrail node (v1.1);
      // code-node branches connect directly. Both are valid "reply produced first".
      expect(reachesSendReply(nodeName), `${nodeName} should reach Send Reply`).toBe(true);
    }
  });

  it('Send Reply feeds Fire Observability (observability is strictly downstream of the WA send)', () => {
    const targets = workflow.connections['Send Reply'].main.flat().map((c) => c.node);
    expect(targets).toContain('Fire Observability');
  });

  it('Fire Observability is a terminal-ish leaf feeding only End — it cannot loop back into the reply path', () => {
    const targets = workflow.connections['Fire Observability'].main.flat().map((c) => c.node);
    expect(targets).toEqual(['End']);
    // Crucially: Fire Observability must NOT connect to Send Reply (would create a
    // dependency of the reply on observability).
    expect(targets).not.toContain('Send Reply');
  });

  it('Fire Observability node has continueOnFail=true so a node-level error never aborts the execution', () => {
    expect(fireObservabilityNode.continueOnFail).toBe(true);
  });

  it('Fire Observability fires asynchronously and does not await the observability call', () => {
    const code = fireObservabilityNode.parameters.jsCode ?? '';
    // The body must NOT `await` the observability request (awaiting would block
    // the node on the sub-workflow), and must swallow errors via .catch + try.
    expect(code).not.toMatch(/await\s+\$http\.request/);
    expect(code).toMatch(/\.catch\(/);
    expect(code).toMatch(/try\s*\{/);
  });
});

// ===========================================================================
// Behavioural seam — the real node body swallows observability failures and
// returns the citizen reply unchanged (Req 18.14, 18.16).
// ===========================================================================
describe('Fire Observability node body — failure does not block the citizen reply', () => {
  it('observability call rejecting asynchronously does NOT throw and preserves the reply', () => {
    const code = fireObservabilityNode.parameters.jsCode as string;
    const ctx = makeContext('🩸 Aapka blood request register ho gaya hai.');

    let attempted = false;
    const $http = {
      request: () => {
        attempted = true;
        // Simulate the observability sub-workflow / DB insert rejecting.
        return Promise.reject(new Error('observability sub-workflow threw (simulated)'));
      },
    };

    let out: unknown;
    expect(() => {
      out = runFireObservability(code, { ...ctx, $http });
    }).not.toThrow();

    // The observability call was actually attempted (we are testing the real
    // fire path, not a no-op short-circuit).
    expect(attempted).toBe(true);

    // The node returns the original execution item with the citizen reply intact.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = out as Array<{ json: any }>;
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].json.reply).toBe('🩸 Aapka blood request register ho gaya hai.');
    expect(result[0].json.phone).toBe('+919876543210');
  });

  it('observability transport throwing SYNCHRONOUSLY does NOT propagate and preserves the reply', () => {
    const code = fireObservabilityNode.parameters.jsCode as string;
    const ctx = makeContext('Your complaint WB-2026-00042 has been filed.');

    const $http = {
      request: () => {
        throw new Error('synchronous observability failure (simulated)');
      },
    };

    let out: unknown;
    expect(() => {
      out = runFireObservability(code, { ...ctx, $http });
    }).not.toThrow();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = out as Array<{ json: any }>;
    expect(result[0].json.reply).toBe('Your complaint WB-2026-00042 has been filed.');
  });

  it('observability call that NEVER resolves does NOT block the reply path (returns synchronously, well under p95)', () => {
    const code = fireObservabilityNode.parameters.jsCode as string;
    const ctx = makeContext('Welcome message');

    const $http = {
      // A promise that never settles — if the node awaited it, the reply path
      // would hang. The node must return immediately regardless.
      request: () => new Promise(() => {}),
    };

    const start = performance.now();
    const out = runFireObservability(code, { ...ctx, $http });
    const elapsed = performance.now() - start;

    // Returned synchronously without awaiting the pending observability promise.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = out as Array<{ json: any }>;
    expect(result[0].json.reply).toBe('Welcome message');

    // Sanity: nowhere near the p95 reply budget — observability cannot extend latency.
    expect(elapsed).toBeLessThan(NONBLOCKING_THRESHOLD_MS);
    expect(elapsed).toBeLessThan(P95_REPLY_BUDGET_MS);
  });

  it('observability returning a non-promise (degenerate transport) still does NOT break the reply path', () => {
    const code = fireObservabilityNode.parameters.jsCode as string;
    const ctx = makeContext('Status: IN_PROGRESS');

    // Some transports could return undefined; the body wraps the .catch() call
    // in try/catch so even a TypeError on `.catch` is swallowed.
    const $http = { request: () => undefined };

    let out: unknown;
    expect(() => {
      out = runFireObservability(code, { ...ctx, $http });
    }).not.toThrow();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = out as Array<{ json: any }>;
    expect(result[0].json.reply).toBe('Status: IN_PROGRESS');
  });
});
