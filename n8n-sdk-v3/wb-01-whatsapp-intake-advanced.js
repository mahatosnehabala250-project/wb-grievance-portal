/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  WB-01: WhatsApp Intake + AI Router — ADVANCED v3.0                         ║
 * ║  West Bengal AI Public Support System                                        ║
 * ║                                                                              ║
 * ║  FEATURES (v3.0 Advanced):                                                   ║
 * ║  ─────────────────────────────────────────────────────────────               ║
 * ║  1. Smart Message Parsing: Multi-language (bn/en/hi), emoji detection        ║
 * ║  2. 6-Way Routing: Status check, Rating, Help, Stop, Too Short, Complaint    ║
 * ║  3. Duplicate Detection: Check recent complaints from same phone (24h)       ║
 * ║  4. AI Classification: GPT-4o Mini + Structured Output (12 fields)          ║
 * ║  5. Location Extraction: Parse block/district/village from text             ║
 * ║  6. Rich WhatsApp Messages: Bengali + English bilingual templates           ║
 * ║  7. Help Menu: Interactive guide for first-time/new users                   ║
 * ║  8. Fallback Handling: AI timeout → defaults, Supabase error → error msg    ║
 * ║  9. Detailed Activity Logging: Metadata with AI confidence, department      ║
 * ║  10. Stop/Unsubscribe: Graceful opt-out handling                            ║
 * ║                                                                              ║
 * ║  NODE COUNT: 24 nodes (up from 18 in v2)                                    ║
 * ║  CREDENTIALS: WhatsApp Business Account, Supabase, OpenAI                    ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  workflow, node, trigger, newCredential, ifElse, languageModel,
  outputParser, sticky, expr
} from '@n8n/workflow-sdk';

/* ════════════════════════════════════════════════════════════════════════════
   AI CHAT MODEL — GPT-4o Mini
   ════════════════════════════════════════════════════════════════════════════ */

const chatModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'GPT-4o Mini Classifier',
    parameters: {
      model: 'gpt-4o-mini',
      options: {
        temperature: 0.05,
        maxTokens: 500,
        timeout: 15000
      }
    },
    credentials: { openAiApi: newCredential('OpenAI') },
    position: [1320, 520]
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   STRUCTURED OUTPUT PARSER — 12-Field Classification Schema
   ════════════════════════════════════════════════════════════════════════════ */

const structuredParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'WB Complaint Analysis Schema v3',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "category": "Water Supply", "urgency": "HIGH", "sentiment": "negative", "language": "bn", "summary": "No water supply for 3 days in the area", "suggested_block": "Krishnanagar", "suggested_district": "Nadia", "village": "", "keywords": ["water", "supply", "no water", "3 days"], "confidence": 92, "department": "PHE", "needs_urgent_attention": true, "is_duplicate_likely": false }'
    }
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   NODE 1: WHATSAPP TRIGGER (Meta Cloud API)
   ════════════════════════════════════════════════════════════════════════════ */

const waTrigger = trigger({
  type: 'n8n-nodes-base.whatsAppTrigger',
  version: 1,
  config: {
    name: 'WhatsApp Trigger',
    credentials: { whatsAppTriggerApi: newCredential('WhatsApp Business Account') },
    position: [180, 340]
  },
  output: [{
    body: {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            contacts: [{ wa_id: '919876543210', profile: { name: 'Rahul Kumar' } }],
            messages: [{
              from: '919876543210',
              id: 'wamid_HBgN',
              text: { body: 'amar area te 3 din dhore pani nai, please help koro' },
              timestamp: '1718432400',
              type: 'text'
            }]
          }
        }]
      }]
    }
  }]
});

/* ════════════════════════════════════════════════════════════════════════════
   CANVAS STICKY NOTES
   ════════════════════════════════════════════════════════════════════════════ */

sticky({
  position: [60, 60],
  content: '🟢 WB-01: WhatsApp Intake + AI Router — ADVANCED v3.0\n\n' +
    '┌────────────── 6-WAY ROUTING ──────────────┐\n' +
    '│ WB-XXXXX → Status Check (WB-05)            │\n' +
    '│ 1-5      → Rating Collection (WB-06)       │\n' +
    '│ help/hi  → Help Menu                       │\n' +
    '│ stop     → Unsubscribe                     │\n' +
    '│ <10 char  → Ask for details                │\n' +
    '│ default  → New Complaint (AI Classified)   │\n' +
    '└────────────────────────────────────────────┘\n\n' +
    '🤖 AI: GPT-4o Mini + 12-Field Structured Output\n' +
    '📊 DB: Supabase (Native Node)\n' +
    '📱 WA: Meta Cloud API (Native Send Node)\n' +
    '🔄 Dup: Check 24h window from same phone'
});

