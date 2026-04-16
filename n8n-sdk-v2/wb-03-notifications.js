import { workflow, node, trigger, newCredential, sticky, splitInBatches, nextBatch } from '@n8n/workflow-sdk';

// ===== CITIZEN WEBHOOK =====
const citizenWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Notify Citizen',
    parameters: { httpMethod: 'POST', path: 'wb-notify-citizen', responseMode: 'lastNode' },
    position: [240, 200]
  },
  output: [{ body: { complaintId: 'clxyz1', status: 'IN_PROGRESS', timestamp: '2025-01-15T12:00:00Z', source: 'status_change', phone: '919876543210' } }]
});

// ===== OFFICER WEBHOOK =====
const officerWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Notify Officer',
    parameters: { httpMethod: 'POST', path: 'wb-notify-officer', responseMode: 'lastNode' },
    position: [240, 550]
  },
  output: [{ body: { complaintId: 'clxyz1', assignedToId: 'uid1', timestamp: '2025-01-15T10:35:00Z', source: 'assignment' } }]
});

sticky({ position: [100, 80], content: 'WB-03: Dual notification engine\nCitizen path: status_change, sla_breach → format → WhatsApp Send\nOfficer path: assignment, escalation → format → WhatsApp Send\nUses: Supabase Node + WhatsApp Send Node' });

// ===== CITIZEN PATH =====

// Code: Route Citizen
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
  const items = b.complaints.map(c => ({ json: { complaintId: c.complaintId, phone: c.phone, ticketNo: c.ticketNo, riskLevel: c.riskLevel, source: 'sla_batch', status: '' } }));
  return items;
}
return [{ json: { complaintId: b.complaintId, status: b.status, source, phone: b.phone || '' } }];`
    },
    position: [480, 200]
  },
  output: [{ complaintId: 'clxyz1', status: 'IN_PROGRESS', source: 'status_change', phone: '919876543210' }]
});

// Supabase: Get Complaint
const getCitizenComplaint = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Get Citizen Complaint',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'get',
      tableId: 'complaints',
      filters: {
        conditions: [{ keyName: 'id', keyValue: '={{ $json.complaintId }}' }]
      }
    },
    position: [720, 200]
  },
  output: [{ id: 'clxyz1', ticketNo: 'WB-01001', phone: '919876543210', issue: 'No water', status: 'IN_PROGRESS', resolution: null, urgency: 'HIGH', category: 'Water Supply', block: 'Krishnanagar', district: 'Nadia' }]
});

// Code: Format Citizen Message
const formatCitizenMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Citizen Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const input = $input.first().json;
const route = $('Route Citizen Notification').first().json;
const phone = input.phone || route.phone || '';
let msg = '';
if (route.source === 'sla_batch') {
  msg = \`⚠️ SLA লঙ্ঘন | SLA Breach Notice\n\n🎫 টিকেট: \${input.ticketNo}\n🔴 আপনার অভিযোগ এসক্যালেট করা হয়েছে\nYour complaint has been escalated.\`;
} else {
  const statusMsgs = {
    OPEN: '🟢 অভিযোগ গ্রহণ করা হয়েছে | Complaint Received',
    IN_PROGRESS: '🔄 স্ট্যাটাস আপডেট | Status Update\n📊 স্ট্যাটাস: 🟡 চলমান | In Progress',
    RESOLVED: \`✅ অভিযোগ সমাধান | Complaint Resolved\n\n📝 সমাধান: \${input.resolution || 'N/A'}\n\n⭐ আপনার অভিজ্ঞতা রেট করুন (Reply 1-5):\n1=খুব খারাপ 2=খারাপ 3=গড় 4=ভালো 5=খুব ভালো\`,
    REJECTED: '❌ অভিযোগ বাতিল | Complaint Rejected'
  };
  msg = \`\${statusMsgs[input.status] || 'Status updated'}\n\n🎫 টিকেট: \${input.ticketNo}\`;
}
return [{ json: { phone, message: msg } }];`
    },
    position: [960, 200]
  },
  output: [{ phone: '919876543210', message: '🔄 Status Update\n🎫 WB-01001' }]
});

