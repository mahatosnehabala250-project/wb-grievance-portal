import { workflow, node, trigger, newCredential, sticky, splitInBatches, nextBatch } from '@n8n/workflow-sdk';

// ===== SCHEDULE TRIGGER =====
const schedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Daily 9 AM IST',
    parameters: { rule: { interval: [{ triggerAtHour: 9 }] } },
    position: [240, 300]
  },
  output: [{}]
});

sticky({ position: [100, 80], content: 'WB-08: Daily Report (9 AM IST)\nAggregate stats from Supabase views → format report → send to admins via WhatsApp Send\nUses: Supabase Node + WhatsApp Send Node' });

// ===== SUPABASE: GET STATS =====
const getStats = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Get Complaint Stats',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'complaint_stats',
      returnAll: true,
      filterType: 'none'
    },
    position: [480, 300]
  },
  output: [{ total: 50, open: 10, inProgress: 15, resolved: 20, rejected: 5, avgRating: 3.8 }]
});

// ===== CODE: FORMAT DAILY REPORT =====
const formatReport = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Daily Report',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const s = $input.first().json;
const date = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const msg = \`📋 WB Grievance Portal — Daily Report
📅 \${date}

📊 সারসংক্ষেপ | Summary:
├ 📥 মোট অভিযোগ | Total: \${s.total || 0}
├ 🟢 খোলা | Open: \${s.open || 0}
├ 🟡 চলমান | In Progress: \${s.inProgress || 0}
├ ✅ সমাধান | Resolved: \${s.resolved || 0}
├ ❌ বাতিল | Rejected: \${s.rejected || 0}
└ ⭐ গড় রেটিং | Avg Rating: \${s.avgRating || 'N/A'}/5

✅ Resolution Rate: \${s.total > 0 ? Math.round(((s.resolved || 0) / s.total) * 100) : 0}%\`;
return [{ json: { message: msg } }];`
    },
    position: [720, 300]
  },
  output: [{ message: '📋 WB Grievance Portal — Daily Report...' }]
});

// ===== SUPABASE: GET ADMINS =====
const getAdmins = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Get Admin & District Heads',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'users',
      returnAll: true,
      filterType: 'manual',
      matchType: 'anyFilter',
      filters: {
        conditions: [
          { keyName: 'role', condition: 'eq', keyValue: 'ADMIN' },
          { keyName: 'isDistrictHead', condition: 'eq', keyValue: 'true' }
        ]
      }
    },
    position: [960, 300]
  },
  output: [{ id: 'admin1', name: 'Admin', whatsappPhone: '919999999000' }]
});

// ===== CODE: BUILD RECIPIENTS =====
const buildRecipients = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Recipient List',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const report = $('Format Daily Report').first().json;
const users = $input.all().map(i => i.json);
return users.map(u => ({ json: { phone: u.whatsappPhone, message: report.message } }));`
    },
    position: [1200, 300]
  },
  output: [{ phone: '919999999000', message: '📋 WB Grievance Portal — Daily Report...' }]
});

// ===== WHATSAPP SEND: DAILY REPORT =====
const sendReport = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Daily Report',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '={{ $env.WA_PHONE_NUMBER_ID || "1125704830617135" }}',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1440, 300]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== WORKFLOW =====
export default workflow('wb-08-daily-report', 'WB-08: Daily Report')
  .add(schedule)
  .to(getStats)
  .to(formatReport)
  .to(getAdmins)
  .to(buildRecipients)
  .to(sendReport);