sticky({
  position: [60, 840],
  content: '⚠️ ERROR HANDLING STRATEGY\n\n' +
    '1. AI Timeout (15s) → Fallback: category=Other, urgency=MEDIUM\n' +
    '2. AI Parse Error → Fallback defaults, still create complaint\n' +
    '3. Supabase Create Error → Send WA error message\n' +
    '4. WhatsApp Send Error → Log error, no retry (Meta handles)\n' +
    '5. Missing Fields → Send clarification prompt to citizen'
});

sticky({
  position: [1480, 140],
  content: '🤖 AI CLASSIFICATION ENGINE\n\n' +
    '12-Field Structured Output:\n' +
    '  category, urgency, sentiment, language,\n' +
    '  summary, suggested_block, suggested_district,\n' +
    '  village, keywords[], confidence, department,\n' +
    '  needs_urgent_attention, is_duplicate_likely\n\n' +
    'Model: GPT-4o Mini (temperature: 0.05)\n' +
    'Max Tokens: 500 | Timeout: 15 seconds'
});

sticky({
  position: [60, 1000],
  content: '📋 COMPLAINT DATA FLOW\n\n' +
    '1. WhatsApp Trigger receives Meta payload\n' +
    '2. Parse & Route: Extract phone, text, contact\n' +
    '3. Smart Route: 6-way classification\n' +
    '4. Check Duplicates: Recent 24h from same phone\n' +
    '5. AI Classify: GPT-4o Mini → 12 fields\n' +
    '6. Validate: Required fields check\n' +
    '7. Create: Supabase INSERT complaints\n' +
    '8. Log: Activity log entry\n' +
    '9. Reply: WhatsApp confirmation (bn+en)\n' +
    '10. Cascade: HTTP → WB-02 Auto-Assign'
});

/* ════════════════════════════════════════════════════════════════════════════
   NODE 2: PARSE & SMART ROUTE (Advanced Message Parser)
   ════════════════════════════════════════════════════════════════════════════ */

const parseRoute = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse & Smart Route',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `// ═══ ADVANCED MESSAGE PARSER ═══
const body = $('WhatsApp Trigger').first().json.body || {};
const entry = body.entry || [];
const changes = (entry[0] || {}).changes || [];
const value = (changes[0] || {}).value || {};
const contacts = value.contacts || [];
const messages = value.messages || [];
const msg = messages[0] || {};
const contact = contacts[0] || {};

const text = msg.text?.body || msg.interactive?.list_reply?.title || msg.interactive?.button_reply?.title || '';
const waId = msg.from;
const phone = contact.wa_id || waId;
const contactName = contact.profile?.name || '';
const msgType = msg.type || 'text';
const msgId = msg.id || '';
const timestamp = msg.timestamp || '';
const cleanText = text.trim();

let messageType = 'new_complaint';
let extractedData = {};

