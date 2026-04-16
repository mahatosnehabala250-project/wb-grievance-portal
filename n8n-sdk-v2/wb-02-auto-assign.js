import { workflow, node, trigger, newCredential, ifElse, sticky } from '@n8n/workflow-sdk';

// ===== WEBHOOK TRIGGER =====
const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Auto-Assign Webhook',
    parameters: { httpMethod: 'POST', path: 'wb-auto-assign', responseMode: 'lastNode' },
    position: [240, 300]
  },
  output: [{ body: { complaintId: 'clxyz1', issue: 'No water', category: 'Water Supply', block: 'Krishnanagar', district: 'Nadia', urgency: 'HIGH', ticketNo: 'WB-01001', citizenName: 'Rahul', phone: '919876543210' } }]
});

sticky({ position: [100, 80], content: 'WB-02: Find matching officer by block → assign → log activity → notify citizen & officer via WhatsApp Send Node\nUses: Supabase Node + WhatsApp Send Node' });

// ===== SUPABASE: GET BLOCK OFFICERS =====
const getOfficers = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Get Block Officers',
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
          { keyName: 'role', condition: 'eq', keyValue: 'BLOCK' },
          { keyName: 'block', condition: 'eq', keyValue: '={{ $json.body.block }}' },
          { keyName: 'isActive', condition: 'eq', keyValue: 'true' }
        ]
      }
    },
    position: [480, 300]
  },
  output: [{ id: 'u1', name: 'Amit Banerjee', block: 'Krishnanagar', whatsappPhone: '919999999001', notifyVia: 'whatsapp' }]
});

// ===== IF: OFFICERS FOUND =====
const checkOfficers = ifElse({
  version: 2.2,
  config: {
    name: 'Officers Available?',
    parameters: {
      conditions: { conditions: [{ leftValue: '={{ $json.id }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty' } }] }
    },
    position: [720, 300]
  }
});

// ===== CODE: SELECT BEST OFFICER =====
const selectOfficer = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Select Best Officer',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const officers = $input.all().map(i => i.json);
const officer = officers[0] || null;
const input = $('Auto-Assign Webhook').first().json.body;
return [{ json: { officerId: officer?.id || '', officerName: officer?.name || '', officerPhone: officer?.whatsappPhone || '', complaintId: input.complaintId, ticketNo: input.ticketNo, issue: input.issue, category: input.category, block: input.block, district: input.district, urgency: input.urgency, citizenName: input.citizenName, phone: input.phone } }];`
    },
    position: [960, 200]
  },
  output: [{ officerId: 'u1', officerName: 'Amit Banerjee', officerPhone: '919999999001', complaintId: 'clxyz1', ticketNo: 'WB-01001' }]
});

// ===== SUPABASE: ASSIGN OFFICER =====
const assignComplaint = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Assign Officer to Complaint',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'complaints',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: {
        conditions: [{ keyName: 'id', condition: 'eq', keyValue: '={{ $json.complaintId }}' }]
      },
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'assignedToId', fieldValue: '={{ $json.officerId }}' },
          { fieldId: 'assignedOfficerName', fieldValue: '={{ $json.officerName }}' },
          { fieldId: 'n8nProcessed', fieldValue: 'true' }
        ]
      }
    },
    position: [1200, 200]
  },
  output: [{ id: 'c1', ticketNo: 'WB-01001' }]
});

// ===== SUPABASE: LOG ACTIVITY =====
const logActivity = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log ASSIGNED Activity',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'create',
      tableId: 'activity_logs',
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'complaintId', fieldValue: '={{ $json.complaintId }}' },
          { fieldId: 'action', fieldValue: 'ASSIGNED' },
          { fieldId: 'description', fieldValue: '={{ `Assigned to ${$json.officerName}` }}' },
          { fieldId: 'actorId', fieldValue: '={{ $json.officerId }}' },
          { fieldId: 'actorName', fieldValue: '={{ $json.officerName }}' }
        ]
      }
    },
    position: [1440, 200]
  },
  output: [{ id: 'log-1' }]
});

// ===== CODE: BUILD MESSAGES =====
const buildMessages = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Notification Messages',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const d = $input.first().json;
const citizenMsg = \`📋 অভিজ্ঞতা আপডেট | Update on Your Complaint\n\n🎫 টিকেট: \${d.ticketNo}\n👤 দায়িত্বপ্রাপ্ত কর্মকর্তা: \${d.officerName}\n📍 ব্লক: \${d.block}\n\nআপনার অভিযোগের দায়িত্ব একজন কর্মকর্তার কাছে দেওয়া হয়েছে।\`;
const officerMsg = \`🔔 নতুন অভিযোগ নিয়োগ | New Complaint Assigned\n\n🎫 টিকেট: \${d.ticketNo}\n📌 বিষয়: \${d.issue}\n📂 বিভাগ: \${d.category}\n📍 \${d.block}, \${d.district}\n🔴 জরুরিতা: \${d.urgency}\n📞 নাগরিক: \${d.citizenName || ''} (\${d.phone || ''})\n\nঅনুগ্রহ করে শীঘ্র ব্যবস্থা নিন।\`;
return [{ json: { citizenPhone: d.phone, officerPhone: d.officerPhone, citizenMsg, officerMsg, ticketNo: d.ticketNo, officerName: d.officerName, block: d.block } }];`
    },
    position: [1680, 200]
  },
  output: [{ citizenPhone: '919876543210', officerPhone: '919999999001', citizenMsg: '📋 Update...', officerMsg: '🔔 New Complaint...' }]
});

// ===== WHATSAPP SEND: NOTIFY CITIZEN =====
const notifyCitizen = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Notify Citizen',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.citizenPhone }}',
      messageType: 'text',
      textBody: '={{ $json.citizenMsg }}'
    },
    position: [1920, 100]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== WHATSAPP SEND: NOTIFY OFFICER =====
const notifyOfficer = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Notify Officer',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.officerPhone }}',
      messageType: 'text',
      textBody: '={{ $json.officerMsg }}'
    },
    position: [1920, 300]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== CODE: NO OFFICER ALERT =====
const noOfficerAlert = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'No Officer Found Alert',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const input = $('Auto-Assign Webhook').first().json.body;
return [{ json: { message: \`⚠️ UNASSIGNED COMPLAINT\n\nNo BLOCK officer found for:\nBlock: \${input.block}\nDistrict: \${input.district}\nComplaint: \${input.ticketNo}\n\nManual assignment required.\`, phone: '' } }];`
    },
    position: [960, 450]
  },
  output: [{ message: '⚠️ UNASSIGNED COMPLAINT' }]
});

// ===== WHATSAPP SEND: ADMIN ALERT =====
const alertAdmin = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Alert Admin (No Officer)',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '=919999999000',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1200, 450]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== WORKFLOW =====
export default workflow('wb-02-auto-assign', 'WB-02: Auto-Assign Officer')
  .add(webhook)
  .to(getOfficers)
  .to(checkOfficers
    .onTrue(selectOfficer
      .to(assignComplaint
        .to(logActivity
          .to(buildMessages
            .to(notifyCitizen)
            .to(notifyOfficer)))))
    .onFalse(noOfficerAlert
      .to(alertAdmin)));
