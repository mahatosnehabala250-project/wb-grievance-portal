import { workflow, node, trigger, newCredential, expr, sticky, ifElse } from '@n8n/workflow-sdk';

const waTrigger = trigger({
  type: 'n8n-nodes-base.whatsAppTrigger',
  version: 1,
  config: {
    name: 'WhatsApp Trigger',
    credentials: { whatsAppTriggerApi: newCredential('WhatsApp Business Account') },
    position: [240, 300]
  },
  output: [{ body: { contacts: [{ wa_id: '919876543210', profile: { name: 'Rahul' } }], messages: [{ from: '919876543210', text: { body: 'No water supply for 3 days' }, type: 'text' }] } }]
});

sticky({ position: [100, 100], content: 'WB-01: WhatsApp Intake → AI Classify → Route (Status/Rating/New) → Create Complaint → Assign' });

const parseMessage = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse & Route Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const body = $('WhatsApp Trigger').first().json.body || {};
const contacts = body.contacts || [];
const messages = body.messages || [];
const msg = messages[0] || {};
const contact = contacts[0] || {};
const text = msg.text?.body || '';
const waId = msg.from;
const phone = contact.wa_id || waId;
const contactName = contact.profile?.name || '';

let messageType = 'new_complaint';
const ticketMatch = text.match(/WB-\\d{5}/i);
if (ticketMatch) {
  messageType = 'status_check';
} else if (/^[1-5]$/.test(text.trim())) {
  messageType = 'rating';
}

return [{ json: { messageType, phone, waId, text: text.substring(0, 500), contactName, rating: parseInt(text.trim()) } }];`
    },
    position: [480, 300]
  },
  output: [{ messageType: 'new_complaint', phone: '919876543210', waId: '919876543210', text: 'No water supply for 3 days', contactName: 'Rahul', rating: 0 }]
});

const checkStatus = ifElse({
  version: 2.2,
  config: {
    name: 'Is Status Check?',
    parameters: {
      conditions: {
        conditions: [{ leftValue: '={{ $json.messageType }}', rightValue: 'status_check', operator: { type: 'string', operation: 'equals' } }]
      }
    },
    position: [720, 300]
  }
});

const checkRating = ifElse({
  version: 2.2,
  config: {
    name: 'Is Rating?',
    parameters: {
      conditions: {
        conditions: [{ leftValue: '={{ $json.messageType }}', rightValue: 'rating', operator: { type: 'string', operation: 'equals' } }]
      }
    },
    position: [960, 300]
  }
});

// PATH A: Status Check
const callStatusCheck = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Call WB-05 Status Check',
    parameters: {
      method: 'POST',
      url: '={{ `${$env.N8N_BASE_URL || "https://n8n.srv1347095.hstgr.cloud"}/webhook/wb-status-check` }}',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ ticketNo: $json.text.match(/WB-\\d{5}/i)?.[0], phone: $json.phone }) }}'
    },
    position: [1200, 100]
  },
  output: [{ message: '📊 টিকেট স্ট্যাটাস...' }]
});

// PATH B: Rating
const callRating = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Call WB-06 Rating',
    parameters: {
      method: 'POST',
      url: '={{ `${$env.N8N_BASE_URL || "https://n8n.srv1347095.hstgr.cloud"}/webhook/wb-rate` }}',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ phone: $json.phone, rating: $json.rating }) }}'
    },
    position: [1200, 300]
  },
  output: [{ message: '🙏 ধন্যবাদ!' }]
});

// PATH C: New Complaint
const classifyAI = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'AI Classify Complaint',
    parameters: {
      method: 'POST',
      url: 'https://wb-grievance-portal.vercel.app/api/ai/process-complaint',
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: 'Content-Type', value: 'application/json' }]
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ text: $json.text }) }}',
      options: { timeout: 15000 }
    },
    position: [1200, 500]
  },
  output: [{ category: 'Water Supply', urgency: 'HIGH', sentiment: 'negative', summary: 'No water supply', language: 'bn' }]
});

const normalizeData = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Complaint Data',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const msg = $('Parse & Route Message').first().json;
const ai = $input.first().json;
const complaintData = {
  citizenName: msg.contactName || '',
  phone: msg.phone,
  issue: msg.text.substring(0, 200),
  category: ai?.category || 'Other',
  block: ai?.suggested_block || '',
  district: ai?.suggested_district || '',
  urgency: ai?.urgency || 'MEDIUM',
  village: '',
  description: msg.text,
  language: ai?.language || 'bn',
  source: 'WHATSAPP'
};
const hasRequired = complaintData.issue && complaintData.issue.length > 3;
return [{ json: { ...complaintData, hasRequired } }];`
    },
    position: [1440, 500]
  },
  output: [{ citizenName: 'Rahul', phone: '919876543210', issue: 'No water supply', category: 'Water Supply', urgency: 'HIGH', block: '', district: '', hasRequired: true }]
});

