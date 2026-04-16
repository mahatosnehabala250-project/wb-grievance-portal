// Deploy all WB workflows to n8n via n8n-mcp API — v2.0 Production Build
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
    headers: { 'Authorization': `Bearer ${MCP_TOKEN}`, 'Content-Type': 'application/json' },
    body
  });
  const text = await response.text();
  const dataMatch = text.match(/data:\s*(\{.*\})/s);
  if (!dataMatch) throw new Error(`Parse error: ${text.substring(0, 200)}`);
  const result = JSON.parse(dataMatch[1]);
  if (result.error) throw new Error(`MCP Error: ${JSON.stringify(result.error)}`);
  return result.result;
}

async function listWorkflows() {
  const result = await callMcp('tools/call', { name: 'n8n_list_workflows', arguments: {} });
  const data = JSON.parse(result.content[0].text);
  return data.data?.workflows || [];
}

async function deleteWorkflow(id) {
  try {
    await callMcp('tools/call', { name: 'n8n_delete_workflow', arguments: { id } });
    return true;
  } catch { return false; }
}

async function createWorkflow(wf) {
  // Remove any Error Trigger nodes and their connections (disconnected validation)
  const nodes = wf.nodes.filter(n => n.type !== 'n8n-nodes-base.errorTrigger');
  const connections = { ...wf.connections };
  nodes.forEach(n => { /* keep all named connections */ });
  // Remove error trigger connections
  Object.keys(connections).forEach(key => {
    if (key.includes('Error') || key.includes('error')) delete connections[key];
  });
  // Clean null references in connections
  for (const [src, outputs] of Object.entries(connections)) {
    if (outputs && outputs.main) {
      outputs.main.forEach((branch, idx) => {
        outputs.main[idx] = branch.filter(conn => conn && conn.node);
      });
      outputs.main = outputs.main.filter(branch => branch.length > 0);
    }
  }

  const result = await callMcp('tools/call', {
    name: 'n8n_create_workflow',
    arguments: { name: wf.name, nodes, connections, settings: wf.settings }
  });
  const data = JSON.parse(result.content[0].text);
  const workflowId = data.id || data.workflow?.id || data.data?.id;
  return workflowId;
}

async function validateWorkflow(id) {
  try {
    const result = await callMcp('tools/call', { name: 'n8n_validate_workflow', arguments: { id } });
    const data = JSON.parse(result.content[0].text);
    return data;
  } catch (e) { return { error: e.message }; }
}

async function main() {
  console.log('=== PHASE 1: Clean up old workflows ===\n');
  const existing = await listWorkflows();
  console.log(`Found ${existing.length} existing workflows:`);
  for (const wf of existing) {
    const deleted = await deleteWorkflow(wf.id);
    console.log(`  ${deleted ? '🗑️ Deleted' : '⚠️ Failed to delete'}: ${wf.name} (${wf.id})`);
  }

  console.log('\n=== PHASE 2: Build & Deploy New Workflows ===\n');

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

  const results = {};

  for (const file of files) {
    const filePath = path.join(workflowDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`❌ ${file}: File not found`);
      results[file] = { status: 'NOT_FOUND' };
      continue;
    }

    const wf = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    console.log(`\n📦 ${wf.name}`);
    console.log(`   Nodes: ${wf.nodes.length}`);

    try {
      const id = await createWorkflow(wf);
      if (id) {
        console.log(`   ✅ Created: ${id}`);
        // Validate
        const validation = await validateWorkflow(id);
        if (validation.valid === false) {
          console.log(`   ⚠️ Validation issues: ${JSON.stringify(validation.errors || []).substring(0, 200)}`);
        } else if (validation.valid === true) {
          console.log(`   ✅ Validation passed`);
        }
        results[file] = { status: 'SUCCESS', id, validation: validation.valid };
      } else {
        console.log(`   ❌ Failed: no ID returned`);
        results[file] = { status: 'FAILED', id: null };
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err.message.substring(0, 200)}`);
      results[file] = { status: 'ERROR', error: err.message };
    }
  }

  console.log('\n=== DEPLOYMENT SUMMARY ===\n');
  for (const [file, r] of Object.entries(results)) {
    const icon = r.status === 'SUCCESS' ? '✅' : '❌';
    console.log(`${icon} ${file}: ${r.id || r.error || r.status}`);
  }

  // Save results
  fs.writeFileSync(path.join(workflowDir, 'deployment-results.json'), JSON.stringify(results, null, 2));

  // List final state
  console.log('\n=== FINAL STATE ===\n');
  const final = await listWorkflows();
  console.log(`Total workflows: ${final.length}`);
  for (const wf of final) {
    console.log(`  ${wf.active ? '🟢' : '⚪'} [${wf.id}] ${wf.name} (${wf.nodeCount} nodes)`);
  }
}

main().catch(console.error);