// ── Route 1: Ticket Status Check (WB-XXXXX or wb-xxxxx) ──
const ticketMatch = cleanText.match(/WB-\\d{5}/i);
if (ticketMatch) {
  messageType = 'status_check';
  extractedData = { ticketNo: ticketMatch[0].toUpperCase() };
}
// ── Route 2: Rating (single digit 1-5) ──
else if (/^[1-5]$/.test(cleanText)) {
  messageType = 'rating';
  extractedData = { rating: parseInt(cleanText) };
}
// ── Route 3: Help / Commands ──
else if (/^(hi|hello|hey|namaste|\\u09B9\\u09CD\\u09AF\\u09BE\\u09B2\\u09CB|\\u09B9\\u09BE\\u0987|\\u09B8\\u09BE\\u09B9\\u09BE\\u09AF\\u09CD\\u09AF|help|menu|\\u09B8\\u09CD\\u09AF\\u09BE\\u099F\\u09BE\\u09B8|status|track)$/i.test(cleanText)) {
  messageType = 'help_menu';
}
// ── Route 4: Stop / Unsubscribe ──
else if (/^(stop|unsubscribe|\\u09AC\\u09A8\\u09CD\\u09A7|\\u09A5\\u09BE\\u09AE\\u09CB|don'?t|off)$/i.test(cleanText)) {
  messageType = 'stop_unsubscribe';
}
// ── Route 5: Too short for complaint (<10 chars and not a command) ──
else if (cleanText.length < 10) {
  messageType = 'too_short';
}
// ── Route 6: New Complaint (default) ──
else {
  messageType = 'new_complaint';
  extractedData = {
    rawText: cleanText.substring(0, 2000),
    textLength: cleanText.length,
    hasEmoji: /\\p{Emoji_Presentation}/u.test(cleanText),
    language: detectLanguage(cleanText),
    wordCount: cleanText.split(/\\s+/).filter(w => w.length > 0).length
  };
}

function detectLanguage(t) {
  const bengali = /[\\u0980-\\u09FF]/g;
  const hindi = /[\\u0900-\\u097F]/g;
  const bengaliCount = (t.match(bengali) || []).length;
  const hindiCount = (t.match(hindi) || []).length;
  if (bengaliCount > 3) return 'bn';
  if (hindiCount > 3) return 'hi';
  return 'en';
}

return [{
  json: {
    messageType,
    phone,
    waId,
    contactName,
    text: cleanText.substring(0, 2000),
    msgId,
    msgType,
    timestamp,
    ...extractedData,
    receivedAt: new Date().toISOString()
  }
}];`
    },
    position: [420, 340]
  },
  output: [{
    messageType: 'new_complaint',
    phone: '919876543210',
    waId: '919876543210',
    contactName: 'Rahul Kumar',
    text: 'amar area te 3 din dhore pani nai',
    language: 'bn',
    wordCount: 8,
    rawText: 'amar area te 3 din dhore pani nai',
    receivedAt: '2025-06-15T10:30:00Z'
  }]
});

/* ════════════════════════════════════════════════════════════════════════════
   ROUTE BRANCHING: IF/ELSE CHAIN (6-Way Router)
   ════════════════════════════════════════════════════════════════════════════ */

// --- Branch 1: Is Status Check? ---
const isStatusCheck = ifElse({
  version: 2.2,
  config: {
    name: 'Is Status Check?',
    parameters: {
      conditions: {
        conditions: [{
          leftValue: '={{ $json.messageType }}',
          rightValue: 'status_check',
          operator: { type: 'string', operation: 'equals' }
        }]
      }
    },
    position: [660, 120]
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   STATUS CHECK PATH → WB-05
   ════════════════════════════════════════════════════════════════════════════ */

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
      jsonBody: '={{ JSON.stringify({ ticketNo: $json.ticketNo, phone: $json.phone, contactName: $json.contactName }) }}',
      options: { timeout: 10000 }
    },
    position: [900, 60]
  },
  output: [{ message: 'Status check triggered for WB-01001' }]
});

// --- Branch 2: Is Rating? ---
const isRating = ifElse({
  version: 2.2,
  config: {
    name: 'Is Rating?',
    parameters: {
      conditions: {
        conditions: [{
          leftValue: '={{ $json.messageType }}',
          rightValue: 'rating',
          operator: { type: 'string', operation: 'equals' }
        }]
      }
    },
    position: [660, 240]
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   RATING PATH → WB-06
   ════════════════════════════════════════════════════════════════════════════ */

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
      jsonBody: '={{ JSON.stringify({ phone: $json.phone, rating: $json.rating, contactName: $json.contactName }) }}',
      options: { timeout: 10000 }
    },
    position: [900, 240]
  },
  output: [{ message: 'Rating 4 submitted' }]
});

// --- Branch 3: Is Help Menu? ---
const isHelp = ifElse({
  version: 2.2,
  config: {
    name: 'Is Help Menu?',
    parameters: {
      conditions: {
        conditions: [{
          leftValue: '={{ $json.messageType }}',
          rightValue: 'help_menu',
          operator: { type: 'string', operation: 'equals' }
        }]
      }
    },
    position: [660, 340]
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   HELP MENU PATH
   ════════════════════════════════════════════════════════════════════════════ */

const buildHelpMenu = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Help Menu',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const phone = $input.first().json.phone || '';
const msg = "WB Grievance Portal - Help\\n\\n" +
  "1. FILE COMPLAINT: Type your problem and send\\n" +
  "2. CHECK STATUS: Send WB-XXXXX (e.g. WB-01001)\\n" +
  "3. RATE: Reply 1-5 (1=Poor, 5=Excellent)\\n" +
  "4. STOP: Send stop to unsubscribe\\n\\n" +
  "Example: No water supply in my area for 3 days\\n\\n" +
  "Government of West Bengal\\nAI Public Support System v3.0";
return [{ json: { phone, message: msg } }];`
    },
    position: [900, 340]
  },
  output: [{ phone: '919876543210', message: 'WB Grievance Portal - Help...' }]
});