const checkRequired = ifElse({
  version: 2.2,
  config: {
    name: 'Has Required Fields?',
    parameters: {
      conditions: {
        conditions: [{ leftValue: '={{ $json.hasRequired }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }]
      }
    },
    position: [1680, 500]
  }
});

const createComplaint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Create Complaint via API',
    parameters: {
      method: 'POST',
      url: 'https://wb-grievance-portal.vercel.app/api/webhook/complaint',
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: 'Content-Type', value: 'application/json' }]
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ citizenName: $json.citizenName, phone: $json.phone, issue: $json.issue, category: $json.category, block: $json.block, district: $json.district, urgency: $json.urgency, village: $json.village, description: $json.description, language: $json.language }) }}',
      options: { timeout: 10000 }
    },
    position: [1920, 400]
  },
  output: [{ success: true, ticketNo: 'WB-01001', id: 'clxyz1' }]
});

const checkCreated = ifElse({
  version: 2.2,
  config: {
    name: 'Creation Successful?',
    parameters: {
      conditions: {
        conditions: [{ leftValue: '={{ $json.success }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }]
      }
    },
    position: [2160, 400]
  }
});

const confirmMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Confirmation',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const d = $input.first().json;
const orig = $('Normalize Complaint Data').first().json;
const msg = \`✅ অভিযোগ নিবন্ধন সফল!\\nComplaint Registered Successfully!\\n\\n🎫 টিকেট নং: \${d.ticketNo}\\n📌 বিষয়: \${orig.issue?.substring(0, 50)}\\n📂 বিভাগ: \${orig.category}\\n🔴 জরুরিতা: \${orig.urgency}\\n\\nআপনার অভিযোগ গ্রহণ করা হয়েছে।\\nYour complaint has been received.\\n\\n📊 স্ট্যাটাস চেক: \${d.ticketNo} লিখে পাঠান\`;
return [{ json: { phone: orig.phone, message: msg, complaintId: d.id, ticketNo: d.ticketNo } }];`
    },
    position: [2400, 300]
  },
  output: [{ phone: '919876543210', message: '✅ অভিযোগ নিবন্ধন সফল!', complaintId: 'clxyz1', ticketNo: 'WB-01001' }]
});

const callAutoAssign = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Call WB-02 Auto-Assign',
    parameters: {
      method: 'POST',
      url: '={{ `${$env.N8N_BASE_URL || "https://n8n.srv1347095.hstgr.cloud"}/webhook/wb-auto-assign` }}',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ complaintId: $json.complaintId, ticketNo: $json.ticketNo, issue: $("Normalize Complaint Data").first().json.issue, category: $("Normalize Complaint Data").first().json.category, block: $("Normalize Complaint Data").first().json.block, district: $("Normalize Complaint Data").first().json.district, urgency: $("Normalize Complaint Data").first().json.urgency, citizenName: $("Normalize Complaint Data").first().json.citizenName, phone: $("Normalize Complaint Data").first().json.phone }) }}'
    },
    position: [2640, 300]
  },
  output: [{ success: true }]
});

const errorMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Error Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `return [{ json: { phone: $('Normalize Complaint Data').first().json.phone, message: '❌ ত্রুটি হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।\\nError occurred. Please try again.' } }];`
    },
    position: [2400, 500]
  },
  output: [{ phone: '919876543210', message: '❌ ত্রুটি হয়েছে' }]
});

const clarifyMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Clarification Prompt',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const phone = $('Parse & Route Message').first().json.phone;
return [{ json: { phone, message: 'অনুগ্রহ করে আপনার অভিযোগের বিবরণ দিন।\\nPlease describe your complaint in detail.\\n\\nExample: "No water supply in my area for 3 days"\\n\\nশুধু টিকেট নং দিলে স্ট্যাটাস চেক হবে।' } }];`
    },
    position: [1680, 650]
  },
  output: [{ phone: '919876543210', message: 'অনুগ্রহ করে আপনার অভিযোগের বিবরণ দিন।' }]
});

export default workflow('wb-01-whatsapp-intake', 'WB-01: WhatsApp Intake + AI Router')
  .add(waTrigger)
  .to(parseMessage)
  .to(checkStatus
    .onTrue(callStatusCheck)
    .onFalse(checkRating
      .onTrue(callRating)
      .onFalse(classifyAI
        .to(normalizeData)
        .to(checkRequired
          .onTrue(createComplaint
            .to(checkCreated
              .onTrue(confirmMsg.to(callAutoAssign))
              .onFalse(errorMsg)))
          .onFalse(clarifyMsg)))));
