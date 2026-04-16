import { workflow, node, trigger, newCredential, expr, sticky } from '@n8n/workflow-sdk';

const errorTrigger = trigger({
  type: 'n8n-nodes-base.errorTrigger',
  version: 1,
  config: {
    name: 'On Workflow Error',
    position: [240, 300]
  },
  output: [{
    workflow: { id: 'abc', name: 'WB-01 Test' },
    execution: { id: '1', error: { message: 'Connection refused', node: { name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest' } } }
  }]
});

sticky({ position: [100, 100], content: 'WB-09: Catches ALL workflow failures → logs to DB → alerts admin via WhatsApp' });

const formatError = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Error Context',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const d = $input.first().json;
const wf = d.workflow?.name || 'Unknown';
const nd = d.execution?.error?.node?.name || 'Unknown';
const msg = d.execution?.error?.message || 'No message';
const eid = d.execution?.id || '';
const ts = new Date().toISOString();
return [{ json: { workflowName: wf, nodeName: nd, errorMessage: msg, executionId: eid, timestamp: ts, logAction: 'WORKFLOW_ERROR', logDescription: \`[ERROR] \${wf} > \${nd}: \${msg}\` } }];`
    },
    position: [480, 300]
  },
  output: [{ workflowName: 'WB-01', nodeName: 'HTTP Request', errorMessage: 'ECONNREFUSED', executionId: '1', timestamp: '2025-06-15T10:00:00Z', logAction: 'WORKFLOW_ERROR', logDescription: '[ERROR] WB-01 > HTTP Request: ECONNREFUSED' }]
});

const logToDb = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Log to Activity DB',
    parameters: {
      method: 'POST',
      url: 'https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/activity_logs',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'apikey', value: '{{ $env.SUPABASE_SERVICE_ROLE_KEY }}' },
          { name: 'Authorization', value: 'Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}' },
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Prefer', value: 'return=representation' }
        ]
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ action: $json.logAction, description: $json.logDescription, metadata: JSON.stringify({ executionId: $json.executionId, nodeName: $json.nodeName }) }) }}'
    },
    position: [720, 300]
  },
  output: [{ id: 'log-1' }]
});

const getAdmins = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Get Admin Users',
    parameters: {
      method: 'GET',
      url: 'https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/users?role=eq.ADMIN&isActive=eq.true&select=id,name,whatsappPhone',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'apikey', value: '{{ $env.SUPABASE_SERVICE_ROLE_KEY }}' },
          { name: 'Authorization', value: 'Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}' }
        ]
      }
    },
    position: [720, 480]
  },
  output: [{ id: 'admin-1', name: 'Admin User', whatsappPhone: '+919999999999' }]
});

const sendAlert = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Alert Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const err = $('Format Error Context').first().json;
const msg = \`🚨 WORKFLOW ERROR\\n\\nWorkflow: \${err.workflowName}\\nNode: \${err.nodeName}\\nError: \${err.errorMessage}\\nTime: \${err.timestamp}\\nExecution ID: \${err.executionId}\`;
return [{ json: { message: msg } }];`
    },
    position: [960, 480]
  },
  output: [{ message: '🚨 WORKFLOW ERROR\n\nWorkflow: WB-01\nNode: HTTP Request\nError: ECONNREFUSED' }]
});

export default workflow('wb-09-error-handler', 'WB-09: Global Error Handler')
  .add(errorTrigger)
  .to(formatError)
  .to(logToDb)
  .to(getAdmins)
  .to(sendAlert);
