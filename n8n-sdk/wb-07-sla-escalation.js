import { workflow, node, trigger, newCredential, sticky, splitInBatches, nextBatch } from '@n8n/workflow-sdk';

const schedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Every 2 Hours',
    parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 2 }] } }
  },
  output: [{}]
});

sticky({ position: [100, 100], content: 'WB-07: Every 2 hours → check SLA breaches → escalate → notify admins' });

const getBreached = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Get SLA Breached Complaints',
    parameters: {
      method: 'GET',
      url: 'https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/sla_at_risk?select=id,ticketNo,urgency,createdAt,phone,assignedToId,block,district,pct',
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
  output: [{ id: 'c1', ticketNo: 'WB-01001', urgency: 'HIGH', phone: '919876543210' }]
});

const checkBreached = node({
  type: 'n8n-nodes-base.if',
  version: 2.2,
  config: {
    name: 'Has Breaches?',
    parameters: {
      conditions: {
        conditions: [{ leftValue: '={{ $json.id }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty' } }]
      }
    },
    position: [720, 300]
  },
  output: [{ hasBreaches: true }]
});

const buildPayload = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Escalation Payload',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const items = $input.all().map(i => i.json);
const escalationMap = { LOW: 'HIGH', MEDIUM: 'HIGH', HIGH: 'CRITICAL', CRITICAL: null };
const complaints = items.map(c => {
  const newUrgency = escalationMap[c.urgency];
  return { id: c.id, riskLevel: c.urgency?.toLowerCase() || 'medium', newUrgency };
}).filter(c => c.newUrgency !== null);
const now = new Date().toISOString();
return [{ json: { complaints, report: \`SLA Breach Report — \${now}: \${complaints.length} complaints breached\`, total: complaints.length } }];`
    },
    position: [960, 200]
  },
  output: [{ complaints: [{ id: 'c1', riskLevel: 'high', newUrgency: 'CRITICAL' }], total: 1 }]
});

const escalate = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'POST Escalate-Batch API',
    parameters: {
      method: 'POST',
      url: 'https://sxdtipaspfolrpqrwadt.supabase.co/rest/v1/rpc/escalate_breach',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'apikey', value: '{{ $env.SUPABASE_SERVICE_ROLE_KEY }}' },
          { name: 'Authorization', value: 'Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}' },
          { name: 'Content-Type', value: 'application/json' }
        ]
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json) }}'
    },
    position: [1200, 200]
  },
  output: [{ success: true }]
});

const formatReport = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Admin Report',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const data = $input.first().json;
const items = data.complaints || [];
const ticketList = items.map(c => \`  🎫 \${c.id?.substring(0,8)} — \${c.riskLevel}\`).join('\\n');
const msg = \`⚠️ SLA Breach Report\\n📅 \${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\\n\\n📊 \${data.total} complaints breached:\\n\${ticketList || '  None'}\\n\\nEscalation initiated automatically.\`;
return [{ json: { message: msg } }];`
    },
    position: [1440, 200]
  },
  output: [{ message: '⚠️ SLA Breach Report\n📊 1 complaints breached' }]
});

export default workflow('wb-07-sla-escalation', 'WB-07: SLA Breach Escalation')
  .add(schedule)
  .to(getBreached)
  .to(checkBreached
    .onTrue(buildPayload.to(escalate.to(formatReport))));