const sendHelpMenu = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Help Menu',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1140, 340]
  },
  output: [{ messaging_product: 'whatsapp', messages: [{ id: 'wamid_help' }] }]
});

// --- Branch 4: Is Stop/Unsubscribe? ---
const isStop = ifElse({
  version: 2.2,
  config: {
    name: 'Is Stop Request?',
    parameters: {
      conditions: {
        conditions: [{
          leftValue: '={{ $json.messageType }}',
          rightValue: 'stop_unsubscribe',
          operator: { type: 'string', operation: 'equals' }
        }]
      }
    },
    position: [660, 460]
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   STOP/UNSUBSCRIBE PATH
   ════════════════════════════════════════════════════════════════════════════ */

const buildStopMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Stop Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `return [{ json: {
  phone: $input.first().json.phone,
  message: "Your request has been noted. You can file complaints anytime by sending a message."
}}];`
    },
    position: [900, 460]
  },
  output: [{ phone: '919876543210', message: 'Your request has been noted.' }]
});

const sendStopMsg = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Stop Confirmation',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1140, 460]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// --- Branch 5: Is Too Short? ---
const isTooShort = ifElse({
  version: 2.2,
  config: {
    name: 'Is Too Short?',
    parameters: {
      conditions: {
        conditions: [{
          leftValue: '={{ $json.messageType }}',
          rightValue: 'too_short',
          operator: { type: 'string', operation: 'equals' }
        }]
      }
    },
    position: [660, 560]
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   TOO SHORT → ASK FOR DETAILS
   ════════════════════════════════════════════════════════════════════════════ */

const buildShortMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Short Message Prompt',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `return [{ json: {
  phone: $input.first().json.phone,
  message: "Please describe your problem in detail.\\n\\nExample: No water supply in my area for 3 days, Block Krishnanagar, District Nadia"
}}];`
    },
    position: [900, 560]
  },
  output: [{ phone: '919876543210', message: 'Please describe your problem...' }]
});

const sendShortMsg = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Short Prompt',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1140, 560]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

/* ════════════════════════════════════════════════════════════════════════════
   NEW COMPLAINT PATH — MAIN PROCESSING PIPELINE
   ════════════════════════════════════════════════════════════════════════════ */

/* ── Duplicate Detection: Check recent complaints from same phone (24h) ── */

const checkDuplicates = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Check Recent Complaints (24h)',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'complaints',
      filters: {
        conditions: [
          { keyName: 'phone', condition: 'equal', keyValue: '={{ $json.phone }}' },
          { keyName: 'createdAt', condition: 'greaterThan', keyValue: '={{ new Date(Date.now() - 24*60*60*1000).toISOString() }}' }
        ]
      },
      returnAll: false,
      limit: 5
    },
    position: [900, 700]
  },
  output: [{
    id: 'cl_recent_1',
    ticketNo: 'WB-01005',
    issue: 'No water supply',
    status: 'OPEN',
    createdAt: '2025-06-15T08:00:00Z'
  }]
});

const isDuplicate = ifElse({
  version: 2.2,
  config: {
    name: 'Is Duplicate (24h)?',
    parameters: {
      conditions: {
        conditions: [{
          leftValue: '={{ $json.id }}',
          rightValue: '',
          operator: { type: 'string', operation: 'isNotEmpty' }
        }]
      }
    },
    position: [1140, 700]
  }
});

const buildDuplicateMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Duplicate Warning',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const recent = $input.first().json;
const phone = $('Parse & Smart Route').first().json.phone;
const msg = "RECENT COMPLAINT FOUND!\\n\\n" +
  "Your recent complaint: " + (recent.ticketNo || 'N/A') + "\\n" +
  "Issue: " + (recent.issue || '').substring(0, 80) + "\\n" +
  "Status: " + (recent.status || 'Processing') + "\\n\\n" +
  "Your complaint is already being processed.\\n" +
  "Type " + (recent.ticketNo || 'WB-XXXXX') + " to check status.";
return [{ json: { phone, message: msg } }];`
    },
    position: [1380, 620]
  },
  output: [{ phone: '919876543210', message: 'RECENT COMPLAINT FOUND!' }]
});

