import { workflow, node, trigger, newCredential, sticky, splitInBatches, nextBatch } from '@n8n/workflow-sdk';

const citizenWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Notify Citizen Webhook',
    parameters: { httpMethod: 'POST', path: 'wb-notify-citizen', responseMode: 'lastNode' },
    position: [240, 200]
  },
  output: [{ body: { complaintId: 'clxyz1', status: 'IN_PROGRESS', timestamp: '2025-01-15T12:00:00Z', source: 'status_change' } }]
});

const officerWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Notify Officer Webhook',
    parameters: { httpMethod: 'POST', path: 'wb-notify-officer', responseMode: 'lastNode' },
    position: [240, 500]
  },
  output: [{ body: { complaintId: 'clxyz1', assignedToId: 'uid1', timestamp: '2025-01-15T10:35:00Z', source: 'assignment' } }]
});

sticky({ position: [100, 100], content: 'WB-03: Dual notification engine — citizen + officer messages via WhatsApp' });

const routeCitizen = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Route Citizen Notification',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const b = $input.first().json.body;
const source = b.source || 'status_change';
if (source === 'sla_breach_batch' && b.complaints) {
  const items = b.complaints.map(c => ({ phone: c.citizenPhone, ticketNo: c.ticketNo, riskLevel: c.riskLevel, source: 'sla_batch' }));
  return items.map(i => ({ json: i }));
}
return [{ json: { complaintId: b.complaintId, status: b.status, source, phone: b.phone } }];`
    },
    position: [480, 200]
  },
  output: [{ complaintId: 'clxyz1', status: 'IN_PROGRESS', source: 'status_change' }]
});

const getCitizenComplaint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Get Citizen Complaint',
    parameters: {
      method: 'GET',
      url: '={{ `https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/complaints?id=eq.${$json.complaintId}&select=ticketNo,phone,issue,status,resolution,urgency,category,block,district` }}',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'apikey', value: '{{ $env.SUPABASE_SERVICE_ROLE_KEY }}' },
          { name: 'Authorization', value: 'Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}' }
        ]
      }
    },
    position: [720, 200]
  },
  output: [{ ticketNo: 'WB-01001', phone: '919876543210', issue: 'No water', status: 'IN_PROGRESS', resolution: null, urgency: 'HIGH', category: 'Water Supply', block: 'Krishnanagar', district: 'Nadia' }]
});

const formatCitizenMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Citizen Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const input = $input.first().json;
let msg = '';
if (input.source === 'sla_batch') {
  msg = \`⚠️ SLA লঙ্ঘন | SLA Breach Notice\\n\\n🎫 টিকেট: \${input.ticketNo}\\n🔴 আপনার অভিযোগ এসক্যালেট করা হয়েছে\\nYour complaint has been escalated to higher priority.\`;
} else {
  const statusMsg = {
    OPEN: '🟢 অভিযোগ গ্রহণ করা হয়েছে | Complaint Received',
    IN_PROGRESS: '🔄 স্ট্যাটাস আপডেট | Status Update\\n\\n📊 স্ট্যাটাস: 🟡 চলমান | In Progress',
    RESOLVED: '✅ অভিযোগ সমাধান | Complaint Resolved\\n\\n📝 সমাধান: ' + (input.resolution || 'N/A') + '\\n\\n⭐ আপনার অভিজ্ঞতা রেট করুন (Reply 1-5):\\n1 = খুব খারাপ | Very Poor\\n2 = খারাপ | Poor\\n3 = গড় | Average\\n4 = ভালো | Good\\n5 = খুব ভালো | Excellent',
    REJECTED: '❌ অভিযোগ বাতিল | Complaint Rejected'
  };
  msg = \`\${statusMsg[input.status] || 'Status updated'}\\n\\n🎫 টিকেট: \${input.ticketNo}\`;
}
return [{ json: { phone: input.phone, message: msg } }];`
    },
    position: [960, 200]
  },
  output: [{ phone: '919876543210', message: '🔄 Status Update\n🎫 WB-01001' }]
});

const routeOfficer = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Route Officer Notification',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const b = $input.first().json.body;
return [{ json: { complaintId: b.complaintId, assignedToId: b.assignedToId, source: b.source, previousUrgency: b.previousUrgency, newUrgency: b.newUrgency, reason: b.reason } }];`
    },
    position: [480, 500]
  },
  output: [{ complaintId: 'clxyz1', assignedToId: 'uid1', source: 'assignment' }]
});

const getOfficerComplaint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Get Officer Complaint Details',
    parameters: {
      method: 'GET',
      url: '={{ `https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/complaints?id=eq.${$json.complaintId}&select=ticketNo,issue,category,urgency,block,district,phone,citizenName,status` }}',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'apikey', value: '{{ $env.SUPABASE_SERVICE_ROLE_KEY }}' },
          { name: 'Authorization', value: 'Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}' }
        ]
      }
    },
    position: [720, 500]
  },
  output: [{ ticketNo: 'WB-01001', issue: 'No water', category: 'Water Supply', urgency: 'HIGH', block: 'Krishnanagar', district: 'Nadia', phone: '919876543210', citizenName: 'Rahul' }]
});

const getNotifyTargets = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Notification Targets',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const complaint = $input.first().json;
const input = $('Notify Officer Webhook').first().json.body;
const urgency = complaint.urgency || 'MEDIUM';
let msg = '';
if (input.source === 'assignment') {
  msg = \`🔔 নতুন অভিযোগ নিয়োগ | New Complaint Assigned\\n\\n🎫 টিকেট: \${complaint.ticketNo}\\n📌 বিষয়: \${complaint.issue}\\n📂 বিভাগ: \${complaint.category}\\n📍 \${complaint.block}, \${complaint.district}\\n🔴 জরুরিতা: \${urgency}\\n📞 নাগরিক: \${complaint.citizenName || ''} (\${complaint.phone || ''})\\n\\nঅনুগ্রহ করে শীঘ্র ব্যবস্থা নিন।\\nPlease take action at the earliest.\`;
} else if (input.source === 'urgency_escalation') {
  msg = \`🚨 এসক্যালেশন সতর্কতা | Escalation Alert\\n\\n🎫 টিকেট: \${complaint.ticketNo}\\n📌 বিষয়: \${complaint.issue}\\n⬆️ জরুরিতা: \${input.previousUrgency} → \${input.newUrgency}\\n📍 \${complaint.block}, \${complaint.district}\\n⏰ কারণ: \${input.reason || 'SLA Breach'}\\n\\nএটি একটি উচ্চ-অগ্রাধিকার এসক্যালেশন।\\nThis is a high-priority escalation.\`;
}
return [{ json: { message: msg, urgency, block: complaint.block, district: complaint.district } }];`
    },
    position: [960, 500]
  },
  output: [{ message: '🔔 New Complaint Assigned...', urgency: 'HIGH', block: 'Krishnanagar', district: 'Nadia' }]
});

export default workflow('wb-03-notifications', 'WB-03: Citizen & Officer Notifications')
  .add(citizenWebhook)
  .to(routeCitizen)
  .to(getCitizenComplaint)
  .to(formatCitizenMsg)
  .add(officerWebhook)
  .to(routeOfficer)
  .to(getOfficerComplaint)
  .to(getNotifyTargets);
