'use client';

import { useState } from 'react';
import {
  GitBranch, Webhook, Clock, Zap, AlertTriangle, Mail, Smartphone,
  Copy, CheckCircle, Download, ChevronRight, Shield, Info,
  Workflow, ArrowRight, FileJson, Terminal, Play, Link,
  Timer, Bell, RefreshCw, Send, Database, BarChart2, Users,
  CheckCircle2, Eye, Code, Rocket, Settings, Globe, Layers,
  Hash, Tag, MessageSquare, Loader2, CircleCheck, XCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/auth-store';
import { motion } from 'framer-motion';
import { NAVY, NAVY_DARK } from '@/lib/constants';
import { authHeaders, safeGetLocalStorage } from '@/lib/helpers';

/* ══════════════════════════════════════════════════════════════
   ANIMATION VARIANTS
   ══════════════════════════════════════════════════════════════ */
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' as const } },
};

/* ══════════════════════════════════════════════════════════════
   WORKFLOW JSON DEFINITIONS
   ══════════════════════════════════════════════════════════════ */

const WORKFLOW_WHATSAPP = {
  name: 'WhatsApp Complaint Intake',
  nodes: [
    {
      parameters: { httpMethod: 'POST', path: 'incoming-whatsapp', responseMode: 'responseNode', responseData: 'allEntries' },
      name: 'WhatsApp Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [250, 300],
      credentials: {},
      webhookId: 'whatsapp-intake-trigger',
    },
    {
      parameters: {
        jsCode: `// Parse incoming WhatsApp message\nconst msg = $input.first().json.body;\nconst complaint = {\n  citizenName: msg.profileName || msg.sender_name || 'WhatsApp User',\n  phone: msg.sender || msg.phone_number || '',\n  issue: msg.message || msg.text || 'No message provided',\n  category: guessCategory(msg.message),\n  block: msg.block || 'Unknown',\n  district: msg.district || 'Unknown',\n  urgency: 'MEDIUM',\n  source: 'WhatsApp',\n  description: msg.message || ''\n};\n\nfunction guessCategory(text) {\n  const t = (text || '').toLowerCase();\n  if (/water|পানি|jal/.test(t)) return 'Water Supply';\n  if (/road|সড়ক|রাস্তা/.test(t)) return 'Road Damage';\n  if (/electric|বিদ্যুৎ|light/.test(t)) return 'Electricity';\n  if (/sanitation|পয়ঃনিষ্কাশন/.test(t)) return 'Sanitation';\n  if (/health|স্বাস্থ্য|হাসপাতাল/.test(t)) return 'Healthcare';\n  if (/school|শিক্ষা/.test(t)) return 'Education';\n  return 'Other';\n}\n\nreturn [{ json: complaint }];`,
      },
      name: 'Parse & Categorize',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [470, 300],
    },
    {
      parameters: {
        url: '={{ $env.WB_PORTAL_URL }}/api/webhook/complaint',
        method: 'POST',
        sendBody: true,
        contentType: 'json',
        bodyParameters: {
          parameters: [
            { name: 'citizenName', value: '={{ $json.citizenName }}' },
            { name: 'phone', value: '={{ $json.phone }}' },
            { name: 'issue', value: '={{ $json.issue }}' },
            { name: 'category', value: '={{ $json.category }}' },
            { name: 'block', value: '={{ $json.block }}' },
            { name: 'district', value: '={{ $json.district }}' },
            { name: 'urgency', value: '={{ $json.urgency }}' },
            { name: 'source', value: '={{ $json.source }}' },
            { name: 'description', value: '={{ $json.description }}' },
          ],
        },
        options: { timeout: 10000 },
      },
      name: 'POST to Portal API',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [690, 300],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ JSON.stringify({ success: true, message: "Complaint received" }) }}',
        responseCode: 200,
      },
      name: 'Respond to Webhook',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [910, 300],
    },
    {
      parameters: {
        jsCode: `const resp = $input.first().json;\nconst ticket = resp.ticketNo || 'N/A';\nconst msg = \`✅ আপনার অভিযোগ নিবন্ধিত হয়েছে!\\n🎫 টিকেট: \${ticket}\\nআমরা শীঘ্রই এটি পর্যালোচনা করব।\\n— WB Grievance Portal\`;\nreturn [{ json: { message: msg, phone: resp.phone } }];`,
      },
      name: 'Build Confirmation',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1130, 300],
    },
    {
      parameters: {
        phoneNumberId: '={{ $env.WA_PHONE_NUMBER_ID }}',
        recipientPhoneNumber: '={{ $json.phone }}',
        text: '={{ $json.message }}',
      },
      name: 'Send WhatsApp Reply',
      type: 'n8n-nodes-base.whatsApp',
      typeVersion: 1.1,
      position: [1350, 300],
    },
  ],
  connections: {
    'WhatsApp Webhook': { main: [[{ node: 'Parse & Categorize', type: 'main', index: 0 }]] },
    'Parse & Categorize': { main: [[{ node: 'POST to Portal API', type: 'main', index: 0 }]] },
    'POST to Portal API': { main: [[{ node: 'Respond to Webhook', type: 'main', index: 0 }, { node: 'Build Confirmation', type: 'main', index: 0 }]] },
    'Build Confirmation': { main: [[{ node: 'Send WhatsApp Reply', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner', errorWorkflow: 'Error Handler' },
  meta: { instanceId: 'wb-grievance-portal' },
  tags: [{ name: 'WhatsApp' }, { name: 'Complaint' }, { name: 'Auto-Reply' }],
};

const WORKFLOW_AUTO_ASSIGN = {
  name: 'Auto-Assignment Engine',
  nodes: [
    {
      parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } },
      name: 'Every 5 Minutes',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [250, 300],
    },
    {
      parameters: {
        url: '={{ $env.WB_PORTAL_URL }}/api/complaints?status=OPEN&assignedToId=null&page=1&limit=50',
        method: 'GET',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'Authorization', value: 'Bearer {{ $env.WB_API_TOKEN }}' }],
        },
        options: { timeout: 10000 },
      },
      name: 'Fetch Unassigned',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [470, 300],
    },
    {
      parameters: {
        jsCode: `// Match each complaint to an officer by block/district\nconst complaints = $('Fetch Unassigned').all();\nconst results = [];\n\nconst officerPool = [\n  { block: 'Krishnanagar-I', district: 'Nadia', officerId: 'blk-001' },\n  { block: 'Krishnanagar-II', district: 'Nadia', officerId: 'blk-002' },\n  { block: 'Kalyani', district: 'Nadia', officerId: 'blk-003' },\n];\n\nfor (const item of complaints) {\n  const c = item.json;\n  const match = officerPool.find(o => o.block === c.block);\n  if (match) {\n    results.push({ json: { id: c.id, assignedToId: match.officerId, block: c.block } });\n  }\n}\n\nif (results.length === 0) {\n  return [{ json: { message: 'No matching officers found', count: 0 } }];\n}\nreturn results;`,
      },
      name: 'Match by Block/District',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [690, 300],
    },
    {
      parameters: {
        method: 'PATCH',
        url: '={{ $env.WB_PORTAL_URL }}/api/complaints/{{ $json.id }}',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'Authorization', value: 'Bearer {{ $env.WB_API_TOKEN }}' }],
        },
        sendBody: true,
        contentType: 'json',
        bodyParameters: {
          parameters: [{ name: 'assignedToId', value: '={{ $json.assignedToId }}' }],
        },
        options: { timeout: 10000 },
      },
      name: 'Assign to Officer',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [910, 300],
    },
  ],
  connections: {
    'Every 5 Minutes': { main: [[{ node: 'Fetch Unassigned', type: 'main', index: 0 }]] },
    'Fetch Unassigned': { main: [[{ node: 'Match by Block/District', type: 'main', index: 0 }]] },
    'Match by Block/District': { main: [[{ node: 'Assign to Officer', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', saveManualExecutions: true, errorWorkflow: 'Error Handler' },
  meta: { instanceId: 'wb-grievance-portal' },
  tags: [{ name: 'Automation' }, { name: 'Assignment' }, { name: 'Cron' }],
};

const WORKFLOW_SLA_BREACH = {
  name: 'SLA Breach Escalation',
  nodes: [
    {
      parameters: { rule: { interval: [{ field: 'cron', minute: '0', hour: '9' }] } },
      name: 'Daily at 9 AM',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [250, 300],
    },
    {
      parameters: {
        url: '={{ $env.WB_PORTAL_URL }}/api/complaints?status=OPEN,IN_PROGRESS&page=1&limit=200',
        method: 'GET',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'Authorization', value: 'Bearer {{ $env.WB_API_TOKEN }}' }],
        },
        options: { timeout: 15000 },
      },
      name: 'Fetch Open Complaints',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [470, 300],
    },
    {
      parameters: {
        jsCode: `// Find complaints open > 7 days (SLA breached)\nconst sevenDaysAgo = new Date();\nsevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);\nconst complaints = $('Fetch Open Complaints').all();\nconst breached = complaints.filter(c => {\n  const created = new Date(c.json.createdAt);\n  return created < sevenDaysAgo;\n});\n\nif (breached.length === 0) {\n  return [{ json: { message: 'No SLA breaches found', count: 0 } }];\n}\n\nreturn breached.map(c => ({\n  json: {\n    id: c.json.id,\n    ticketNo: c.json.ticketNo,\n    issue: c.json.issue,\n    district: c.json.district,\n    urgency: c.json.urgency,\n    daysOpen: Math.floor((Date.now() - new Date(c.json.createdAt).getTime()) / 86400000),\n    citizenName: c.json.citizenName,\n    phone: c.json.phone,\n  }\n}));`,
      },
      name: 'Filter SLA Breached',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [690, 300],
    },
    {
      parameters: {
        method: 'PATCH',
        url: '={{ $env.WB_PORTAL_URL }}/api/complaints/{{ $json.id }}/escalate',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'Authorization', value: 'Bearer {{ $env.WB_API_TOKEN }}' }],
        },
        options: { timeout: 10000 },
      },
      name: 'Escalate Urgency',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [910, 200],
    },
    {
      parameters: {
        jsCode: `// Build escalation email\nconst items = $('Filter SLA Breached').all();\nconst body = \`<h2>🚨 SLA Breach Escalation Report</h2>\n<p>The following complaints have exceeded the 7-day SLA:</p>\n<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse">\n<tr style="background:#0A2463;color:white"><th>Ticket</th><th>Issue</th><th>District</th><th>Days Open</th><th>Urgency</th></tr>\n\${items.map(i => \`\${i.json.ticketNo}\${i.json.issue}\${i.json.district}\${i.json.daysOpen}\${i.json.urgency}\`).join('')}\n</table>\n<p style="color:#666;font-size:12px">Generated by n8n Workflow — WB Grievance Portal</p>\`;\nreturn [{ json: { subject: \`[ESCALATION] \${items.length} SLA Breaches Detected - \${new Date().toLocaleDateString('en-IN')}\`, html: body } }];`,
      },
      name: 'Format Email Report',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [910, 420],
    },
    {
      parameters: {
        fromEmail: 'noreply@wb-grievance.gov.in',
        toEmail: '={{ $env.DISTRICT_ADMIN_EMAIL }}',
        subject: '={{ $json.subject }}',
        html: '={{ $json.html }}',
        options: {},
      },
      name: 'Send Email Alert',
      type: 'n8n-nodes-base.emailSend',
      typeVersion: 2.1,
      position: [1130, 420],
    },
  ],
  connections: {
    'Daily at 9 AM': { main: [[{ node: 'Fetch Open Complaints', type: 'main', index: 0 }]] },
    'Fetch Open Complaints': { main: [[{ node: 'Filter SLA Breached', type: 'main', index: 0 }]] },
    'Filter SLA Breached': { main: [[{ node: 'Escalate Urgency', type: 'main', index: 0 }, { node: 'Format Email Report', type: 'main', index: 0 }]] },
    'Format Email Report': { main: [[{ node: 'Send Email Alert', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', saveManualExecutions: true, errorWorkflow: 'Error Handler' },
  meta: { instanceId: 'wb-grievance-portal' },
  tags: [{ name: 'SLA' }, { name: 'Escalation' }, { name: 'Notification' }, { name: 'Email' }],
};

const WORKFLOW_DAILY_REPORT = {
  name: 'Daily Summary Report',
  nodes: [
    {
      parameters: { rule: { interval: [{ field: 'cron', minute: '0', hour: '18' }] } },
      name: 'Daily at 6 PM',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [250, 300],
    },
    {
      parameters: {
        url: '={{ $env.WB_PORTAL_URL }}/api/dashboard',
        method: 'GET',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'Authorization', value: 'Bearer {{ $env.WB_API_TOKEN }}' }],
        },
        options: { timeout: 15000 },
      },
      name: 'Fetch Dashboard Stats',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [470, 300],
    },
    {
      parameters: {
        jsCode: `// Format daily summary report\nconst data = $input.first().json;\nconst s = data.stats;\nconst today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });\n\nconst html = \`<!DOCTYPE html><html><head><style>body{font-family:system-ui;background:#f8fafc;color:#1e293b;padding:40px}.header{background:linear-gradient(135deg,#0A2463,#1a3a7a);color:white;padding:30px;border-radius:12px;margin-bottom:24px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:20px 0}.stat{background:white;border-radius:10px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}.stat h3{font-size:28px;margin:0}.stat p{color:#64748b;font-size:13px;margin:4px 0 0}</style></head><body>\n<div class="header"><h1 style="margin:0;font-size:22px">📊 WB Grievance Portal — Daily Report</h1><p style="margin:8px 0 0;opacity:.85">\${today}</p></div>\n<div class="stats">\n<div class="stat"><h3>\${s.total}</h3><p>Total Complaints</p></div>\n<div class="stat"><h3 style="color:#DC2626">\${s.open}</h3><p>Open</p></div>\n<div class="stat"><h3 style="color:#F59E0B">\${s.inProgress}</h3><p>In Progress</p></div>\n<div class="stat"><h3 style="color:#16A34A">\${s.resolved}</h3><p>Resolved</p></div>\n<div class="stat"><h3 style="color:#DC2626">\${s.critical}</h3><p>Critical</p></div>\n<div class="stat"><h3>\${s.resolutionRate}%</h3><p>Resolution Rate</p></div>\n</div>\n<p style="color:#94a3b8;font-size:12px;text-align:center">Generated by n8n Workflow — West Bengal Grievance Portal</p></body></html>\`;\n\nreturn [{ json: { subject: \`[Daily Report] Grievance Summary — \${today}\`, html, total: s.total, resolved: s.resolved, open: s.open } }];`,
      },
      name: 'Format HTML Report',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [690, 300],
    },
    {
      parameters: {
        fromEmail: 'reports@wb-grievance.gov.in',
        toEmail: '={{ $env.DISTRICT_ADMIN_EMAILS }}',
        subject: '={{ $json.subject }}',
        html: '={{ $json.html }}',
        options: {},
      },
      name: 'Email to District Admins',
      type: 'n8n-nodes-base.emailSend',
      typeVersion: 2.1,
      position: [910, 300],
    },
  ],
  connections: {
    'Daily at 6 PM': { main: [[{ node: 'Fetch Dashboard Stats', type: 'main', index: 0 }]] },
    'Fetch Dashboard Stats': { main: [[{ node: 'Format HTML Report', type: 'main', index: 0 }]] },
    'Format HTML Report': { main: [[{ node: 'Email to District Admins', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', saveManualExecutions: true, errorWorkflow: 'Error Handler' },
  meta: { instanceId: 'wb-grievance-portal' },
  tags: [{ name: 'Report' }, { name: 'Daily' }, { name: 'Email' }, { name: 'Dashboard' }],
};

const WORKFLOW_STATUS_NOTIFY = {
  name: 'Citizen Status Notification',
  nodes: [
    {
      parameters: { httpMethod: 'POST', path: 'status-change', responseMode: 'responseNode' },
      name: 'Status Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [250, 300],
      webhookId: 'status-change-trigger',
    },
    {
      parameters: {
        url: '={{ $env.WB_PORTAL_URL }}/api/complaints/{{ $json.body.complaintId }}',
        method: 'GET',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'Authorization', value: 'Bearer {{ $env.WB_API_TOKEN }}' }],
        },
        options: { timeout: 10000 },
      },
      name: 'Get Complaint Details',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [470, 300],
    },
    {
      parameters: {
        jsCode: `// Format citizen notification message\nconst c = $input.first().json;\nconst statusMessages = {\n  'IN_PROGRESS': '🔄 Your complaint is now being processed by our team.',\n  'RESOLVED': '✅ Great news! Your complaint has been resolved.',\n  'REJECTED': '❌ Your complaint could not be processed. Please contact your block office.',\n};\n\nconst msg = \`📋 WB Grievance Portal Status Update\\n\\n🎫 Ticket: \${c.ticketNo}\\n📋 Issue: \${c.issue}\\n📍 Block: \${c.block}, \${c.district}\\n\\n\${statusMessages[c.status] || 'Status updated to: ' + c.status}\\n\\n\${c.resolution ? '📝 Resolution: ' + c.resolution : ''}\\n\\n— Government of West Bengal\`;\n\nreturn [{ json: { message: msg, phone: c.phone, citizenName: c.citizenName, ticketNo: c.ticketNo } }];`,
      },
      name: 'Format Message',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [690, 300],
    },
    {
      parameters: {
        phoneNumberId: '={{ $env.WA_PHONE_NUMBER_ID }}',
        recipientPhoneNumber: '={{ $json.phone }}',
        text: '={{ $json.message }}',
      },
      name: 'Send WhatsApp',
      type: 'n8n-nodes-base.whatsApp',
      typeVersion: 1.1,
      position: [910, 200],
    },
    {
      parameters: {
        from: 'WB-GOV',
        to: '={{ $json.phone }}',
        message: '={{ $json.message }}',
      },
      name: 'Send SMS Fallback',
      type: 'n8n-nodes-base.twilio',
      typeVersion: 2.2,
      position: [910, 420],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ JSON.stringify({ success: true, notified: true }) }}',
        responseCode: 200,
      },
      name: 'Respond to Caller',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [1130, 300],
    },
  ],
  connections: {
    'Status Webhook': { main: [[{ node: 'Get Complaint Details', type: 'main', index: 0 }]] },
    'Get Complaint Details': { main: [[{ node: 'Format Message', type: 'main', index: 0 }]] },
    'Format Message': { main: [[{ node: 'Send WhatsApp', type: 'main', index: 0 }, { node: 'Send SMS Fallback', type: 'main', index: 0 }]] },
    'Send WhatsApp': { main: [[{ node: 'Respond to Caller', type: 'main', index: 0 }]] },
    'Send SMS Fallback': { main: [[{ node: 'Respond to Caller', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', saveManualExecutions: true, errorWorkflow: 'Error Handler' },
  meta: { instanceId: 'wb-grievance-portal' },
  tags: [{ name: 'Notification' }, { name: 'WhatsApp' }, { name: 'SMS' }, { name: 'Citizen' }],
};

const WORKFLOW_ERROR_HANDLER = {
  name: 'Error Handler',
  nodes: [
    {
      parameters: {},
      name: 'Error Trigger',
      type: 'n8n-nodes-base.errorTrigger',
      typeVersion: 1,
      position: [250, 300],
    },
    {
      parameters: {
        jsCode: `// Format error details into a readable message\nconst error = $input.first().json;\nconst execution = error.execution || {};\nconst workflowName = execution.workflow?.name || 'Unknown Workflow';\nconst nodeName = execution.error?.node?.name || 'Unknown Node';\nconst errorMessage = execution.error?.message || 'No error message';\nconst timestamp = new Date().toISOString();\n\nconst formattedMessage = \`🚨 Workflow Error Alert\\n\\n📋 Workflow: \${workflowName}\\n🔧 Failed Node: \${nodeName}\\n❌ Error: \${errorMessage}\\n⏰ Time: \${timestamp}\\n🔄 Execution ID: \${execution.id || 'N/A'}\\n\\nPlease investigate immediately.\`;\n\nreturn [{ json: { workflowName, nodeName, errorMessage, timestamp, executionId: execution.id, formattedMessage, retryCount: (execution.retryCount || 0) + 1 } }];`,
      },
      name: 'Format Error Message',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [470, 300],
    },
    {
      parameters: {
        jsCode: `// Determine if error should be retried or escalated\nconst data = $input.first().json;\nconst MAX_RETRIES = 3;\nconst shouldRetry = data.retryCount < MAX_RETRIES && !data.errorMessage.includes('Authentication');\n\nreturn [{ json: { ...data, shouldRetry, isCritical: !shouldRetry } }];`,
      },
      name: 'Check Retry Count',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [690, 300],
    },
    {
      parameters: {
        fromEmail: 'errors@wb-grievance.gov.in',
        toEmail: '={{ $env.ADMIN_ALERT_EMAIL || "admin@wb-gov.in" }}',
        subject: '={{ "[CRITICAL] Workflow Error: " + $json.workflowName + " - " + $json.nodeName }}',
        html: '={{ "<div style=\\"font-family:system-ui;padding:24px;max-width:600px\\"><h2 style=\\"color:#DC2626\\">🚨 Workflow Error</h2><table style=\\"width:100%;border-collapse:collapse;font-size:14px\\"><tr><td style=\\"padding:8px;border:1px solid #e5e7eb;font-weight:bold\\">Workflow</td><td style=\\"padding:8px;border:1px solid #e5e7eb\\">" + $json.workflowName + "</td></tr><tr><td style=\\"padding:8px;border:1px solid #e5e7eb;font-weight:bold\\">Failed Node</td><td style=\\"padding:8px;border:1px solid #e5e7eb\\">" + $json.nodeName + "</td></tr><tr><td style=\\"padding:8px;border:1px solid #e5e7eb;font-weight:bold\\">Error</td><td style=\\"padding:8px;border:1px solid #e5e7eb;color:#DC2626\\">" + $json.errorMessage + "</td></tr><tr><td style=\\"padding:8px;border:1px solid #e5e7eb;font-weight:bold\\">Time</td><td style=\\"padding:8px;border:1px solid #e5e7eb\\">" + $json.timestamp + "</td></tr><tr><td style=\\"padding:8px;border:1px solid #e5e7eb;font-weight:bold\\">Retry Count</td><td style=\\"padding:8px;border:1px solid #e5e7eb\\">" + $json.retryCount + "</td></tr></table><p style=\\"color:#6b7280;font-size:12px;margin-top:16px\\">Generated by n8n Error Handler — WB Grievance Portal</p></div>" }}',
        options: {},
      },
      name: 'Send Admin Email',
      type: 'n8n-nodes-base.emailSend',
      typeVersion: 2.1,
      position: [910, 200],
    },
    {
      parameters: {
        url: '={{ $env.SLACK_WEBHOOK_URL || $env.DISCORD_WEBHOOK_URL }}',
        method: 'POST',
        sendBody: true,
        contentType: 'json',
        bodyParameters: {
          parameters: [
            { name: 'text', value: '={{ $json.formattedMessage }}' },
          ],
        },
        options: { timeout: 5000 },
      },
      name: 'Log to Slack/Discord',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [910, 420],
    },
    {
      parameters: { amount: 60, unit: 'seconds' },
      name: 'Wait & Retry',
      type: 'n8n-nodes-base.wait',
      typeVersion: 1.1,
      position: [1130, 300],
    },
  ],
  connections: {
    'Error Trigger': { main: [[{ node: 'Format Error Message', type: 'main', index: 0 }]] },
    'Format Error Message': { main: [[{ node: 'Check Retry Count', type: 'main', index: 0 }]] },
    'Check Retry Count': { main: [[{ node: 'Send Admin Email', type: 'main', index: 0 }, { node: 'Log to Slack/Discord', type: 'main', index: 0 }, { node: 'Wait & Retry', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  meta: { instanceId: 'wb-grievance-portal' },
  tags: [{ name: 'Error' }, { name: 'Alert' }, { name: 'Admin' }, { name: 'Monitoring' }],
};

const WORKFLOW_ASSIGN_NOTIFY = {
  name: 'Officer Assignment Notification',
  nodes: [
    {
      parameters: { httpMethod: 'POST', path: 'complaint-assigned', responseMode: 'responseNode', responseData: 'allEntries' },
      name: 'Assignment Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [250, 300],
      credentials: {},
      webhookId: 'complaint-assigned-trigger',
    },
    {
      parameters: {
        url: '={{ $env.WB_PORTAL_URL }}/api/complaints/{{ $json.body.complaintId }}',
        method: 'GET',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'Authorization', value: 'Bearer {{ $env.WB_API_TOKEN }}' }],
        },
        options: { timeout: 10000 },
      },
      name: 'Get Complaint Details',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [470, 300],
    },
    {
      parameters: {
        jsCode: `// Extract officer details from webhook payload\nconst body = $input.first().json.body;\nconst officer = {\n  name: body.officerName || body.assignedOfficerName || 'Officer',\n  phone: body.officerPhone || body.assignedOfficerPhone || '',\n  email: body.officerEmail || body.assignedOfficerEmail || '',\n  block: body.block || 'Unknown',\n  district: body.district || 'Unknown',\n};\n\nconst complaint = $input.first().json;\nconst complaintData = {\n  ticketNo: complaint.ticketNo || 'N/A',\n  issue: complaint.issue || 'No description',\n  category: complaint.category || 'Other',\n  citizenName: complaint.citizenName || 'Unknown',\n  urgency: complaint.urgency || 'MEDIUM',\n};\n\nreturn [{ json: { officer, complaint: complaintData } }];`,
      },
      name: 'Get Officer Info',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [690, 300],
    },
    {
      parameters: {
        jsCode: `// Format assignment notification message (Hindi + English)\nconst data = $input.first().json;\nconst o = data.officer;\nconst c = data.complaint;\n\nconst msg = \`📋 नया अभियोग आपको सौंपा गया है / New Complaint Assigned to You\\n\\n🎫 टिकेट / Ticket: \${c.ticketNo}\\n📂 श्रेणी / Category: \${c.category}\\n📝 विवरण / Issue: \${c.issue}\\n👤 नागरिक / Citizen: \${c.citizenName}\\n🔴 प्राथमिकता / Priority: \${c.urgency}\\n📍 ब्लॉक / Block: \${o.block}, \${o.district}\\n\\nकृपया शीघ्र कार्रवाई करें / Please take action at the earliest.\\n— WB Grievance Portal\`;\n\nconst emailHtml = \`<!DOCTYPE html><html><body style=\\"font-family:system-ui;padding:24px;max-width:600px;\\"><div style=\\"background:linear-gradient(135deg,#0A2463,#1a3a7a);color:white;padding:20px;border-radius:12px;margin-bottom:20px\\"><h2 style=\\"margin:0\\">📋 New Complaint Assigned</h2><p style=\\"margin:8px 0 0;opacity:0.85\\">Ticket: \${c.ticketNo}</p></div><table style=\\"width:100%;border-collapse:collapse;font-size:14px\\"><tr><td style=\\"padding:10px;border:1px solid #e5e7eb;font-weight:bold\\">Category</td><td style=\\"padding:10px;border:1px solid #e5e7eb\\">\${c.category}</td></tr><tr><td style=\\"padding:10px;border:1px solid #e5e7eb;font-weight:bold\\">Issue</td><td style=\\"padding:10px;border:1px solid #e5e7eb\\">\${c.issue}</td></tr><tr><td style=\\"padding:10px;border:1px solid #e5e7eb;font-weight:bold\\">Citizen</td><td style=\\"padding:10px;border:1px solid #e5e7eb\\">\${c.citizenName}</td></tr><tr><td style=\\"padding:10px;border:1px solid #e5e7eb;font-weight:bold\\">Priority</td><td style=\\"padding:10px;border:1px solid #e5e7eb\\">\${c.urgency}</td></tr><tr><td style=\\"padding:10px;border:1px solid #e5e7eb;font-weight:bold\\">Block</td><td style=\\"padding:10px;border:1px solid #e5e7eb\\">\${o.block}, \${o.district}</td></tr></table><p style=\\"color:#6b7280;font-size:12px;margin-top:16px\\">Please log in to the portal to take action. — WB Grievance Portal</p></body></html>\`;\n\nreturn [{ json: { message: msg, phone: o.phone, email: o.email, officerName: o.name, emailHtml, emailSubject: \`[New Complaint] Ticket \${c.ticketNo} Assigned — \${c.category}\` } }];`,
      },
      name: 'Format Assignment Message',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [910, 300],
    },
    {
      parameters: {
        phoneNumberId: '={{ $env.WA_PHONE_NUMBER_ID }}',
        recipientPhoneNumber: '={{ $json.phone }}',
        text: '={{ $json.message }}',
      },
      name: 'Send WhatsApp to Officer',
      type: 'n8n-nodes-base.whatsApp',
      typeVersion: 1.1,
      position: [1130, 200],
    },
    {
      parameters: {
        fromEmail: 'notifications@wb-grievance.gov.in',
        toEmail: '={{ $json.email }}',
        subject: '={{ $json.emailSubject }}',
        html: '={{ $json.emailHtml }}',
        options: {},
      },
      name: 'Send Email to Officer',
      type: 'n8n-nodes-base.emailSend',
      typeVersion: 2.1,
      position: [1130, 420],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ JSON.stringify({ success: true, officerNotified: true, officerName: $json.officerName }) }}',
        responseCode: 200,
      },
      name: 'Respond to Caller',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [1350, 300],
    },
  ],
  connections: {
    'Assignment Webhook': { main: [[{ node: 'Get Complaint Details', type: 'main', index: 0 }]] },
    'Get Complaint Details': { main: [[{ node: 'Get Officer Info', type: 'main', index: 0 }]] },
    'Get Officer Info': { main: [[{ node: 'Format Assignment Message', type: 'main', index: 0 }]] },
    'Format Assignment Message': { main: [[{ node: 'Send WhatsApp to Officer', type: 'main', index: 0 }, { node: 'Send Email to Officer', type: 'main', index: 0 }]] },
    'Send WhatsApp to Officer': { main: [[{ node: 'Respond to Caller', type: 'main', index: 0 }]] },
    'Send Email to Officer': { main: [[{ node: 'Respond to Caller', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', saveManualExecutions: true, errorWorkflow: 'Error Handler' },
  meta: { instanceId: 'wb-grievance-portal' },
  tags: [{ name: 'Notification' }, { name: 'Officer' }, { name: 'WhatsApp' }, { name: 'Email' }],
};

/* ══════════════════════════════════════════════════════════════
   CONNECTION VALIDATION HELPER
   ══════════════════════════════════════════════════════════════ */
function validateWorkflowConnections(workflow: Record<string, unknown>): { connected: boolean; orphanNodes: string[] } {
  const nodes = (workflow.nodes as Array<{ name: string }>) || [];
  const connections = (workflow.connections as Record<string, { main?: Array<Array<{ node: string }>> }>) || {};

  const nodeNames = new Set(nodes.map((n) => n.name));

  // Nodes that appear as keys in connections (source nodes)
  const sourceNodes = new Set(Object.keys(connections));

  // Nodes that appear as targets in connections
  const targetNodes = new Set<string>();
  for (const conn of Object.values(connections)) {
    if (conn.main) {
      for (const branch of conn.main) {
        for (const target of branch) {
          targetNodes.add(target.node);
        }
      }
    }
  }

  // Orphan nodes: defined but not a source AND not a target
  const orphanNodes: string[] = [];
  for (const name of nodeNames) {
    if (!sourceNodes.has(name) && !targetNodes.has(name)) {
      orphanNodes.push(name);
    }
  }

  return { connected: orphanNodes.length === 0, orphanNodes };
}

/* ══════════════════════════════════════════════════════════════
   WORKFLOW DEFINITIONS
   ══════════════════════════════════════════════════════════════ */
interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  triggerType: string;
  triggerIcon: typeof Webhook;
  color: string;
  nodeCount: number;
  estimatedRunTime: string;
  tags: string[];
  apiEndpoints: string[];
  flowSteps: { label: string; icon: typeof Webhook }[];
  json: Record<string, unknown>;
}

const WORKFLOWS: WorkflowDef[] = [
  {
    id: 'whatsapp-intake',
    name: 'WhatsApp Complaint Intake',
    description: 'Receives WhatsApp messages from citizens, parses and categorizes complaints using keyword matching, creates tickets via portal API, and sends auto-confirmation replies.',
    triggerType: 'Webhook',
    triggerIcon: Webhook,
    color: '#25D366',
    nodeCount: 6,
    estimatedRunTime: '~3s',
    tags: ['WhatsApp', 'Complaint', 'Auto-Reply', 'AI'],
    apiEndpoints: ['POST /api/webhook/complaint'],
    flowSteps: [
      { label: 'Webhook', icon: Webhook },
      { label: 'Parse', icon: Code },
      { label: 'Categorize', icon: Layers },
      { label: 'POST API', icon: Send },
      { label: 'Confirm', icon: CheckCircle2 },
      { label: 'Reply', icon: MessageSquare },
    ],
    json: WORKFLOW_WHATSAPP,
  },
  {
    id: 'auto-assignment',
    name: 'Auto-Assignment Engine',
    description: 'Runs every 5 minutes to fetch unassigned complaints, matches them to the correct block officer by location, and automatically assigns via PATCH API.',
    triggerType: 'Cron (5 min)',
    triggerIcon: Clock,
    color: '#F59E0B',
    nodeCount: 4,
    estimatedRunTime: '~5s',
    tags: ['Automation', 'Assignment', 'Cron', 'Smart Matching'],
    apiEndpoints: ['GET /api/complaints', 'PATCH /api/complaints/[id]'],
    flowSteps: [
      { label: 'Cron', icon: Clock },
      { label: 'Fetch', icon: Database },
      { label: 'Match', icon: GitBranch },
      { label: 'Assign', icon: Users },
    ],
    json: WORKFLOW_AUTO_ASSIGN,
  },
  {
    id: 'sla-escalation',
    name: 'SLA Breach Escalation',
    description: 'Runs daily at 9 AM to find complaints open longer than 7 days, auto-escalates urgency level, and sends formatted HTML email alert to district administrators.',
    triggerType: 'Cron (9 AM)',
    triggerIcon: Clock,
    color: '#EF4444',
    nodeCount: 6,
    estimatedRunTime: '~8s',
    tags: ['SLA', 'Escalation', 'Notification', 'Email'],
    apiEndpoints: ['GET /api/complaints', 'PATCH /api/complaints/[id]/escalate'],
    flowSteps: [
      { label: 'Cron', icon: Clock },
      { label: 'Fetch Open', icon: Database },
      { label: 'Filter >7d', icon: AlertTriangle },
      { label: 'Escalate', icon: Zap },
      { label: 'Format', icon: Mail },
      { label: 'Email', icon: Send },
    ],
    json: WORKFLOW_SLA_BREACH,
  },
  {
    id: 'daily-report',
    name: 'Daily Summary Report',
    description: 'Runs daily at 6 PM to aggregate dashboard statistics, generate a beautiful HTML report with key metrics, and email it to all district administrators.',
    triggerType: 'Cron (6 PM)',
    triggerIcon: Clock,
    color: '#3B82F6',
    nodeCount: 4,
    estimatedRunTime: '~4s',
    tags: ['Report', 'Daily', 'Email', 'Dashboard'],
    apiEndpoints: ['GET /api/dashboard'],
    flowSteps: [
      { label: 'Cron', icon: Clock },
      { label: 'Fetch Stats', icon: BarChart2 },
      { label: 'Format HTML', icon: Code },
      { label: 'Email', icon: Send },
    ],
    json: WORKFLOW_DAILY_REPORT,
  },
  {
    id: 'status-notification',
    name: 'Citizen Status Notification',
    description: 'Triggered when a complaint status changes in the portal. Fetches full complaint details, formats a citizen-friendly message, and sends via WhatsApp with SMS fallback.',
    triggerType: 'Webhook',
    triggerIcon: Webhook,
    color: '#8B5CF6',
    nodeCount: 6,
    estimatedRunTime: '~4s',
    tags: ['Notification', 'WhatsApp', 'SMS', 'Citizen'],
    apiEndpoints: ['GET /api/complaints/[id]'],
    flowSteps: [
      { label: 'Webhook', icon: Webhook },
      { label: 'Get Details', icon: Eye },
      { label: 'Format', icon: Code },
      { label: 'WhatsApp', icon: MessageSquare },
      { label: 'SMS', icon: Smartphone },
      { label: 'Respond', icon: CheckCircle2 },
    ],
    json: WORKFLOW_STATUS_NOTIFY,
  },
  {
    id: 'error-handler',
    name: 'Error Handler',
    description: 'Catches errors from all workflows, formats error details, sends admin email alerts, logs to Slack/Discord, and manages retry logic for transient failures.',
    triggerType: 'Error Trigger',
    triggerIcon: AlertTriangle,
    color: '#EF4444',
    nodeCount: 6,
    estimatedRunTime: '~3s',
    tags: ['Error', 'Alert', 'Admin', 'Monitoring'],
    apiEndpoints: [],
    flowSteps: [
      { label: 'Error', icon: AlertTriangle },
      { label: 'Format', icon: Code },
      { label: 'Check', icon: RefreshCw },
      { label: 'Email', icon: Mail },
      { label: 'Log', icon: Bell },
      { label: 'Retry', icon: Timer },
    ],
    json: WORKFLOW_ERROR_HANDLER,
  },
  {
    id: 'assign-notify',
    name: 'Officer Assignment Notification',
    description: 'Triggered when a complaint is assigned to an officer. Fetches complaint details, formats bilingual Hindi/English notification, and sends via WhatsApp and email to the assigned officer.',
    triggerType: 'Webhook',
    triggerIcon: Webhook,
    color: '#06B6D4',
    nodeCount: 7,
    estimatedRunTime: '~4s',
    tags: ['Notification', 'Officer', 'WhatsApp', 'Email'],
    apiEndpoints: ['GET /api/complaints/[id]', 'POST /webhook/complaint-assigned'],
    flowSteps: [
      { label: 'Webhook', icon: Webhook },
      { label: 'Get Details', icon: Eye },
      { label: 'Officer', icon: Users },
      { label: 'Format', icon: Code },
      { label: 'WhatsApp', icon: MessageSquare },
      { label: 'Email', icon: Mail },
      { label: 'Respond', icon: CheckCircle2 },
    ],
    json: WORKFLOW_ASSIGN_NOTIFY,
  },
];

/* ══════════════════════════════════════════════════════════════
   WEBHOOK URL REFERENCE
   ══════════════════════════════════════════════════════════════ */
const WEBHOOK_URLS = [
  { method: 'POST', path: '/api/webhook/complaint', desc: 'Receive complaint from external sources', usedBy: ['WhatsApp Complaint Intake'] },
  { method: 'GET', path: '/api/complaints', desc: 'List complaints with filters', usedBy: ['Auto-Assignment Engine', 'SLA Breach Escalation'] },
  { method: 'GET', path: '/api/complaints/[id]', desc: 'Get single complaint details', usedBy: ['Citizen Status Notification'] },
  { method: 'PATCH', path: '/api/complaints/[id]', desc: 'Update complaint (assign, status)', usedBy: ['Auto-Assignment Engine'] },
  { method: 'PATCH', path: '/api/complaints/[id]/escalate', desc: 'Escalate urgency level', usedBy: ['SLA Breach Escalation'] },
  { method: 'GET', path: '/api/dashboard', desc: 'Dashboard statistics', usedBy: ['Daily Summary Report'] },
  { method: 'POST', path: '/api/auth/login', desc: 'Obtain JWT token', usedBy: ['All workflows (auth)'] },
];

/* ══════════════════════════════════════════════════════════════
   SETUP GUIDE STEPS
   ══════════════════════════════════════════════════════════════ */
const SETUP_STEPS = [
  {
    title: 'Install n8n via Docker',
    icon: Terminal,
    content: `docker run -it --rm \\
  --name n8n \\
  -p 5678:5678 \\
  -v ~/.n8n:/home/node/.n8n \\
  -e N8N_BASIC_AUTH_ACTIVE=true \\
  -e N8N_BASIC_AUTH_USER=admin \\
  -e N8N_BASIC_AUTH_PASSWORD=your_secure_password \\
  -e WEBHOOK_URL=https://your-domain.com/ \\
  n8nio/n8n`,
  },
  {
    title: 'Import Workflow JSON',
    icon: FileJson,
    content: `1. Open n8n at http://localhost:5678\n2. Click "Add Workflow" → "Import from JSON"\n3. Copy the workflow JSON from the "Copy JSON" button above\n4. Paste and click "Import"\n5. Review the workflow nodes and connections`,
  },
  {
    title: 'Configure Environment Variables',
    icon: Settings,
    content: `# Required environment variables for n8n:\n\nWB_PORTAL_URL=https://your-portal-domain.com\nWB_API_TOKEN=your_jwt_api_token\nWA_PHONE_NUMBER_ID=your_whatsapp_phone_number_id\nDISTRICT_ADMIN_EMAIL=admin@wb-gov.in\nDISTRICT_ADMIN_EMAILS=admin1@wb-gov.in,admin2@wb-gov.in\n\n# Get your API token by logging in to the portal\n# and copying the JWT from browser DevTools.`,
  },
  {
    title: 'Test the Workflow',
    icon: Play,
    content: `1. Click the "Execute Workflow" button in n8n\n2. For webhook workflows, send a test request using curl:\n\n   curl -X POST https://your-n8n.com/webhook/incoming-whatsapp \\\n     -H "Content-Type: application/json" \\\n     -d '{"message":"No water supply in our area","block":"Krishnanagar-I","district":"Nadia"}'\n\n3. Check the n8n execution log for errors\n4. Verify the complaint appears in the portal`,
  },
  {
    title: 'Activate the Workflow',
    icon: Rocket,
    content: `1. Toggle the "Active" switch in the top-right corner of n8n\n2. The workflow will now run automatically on its schedule\n3. Monitor executions in the "Executions" tab\n4. Set up error notifications via n8n's built-in settings\n5. For production, consider enabling "Error Workflow" for automatic retry`,
  },
];

/* ══════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ══════════════════════════════════════════════════════════════ */

function MiniFlowDiagram({ steps, color }: { steps: { label: string; icon: typeof Webhook }[]; color: string }) {
  return (
    <div className="flex items-center gap-0 overflow-x-auto py-2 px-1">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center shrink-0">
          <motion.div
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.08 }}
            className="flex flex-col items-center gap-1 w-[56px]"
          >
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm"
              style={{ backgroundColor: `${color}20`, border: `1.5px solid ${color}50` }}
            >
              <step.icon className="h-3.5 w-3.5" style={{ color }} />
            </div>
            <span className="text-[8px] font-semibold text-muted-foreground text-center leading-tight truncate w-full">
              {step.label}
            </span>
          </motion.div>
          {i < steps.length - 1 && (
            <div className="mx-0.5 shrink-0">
              <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CopyButton({ text, label, variant = 'outline' }: { text: string; label?: string; variant?: 'outline' | 'ghost' | 'default' }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success(label ? `${label} copied!` : 'Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Button variant={variant} size="sm" onClick={handleCopy} className={`h-8 gap-1.5 text-xs ${copied ? 'text-emerald-600' : ''}`}>
      {copied ? <CheckCircle className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {label && <span className="hidden sm:inline">{copied ? 'Copied!' : label}</span>}
    </Button>
  );
}

function DownloadButton({ workflow }: { workflow: WorkflowDef }) {
  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(workflow.json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workflow.id}-n8n-workflow.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Workflow JSON downloaded!');
  };
  return (
    <Button variant="outline" size="sm" onClick={handleDownload} className="h-8 gap-1.5 text-xs">
      <Download className="h-3 w-3" />
      <span className="hidden sm:inline">Download</span>
    </Button>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */
export default function N8NWorkflowsView() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="space-y-6 max-w-6xl">
      {/* ═══ PAGE HEADER ═══ */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-2xl shadow-lg"
      >
        <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${NAVY_DARK} 0%, ${NAVY} 50%, #1a3a7a 100%)` }} />
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 25% 50%, white 1px, transparent 1px), radial-gradient(circle at 75% 30%, white 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
        {/* Decorative circles */}
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="absolute -right-4 -bottom-8 h-28 w-28 rounded-full bg-white/[0.03]" />

        <div className="relative px-6 py-8 sm:px-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center shadow-lg">
                <Workflow className="h-7 w-7 text-white" />
              </div>
              <div>
                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">n8n Workflows</h2>
                <p className="text-sm text-blue-200/70 mt-0.5">Ready-to-import automation workflows for the grievance portal</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
                <span className="text-xs font-medium text-white">{WORKFLOWS.length} Workflows Ready</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20">
                <GitBranch className="h-3.5 w-3.5 text-orange-300" />
                <span className="text-xs font-medium text-white">{WORKFLOWS.reduce((a, w) => a + w.nodeCount, 0)} Total Nodes</span>
              </div>
              {isAdmin && (
                <Badge className="bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 text-[10px]">
                  <Shield className="h-3 w-3 mr-1" /> Admin Access
                </Badge>
              )}
            </div>
          </div>

          {/* Quick stats bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            {WORKFLOWS.map((wf) => (
              <div key={wf.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.07] border border-white/10">
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: wf.color }} />
                <span className="text-[10px] font-medium text-white/80 truncate">{wf.name}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ═══ CONNECTION HEALTH SUMMARY ═══ */}
      <motion.div variants={stagger} initial="hidden" animate="show">
        <motion.div variants={fadeUp}>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${NAVY}12`, border: `1.5px solid ${NAVY}30` }}>
                  <Link className="h-5 w-5" style={{ color: NAVY }} />
                </div>
                <div>
                  <CardTitle className="text-base font-bold">Connection Health</CardTitle>
                  <CardDescription className="text-xs">Validates all node connections across workflows</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="p-3 rounded-xl bg-muted/40 border border-border/50 text-center">
                  <div className="text-xl font-black">{WORKFLOWS.length}</div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total Workflows</div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30 text-center">
                  <div className="text-xl font-black text-emerald-600">{WORKFLOWS.filter(wf => validateWorkflowConnections(wf.json).connected).length}</div>
                  <div className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Connected</div>
                </div>
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30 text-center">
                  <div className="text-xl font-black text-red-600">{WORKFLOWS.filter(wf => !validateWorkflowConnections(wf.json).connected).length}</div>
                  <div className="text-[10px] font-semibold text-red-600 uppercase tracking-wider">Issues</div>
                </div>
              </div>
              <div className="space-y-2">
                {WORKFLOWS.map(wf => {
                  const validation = validateWorkflowConnections(wf.json);
                  return (
                    <div key={wf.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 border border-border/30">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: validation.connected ? '#16A34A' : '#DC2626' }} />
                        <span className="text-xs font-medium">{wf.name}</span>
                      </div>
                      {validation.connected ? (
                        <Badge className="text-[9px] bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-0 gap-1">
                          <CircleCheck className="h-3 w-3" /> All nodes connected
                        </Badge>
                      ) : (
                        <Badge className="text-[9px] bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-0 gap-1">
                          <XCircle className="h-3 w-3" /> {validation.orphanNodes.length} orphan node(s)
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* ═══ WORKFLOW CARDS ═══ */}
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
        {WORKFLOWS.map((wf, idx) => (
          <motion.div key={wf.id} variants={fadeUp}>
            <Card className="border-0 shadow-sm overflow-hidden group hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5">
              {/* Color accent bar */}
              <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${wf.color}, ${wf.color}60)` }} />
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div
                      className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
                      style={{ backgroundColor: `${wf.color}15`, border: `1.5px solid ${wf.color}40` }}
                    >
                      <wf.triggerIcon className="h-5 w-5" style={{ color: wf.color }} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base font-bold">{wf.name}</CardTitle>
                        <Badge
                          className="text-[9px] font-bold px-1.5 py-0 text-white"
                          style={{ backgroundColor: wf.color }}
                        >
                          {wf.triggerType}
                        </Badge>
                      </div>
                      <CardDescription className="text-xs mt-1 leading-relaxed">{wf.description}</CardDescription>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <CopyButton text={JSON.stringify(wf.json, null, 2)} label="Copy JSON" />
                    <DownloadButton workflow={wf} />
                  </div>
                </div>

                {/* Mini flow diagram */}
                <div className="mt-4 p-3 rounded-xl bg-muted/40 border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Node Flow</span>
                  </div>
                  <MiniFlowDiagram steps={wf.flowSteps} color={wf.color} />
                </div>

                {/* Meta info */}
                <div className="flex items-center gap-4 mt-3 flex-wrap">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Layers className="h-3 w-3" />
                    <span className="font-semibold">{wf.nodeCount}</span> nodes
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Timer className="h-3 w-3" />
                    <span className="font-semibold">{wf.estimatedRunTime}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Link className="h-3 w-3 text-muted-foreground" />
                    {wf.apiEndpoints.map((ep) => (
                      <code key={ep} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground">
                        {ep}
                      </code>
                    ))}
                  </div>
                </div>

                {/* Tags */}
                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                  {wf.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px] font-normal px-2 py-0">
                      <Tag className="h-2.5 w-2.5 mr-1" />
                      {tag}
                    </Badge>
                  ))}
                </div>

                {/* Connection validation badge */}
                <div className="mt-3">
                  {(() => {
                    const validation = validateWorkflowConnections(wf.json);
                    return validation.connected ? (
                      <Badge className="text-[9px] bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-0 gap-1">
                        <CircleCheck className="h-3 w-3" /> All nodes connected
                      </Badge>
                    ) : (
                      <Badge className="text-[9px] bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-0 gap-1">
                        <XCircle className="h-3 w-3" /> {validation.orphanNodes.length} orphan node(s): {validation.orphanNodes.join(', ')}
                      </Badge>
                    );
                  })()}
                </div>
              </CardHeader>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* ═══ WEBHOOK URLs REFERENCE ═══ */}
      <motion.div variants={stagger} initial="hidden" animate="show">
        <motion.div variants={fadeUp}>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${NAVY}12`, border: `1.5px solid ${NAVY}30` }}>
                  <Globe className="h-5 w-5" style={{ color: NAVY }} />
                </div>
                <div>
                  <CardTitle className="text-base font-bold">API & Webhook URL Reference</CardTitle>
                  <CardDescription className="text-xs">All available endpoints that n8n workflows can call</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-border/50 overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/80 border-b border-border/50">
                        <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px]">Method</th>
                        <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px]">Endpoint</th>
                        <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px] hidden sm:table-cell">Description</th>
                        <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px]">Used By</th>
                        <th className="text-right px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px]">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {WEBHOOK_URLS.map((url, i) => (
                        <tr key={url.path} className={`border-b border-border/30 ${i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}`}>
                          <td className="px-4 py-2.5">
                            <Badge className={`text-[10px] font-bold px-1.5 py-0 text-white ${url.method === 'POST' ? 'bg-emerald-600' : url.method === 'PATCH' ? 'bg-amber-600' : url.method === 'DELETE' ? 'bg-red-600' : 'bg-sky-600'}`}>
                              {url.method}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5">
                            <code className="font-mono text-[11px] font-semibold text-foreground">{url.path}</code>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">{url.desc}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {url.usedBy.map((w) => (
                                <Badge key={w} variant="outline" className="text-[9px] font-normal px-1.5 py-0 whitespace-nowrap">
                                  {w}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <CopyButton text={url.path} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* ═══ SETUP GUIDE ═══ */}
      <motion.div variants={stagger} initial="hidden" animate="show">
        <motion.div variants={fadeUp}>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${NAVY}12`, border: `1.5px solid ${NAVY}30` }}>
                  <Rocket className="h-5 w-5" style={{ color: NAVY }} />
                </div>
                <div>
                  <CardTitle className="text-base font-bold">Setup Guide</CardTitle>
                  <CardDescription className="text-xs">Step-by-step instructions to get n8n workflows running</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                {SETUP_STEPS.map((step, idx) => (
                  <AccordionItem key={idx} value={`step-${idx}`} className="border-border/50">
                    <AccordionTrigger className="hover:no-underline py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-7 w-7 rounded-lg flex items-center justify-center text-white text-xs font-black shrink-0"
                          style={{ backgroundColor: NAVY }}
                        >
                          {idx + 1}
                        </div>
                        <div className="flex items-center gap-2">
                          <step.icon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-semibold text-left">{step.title}</span>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pl-12">
                      <div className="relative rounded-xl overflow-hidden border border-border/50">
                        <div className="flex items-center justify-between px-4 py-2 bg-muted/80 border-b border-border/50">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {idx === 0 ? 'Terminal' : idx === 1 ? 'n8n UI' : idx === 2 ? 'Environment' : idx === 3 ? 'Testing' : 'Production'}
                          </span>
                          <CopyButton text={step.content} label="Copy" variant="ghost" />
                        </div>
                        <pre className="p-4 text-xs leading-relaxed overflow-x-auto custom-scrollbar" style={{ background: 'linear-gradient(135deg, #0d1117, #161b22)' }}>
                          <code className="text-emerald-300 font-mono whitespace-pre-wrap">{step.content}</code>
                        </pre>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* ═══ ENVIRONMENT VARIABLES QUICK REFERENCE ═══ */}
      <motion.div variants={stagger} initial="hidden" animate="show">
        <motion.div variants={fadeUp}>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${NAVY}12`, border: `1.5px solid ${NAVY}30` }}>
                  <Settings className="h-5 w-5" style={{ color: NAVY }} />
                </div>
                <div>
                  <CardTitle className="text-base font-bold">Environment Variables Quick Reference</CardTitle>
                  <CardDescription className="text-xs">Set these in your n8n instance for the workflows to work</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-border/50 overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/80 border-b border-border/50">
                        <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px]">Variable</th>
                        <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px] hidden sm:table-cell">Description</th>
                        <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px]">Example</th>
                        <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px]">Required</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { var: 'WB_PORTAL_URL', desc: 'Base URL of the portal', example: 'https://portal.wb.gov.in', required: true },
                        { var: 'WB_API_TOKEN', desc: 'JWT token for API authentication', example: 'eyJhbGciOi...', required: true },
                        { var: 'WA_PHONE_NUMBER_ID', desc: 'WhatsApp Business phone number ID', example: '110234567890', required: false },
                        { var: 'DISTRICT_ADMIN_EMAIL', desc: 'Primary district admin email', example: 'admin@wb-gov.in', required: false },
                        { var: 'DISTRICT_ADMIN_EMAILS', desc: 'Comma-separated admin emails', example: 'a@wb.in,b@wb.in', required: false },
                      ].map((env, i) => (
                        <tr key={env.var} className={`border-b border-border/30 ${i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}`}>
                          <td className="px-4 py-2.5">
                            <code className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold">
                              {env.var}
                            </code>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">{env.desc}</td>
                          <td className="px-4 py-2.5">
                            <code className="font-mono text-[10px] text-muted-foreground">{env.example}</code>
                          </td>
                          <td className="px-4 py-2.5">
                            {env.required ? (
                              <Badge className="text-[9px] bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-0">Required</Badge>
                            ) : (
                              <Badge className="text-[9px] bg-muted text-muted-foreground border-0">Optional</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Info callout */}
              <div className="mt-4 p-4 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30">
                <div className="flex items-start gap-2.5">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <div className="text-xs text-blue-700 dark:text-blue-300">
                    <p className="font-semibold mb-0.5">Security Note</p>
                    <p className="text-blue-600/80 dark:text-blue-400/80">
                      Never share your API tokens publicly. Use Docker secrets or n8n&apos;s credential management to store sensitive values securely. Rotate tokens regularly.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* ═══ ALL-IN-ONE DOWNLOAD ═══ */}
      <motion.div variants={stagger} initial="hidden" animate="show">
        <motion.div variants={fadeUp}>
          <Card className="border-0 shadow-sm overflow-hidden" style={{ borderColor: `${NAVY}30` }}>
            <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${NAVY}, ${NAVY}60)` }} />
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${NAVY}15`, border: `1.5px solid ${NAVY}30` }}>
                  <Download className="h-6 w-6" style={{ color: NAVY }} />
                </div>
                <div className="flex-1 text-center sm:text-left">
                  <h3 className="text-sm font-bold">Download All Workflows</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Get all {WORKFLOWS.length} workflow JSON files bundled together for easy import</p>
                </div>
                <Button
                  onClick={() => {
                    const allWorkflows = WORKFLOWS.map((wf) => wf.json);
                    const blob = new Blob([JSON.stringify(allWorkflows, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'wb-grievance-all-n8n-workflows.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    toast.success(`All ${WORKFLOWS.length} workflows downloaded!`);
                  }}
                  className="gap-2 text-sm font-semibold text-white shrink-0"
                  style={{ backgroundColor: NAVY }}
                >
                  <Download className="h-4 w-4" />
                  Download All ({WORKFLOWS.length} Workflows)
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </div>
  );
}