// WhatsApp Send: Citizen
const sendCitizen = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send to Citizen',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '={{ $env.WA_PHONE_NUMBER_ID || "1125704830617135" }}',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1200, 200]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== OFFICER PATH =====

// Code: Route Officer
const routeOfficer = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Route Officer Notification',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const b = $input.first().json.body;
return [{ json: { complaintId: b.complaintId, assignedToId: b.assignedToId, source: b.source, previousUrgency: b.previousUrgency || '', newUrgency: b.newUrgency || '', reason: b.reason || '' } }];`
    },
    position: [480, 550]
  },
  output: [{ complaintId: 'clxyz1', assignedToId: 'uid1', source: 'assignment' }]
});

// Supabase: Get Officer Complaint
const getOfficerComplaint = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Get Officer Complaint',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'get',
      tableId: 'complaints',
      filters: {
        conditions: [{ keyName: 'id', keyValue: '={{ $json.complaintId }}' }]
      }
    },
    position: [720, 550]
  },
  output: [{ id: 'clxyz1', ticketNo: 'WB-01001', issue: 'No water', category: 'Water Supply', urgency: 'HIGH', block: 'Krishnanagar', district: 'Nadia', phone: '919876543210', citizenName: 'Rahul', assignedToId: 'uid1' }]
});

// Supabase: Get Officer
const getOfficer = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Get Officer Details',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'get',
      tableId: 'users',
      filters: {
        conditions: [{ keyName: 'id', keyValue: '={{ $json.assignedToId || $json.id }}' }]
      }
    },
    position: [960, 550]
  },
  output: [{ id: 'uid1', name: 'Amit Banerjee', whatsappPhone: '919999999001', block: 'Krishnanagar', role: 'BLOCK' }]
});

// Code: Build Officer Message
const formatOfficerMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Officer Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const complaint = $('Get Officer Complaint').first().json;
const route = $('Route Officer Notification').first().json;
let msg = '';
if (route.source === 'assignment') {
  msg = \`🔔 নতুন অভিযোগ নিয়োগ | New Complaint Assigned\n\n🎫 টিকেট: \${complaint.ticketNo}\n📌 বিষয়: \${complaint.issue}\n📂 বিভাগ: \${complaint.category}\n📍 \${complaint.block}, \${complaint.district}\n🔴 জরুরিতা: \${complaint.urgency}\n📞 নাগরিক: \${complaint.citizenName || ''} (\${complaint.phone || ''})\n\nঅনুগ্রহ করে শীঘ্র ব্যবস্থা নিন।\`;
} else if (route.source === 'urgency_escalation') {
  msg = \`🚨 এসক্যালেশন সতর্কতা | Escalation Alert\n\n🎫 টিকেট: \${complaint.ticketNo}\n📌 বিষয়: \${complaint.issue}\n⬆️ জরুরিতা: \${route.previousUrgency} → \${route.newUrgency}\n📍 \${complaint.block}, \${complaint.district}\n⏰ কারণ: \${route.reason || 'SLA Breach'}\n\nএটি উচ্চ-অগ্রাধিকার এসক্যালেশন।\`;
}
return [{ json: { phone: complaint.assignedToId ? $('Get Officer Details').first().json.whatsappPhone : '', message: msg, officerName: $('Get Officer Details').first().json.name || '' } }];`
    },
    position: [1200, 550]
  },
  output: [{ phone: '919999999001', message: '🔔 New Complaint Assigned...', officerName: 'Amit Banerjee' }]
});

// WhatsApp Send: Officer
const sendOfficer = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send to Officer',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '={{ $env.WA_PHONE_NUMBER_ID || "1125704830617135" }}',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1440, 550]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== WORKFLOW =====
export default workflow('wb-03-notifications', 'WB-03: Citizen & Officer Notifications')
  .add(citizenWebhook)
  .to(routeCitizen)
  .to(getCitizenComplaint)
  .to(formatCitizenMsg)
  .to(sendCitizen)
  .add(officerWebhook)
  .to(routeOfficer)
  .to(getOfficerComplaint)
  .to(getOfficer)
  .to(formatOfficerMsg)
  .to(sendOfficer);
