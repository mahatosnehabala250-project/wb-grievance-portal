import { workflow, node, trigger, newCredential, expr, sticky, splitInBatches, nextBatch } from '@n8n/workflow-sdk';

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Auto-Assign Webhook',
    parameters: {
      httpMethod: 'POST',
      path: 'wb-auto-assign',
      responseMode: 'lastNode'
    },
    position: [240, 300]
  },
  output: [{ body: { complaintId: 'clxyz1', issue: 'No water', category: 'Water Supply', block: 'Krishnanagar', district: 'Nadia', urgency: 'HIGH', ticketNo: 'WB-01001', citizenName: 'Rahul', phone: '919876543210' } }]
});

sticky({ position: [100, 100], content: 'WB-02: Find matching officer by block → assign → log activity → notify citizen & officer via WhatsApp' });

const getOfficers = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Get Block Officers',
    parameters: {
      method: 'GET',
      url: '={{ `https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/users?role=eq.BLOCK&block=eq.${encodeURIComponent($json.body.block)}&isActive=eq.true&select=id,name,block,whatsappPhone,notifyVia` }}',
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
  output: [{ id: 'u1', name: 'Amit Banerjee', block: 'Krishnanagar', whatsappPhone: '+919999999001', notifyVia: 'whatsapp' }]
});

const checkOfficers = node({
  type: 'n8n-nodes-base.if',
  version: 2.2,
  config: {
    name: 'Officers Available?',
    parameters: {
      conditions: {
        conditions: [{ leftValue: '={{ $json.id }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty' } }]
      }
    },
    position: [720, 300]
  },
  output: [{ hasOfficer: true }]
});

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
  output: [{ officerId: 'u1', officerName: 'Amit Banerjee', officerPhone: '+919999999001', complaintId: 'clxyz1', ticketNo: 'WB-01001' }]
});

const assignComplaint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Assign Officer to Complaint',
    parameters: {
      method: 'PATCH',
      url: '={{ `https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/complaints?id=eq.${$json.complaintId}` }}',
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
      jsonBody: '={{ JSON.stringify({ assignedToId: $json.officerId, assignedOfficerName: $json.officerName, n8nProcessed: true }) }}'
    },
    position: [1200, 200]
  },
  output: [{ id: 'c1', ticketNo: 'WB-01001' }]
});

const logActivity = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Log ASSIGNED Activity',
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
      jsonBody: '={{ JSON.stringify({ complaintId: $json.complaintId, action: "ASSIGNED", description: `Assigned to ${$json.officerName}`, actorId: $json.officerId, actorName: $json.officerName }) }}'
    },
    position: [1440, 200]
  },
  output: [{ id: 'log-1' }]
});

const formatNotify = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Notification Messages',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const d = $input.first().json;
const citizenMsg = \`📋 অভিজ্ঞতা আপডেট | Update on Your Complaint\\n\\n🎫 টিকেট: \${d.ticketNo}\\n👤 দায়িত্বপ্রাপ্ত কর্মকর্তা: \${d.officerName}\\n📍 ব্লক: \${d.block}\\n\\nআপনার অভিযোগের দায়িত্ব একজন কর্মকর্তার কাছে দেওয়া হয়েছে।\\nAn officer has been assigned to your complaint.\`;
const officerMsg = \`🔔 নতুন অভিযোগ নিয়োগ | New Complaint\\n\\n🎫 টিকেট: \${d.ticketNo}\\n📌 বিষয়: \${d.issue}\\n📂 বিভাগ: \${d.category}\\n📍 \${d.block}, \${d.district}\\n🔴 জরুরিতা: \${d.urgency}\\n📞 নাগরিক: \${d.citizenName || ''} (\${d.phone || ''})\\n\\nঅনুগ্রহ করে শীঘ্র ব্যবস্থা নিন।\\nPlease take action at the earliest.\`;
return [{ json: { citizenPhone: d.phone, officerPhone: d.officerPhone, citizenMsg, officerMsg } }];`
    },
    position: [1680, 200]
  },
  output: [{ citizenPhone: '919876543210', officerPhone: '+919999999001', citizenMsg: '📋 Update...', officerMsg: '🔔 New Complaint...' }]
});

const noOfficerAlert = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'No Officer Alert',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const input = $('Auto-Assign Webhook').first().json.body;
return [{ json: { message: \`⚠️ UNASSIGNED COMPLAINT\\n\\nNo BLOCK officer found for:\\nBlock: \${input.block}\\nDistrict: \${input.district}\\nComplaint: \${input.ticketNo}\\n\\nManual assignment required.\` } }];`
    },
    position: [960, 420]
  },
  output: [{ message: '⚠️ UNASSIGNED COMPLAINT' }]
});

export default workflow('wb-02-auto-assign', 'WB-02: Auto-Assign Officer')
  .add(webhook)
  .to(getOfficers)
  .to(checkOfficers
    .onTrue(selectOfficer.to(assignComplaint.to(logActivity.to(formatNotify))))
    .onFalse(noOfficerAlert));
