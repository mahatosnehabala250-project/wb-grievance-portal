/**
 * n8n Agent Node IDs — maps each specialist agent to its workflow and node ID
 * so the admin UI can deep-link directly to the n8n editor for prompt editing.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md §Frontend `/dashboard/agents`
 * @see Requirements 15.2
 */

export interface N8nNodeLink {
  workflowId: string;
  nodeId: string;
}

export const N8N_AGENT_NODE_IDS: Record<string, N8nNodeLink> = {
  complaint: { workflowId: 'JS-01v2', nodeId: 'complaint-agent' },
  blood: { workflowId: 'JS-01v2', nodeId: 'blood-agent' },
  donor: { workflowId: 'JS-01v2', nodeId: 'donor-agent' },
  info: { workflowId: 'JS-01v2', nodeId: 'info-code' },
};

/**
 * Build the full n8n editor URL for a given agent.
 * Uses NEXT_PUBLIC_N8N_HOST env var (e.g., "https://n8n.example.com").
 */
export function getN8nEditorUrl(agentId: string): string | null {
  const link = N8N_AGENT_NODE_IDS[agentId];
  if (!link) return null;

  const host = process.env.NEXT_PUBLIC_N8N_HOST || '';
  if (!host) return null;

  return `${host.replace(/\/$/, '')}/workflow/${link.workflowId}?nodeId=${link.nodeId}`;
}
