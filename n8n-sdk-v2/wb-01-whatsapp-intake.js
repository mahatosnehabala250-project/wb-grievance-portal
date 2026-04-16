import { workflow, node, trigger, newCredential, ifElse, languageModel, outputParser, sticky } from '@n8n/workflow-sdk';

// ===== AI CHAT MODEL =====
const chatModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'GPT-4o Mini',
    parameters: { model: 'gpt-4o-mini', options: { temperature: 0 } },
    credentials: { openAiApi: newCredential('OpenAI') },
    position: [1200, 600]
  }
});

// ===== STRUCTURED OUTPUT PARSER =====
const structuredParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Complaint Classification Schema',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "category": "Water Supply", "urgency": "HIGH", "sentiment": "negative", "summary": "No water for 3 days", "language": "bn", "suggested_block": "", "suggested_district": "" }'
    }
  }
});

// ===== WHATSAPP TRIGGER =====
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

sticky({ position: [100, 80], content: 'WB-01: WhatsApp → Parse → Route → AI Classify → Supabase → WhatsApp Reply → Auto-Assign\nUses: AI Agent + Supabase Node + WhatsApp Send Node' });

// ===== CODE: PARSE & ROUTE =====
const parseRoute = node({
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
let ticketNo = '';
let rating = 0;

const ticketMatch = text.match(/WB-\\d{5}/i);
if (ticketMatch) {
  messageType = 'status_check';
  ticketNo = ticketMatch[0].toUpperCase();
} else if (/^[1-5]$/.test(text.trim())) {
  messageType = 'rating';
  rating = parseInt(text.trim());
}

return [{ json: { messageType, phone, waId, text: text.substring(0, 500), contactName, ticketNo, rating } }];`
    },
    position: [480, 300]
  },
  output: [{ messageType: 'new_complaint', phone: '919876543210', text: 'No water supply for 3 days', contactName: 'Rahul', rating: 0 }]
});

// ===== IF: STATUS CHECK =====
const checkStatus = ifElse({
  version: 2.2,
  config: {
    name: 'Is Status Check?',
    parameters: {
      conditions: { conditions: [{ leftValue: '={{ $json.messageType }}', rightValue: 'status_check', operator: { type: 'string', operation: 'equals' } }] }
    },
    position: [720, 200]
  }
});

// ===== HTTP: CALL WB-05 STATUS CHECK =====
const callStatusCheck = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Call WB-05 Status Check',
    parameters: {
      method: 'POST',
      url: 'https://n8n.srv1347095.hstgr.cloud/webhook/wb-status-check',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ ticketNo: $json.ticketNo, phone: $json.phone }) }}'
    },
    position: [960, 100]
  },
  output: [{ message: 'Status check triggered' }]
});

// ===== IF: RATING =====
const checkRating = ifElse({
  version: 2.2,
  config: {
    name: 'Is Rating?',
    parameters: {
      conditions: { conditions: [{ leftValue: '={{ $json.messageType }}', rightValue: 'rating', operator: { type: 'string', operation: 'equals' } }] }
    },
    position: [720, 400]
  }
});

// ===== HTTP: CALL WB-06 RATING =====
const callRating = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Call WB-06 Rating',
    parameters: {
      method: 'POST',
      url: 'https://n8n.srv1347095.hstgr.cloud/webhook/wb-rate',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ phone: $json.phone, rating: $json.rating }) }}'
    },
    position: [960, 400]
  },
  output: [{ message: 'Rating submitted' }]
});

// ===== AI AGENT: CLASSIFY COMPLAINT =====
const aiClassifier = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'AI Complaint Classifier',
    parameters: {
      promptType: 'define',
      text: '={{ `Classify this West Bengal grievance: "${$json.text}"\n\nReturn JSON: category (Water Supply|Road Damage|Electricity|Sanitation|Healthcare|Education|Public Transport|Agriculture|Housing|Other), urgency (LOW|MEDIUM|HIGH|CRITICAL), sentiment, summary (English), language (bn|en|hi), suggested_block, suggested_district` }}',
      hasOutputParser: true,
      options: {
        systemMessage: 'You are a WB Grievance Portal AI. Classify complaints in Bengali/English/Hindi. Return ONLY valid JSON with: category, urgency, sentiment, summary, language, suggested_block, suggested_district.',
        maxIterations: 1
      }
    },
    subnodes: { model: chatModel, outputParser: structuredParser },
    position: [960, 600]
  },
  output: [{ output: { category: 'Water Supply', urgency: 'HIGH', sentiment: 'negative', summary: 'No water supply', language: 'bn', suggested_block: '', suggested_district: '' } }]
});

// ===== CODE: NORMALIZE DATA =====
const normalizeData = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Complaint Data',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const msg = $('Parse & Route Message').first().json;
const aiOutput = $input.first().json.output || $input.first().json;
const ai = typeof aiOutput === 'string' ? JSON.parse(aiOutput) : aiOutput;
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
  source: 'WHATSAPP',
  sentiment: ai?.sentiment || 'neutral',
  matchScore: 0
};
const hasRequired = complaintData.issue && complaintData.issue.length > 3;
return [{ json: { ...complaintData, hasRequired } }];`
    },
    position: [1200, 600]
  },
  output: [{ citizenName: 'Rahul', phone: '919876543210', issue: 'No water supply', category: 'Water Supply', urgency: 'HIGH', block: '', district: '', hasRequired: true, source: 'WHATSAPP' }]
});