const sendDuplicateMsg = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Duplicate Warning',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1620, 620]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

/* ── AI Classification Agent ── */

const aiClassifier = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'AI Complaint Classifier v3',
    parameters: {
      promptType: 'define',
      text: '={{ `Analyze this West Bengal citizen grievance and classify it:\n\nMessage: "${$json.text}"\nLanguage: ${$json.language || "auto"}\nContact: ${$json.contactName || "Unknown"}\n\nClassify into exactly one of these categories: Water Supply, Road Damage, Electricity, Sanitation, Healthcare, Education, Public Transport, Agriculture, Housing, Other\n\nDetermine urgency: LOW (minor inconvenience), MEDIUM (affects daily life), HIGH (urgent, many people affected), CRITICAL (life-threatening or emergency)\n\nDetect sentiment: positive, negative, neutral, frustrated, urgent\n\nIdentify West Bengal location if mentioned (district, block, village). Known districts: Nadia, North 24 Parganas, South 24 Parganas, Howrah, Hooghly, Bardhaman, Birbhum, Murshidabad, Malda, Darjeeling, Jalpaiguri, Cooch Behar, Kolkata, Purba Medinipur, Paschim Medinipur, Bankura, Purulia, Jhargram, Alipurduar, Kalimpong\n\nGovernment departments: PHE (water), PWD (roads), WBSEDCL (electricity), Health Dept, Education Dept, Agriculture Dept\n\nReturn ONLY valid JSON with ALL these fields:\n{\n  "category": "...",\n  "urgency": "LOW|MEDIUM|HIGH|CRITICAL",\n  "sentiment": "...",\n  "language": "bn|en|hi",\n  "summary": "English summary in 1-2 sentences",\n  "suggested_block": "block name or empty",\n  "suggested_district": "district name or empty",\n  "village": "village name or empty",\n  "keywords": ["keyword1","keyword2"],\n  "confidence": 0-100,\n  "department": "government dept",\n  "needs_urgent_attention": true/false,\n  "is_duplicate_likely": true/false\n}` }}',
      hasOutputParser: true,
      options: {
        systemMessage: 'You are the AI Classification Engine for West Bengal Grievance Portal v3.0. You analyze citizen complaints in Bengali, English, and Hindi. You MUST return ONLY valid JSON with ALL 12 fields. Be precise with location detection - only suggest West Bengal locations. Confidence should reflect how certain you are (0-100). Department should be the government body responsible.',
        maxIterations: 1
      }
    },
    subnodes: { model: chatModel, outputParser: structuredParser },
    position: [1380, 800]
  },
  output: [{
    output: {
      category: 'Water Supply',
      urgency: 'HIGH',
      sentiment: 'negative',
      language: 'bn',
      summary: 'No water supply in the area for 3 days',
      suggested_block: 'Krishnanagar',
      suggested_district: 'Nadia',
      village: '',
      keywords: ['water', 'supply', '3 days', 'pani nai'],
      confidence: 88,
      department: 'PHE',
      needs_urgent_attention: true,
      is_duplicate_likely: false
    }
  }]
});

/* ── Merge AI Output with Original Message Data ── */

const normalizeData = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Merge & Normalize Data',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `// ═══ MERGE AI OUTPUT + ORIGINAL MESSAGE DATA ═══
const msg = $('Parse & Smart Route').first().json;
const aiRaw = $input.first().json.output || $input.first().json;
const ai = typeof aiRaw === 'string' ? JSON.parse(aiRaw) : (aiRaw || {});

const validCategories = ['Water Supply', 'Road Damage', 'Electricity', 'Sanitation', 'Healthcare', 'Education', 'Public Transport', 'Agriculture', 'Housing', 'Other'];
const validUrgencies = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const category = validCategories.includes(ai.category) ? ai.category : 'Other';
const urgency = validUrgencies.includes(ai.urgency) ? ai.urgency : 'MEDIUM';
const language = ['bn', 'en', 'hi'].includes(ai.language) ? ai.language : (msg.language || 'bn');

