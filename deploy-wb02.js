// Quick deploy WB-02 only
const MCP_URL = 'https://api.n8n-mcp.com/';
const MCP_TOKEN = 'nmcp_445a9ce980cb597b622a524b97baed9239167d807296e88b00dbaf749b1a251e';
const fs = require('fs');

let rid = 500;
async function callMcp(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: rid++, method, params });
  const res = await fetch(MCP_URL, { method: 'POST', headers: { 'Authorization': `Bearer ${MCP_TOKEN}`, 'Content-Type': 'application/json' }, body });
  const text = await res.text();
  const m = text.match(/data:\s*(\{.*\})/s);
  if (!m) throw new Error(`Parse error: ${text.substring(0,300)}`);
  const r = JSON.parse(m[1]);
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.result;
}

async function main() {
  const wf = JSON.parse(fs.readFileSync('n8n-workflows/wb-02-auto-assign.json', 'utf-8'));
  // Remove error trigger
  const nodes = wf.nodes.filter(n => n.type !== 'n8n-nodes-base.errorTrigger');
  const connections = { ...wf.connections };
  delete connections['Error Trigger'];
  
  console.log('Deploying WB-02...');
  const result = await callMcp('tools/call', {
    name: 'n8n_create_workflow',
    arguments: { name: wf.name, nodes, connections, settings: wf.settings }
  });
  const data = JSON.parse(result.content[0].text);
  console.log('Result:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
