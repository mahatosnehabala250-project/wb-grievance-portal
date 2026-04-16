// Validate and list all workflows - v2 with better error handling
const MCP_URL = 'https://api.n8n-mcp.com/';
const MCP_TOKEN = 'nmcp_445a9ce980cb597b622a524b97baed9239167d807296e88b00dbaf749b1a251e';

let rid = 600;
async function callMcp(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: rid++, method, params });
  const res = await fetch(MCP_URL, { method: 'POST', headers: { 'Authorization': `Bearer ${MCP_TOKEN}`, 'Content-Type': 'application/json' }, body });
  const text = await res.text();
  // Try SSE format
  const m = text.match(/data:\s*(\{[\s\S]*\})\s*$/);
  if (m) {
    const parsed = JSON.parse(m[1]);
    return parsed.result || parsed;
  }
  // Try direct JSON
  return JSON.parse(text);
}

async function callTool(name, args) {
  const result = await callMcp('tools/call', { name, arguments: args });
  const content = result.content?.[0]?.text;
  if (content) return JSON.parse(content);
  return result;
}

async function main() {
  const list = await callTool('n8n_list_workflows', {});
  const wfs = list.data?.workflows || [];
  
  console.log('=== ALL N8N WORKFLOWS ===\n');
  for (const wf of wfs) {
    console.log(`${wf.active ? '🟢' : '⚪'} [${wf.id}] ${wf.name} (${wf.nodeCount} nodes)`);
  }
  
  console.log(`\nTotal: ${wfs.length} workflows\n`);
  
  console.log('=== N8N INSTANCE HEALTH ===\n');
  const health = await callTool('n8n_health_check', { mode: 'status' });
  console.log(`Status: ${health.status}`);
  console.log(`Connected: ${health.details?.connected}`);
  console.log(`Instance: ${health.details?.instanceId}`);
}

main().catch(e => console.error('Error:', e.message));