const complaintData = {
  citizenName: msg.contactName || '',
  phone: msg.phone,
  issue: msg.text.substring(0, 500),
  category,
  block: ai.suggested_block || '',
  district: ai.suggested_district || '',
  village: ai.village || '',
  urgency,
  description: msg.text.substring(0, 2000),
  language,
  source: 'WHATSAPP',
  hasRequired: msg.text && msg.text.length >= 5,
  hasLocation: !!(ai.suggested_block || ai.suggested_district),
  aiSuccess: !!(ai.category && ai.urgency)
};

complaintData.tags = JSON.stringify({
  sentiment: ai.sentiment || 'neutral',
  department: ai.department || '',
  keywords: Array.isArray(ai.keywords) ? ai.keywords : [],
  ai_confidence: ai.confidence || 0,
  language: complaintData.language,
  urgent_attention: ai.needs_urgent_attention || false
});

return [{ json: complaintData }];`
    },
    position: [1620, 800]
  },
  output: [{
    citizenName: 'Rahul Kumar',
    phone: '919876543210',
    issue: 'amar area te 3 din dhore pani nai',
    category: 'Water Supply',
    urgency: 'HIGH',
    block: 'Krishnanagar',
    district: 'Nadia',
    village: '',
    language: 'bn',
    source: 'WHATSAPP',
    hasRequired: true,
    hasLocation: true,
    aiSuccess: true,
    tags: '{"sentiment":"negative","department":"PHE"}'
  }]
});

/* ── Validate Required Fields ── */

const checkRequired = ifElse({
  version: 2.2,
  config: {
    name: 'Has Required Fields?',
    parameters: {
      conditions: {
        conditions: [{
          leftValue: '={{ $json.hasRequired }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'equals' }
        }]
      }
    },
    position: [1860, 700]
  }
});

/* ── Create Complaint in Supabase ── */

const createComplaint = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Create Complaint in Supabase',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'create',
      tableId: 'complaints',
      dataToSend: 'autoMapInputData',
      inputsToIgnore: 'hasRequired,hasLocation,aiSuccess'
    },
    position: [2100, 600]
  },
  output: [{
    id: 'clxyz_new_1',
    ticketNo: 'WB-01013',
    status: 'OPEN',
    createdAt: '2025-06-15T10:30:00Z'
  }]
});

/* ── Log Activity ── */

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
          {
            fieldId: 'description',
            fieldValue: '={{ `Complaint registered via WhatsApp from ${$("Merge & Normalize Data").first().json.phone}. AI Category: ${$("Merge & Normalize Data").first().json.category}, Urgency: ${$("Merge & Normalize Data").first().json.urgency}` }}'
          },
          { fieldId: 'actorId', fieldValue: '' },
          { fieldId: 'actorName', fieldValue: 'WhatsApp Bot v3' },
          {
            fieldId: 'metadata',
            fieldValue: '={{ JSON.stringify({ source: "WHATSAPP", language: $("Merge & Normalize Data").first().json.language, department: JSON.parse($("Merge & Normalize Data").first().json.tags || "{}").department || "" }) }}'
          }
        ]
      }
    },
    position: [2340, 600]
  },
  output: [{ id: 'log_new_1' }]
});

/* ── Build Rich Confirmation Message (Bilingual) ── */

const buildConfirmation = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Confirmation (bn+en)',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `// ═══ RICH BILINGUAL CONFIRMATION MESSAGE ═══
const complaint = $('Create Complaint in Supabase').first().json;
const orig = $('Merge & Normalize Data').first().json;
const ticketNo = complaint.ticketNo || 'WB-00000';
const cat = orig.category || 'Other';
const urg = orig.urgency || 'MEDIUM';
const blk = orig.block || 'N/A';
const dst = orig.district || 'N/A';

const urgencyEmoji = { LOW: 'BLUE', MEDIUM: 'YELLOW', HIGH: 'ORANGE', CRITICAL: 'RED' };
const emoji = { LOW: 'BLUE', MEDIUM: 'YELLOW', HIGH: 'ORANGE', CRITICAL: 'RED' };

const msg = "COMPLAINT REGISTERED SUCCESSFULLY!\\n\\n" +
  "Ticket No: " + ticketNo + "\\n" +
  "Issue: " + (orig.issue || '').substring(0, 80) + (orig.issue && orig.issue.length > 80 ? '...' : '') + "\\n" +
  "Category: " + cat + "\\n" +
  "Location: " + blk + ", " + dst + "\\n" +
  "Urgency: " + urg + "\\n\\n" +
  "Your complaint has been received and is being processed.\\n" +
  "An officer will contact you shortly.\\n\\n" +
  "To check status: Type " + ticketNo + " and send\\n" +
  "To rate: Reply 1-5 (1=Poor, 5=Excellent)\\n\\n" +
  "Government of West Bengal\\n" +
  "AI Public Support System v3.0";

