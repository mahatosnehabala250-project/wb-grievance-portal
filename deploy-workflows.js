// Deploy all WB workflows to n8n via n8n-mcp API
const fs = require('fs');
const path = require('path');

const MCP_URL = 'https://api.n8n-mcp.com/';
const MCP_TOKEN = 'nmcp_445a9ce980cb597b622a524b97baed9239167d807296e88b00dbaf749b1a251e';

let requestId = 100;

async function callMcp(method, params) {
  const id = requestId++;
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MCP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body
  });
  
  const text = await response.text();
  const dataMatch = text.match(/data:\s*(\{.*\})/s);
  if (!dataMatch) throw new Error(`Failed to parse: ${text.substring(0, 200)}`);
  const result = JSON.parse(dataMatch[1]);
  if (result.error) throw new Error(`MCP Error: ${JSON.stringify(result.error)}`);
  return result.result;
}

async function createWorkflow(filePath) {
  let wf = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  
  // Remove disconnected Error Trigger nodes (n8n-mcp validator requires all nodes connected)
  const errorTriggerNames = wf.nodes
    .filter(n => n.type === 'n8n-nodes-base.errorTrigger')
    .map(n => n.name);
  
  wf.nodes = wf.nodes.filter(n => n.type !== 'n8n-nodes-base.errorTrigger');
  errorTriggerNames.forEach(name => delete wf.connections[name]);
  
  console.log(`\n📦 Creating: ${wf.name}`);
  console.log(`   Nodes: ${wf.nodes.length}`);
  
  const result = await callMcp('tools/call', {
    name: 'n8n_create_workflow',
    arguments: {
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings
    }
  });
  
  const data = JSON.parse(result.content[0].text);
  
  if (data.id || data.workflow?.id) {
    const wid = data.id || data.workflow?.id;
    console.log(`   ✅ Created! ID: ${wid}`);
    return wid;
  } else if (data.error) {
    console.log(`   ⚠️ Validation: ${data.error}`);
    // Try autofix
    if (data.workflow?.id) {
      console.log(`   🔧 Attempting autofix...`);
      try {
        const fixResult = await callMcp('tools/call', {
          name: 'n8n_autofix_workflow',
          arguments: { id: data.workflow.id, applyFixes: true }
        });
        const fixData = JSON.parse(fixResult.content[0].text);
        console.log(`   🔧 Autofix: ${JSON.stringify(fixData).substring(0, 200)}`);
        return data.workflow.id;
      } catch(e) { console.log(`   ❌ Autofix failed: ${e.message}`); }
    }
    return null;
  } else {
    console.log(`   ⚠️ Response: ${JSON.stringify(data).substring(0, 300)}`);
    return null;
  }
}

async function main() {
  const workflowDir = path.join(__dirname, 'n8n-workflows');
  const files = [
    'wb-01-whatsapp-intake.json',
    'wb-02-auto-assign.json', 
    'wb-03-notifications.json',
    'wb-05-status-check.json',
    'wb-06-rating.json',
    'wb-07-sla-escalation.json',
    'wb-08-daily-report.json'
  ];
  
  console.log('🚀 Deploying WB Grievance Portal Workflows...');
  console.log('================================================');
  
  const results = {};
  for (const file of files) {
    const filePath = path.join(workflowDir, file);
    if (fs.existsSync(filePath)) {
      try { results[file] = await createWorkflow(filePath); }
      catch (err) { console.log(`   ❌ Error: ${err.message}`); results[file] = 'ERROR'; }
    } else { results[file] = 'NOT_FOUND'; }
  }
  
  console.log('\n================================================');
  console.log('\n📋 Deployment Summary:');
  for (const [file, id] of Object.entries(results)) {
    const icon = !id || id === 'ERROR' ? '❌' : '✅';
    console.log(`   ${icon} ${file} → ${id || 'FAILED'}`);
  }
  
  // Save results
  fs.writeFileSync(path.join(__dirname, 'n8n-workflows', 'deployment-results.json'), JSON.stringify(results, null, 2));
}

main().catch(console.error);
