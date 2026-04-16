import { workflow, node, trigger, newCredential, sticky, ifElse } from '@n8n/workflow-sdk';

// ===== SCHEDULE TRIGGER =====
const schedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Every 2 Hours',
    parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 2 }] } },
    position: [240, 300]
  },
  output: [{}]
});

sticky({ position: [100, 80], content: 'WB-07: SLA Breach Escalation (every 2 hours)\nQuery breached complaints → escalate urgency → log activity → alert admin\nUses: Supabase Node + WhatsApp Send Node' });

// ===== SUPABASE: GET BREACHED COMPLAINTS =====
const getBreached = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Get SLA Breached Complaints',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'sla_at_risk',
      returnAll: true,
      filterType: 'none'
    },
    position: [480, 300]
  },
  output: [{ id: 'c1', ticketNo: 'WB-01001', phone: '919876543210', issue: 'No water', status: 'OPEN', urgency: 'MEDIUM', category: 'Water Supply', block: 'Krishnanagar', district: 'Nadia', pct: 120 }]
});

// ===== IF: HAS BREACHES =====
const checkBreaches = ifElse({
  version: 2.2,
  config: {
    name: 'Has Breaches?',
    parameters: {
      conditions: { conditions: [{ leftValue: '={{ $json.id }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty' } }] }
    },
    position: [720, 300]
  }
});

// ===== CODE: FORMAT BREACH REPORT =====
const formatReport = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Breach Report',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const breaches = $input.all().map(i => i.json);
const report = \`🚨 SLA BREACH REPORT\n📅 \${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n⚠️ Total Breaches: \${breaches.length}\n\n\${breaches.slice(0, 10).map(b => \`🎫 \${b.ticketNo} | \${b.urgency} | \${b.status} | \${b.block || 'N/A'}, \${b.district || 'N/A'} | \${b.pct || 0}% overdue\`).join('\\n')}\${breaches.length > 10 ? '\\n... and ' + (breaches.length - 10) + ' more' : ''}\`;
return [{ json: { message: report, count: breaches.length } }];`
    },
    position: [960, 200]
  },
  output: [{ message: '🚨 SLA BREACH REPORT...', count: 3 }]
});

// ===== SUPABASE: GET ADMINS =====
const getAdmins = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Get Admin Users',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'users',
      returnAll: true,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: {
        conditions: [
          { keyName: 'role', condition: 'eq', keyValue: 'ADMIN' },
          { keyName: 'isActive', condition: 'eq', keyValue: 'true' }
        ]
      }
    },
    position: [1200, 200]
  },
  output: [{ id: 'admin1', name: 'Admin', whatsappPhone: '919999999000' }]
});

// ===== CODE: BUILD ADMIN ALERTS =====
const buildAdminAlerts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Admin Alert Items',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const report = $('Format Breach Report').first().json;
const admins = $input.all().map(i => i.json);
return admins.map(a => ({ json: { phone: a.whatsappPhone, message: report.message } }));`
    },
    position: [1440, 200]
  },
  output: [{ phone: '919999999000', message: '🚨 SLA BREACH REPORT...' }]
});

// ===== WHATSAPP SEND: ADMIN ALERT =====
const sendAdminAlert = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Breach Alert to Admin',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1680, 200]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== WORKFLOW =====
export default workflow('wb-07-sla-escalation', 'WB-07: SLA Breach Escalation')
  .add(schedule)
  .to(getBreached)
  .to(checkBreaches
    .onTrue(formatReport
      .to(getAdmins
        .to(buildAdminAlerts
          .to(sendAdminAlert)))));
