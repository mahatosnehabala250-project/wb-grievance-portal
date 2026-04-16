import { workflow, node, trigger, newCredential, ifElse, sticky } from '@n8n/workflow-sdk';

// ===== WEBHOOK TRIGGER =====
const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Status Check Webhook',
    parameters: { httpMethod: 'POST', path: 'wb-status-check', responseMode: 'lastNode' },
    position: [240, 300]
  },
  output: [{ body: { ticketNo: 'WB-01001', phone: '919876543210' } }]
});

sticky({ position: [100, 80], content: 'WB-05: Citizen sends WB-XXXXX → query Supabase → reply with status via WhatsApp Send Node\nUses: Supabase Node + WhatsApp Send Node' });

// ===== SUPABASE: GET COMPLAINT BY TICKET =====
const getComplaint = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Get Complaint by TicketNo',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'get',
      tableId: 'complaints',
      filters: {
        conditions: [{ keyName: 'ticketNo', keyValue: '={{ $json.body.ticketNo }}' }]
      }
    },
    position: [480, 300]
  },
  output: [{ id: 'clxyz1', ticketNo: 'WB-01001', phone: '919876543210', issue: 'No water', status: 'IN_PROGRESS', category: 'Water Supply', urgency: 'HIGH', block: 'Krishnanagar', district: 'Nadia', assignedOfficerName: 'Amit Banerjee', createdAt: '2025-01-15T10:30:00Z' }]
});

// ===== IF: FOUND =====
const checkFound = ifElse({
  version: 2.2,
  config: {
    name: 'Complaint Found?',
    parameters: {
      conditions: { conditions: [{ leftValue: '={{ $json.id }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty' } }] }
    },
    position: [720, 300]
  }
});

// ===== CODE: FORMAT STATUS =====
const formatStatus = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Status Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const c = $input.first().json;
const phone = c.phone || $('Status Check Webhook').first().json.body.phone;
const statusEmoji = { OPEN: '🟢', IN_PROGRESS: '🟡', RESOLVED: '✅', REJECTED: '❌' };
const statusBn = { OPEN: 'খোলা', IN_PROGRESS: 'চলমান', RESOLVED: 'সমাধান', REJECTED: 'বাতিল' };
const msg = \`📊 টিকেট স্ট্যাটাস | Ticket Status\n\n🎫 টিকেট নং: \${c.ticketNo}\n\${statusEmoji[c.status] || '⚪'} স্ট্যাটাস: \${statusBn[c.status] || c.status} (\${c.status})\n📌 বিষয়: \${c.issue?.substring(0, 60)}\n📂 বিভাগ: \${c.category}\n📍 \${c.block}, \${c.district}\n🔴 জরুরিতা: \${c.urgency}\${c.assignedOfficerName ? '\\n👤 দায়িত্বে: ' + c.assignedOfficerName : ''}\n📅 তারিখ: \${c.createdAt ? new Date(c.createdAt).toLocaleDateString('bn-IN') : 'N/A'}\`;
return [{ json: { phone, message: msg } }];`
    },
    position: [960, 200]
  },
  output: [{ phone: '919876543210', message: '📊 টিকেট স্ট্যাটাস...' }]
});

// ===== WHATSAPP SEND: STATUS =====
const sendStatus = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Status to Citizen',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1200, 200]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== CODE: NOT FOUND MESSAGE =====
const notFoundMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Not Found Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const phone = $('Status Check Webhook').first().json.body.phone;
const ticketNo = $('Status Check Webhook').first().json.body.ticketNo;
return [{ json: { phone, message: \`❌ টিকেট পাওয়া যায়নি\\nTicket Not Found\\n\\n🎫 \${ticketNo} নম্বর কোনো অভিযোগের সাথে মেলেনি।\\nPlease check the ticket number and try again.\` } }];`
    },
    position: [960, 400]
  },
  output: [{ phone: '919876543210', message: '❌ টিকেট পাওয়া যায়নি' }]
});

// ===== WHATSAPP SEND: NOT FOUND =====
const sendNotFound = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Not Found',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1200, 400]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== WORKFLOW =====
export default workflow('wb-05-status-check', 'WB-05: Status Check by Ticket')
  .add(webhook)
  .to(getComplaint)
  .to(checkFound
    .onTrue(formatStatus.to(sendStatus))
    .onFalse(notFoundMsg.to(sendNotFound)));
