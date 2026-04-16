import { workflow, node, trigger, newCredential, sticky } from '@n8n/workflow-sdk';

// ===== ERROR TRIGGER =====
const errorTrigger = trigger({
  type: 'n8n-nodes-base.errorTrigger',
  version: 1,
  config: {
    name: 'Error Trigger',
    position: [240, 300]
  },
  output: [{ execution: { id: 'exec-1', url: 'https://n8n.example.com/execution/exec-1' }, workflow: { id: 'wf-1', name: 'WB-01: WhatsApp Intake' } }]
});

sticky({ position: [100, 80], content: 'WB-09: Global Error Handler\nCatches ALL workflow failures → format error → alert admin via WhatsApp Send Node\nUses: WhatsApp Send Node' });

// ===== CODE: FORMAT ERROR =====
const formatError = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Error Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const execution = $input.first().json.execution || {};
const workflow = $input.first().json.workflow || {};
const errorMsg = $input.first().json.error?.message || 'Unknown error';
const msg = \`🚨 WORKFLOW ERROR ALERT

❌ Workflow: \${workflow.name || 'Unknown'}
🆔 Execution ID: \${execution.id || 'N/A'}
📝 Error: \${errorMsg}

⏰ Time: \${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

🔗 View: \${execution.url || 'N/A'}

Please check the n8n dashboard immediately.\`;
return [{ json: { message: msg } }];`
    },
    position: [480, 300]
  },
  output: [{ message: '🚨 WORKFLOW ERROR ALERT\n❌ Workflow: WB-01...' }]
});

// ===== WHATSAPP SEND: ERROR ALERT =====
const sendAlert = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Error Alert to Admin',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '=919999999000',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [720, 300]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== WORKFLOW =====
export default workflow('wb-09-error-handler', 'WB-09: Global Error Handler')
  .add(errorTrigger)
  .to(formatError)
  .to(sendAlert);
