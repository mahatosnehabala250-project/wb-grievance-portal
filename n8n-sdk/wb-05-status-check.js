import { workflow, node, trigger, expr, newCredential, sticky } from '@n8n/workflow-sdk';

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Status Check Webhook',
    parameters: {
      httpMethod: 'POST',
      path: 'wb-status-check',
      responseMode: 'lastNode'
    },
    position: [240, 300]
  },
  output: [{ body: { ticketNo: 'WB-01001', phone: '919876543210' } }]
});

sticky({ position: [100, 100], content: 'WB-05: Citizen sends WB-XXXXX → query Supabase → reply status via WhatsApp' });

const getComplaint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Get Complaint by Ticket',
    parameters: {
      method: 'GET',
      url: '={{ `https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/complaints?ticketNo=eq.${$json.body.ticketNo}&select=*` }}',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'apikey', value: '{{ $env.SUPABASE_SERVICE_ROLE_KEY }}' },
          { name: 'Authorization', value: 'Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}' }
        ]
      }
    },
    position: [480, 300]
  },
  output: [{ id: 'c1', ticketNo: 'WB-01001', issue: 'No water supply', category: 'Water Supply', status: 'IN_PROGRESS', urgency: 'HIGH', block: 'Krishnanagar', district: 'Nadia', assignedOfficerName: 'Amit', phone: '919876543210', createdAt: '2025-01-15T10:00:00Z', updatedAt: '2025-01-16T14:30:00Z' }]
});

const checkFound = node({
  type: 'n8n-nodes-base.if',
  version: 2.2,
  config: {
    name: 'Complaint Found?',
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '={{ $json.ticketNo }}',
          typeValidation: 'strict'
        },
        combinator: 'and',
        conditions: [{ leftValue: '={{ $json.ticketNo }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty' } }]
      }
    },
    position: [720, 300]
  },
  output: [{ found: true }]
});

const formatStatus = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Status Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const c = $input.first().json;
const statusMap = { OPEN: '🔴 খোলা | Open', IN_PROGRESS: '🟡 চলমান | In Progress', RESOLVED: '✅ সমাধান | Resolved', REJECTED: '❌ বাতিল | Rejected' };
const statusText = statusMap[c.status] || c.status;
const urgencyMap = { LOW: '🔵', MEDIUM: '🟡', HIGH: '🟠', CRITICAL: '🔴' };
const urgEmoji = urgencyMap[c.urgency] || '';
const created = new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const updated = new Date(c.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const msg = \`📊 টিকেট স্ট্যাটাস | Ticket Status\\n\\n🎫 টিকেট: \${c.ticketNo}\\n📌 বিষয়: \${c.issue}\\n📂 বিভাগ: \${c.category}\\n📍 \${c.block}, \${c.district}\\n\${urgEmoji} জরুরিতা: \${c.urgency}\\n📊 স্ট্যাটাস: \${statusText}\\n👤 দায়িত্বপ্রাপ্ত: \${c.assignedOfficerName || 'অনির্ধারিত'}\\n📅 দায়ের: \${created}\\n🕐 আপডেট: \${updated}\`;
return [{ json: { phone: c.phone, message: msg } }];`
    },
    position: [960, 200]
  },
  output: [{ phone: '919876543210', message: '📊 টিকেট স্ট্যাটাস\n\n🎫 WB-01001\n📌 No water supply\n📊 IN_PROGRESS' }]
});

const notFoundMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Not Found Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const phone = $('Status Check Webhook').first().json.body?.phone || '';
return [{ json: { phone, message: \`❌ টিকেট পাওয়া যায়নি\\nTicket not found.\\n\\nঅনুগ্রহ করে সঠিক টিকেট নং দিন।\\nPlease enter a valid ticket number.\` } }];`
    },
    position: [960, 400]
  },
  output: [{ phone: '919876543210', message: '❌ টিকেট পাওয়া যায়নি' }]
});

export default workflow('wb-05-status-check', 'WB-05: Status Check by Ticket')
  .add(webhook)
  .to(getComplaint)
  .to(checkFound
    .onTrue(formatStatus)
    .onFalse(notFoundMsg));
