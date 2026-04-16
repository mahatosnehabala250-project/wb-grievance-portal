import { workflow, node, trigger, newCredential, sticky } from '@n8n/workflow-sdk';

const schedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Daily 9 AM IST',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1 }] } }
  },
  output: [{}]
});

sticky({ position: [100, 100], content: 'WB-08: Daily 9 AM IST → aggregate stats → send report to admins + district heads via WhatsApp' });

const getStats = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Get Dashboard Stats',
    parameters: {
      method: 'GET',
      url: 'https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/complaint_stats?select=*',
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
  output: [{ status: 'OPEN', count: 23 }, { status: 'IN_PROGRESS', count: 45 }, { status: 'RESOLVED', count: 120 }, { status: 'REJECTED', count: 5 }]
});

const formatReport = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Daily Report',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const stats = $input.all().map(i => i.json);
const byStatus = {};
stats.forEach(s => { byStatus[s.status || 'unknown'] = s.count || 0; });
const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
const msg = \`📋 WB Grievance Portal — Daily Report\\n📅 \${today}\\n\\n📊 সারসংক্ষেপ | Summary:\\n├ 📤 খোলা | Open: \${byStatus.OPEN || 0}\\n├ 🔄 চলমান | In Progress: \${byStatus.IN_PROGRESS || 0}\\n├ ✅ সমাধান | Resolved: \${byStatus.RESOLVED || 0}\\n└ ❌ বাতিল | Rejected: \${byStatus.REJECTED || 0}\\n\\nTotal Active: \${(byStatus.OPEN || 0) + (byStatus.IN_PROGRESS || 0)}\\nTotal Resolved: \${byStatus.RESOLVED || 0}\`;
return [{ json: { message: msg } }];`
    },
    position: [720, 300]
  },
  output: [{ message: '📋 WB Grievance Portal — Daily Report\n📊 Summary...' }]
});

const getRecipients = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Get Admin & District Heads',
    parameters: {
      method: 'GET',
      url: 'https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/users?or=(role.eq.ADMIN,and(role.eq.DISTRICT,isDistrictHead.eq.true))&isActive=eq.true&select=name,whatsappPhone,role',
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
  output: [{ name: 'Admin', whatsappPhone: '+919999999999', role: 'ADMIN' }]
});

const buildMessages = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Per-Recipient Messages',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const reportMsg = $('Format Daily Report').first().json.message;
const recipients = $input.all().map(i => i.json);
return recipients.filter(r => r.whatsappPhone).map(r => ({ json: { phone: r.whatsappPhone, message: reportMsg, recipientName: r.name } }));`
    },
    position: [960, 480]
  },
  output: [{ phone: '+919999999999', message: '📋 Daily Report...', recipientName: 'Admin' }]
});

export default workflow('wb-08-daily-report', 'WB-08: Daily Report')
  .add(schedule)
  .to(getStats)
  .to(formatReport)
  .to(getRecipients)
  .to(buildMessages);