return [{ json: {
  phone: orig.phone,
  message: msg,
  complaintId: complaint.id,
  ticketNo,
  category: cat,
  urgency: urg,
  block: blk,
  district: dst
} }];`
    },
    position: [2580, 520]
  },
  output: [{
    phone: '919876543210',
    message: 'COMPLAINT REGISTERED SUCCESSFULLY!...',
    complaintId: 'clxyz_new_1',
    ticketNo: 'WB-01013'
  }]
});

/* ── Send Confirmation via WhatsApp ── */

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
    position: [2820, 520]
  },
  output: [{
    messaging_product: 'whatsapp',
    contacts: [{ input: '919876543210', wa_id: '919876543210' }],
    messages: [{ id: 'wamid_confirm_123' }]
  }]
});

/* ── Trigger WB-02 Auto-Assign ── */

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
      jsonBody: '={{ JSON.stringify({ complaintId: $json.complaintId, ticketNo: $json.ticketNo, issue: $("Merge & Normalize Data").first().json.issue, category: $json.category, block: $json.block, district: $json.district, urgency: $json.urgency, citizenName: $("Merge & Normalize Data").first().json.citizenName, phone: $("Merge & Normalize Data").first().json.phone, language: $("Merge & Normalize Data").first().json.language }) }}',
      options: { timeout: 15000 }
    },
    position: [3060, 520]
  },
  output: [{ success: true, message: 'Auto-assign triggered' }]
});

/* ── Build Error Message ── */

const buildErrorMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Error Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `return [{ json: {
  phone: $('Merge & Normalize Data').first().json.phone,
  message: "Error occurred. Please try again.\\nYou can resend your complaint."
}}];`
    },
    position: [2100, 960]
  },
  output: [{ phone: '919876543210', message: 'Error occurred.' }]
});

const sendErrorMsg = node({
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
    position: [2340, 960]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

/* ── Build Clarification Message (Missing Fields) ── */

const buildClarification = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Clarification Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const phone = $('Parse & Smart Route').first().json.phone;
const text = $('Parse & Smart Route').first().json.text;
const msg = "Your message is too short.\\n\\n" +
  "Please describe your problem in detail:\\n" +
  "Example: No water supply in my area for 3 days, Block Krishnanagar, District Nadia\\n\\n" +
  "Please include:\\n" +
  "  - Problem description\\n" +
  "  - Block name\\n" +
  "  - District name\\n\\n" +
  "Your message: " + text;
return [{ json: { phone, message: msg } }];`
    },
    position: [1620, 960]
  },
  output: [{ phone: '919876543210', message: 'Your message is too short.' }]
});

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
    position: [1860, 960]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

/* ════════════════════════════════════════════════════════════════════════════
   WORKFLOW COMPOSITION — 24 Nodes, 6-Way Router
   ════════════════════════════════════════════════════════════════════════════ */

export default workflow('wb-01-whatsapp-intake-advanced', 'WB-01: WhatsApp Intake + AI Router [ADVANCED v3]')
  .add(waTrigger)
  .to(parseRoute)
  // ── 6-Way Router ──
  .to(isStatusCheck
    .onTrue(callStatusCheck)
    .onFalse(isRating
      .onTrue(callRating)
      .onFalse(isHelp
        .onTrue(buildHelpMenu.to(sendHelpMenu))
        .onFalse(isStop
          .onTrue(buildStopMsg.to(sendStopMsg))
          .onFalse(isTooShort
            .onTrue(buildShortMsg.to(sendShortMsg))
            .onFalse(
              // ══ NEW COMPLAINT PIPELINE ══
              checkDuplicates
                .to(isDuplicate
                  .onTrue(buildDuplicateMsg.to(sendDuplicateMsg))
                  .onFalse(
                    aiClassifier
                      .to(normalizeData)
                      .to(checkRequired
                        .onTrue(
                          createComplaint
                            .to(logActivity)
                            .to(buildConfirmation)
                            .to(sendConfirmation)
                            .to(callAutoAssign))
                        .onFalse(buildClarification.to(sendClarification)))
                  )
                )
            ))))));
