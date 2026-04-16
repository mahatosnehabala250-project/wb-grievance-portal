import { workflow, node, trigger, newCredential, ifElse, sticky } from '@n8n/workflow-sdk';

// ===== WEBHOOK TRIGGER =====
const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Rating Webhook',
    parameters: { httpMethod: 'POST', path: 'wb-rate', responseMode: 'lastNode' },
    position: [240, 300]
  },
  output: [{ body: { phone: '919876543210', rating: 4 } }]
});

sticky({ position: [100, 80], content: 'WB-06: Citizen replies 1-5 → find resolved complaint → update rating in Supabase → thank you via WhatsApp Send\nUses: Supabase Node + WhatsApp Send Node' });

// ===== CODE: VALIDATE RATING =====
const validateRating = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Rating',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const body = $input.first().json.body;
const rating = parseInt(body.rating);
const phone = body.phone;
const isValid = !isNaN(rating) && rating >= 1 && rating <= 5;
return [{ json: { phone, rating, isValid } }];`
    },
    position: [480, 300]
  },
  output: [{ phone: '919876543210', rating: 4, isValid: true }]
});

// ===== IF: VALID =====
const checkValid = ifElse({
  version: 2.2,
  config: {
    name: 'Rating Valid?',
    parameters: {
      conditions: { conditions: [{ leftValue: '={{ $json.isValid }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }] }
    },
    position: [720, 300]
  }
});

// ===== SUPABASE: FIND RESOLVED COMPLAINT =====
const findResolved = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Find Resolved Complaint',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'complaints',
      returnAll: true,
      limit: 1,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: {
        conditions: [
          { keyName: 'phone', condition: 'eq', keyValue: '={{ $json.phone }}' },
          { keyName: 'status', condition: 'eq', keyValue: 'RESOLVED' }
        ]
      }
    },
    position: [960, 200]
  },
  output: [{ id: 'clxyz1', ticketNo: 'WB-01001', phone: '919876543210' }]
});

// ===== SUPABASE: UPDATE RATING =====
const updateRating = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Update Satisfaction Rating',
    credentials: { supabaseApi: newCredential('Supabase') },
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'complaints',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: {
        conditions: [{ keyName: 'id', condition: 'eq', keyValue: '={{ $json.id }}' }]
      },
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'satisfactionRating', fieldValue: '={{ $("Validate Rating").first().json.rating }}' }
        ]
      }
    },
    position: [1200, 200]
  },
  output: [{ id: 'clxyz1' }]
});

// ===== CODE: THANK YOU =====
const buildThankYou = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Thank You Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const rating = $('Validate Rating').first().json.rating;
const complaint = $('Find Resolved Complaint').first().json;
const phone = complaint.phone || $('Validate Rating').first().json.phone;
const stars = '⭐'.repeat(rating);
const msg = \`🙏 ধন্যবাদ! Thank you for your feedback!\n\n\${stars} \${rating}/5 Rating Received\n🎫 টিকেট: \${complaint.ticketNo || 'N/A'}\n\nআপনার মতামত আমাদের সেবা উন্নত করতে সাহায্য করবে।\`;
return [{ json: { phone, message: msg } }];`
    },
    position: [1440, 200]
  },
  output: [{ phone: '919876543210', message: '🙏 ধন্যবাদ! ⭐⭐⭐⭐ 4/5' }]
});

// ===== WHATSAPP SEND: THANK YOU =====
const sendThankYou = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Thank You',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1680, 200]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== CODE: INVALID RATING =====
const buildInvalid = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Invalid Rating Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const phone = $('Validate Rating').first().json.phone;
return [{ json: { phone, message: '❌ অবৈধ রেটিং। অনুগ্রহ করে 1 থেকে 5 এর মধ্যে একটি সংখ্যা পাঠান।\\nInvalid rating. Please send a number between 1 and 5.' } }];`
    },
    position: [960, 420]
  },
  output: [{ phone: '919876543210', message: '❌ অবৈধ রেটিং' }]
});

// ===== WHATSAPP SEND: INVALID =====
const sendInvalid = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Invalid Rating',
    credentials: { whatsAppApi: newCredential('WhatsApp Business Cloud') },
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: '=1125704830617135',
      recipientPhoneNumber: '={{ $json.phone }}',
      messageType: 'text',
      textBody: '={{ $json.message }}'
    },
    position: [1200, 420]
  },
  output: [{ messaging_product: 'whatsapp' }]
});

// ===== WORKFLOW =====
export default workflow('wb-06-rating', 'WB-06: Rating Collection')
  .add(webhook)
  .to(validateRating)
  .to(checkValid
    .onTrue(findResolved
      .to(updateRating
        .to(buildThankYou
          .to(sendThankYou))))
    .onFalse(buildInvalid
      .to(sendInvalid)));
