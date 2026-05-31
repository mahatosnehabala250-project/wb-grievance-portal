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
  const codeNodesDir = path.join(workflowDir, 'code-nodes');
  const files = [
    'wb-01-whatsapp-intake.json',
    'wb-02-auto-assign.json',
    'wb-03-notifications.json',
    'wb-05-status-check.json',
    'wb-06-rating.json',
    'wb-07-sla-escalation.json',
    'wb-08-daily-report.json',
    'JS-01v2.json'
  ];

  // ─── Code Node Injection Map ─────────────────────────────────────────────
  // Maps node names in JS-01v2.json to their external code-node source files.
  // At deploy time, the placeholder jsCode in these nodes is replaced with the
  // actual file contents from n8n-workflows/code-nodes/.
  const CODE_NODE_INJECTIONS = {
    'Parse Message': 'parse-message.js',
    'Prepare Context': 'prepare-context.js',
    'CEO Router': 'ceo-router.js',
    'Status Code': 'status-info.js',
    // Task 18.4 — Clarification Micro-Agent (Switch agent='clarification' branch)
    'Clarification': 'clarification-agent.js',
    // Task 23.3 — Output Guardrail between each specialist agent and Send Reply
    'Guardrail - Complaint': 'guardrail.js',
    'Guardrail - Blood': 'guardrail.js',
    'Guardrail - Donor': 'guardrail.js',
    // Task 27.4 — Gemini-substitute Code Nodes (circuit breaker pre-check)
    'Gemini Check - Complaint': 'gemini-substitute.js',
    'Gemini Check - Blood': 'gemini-substitute.js',
    'Gemini Check - Donor': 'gemini-substitute.js'
  };

  const results = {};

  for (const file of files) {
    const filePath = path.join(workflowDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`❌ ${file}: File not found`);
      results[file] = { status: 'NOT_FOUND' };
      continue;
    }

    const wf = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // ─── Inject external code-node bodies for JS-01v2 ────────────────────
    if (file === 'JS-01v2.json') {
      for (const [nodeName, codeFile] of Object.entries(CODE_NODE_INJECTIONS)) {
        const codeFilePath = path.join(codeNodesDir, codeFile);
        if (fs.existsSync(codeFilePath)) {
          const codeBody = fs.readFileSync(codeFilePath, 'utf-8');
          const node = wf.nodes.find(n => n.name === nodeName);
          if (node && node.parameters) {
            node.parameters.jsCode = codeBody;
            console.log(`   💉 Injected ${codeFile} → "${nodeName}" node`);
          } else {
            console.log(`   ⚠️ Node "${nodeName}" not found in workflow — skipping injection`);
          }
        } else {
          console.log(`   ⚠️ Code file not found: ${codeFilePath} — skipping injection for "${nodeName}"`);
        }
      }

      // ─── Prompt Injection: AI Agent system messages ──────────────────────
      // Maps AI Agent node names to their prompt source files under
      // n8n-workflows/prompts/. At deploy time, the placeholder systemMessage
      // in each agent node is replaced with the actual prompt file contents.
      //
      // NOTE (task 28.4): the compact variants (<agent>.compact.md) are NOT
      // injected here. They are registered into `agent_prompt_versions` by
      // `npm run register:prompts` and selected at runtime by the v1.1.14
      // prompt loader when the v1.1.11 BudgetGuard sets compact_mode (Req 30.5).
      // The full <agent>.md injected below is the default systemMessage used
      // when a session is not in compact mode.
      const PROMPT_INJECTIONS = {
        'Complaint Agent': 'complaint.md',
        'Blood Agent': 'blood.md',
        'Donor Agent': 'donor.md',
      };

      const promptsDir = path.join(workflowDir, 'prompts');

      for (const [nodeName, promptFile] of Object.entries(PROMPT_INJECTIONS)) {
        const promptFilePath = path.join(promptsDir, promptFile);
        if (fs.existsSync(promptFilePath)) {
          const promptContent = fs.readFileSync(promptFilePath, 'utf-8');
          const node = wf.nodes.find(n => n.name === nodeName);
          if (node && node.parameters && node.parameters.options) {
            node.parameters.options.systemMessage = promptContent;
            console.log(`   💉 Injected prompt ${promptFile} → "${nodeName}" systemMessage`);
          } else {
            console.log(`   ⚠️ Node "${nodeName}" not found or missing options — skipping prompt injection`);
          }
        } else {
          console.log(`   ⚠️ Prompt file not found: ${promptFilePath} — skipping injection for "${nodeName}"`);
        }
      }

      // ─── Info Prompt Injection: Status Code node ─────────────────────────
      // Injects the info.md content into the Status Code node's jsCode as a
      // template literal variable so the code node can reference scheme info
      // without a separate file read at runtime.
      const infoPromptPath = path.join(promptsDir, 'info.md');
      if (fs.existsSync(infoPromptPath)) {
        const infoContent = fs.readFileSync(infoPromptPath, 'utf-8');
        const statusNode = wf.nodes.find(n => n.name === 'Status Code');
        if (statusNode && statusNode.parameters) {
          // Prepend the info content as an escaped template literal variable
          const escapedInfo = infoContent.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
          const infoVariable = `const INFO_PROMPT = \`${escapedInfo}\`;\n\n`;
          statusNode.parameters.jsCode = infoVariable + statusNode.parameters.jsCode;
          console.log(`   💉 Injected info.md → "Status Code" node as INFO_PROMPT variable`);
        } else {
          console.log(`   ⚠️ Node "Status Code" not found — skipping info.md injection`);
        }
      } else {
        console.log(`   ⚠️ Prompt file not found: ${infoPromptPath} — skipping info.md injection`);
      }

      // ─── Scheme Summaries Injection: Status Code node ────────────────────
      // Injects the scheme_summaries.md content into the Status Code node's
      // jsCode as a SCHEME_SUMMARIES template literal variable for Phase 1
      // inlined Gemini prompts (INFO_USE_EMBEDDINGS=false).
      const schemeSummariesPath = path.join(promptsDir, 'scheme_summaries.md');
      if (fs.existsSync(schemeSummariesPath)) {
        const schemeContent = fs.readFileSync(schemeSummariesPath, 'utf-8');
        const statusNodeForSchemes = wf.nodes.find(n => n.name === 'Status Code');
        if (statusNodeForSchemes && statusNodeForSchemes.parameters) {
          const escapedSchemes = schemeContent.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
          const schemeVariable = `const SCHEME_SUMMARIES = \`${escapedSchemes}\`;\n\n`;
          statusNodeForSchemes.parameters.jsCode = schemeVariable + statusNodeForSchemes.parameters.jsCode;
          console.log(`   💉 Injected scheme_summaries.md → "Status Code" node as SCHEME_SUMMARIES variable`);
        } else {
          console.log(`   ⚠️ Node "Status Code" not found — skipping scheme_summaries.md injection`);
        }
      } else {
        console.log(`   ⚠️ Prompt file not found: ${schemeSummariesPath} — skipping scheme_summaries.md injection`);
      }
    }

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