// ===== IF: HAS REQUIRED FIELDS =====
const checkRequired = ifElse({
  version: 2.2,
  config: {
    name: 'Has Required Fields?',
    parameters: {
      conditions: { conditions: [{ leftValue: '={{ $json.hasRequired }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }] }
    },
    position: [1440, 500]
  }
});

// ===== SUPABASE: CREATE COMPLAINT =====
const createComplaint = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Create Complaint',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'create',
      tableId: 'complaints',
      dataToSend: 'autoMapInputData',
      inputsToIgnore: 'hasRequired'
    },
    position: [1680, 400]
  },
  output: [{ id: 'clxyz1', ticketNo: 'WB-01001', status: 'OPEN', createdAt: '2025-01-15T10:30:00Z' }]
});

// ===== SUPABASE: LOG ACTIVITY =====
const logActivity = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log CREATED Activity',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'create',
      tableId: 'activity_logs',
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'complaintId', fieldValue: '={{ $json.id }}' },
          { fieldId: 'action', fieldValue: 'CREATED' },
          { fieldId: 'description', fieldValue: '={{ `Complaint registered via WhatsApp from ${$json.phone}` }}' },
          { fieldId: 'actorId', fieldValue: '' },
          { fieldId: 'actorName', fieldValue: 'WhatsApp Bot' }
        ]
      }
    },
    position: [1920, 400]
  },
  output: [{ id: 'log-1' }]
});

// ===== CODE: BUILD CONFIRMATION =====
const buildConfirmation = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Confirmation Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const complaint = $('Create Complaint').first().json;
const orig = $('Normalize Complaint Data').first().json;
const ticketNo = complaint.ticketNo || 'WB-00000';
const msg = \`✅ অভিযোগ নিবন্ধন সফল!
Complaint Registered Successfully!

🎫 টিকেট নং: \${ticketNo}
📌 বিষয়: \${(orig.issue || '').substring(0, 50)}
📂 বিভাগ: \${orig.category}
🔴 জরুরিতা: \${orig.urgency}

আপনার অভিযোগ গ্রহণ করা হয়েছে।
Your complaint has been received.

📊 স্ট্যাটাস চেক: \${ticketNo} লিখে পাঠান\`;
return [{ json: { phone: orig.phone, message: msg, complaintId: complaint.id, ticketNo } }];`
    },
    position: [2160, 300]
  },
  output: [{ phone: '919876543210', message: '✅ অভিযোগ নিবন্ধন সফল!', complaintId: 'clxyz1', ticketNo: 'WB-01001' }]
});

// ===== WHATSAPP SEND: CONFIRMATION =====
const sendConfirmation = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Confirmation',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [2400, 300]
  },
  output: [{ messaging_product: 'whatsapp', contacts: [{ input: '919876543210', wa_id: '919876543210' }], messages: [{ id: 'wamid_123' }] }]
});

// ===== HTTP: TRIGGER WB-02 AUTO-ASSIGN =====
const callAutoAssign = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Trigger WB-02 Auto-Assign',
    parameters: {
      method: 'POST',
      url: 'https://n8n.srv1347095.hstgr.cloud/webhook/wb-auto-assign',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ complaintId: $json.complaintId, ticketNo: $json.ticketNo, issue: $("Normalize Complaint Data").first().json.issue, category: $("Normalize Complaint Data").first().json.category, block: $("Normalize Complaint Data").first().json.block, district: $("Normalize Complaint Data").first().json.district, urgency: $("Normalize Complaint Data").first().json.urgency, citizenName: $("Normalize Complaint Data").first().json.citizenName, phone: $("Normalize Complaint Data").first().json.phone }) }}'
    },
    position: [2640, 300]
  },
  output: [{ success: true }]
});

// ===== CODE: BUILD ERROR MESSAGE =====
const buildError = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Error Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `return [{ json: { phone: $('Normalize Complaint Data').first().json.phone, message: '❌ ত্রুটি হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।\\nError occurred. Please try again.' } }];`
    },
    position: [1680, 600]
  },
  output: [{ phone: '919876543210', message: '❌ ত্রুটি হয়েছে' }]
});

// ===== WHATSAPP SEND: ERROR =====
const sendError = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Error Message',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1920, 600]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== CODE: BUILD CLARIFICATION =====
const buildClarification = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Clarification Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const phone = $('Parse & Route Message').first().json.phone;
return [{ json: { phone, message: 'অনুগ্রহ করে আপনার অভিযোগের বিবরণ দিন।\\nPlease describe your complaint in detail.\\n\\nExample: "No water supply in my area for 3 days"' } }];`
    },
    position: [1200, 750]
  },
  output: [{ phone: '919876543210', message: 'অনুগ্রহ করে আপনার অভিযোগের বিবরণ দিন।' }]
});

// ===== WHATSAPP SEND: CLARIFICATION =====
const sendClarification = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Clarification',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1440, 750]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== WORKFLOW COMPOSITION =====
export default workflow('wb-01-whatsapp-intake', 'WB-01: WhatsApp Intake + AI Router')
  .add(waTrigger)
  .to(parseRoute)
  .to(checkStatus
    .onTrue(callStatusCheck)
    .onFalse(checkRating
      .onTrue(callRating)
      .onFalse(aiClassifier
        .to(normalizeData)
        .to(checkRequired
          .onTrue(createComplaint
            .to(logActivity
              .to(buildConfirmation
                .to(sendConfirmation
                  .to(callAutoAssign)))))
          .onFalse(buildClarification
            .to(sendClarification))))));
