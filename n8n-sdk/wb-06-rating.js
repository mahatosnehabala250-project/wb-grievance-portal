import { workflow, node, trigger, expr, newCredential, sticky } from '@n8n/workflow-sdk';

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Rating Webhook',
    parameters: {
      httpMethod: 'POST',
      path: 'wb-rate',
      responseMode: 'lastNode'
    },
    position: [240, 300]
  },
  output: [{ body: { phone: '919876543210', rating: 4 } }]
});

sticky({ position: [100, 100], content: 'WB-06: Citizen replies 1-5 → validate → find resolved complaint → update rating → thank you' });

const validateRating = node({
  type: 'n8n-nodes-base.if',
  version: 2.2,
  config: {
    name: 'Valid Rating (1-5)?',
    parameters: {
      conditions: {
        combinator: 'and',
        conditions: [{
          leftValue: '={{ $json.body.rating }}',
          rightValue: '1',
          operator: { type: 'number', operation: 'gte' }
        }, {
          leftValue: '={{ $json.body.rating }}',
          rightValue: '5',
          operator: { type: 'number', operation: 'lte' }
        }]
      }
    },
    position: [480, 300]
  },
  output: [{ rating: 4 }]
});

const invalidMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Invalid Rating Message',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `return [{ json: { message: '❌ অবৈধ রেটিং\\nInvalid rating.\\n\\nঅনুগ্রহ করে 1 থেকে 5 এর মধ্যে একটি সংখ্যা দিন।\\nPlease reply with a number between 1 and 5.' } }];`
    },
    position: [480, 480]
  },
  output: [{ message: '❌ অবৈধ রেটিং' }]
});

const findResolved = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Find Resolved Complaint',
    parameters: {
      method: 'GET',
      url: '={{ `https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/complaints?phone=eq.${$json.body.phone}&status=eq.RESOLVED&satisfactionRating=is.null&order=createdAt.desc&limit=1&select=id,ticketNo,phone,issue` }}',
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
  output: [{ id: 'c1', ticketNo: 'WB-01001', phone: '919876543210', issue: 'No water supply' }]
});

const checkComplaint = node({
  type: 'n8n-nodes-base.if',
  version: 2.2,
  config: {
    name: 'Resolved Found?',
    parameters: {
      conditions: {
        conditions: [{ leftValue: '={{ $json.id }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty' } }]
      }
    },
    position: [960, 200]
  },
  output: [{ found: true }]
});

const updateRating = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Update Rating in DB',
    parameters: {
      method: 'PATCH',
      url: '={{ `https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/complaints?id=eq.${$json.id}` }}',
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
      jsonBody: '={{ JSON.stringify({ satisfactionRating: $('Rating Webhook').first().json.body.rating }) }}'
    },
    position: [1200, 120]
  },
  output: [{ id: 'c1', ticketNo: 'WB-01001', satisfactionRating: 4 }]
});

const thankYouMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Thank You',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const r = $('Rating Webhook').first().json.body.rating;
const t = $input.first().json.ticketNo || 'N/A';
return [{ json: { phone: $input.first().json.phone, message: \`🙏 ধন্যবাদ! Thank You!\\n\\nআপনার \${t} টিকেটের জন্য ⭐ \${r}/5 রেটিং পেয়েছি।\\nWe received your ⭐ \${r}/5 rating for ticket \${t}.\\n\\nআপনার মতামত আমাদের সেবা উন্নত করতে সাহায্য করে।\\nYour feedback helps us improve.\` } }];`
    },
    position: [1440, 120]
  },
  output: [{ phone: '919876543210', message: '🙏 ধন্যবাদ! ⭐ 4/5' }]
});

const noResolvedMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'No Resolved Complaint',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `return [{ json: { message: 'ℹ️ কোনো সমাধান হওয়া অভিযোগ পাওয়া যায়নি\\nNo resolved complaint found for rating.\\n\\nআপনার অভিযোগ এখনও চলমান অবস্থায় আছে।' } }];`
    },
    position: [1200, 320]
  },
  output: [{ message: 'ℹ️ No resolved complaint found' }]
});

export default workflow('wb-06-rating', 'WB-06: Rating Collection')
  .add(webhook)
  .to(validateRating
    .onTrue(findResolved
      .to(checkComplaint
        .onTrue(updateRating.to(thankYouMsg))
        .onFalse(noResolvedMsg)))
    .onFalse(invalidMsg));
