const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1M2Y5MDE1YS01M2E1LTQ3NTItYWVlYy05NDllYjViMTkyZmEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNTMxYmMzZTEtZDRkMi00ZDU3LWI5ZWMtZTliOGE3NTY1ODYwIiwiaWF0IjoxNzc2MDk4NTY3LCJleHAiOjE3Nzg2MjMyMDB9.LaSfBUSPVo2BW1YKfNtL03mNSeCSdmgYWEmnWngsnXc';
const BASE = 'https://n8n.srv1347095.hstgr.cloud/api/v1';
const API_HEADERS = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' };

async function updateWorkflow(id, { name, nodes, connections }) {
  const res = await fetch(`${BASE}/workflows/${id}`, {
    method: 'PUT',
    headers: API_HEADERS,
    body: JSON.stringify({ name, nodes, connections, settings: { executionOrder: 'v1' } })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status} - ${err}`);
  }
  return res.json();
}

function doc(id, content, pos) {
  return { parameters: { content }, id, name: "Doc", type: "n8n-nodes-base.stickyNote", typeVersion: 1, position: pos || [0, 0] };
}
function code(id, name, js, pos) {
  return { parameters: { jsCode: js }, id, name, type: "n8n-nodes-base.code", typeVersion: 2, position: pos };
}
function http(id, name, method, url, pos, sendBody) {
  const p = { method, url, options: { timeout: 15000 } };
  if (sendBody && method !== 'GET') {
    p.sendBody = true;
    p.specifyBody = 'json';
    p.jsonBody = sendBody;
  }
  return { parameters: p, id, name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: pos };
}

// ============================================================
// WB-01: WhatsApp Complaint Intake (AI Agent)
// ============================================================
const WB01 = {
  name: "WB-01 WhatsApp Complaint Intake (AI Agent)",
  nodes: [
    doc("wb01-doc", "## WB-01: WhatsApp Complaint Intake (AI Agent)\n\n1. WhatsApp Trigger -> Text Filter\n2. Extract Data -> AI LLM Classifier\n3. Parse -> Save to Portal -> Smart Reply\n\n**AI:** 14 categories, 4 urgency levels, multi-language", [-50, -100]),
    { parameters: {}, id: "wb01-t1", name: "WhatsApp Trigger", type: "n8n-nodes-base.whatsAppTrigger", typeVersion: 1, position: [0, 300] },
    { parameters: { rule: { conditions: { combinator: "and", conditions: [{ leftValue: "={{ $json.messages[0].type }}", rightValue: "text", operator: { type: "string", operation: "equals" } }] } } }, id: "wb01-t2", name: "Is Text Message?", type: "n8n-nodes-base.if", typeVersion: 2.2, position: [220, 300] },
    code("wb01-t3", "Extract Message Data", 'const msg = $input.first().json;\nconst messageText = msg.messages[0].text?.body || "";\nconst from = msg.contacts?.[0]?.wa_id || msg.messages[0].from || "";\nconst contactName = msg.contacts?.[0]?.profile?.name || "Unknown";\nreturn [{ json: { messageText, from, contactName, timestamp: new Date().toISOString(), source: "whatsapp" } }];', [440, 180]),
    { parameters: { systemMessage: "You are an AI complaint intake assistant for West Bengal Government. Extract structured data from the citizen message.\n\nCategories: Water Supply, Electricity, Roads & Infrastructure, Healthcare, Education, Sanitation, Public Transport, Law & Order, Agriculture, Housing, Employment, Environment, Other\nUrgency: LOW, MEDIUM, HIGH, CRITICAL\n\nRespond ONLY with JSON: {\"summary\":\"English summary\",\"category\":\"category\",\"subcategory\":\"type\",\"urgency\":\"LOW|MEDIUM|HIGH|CRITICAL\",\"language\":\"language\",\"autoResponse\":\"acknowledgment in citizen language\",\"location\":\"location or null\",\"block\":\"block or null\",\"district\":\"district or null\",\"needsFollowUp\":true/false,\"estimatedResolution\":\"X days\"}", options: { temperature: 0.2 } }, id: "wb01-t4", name: "AI Complaint Classifier", type: "@n8n/n8n-nodes-langchain.chainLlm", typeVersion: 1.4, position: [660, 180] },
    code("wb01-t5", "Parse & Merge Data", 'const ai = $input.first().json;\nlet data;\ntry {\n  const t = ai.text || JSON.stringify(ai);\n  data = JSON.parse(t.match(/\\{[\\s\\S]*\\}/)?.[0] || t);\n} catch(e) {\n  data = { summary: "Processing", category: "Other", urgency: "MEDIUM", autoResponse: "Thank you. Complaint received.", language: "unknown", needsFollowUp: true, estimatedResolution: "5-7 days" };\n}\nconst prev = $("Extract Message Data").first().json;\nreturn [{ json: { ...data, whatsappPhone: prev.from, contactName: prev.contactName, source: "whatsapp", status: "open", complaintId: "WB-" + Date.now().toString(36).toUpperCase(), createdAt: prev.timestamp } }];', [880, 180]),
    http("wb01-t6", "Save to Portal DB", "POST", "https://n8n.srv1347095.hstgr.cloud/webhook/complaint-intake", [1100, 180], "={{ JSON.stringify($json) }}"),
    { parameters: { body: "={{ $json.autoResponse + '\\n\\n📋 Complaint ID: ' + $json.complaintId + '\\n📂 Category: ' + $json.category + '\\n🔴 Urgency: ' + $json.urgency + '\\n⏰ Est. Resolution: ' + $json.estimatedResolution }}", options: {} }, id: "wb01-t7", name: "Send Smart Ack", type: "n8n-nodes-base.whatsApp", typeVersion: 1, position: [1320, 180] },
    code("wb01-e1", "Handle Non-Text", 'return [{ json: { reply: "🙏 আপনার মেসেজ পেয়েছি। অনুগ্রহ করে টেক্সট আকারে লিখুন।\\nThank you. Please type your complaint as text." } }];', [440, 420]),
    { parameters: { body: "={{ $json.reply }}", options: {} }, id: "wb01-e2", name: "Send Text Request", type: "n8n-nodes-base.whatsApp", typeVersion: 1, position: [660, 420] }
  ],
  connections: {
    "WhatsApp Trigger": { main: [[{ node: "Is Text Message?", type: "main", index: 0 }]] },
    "Is Text Message?": { main: [[{ node: "Extract Message Data", type: "main", index: 0 }], [{ node: "Handle Non-Text", type: "main", index: 0 }]] },
    "Extract Message Data": { main: [[{ node: "AI Complaint Classifier", type: "main", index: 0 }]] },
    "AI Complaint Classifier": { main: [[{ node: "Parse & Merge Data", type: "main", index: 0 }]] },
    "Parse & Merge Data": { main: [[{ node: "Save to Portal DB", type: "main", index: 0 }]] },
    "Save to Portal DB": { main: [[{ node: "Send Smart Ack", type: "main", index: 0 }]] },
    "Handle Non-Text": { main: [[{ node: "Send Text Request", type: "main", index: 0 }]] }
  }
};

// ============================================================
// WB-02: Auto-Assignment Engine (AI Smart Match)
// ============================================================
const WB02 = {
  name: "WB-02 Auto-Assignment Engine (AI Smart Match)",
  nodes: [
    doc("wb02-doc", "## WB-02: Auto-Assignment Engine (AI Smart Match)\n\n1. Webhook -> Validate -> AI Route Analyzer\n2. Fetch Officers -> AI Workload Balancer\n3. Parse & Assign -> Update DB\n\n**AI:** Expertise matching, workload balancing", [-50, -100]),
    { parameters: { httpMethod: "POST", path: "auto-assign", responseMode: "lastNode", responseData: "allEntries" }, id: "wb02-t1", name: "Assignment Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [0, 300] },
    code("wb02-t2", "Validate Complaint", 'const data = $input.first().json;\nif (!data.complaintId || !data.category) throw new Error("Missing complaintId or category");\nreturn [{ json: { ...data, validatedAt: new Date().toISOString() } }];', [220, 300]),
    { parameters: { systemMessage: "You are a government complaint routing AI. Given a complaint category, location, block, district, urgency, determine the best officer department and specialization.\n\nRespond JSON: {\"department\":\"dept\",\"specialization\":\"spec\",\"priorityScore\":1-10,\"estimatedComplexity\":\"simple|moderate|complex|critical\"}", options: { temperature: 0.1 } }, id: "wb02-t3", name: "AI Route Analyzer", type: "@n8n/n8n-nodes-langchain.chainLlm", typeVersion: 1.4, position: [440, 300] },
    code("wb02-t4", "Parse Route", 'const ai = $input.first().json;\nconst comp = $("Validate Complaint").first().json;\nlet route;\ntry { route = JSON.parse((ai.text||"{}").match(/\\{[\\s\\S]*\\}/)?.[0] || "{}"); } catch(e) { route = { department: "General Admin", specialization: "general", priorityScore: 5, estimatedComplexity: "moderate" }; }\nreturn [{ json: { complaint: comp, route, searchParams: { category: comp.category, district: comp.district || "any", urgency: comp.urgency } } }];', [660, 300]),
    http("wb02-t5", "Fetch Officers", "POST", "https://n8n.srv1347095.hstgr.cloud/api/officers/available", [880, 300], '={{ JSON.stringify({ category: $json.searchParams.category, district: $json.searchParams.district }) }}'),
    { parameters: { systemMessage: "You are an intelligent workload balancer. Given a complaint and list of officers with workload, expertise, location, score each and recommend the best.\n\nWeights: expertise 40%, workload 30%, location 20%, availability 10%\n\nJSON: {\"recommendedOfficer\":{\"id\":\"...\",\"name\":\"...\",\"score\":85,\"reason\":\"...\"},\"allScores\":[]}", options: { temperature: 0.1 } }, id: "wb02-t6", name: "AI Workload Balancer", type: "@n8n/n8n-nodes-langchain.chainLlm", typeVersion: 1.4, position: [1100, 300] },
    code("wb02-t7", "Parse & Assign", 'const ai = $input.first().json;\nconst prev = $("Parse Route").first().json;\nlet result;\ntry { result = JSON.parse((ai.text||"{}").match(/\\{[\\s\\S]*\\}/)?.[0] || "{}"); } catch(e) { result = { recommendedOfficer: { id: "fallback", name: "Admin", score: 50, reason: "Fallback" } }; }\nreturn [{ json: { complaintId: prev.complaint.complaintId, officer: result.recommendedOfficer, route: prev.route, assignedAt: new Date().toISOString() } }];', [1320, 300]),
    http("wb02-t8", "Update Complaint", "POST", "https://n8n.srv1347095.hstgr.cloud/api/complaints/assign", [1540, 300], '={{ JSON.stringify({ complaintId: $json.complaintId, officerId: $json.officer.id, officerName: $json.officer.name }) }}'),
    { parameters: { respondWith: "allIncomingItems" }, id: "wb02-t9", name: "Respond Webhook", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [1760, 300] }
  ],
  connections: {
    "Assignment Webhook": { main: [[{ node: "Validate Complaint", type: "main", index: 0 }]] },
    "Validate Complaint": { main: [[{ node: "AI Route Analyzer", type: "main", index: 0 }]] },
    "AI Route Analyzer": { main: [[{ node: "Parse Route", type: "main", index: 0 }]] },
    "Parse Route": { main: [[{ node: "Fetch Officers", type: "main", index: 0 }]] },
    "Fetch Officers": { main: [[{ node: "AI Workload Balancer", type: "main", index: 0 }]] },
    "AI Workload Balancer": { main: [[{ node: "Parse & Assign", type: "main", index: 0 }]] },
    "Parse & Assign": { main: [[{ node: "Update Complaint", type: "main", index: 0 }]] },
    "Update Complaint": { main: [[{ node: "Respond Webhook", type: "main", index: 0 }]] }
  }
};

// ============================================================
// WB-03: Citizen Status Notification
// ============================================================
const WB03 = {
  name: "WB-03 Citizen Status Notification",
  nodes: [
    doc("wb03-doc", "## WB-03: Citizen Status Notification\n\n1. Webhook -> Prepare Context -> AI Message Formatter\n2. Channel Router -> WhatsApp / SMS\n3. Send + Track", [-50, -100]),
    { parameters: { httpMethod: "POST", path: "notify-citizen", responseMode: "lastNode", responseData: "allEntries" }, id: "wb03-t1", name: "Status Change Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [0, 300] },
    code("wb03-t2", "Prepare Context", 'const data = $input.first().json;\nconst msgs = {\n  assigned: "Your complaint has been assigned to an officer.",\n  in_progress: "An officer is working on your complaint.",\n  resolved: "Your complaint has been resolved!",\n  escalated: "Your complaint has been escalated to senior officer.",\n  reopened: "Your complaint has been reopened."\n};\nreturn [{ json: { ...data, statusMessage: msgs[data.newStatus] || "Status updated to " + data.newStatus, ts: new Date().toISOString() } }];', [220, 300]),
    { parameters: { systemMessage: "Generate a warm Bengali+English notification for a West Bengal citizen about complaint status change. Include complaint ID, status, next steps. Be concise and empathetic.", options: { temperature: 0.3 } }, id: "wb03-t3", name: "AI Message Formatter", type: "@n8n/n8n-nodes-langchain.chainLlm", typeVersion: 1.4, position: [440, 300] },
    code("wb03-t4", "Build Notification", 'const ai = $input.first().json;\nconst prev = $("Prepare Context").first().json;\nreturn [{ json: { ...prev, formattedMessage: ai.text || prev.statusMessage } }];', [660, 300] ),
    { parameters: { rule: { conditions: { combinator: "or", conditions: [{ leftValue: "={{ $json.channel || 'whatsapp' }}", rightValue: "whatsapp", operator: { type: "string", operation: "equals" } }, { leftValue: "={{ $json.channel }}", rightValue: "", operator: { type: "string", operation: "equals" } }] } } }, id: "wb03-t5", name: "Channel Router", type: "n8n-nodes-base.if", typeVersion: 2.2, position: [880, 300] },
    { parameters: { body: "={{ $json.formattedMessage }}", options: {} }, id: "wb03-t6", name: "Send WhatsApp", type: "n8n-nodes-base.whatsApp", typeVersion: 1, position: [1100, 180] },
    http("wb03-t7", "Send SMS", "POST", "https://n8n.srv1347095.hstgr.cloud/api/sms/send", [1100, 420], '={{ JSON.stringify({ phone: $json.citizenPhone, message: $json.formattedMessage }) }}'),
    { parameters: { respondWith: "json", responseBody: '{"success":true}' }, id: "wb03-t8", name: "Respond Success", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [1320, 300] }
  ],
  connections: {
    "Status Change Webhook": { main: [[{ node: "Prepare Context", type: "main", index: 0 }]] },
    "Prepare Context": { main: [[{ node: "AI Message Formatter", type: "main", index: 0 }]] },
    "AI Message Formatter": { main: [[{ node: "Build Notification", type: "main", index: 0 }]] },
    "Build Notification": { main: [[{ node: "Channel Router", type: "main", index: 0 }]] },
    "Channel Router": { main: [[{ node: "Send WhatsApp", type: "main", index: 0 }], [{ node: "Send SMS", type: "main", index: 0 }]] },
    "Send WhatsApp": { main: [[{ node: "Respond Success", type: "main", index: 0 }]] },
    "Send SMS": { main: [[{ node: "Respond Success", type: "main", index: 0 }]] }
  }
};

// ============================================================
// WB-04: Officer Assignment Notification
// ============================================================
const WB04 = {
  name: "WB-04 Officer Assignment Notification",
  nodes: [
    doc("wb04-doc", "## WB-04: Officer Assignment Notification\n\n1. Webhook -> Build Briefing -> AI Generator\n2. Format -> Notify Officer WhatsApp\n3. Respond", [-50, -100]),
    { parameters: { httpMethod: "POST", path: "notify-officer", responseMode: "lastNode", responseData: "allEntries" }, id: "wb04-t1", name: "Assignment Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [0, 300] },
    code("wb04-t2", "Build Briefing Data", 'const data = $input.first().json;\nreturn [{ json: { ...data, briefing: { complaintId: data.complaintId, category: data.category, urgency: data.urgency, summary: data.summary, citizenName: data.citizenName, location: data.location, assignedAt: new Date().toISOString() } } }];', [220, 300]),
    { parameters: { systemMessage: "Generate a professional officer briefing notification for a new complaint assignment in West Bengal. Include complaint details, urgency, and recommended actions. Tone: professional, action-oriented. Include complaint ID.", options: { temperature: 0.2 } }, id: "wb04-t3", name: "AI Briefing Generator", type: "@n8n/n8n-nodes-langchain.chainLlm", typeVersion: 1.4, position: [440, 300] },
    code("wb04-t4", "Format Notification", 'const ai = $input.first().json;\nconst prev = $("Build Briefing Data").first().json;\nconst msg = (ai.text || ai.output || prev.briefing.summary);\nreturn [{ json: { ...prev, officerBriefing: msg, formattedWA: "*New Complaint Assigned*\\n\\n" + msg + "\\n\\nView: Portal Dashboard" } }];', [660, 300]),
    { parameters: { body: "={{ $json.formattedWA }}", options: {} }, id: "wb04-t5", name: "Notify Officer", type: "n8n-nodes-base.whatsApp", typeVersion: 1, position: [880, 300] },
    { parameters: { respondWith: "json", responseBody: '{"success":true}' }, id: "wb04-t6", name: "Respond", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [1100, 300] }
  ],
  connections: {
    "Assignment Webhook": { main: [[{ node: "Build Briefing Data", type: "main", index: 0 }]] },
    "Build Briefing Data": { main: [[{ node: "AI Briefing Generator", type: "main", index: 0 }]] },
    "AI Briefing Generator": { main: [[{ node: "Format Notification", type: "main", index: 0 }]] },
    "Format Notification": { main: [[{ node: "Notify Officer", type: "main", index: 0 }]] },
    "Notify Officer": { main: [[{ node: "Respond", type: "main", index: 0 }]] }
  }
};

// ============================================================
// WB-05: SLA Breach Escalation (AI)
// ============================================================
const WB05 = {
  name: "WB-05 SLA Breach Escalation (AI)",
  nodes: [
    doc("wb05-doc", "## WB-05: SLA Breach Escalation (AI)\n\n1. Schedule 2h -> Fetch Open -> AI SLA Analyzer\n2. Risk Classification -> Auto-Escalate\n3. AI Report -> Email Admin", [-50, -100]),
    { parameters: { rule: { interval: [{ field: "hours", hoursInterval: 2 }] } }, id: "wb05-t1", name: "Every 2 Hours", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 300] },
    http("wb05-t2", "Fetch Open", "GET", "https://n8n.srv1347095.hstgr.cloud/api/complaints?status=open&status=in_progress", [220, 300], null),
    code("wb05-t3", "Calculate SLA Risk", 'const complaints = $input.first().json?.data || $input.all();\nconst now = new Date();\nconst sla = { LOW: 14, MEDIUM: 7, HIGH: 3, CRITICAL: 1 };\nconst atRisk = (Array.isArray(complaints) ? complaints : []).filter(c => {\n  const days = (now - new Date(c.createdAt)) / 86400000;\n  const limit = sla[c.urgency] || 7;\n  return { ...c, daysOpen: Math.round(days*10)/10, slaDays: limit, riskPct: Math.round((days/limit)*100), atRisk: (days/limit) > 0.6 };\n}).filter(c => c.atRisk).sort((a,b) => b.riskPct - a.riskPct);\nreturn [{ json: { totalChecked: complaints.length, atRiskCount: atRisk.length, complaints: atRisk, checkTime: now.toISOString() } }];', [440, 300]),
    { parameters: { rule: { conditions: { combinator: "and", conditions: [{ leftValue: "={{ $json.atRiskCount }}", rightValue: 0, operator: { type: "number", operation: "gt" } }] } } }, id: "wb05-t4", name: "Has At-Risk?", type: "n8n-nodes-base.if", typeVersion: 2.2, position: [660, 300] },
    { parameters: { systemMessage: "You are a government SLA escalation analyst. Given at-risk complaints, generate: executive summary, individual escalation notes, recommended supervisor actions.\n\nJSON: {\"executiveSummary\":\"...\",\"escalations\":[{\"complaintId\":\"...\",\"riskLevel\":\"...\",\"recommendation\":\"...\"}],\"supervisorActions\":[\"...\"]}", options: { temperature: 0.2 } }, id: "wb05-t5", name: "AI Escalation Analyst", type: "@n8n/n8n-nodes-langchain.chainLlm", typeVersion: 1.4, position: [880, 200] },
    code("wb05-t6", "Parse AI", 'const ai = $input.first().json;\nconst prev = $("Calculate SLA Risk").first().json;\nlet analysis;\ntry { analysis = JSON.parse((ai.text||"{}").match(/\\{[\\s\\S]*\\}/)?.[0] || "{}"); } catch(e) { analysis = { executiveSummary: "SLA analysis pending", escalations: [], supervisorActions: ["Review complaints"] }; }\nreturn [{ json: { ...prev, analysis, processedAt: new Date().toISOString() } }];', [1100, 200]),
    http("wb05-t7", "Escalate DB", "POST", "https://n8n.srv1347095.hstgr.cloud/api/complaints/escalate-batch", [1320, 200], '={{ JSON.stringify({ escalations: $json.analysis.escalations || [] }) }}'),
    { parameters: { subject: "SLA Escalation Report", body: "={{ $json.analysis.executiveSummary }}\n\nAt-Risk: {{ $json.atRiskCount }} / {{ $json.totalChecked }}", options: {} }, id: "wb05-t8", name: "Email Admin", type: "n8n-nodes-base.emailSend", typeVersion: 2.2, position: [1540, 200] },
    { parameters: {}, id: "wb05-t9", name: "No Action", type: "n8n-nodes-base.noOp", typeVersion: 1, position: [880, 420] }
  ],
  connections: {
    "Every 2 Hours": { main: [[{ node: "Fetch Open", type: "main", index: 0 }]] },
    "Fetch Open": { main: [[{ node: "Calculate SLA Risk", type: "main", index: 0 }]] },
    "Calculate SLA Risk": { main: [[{ node: "Has At-Risk?", type: "main", index: 0 }]] },
    "Has At-Risk?": { main: [[{ node: "AI Escalation Analyst", type: "main", index: 0 }], [{ node: "No Action", type: "main", index: 0 }]] },
    "AI Escalation Analyst": { main: [[{ node: "Parse AI", type: "main", index: 0 }]] },
    "Parse AI": { main: [[{ node: "Escalate DB", type: "main", index: 0 }]] },
    "Escalate DB": { main: [[{ node: "Email Admin", type: "main", index: 0 }]] }
  }
};

// ============================================================
// WB-06: Daily Summary Report (AI Analytics)
// ============================================================
const WB06 = {
  name: "WB-06 Daily Summary Report (AI Analytics)",
  nodes: [
    doc("wb06-doc", "## WB-06: Daily Summary Report (AI)\n\n1. Schedule 9AM -> Fetch Data + Stats\n2. Aggregate -> AI Report Generator\n3. Email + Save to DB", [-50, -100]),
    { parameters: { rule: { interval: [{ field: "cronExpression", triggerAtHour: 9 }] } }, id: "wb06-t1", name: "Daily 9 AM", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 300] },
    http("wb06-t2", "Fetch Yesterday", "GET", "https://n8n.srv1347095.hstgr.cloud/api/complaints?period=yesterday", [220, 200], null),
    http("wb06-t3", "Fetch Stats", "GET", "https://n8n.srv1347095.hstgr.cloud/api/complaints/stats", [220, 400], null),
    code("wb06-t4", "Aggregate Data", 'const complaints = $input.first().json?.data || [];\nconst stats = $("Fetch Stats").first().json?.data || {};\nconst byCat = {}, byUrg = {}, byDist = {};\ncomplaints.forEach(c => {\n  byCat[c.category] = (byCat[c.category]||0) + 1;\n  byUrg[c.urgency] = (byUrg[c.urgency]||0) + 1;\n  if (c.district) byDist[c.district] = (byDist[c.district]||0) + 1;\n});\nreturn [{ json: { date: new Date().toLocaleDateString("en-IN"), newComplaints: complaints.length, byCategory: byCat, byUrgency: byUrg, byDistrict: byDist, activeTotal: stats.total || 0, resolvedToday: stats.resolvedToday || 0, complaints } }];', [440, 300]),
    { parameters: { systemMessage: "You are a government analytics AI. Generate a comprehensive daily report for WB Public Support System. Include: Executive Summary, Key Metrics, Category breakdown with insights, Urgency analysis, District hotspots, Trend comparison, Recommended actions, Anomaly alerts. Professional tone, data-driven, markdown format.", options: { temperature: 0.3 } }, id: "wb06-t5", name: "AI Report Generator", type: "@n8n/n8n-nodes-langchain.chainLlm", typeVersion: 1.4, position: [660, 300] },
    code("wb06-t6", "Build Report", 'const ai = $input.first().json;\nconst data = $("Aggregate Data").first().json;\nreturn [{ json: { report: ai.text || ai.output, data, generatedAt: new Date().toISOString() } }];', [880, 300]),
    { parameters: { subject: "WB Public Support - Daily Report", body: "={{ $json.report }}", options: {} }, id: "wb06-t7", name: "Email Report", type: "n8n-nodes-base.emailSend", typeVersion: 2.2, position: [1100, 200] },
    http("wb06-t8", "Save Report", "POST", "https://n8n.srv1347095.hstgr.cloud/api/reports/daily", [1100, 400], '={{ JSON.stringify({ report: $json.report, date: $json.data.date }) }}')
  ],
  connections: {
    "Daily 9 AM": { main: [[{ node: "Fetch Yesterday", type: "main", index: 0 }, { node: "Fetch Stats", type: "main", index: 0 }]] },
    "Fetch Yesterday": { main: [[{ node: "Aggregate Data", type: "main", index: 0 }]] },
    "Fetch Stats": { main: [[{ node: "Aggregate Data", type: "main", index: 0 }]] },
    "Aggregate Data": { main: [[{ node: "AI Report Generator", type: "main", index: 0 }]] },
    "AI Report Generator": { main: [[{ node: "Build Report", type: "main", index: 0 }]] },
    "Build Report": { main: [[{ node: "Email Report", type: "main", index: 0 }, { node: "Save Report", type: "main", index: 0 }]] }
  }
};

// ============================================================
// WB-07: AI Complaint Brain (RAG)
// ============================================================
const WB07 = {
  name: "WB-07 AI Complaint Brain (RAG)",
  nodes: [
    doc("wb07-doc", "## WB-07: AI Complaint Brain (RAG)\n\n1. Webhook -> AI Brain Agent (RAG)\n2. Process Response -> Recommendations\n3. Sync Airtable -> Return Intelligence", [-50, -100]),
    { parameters: { httpMethod: "POST", path: "ai-brain", responseMode: "lastNode", responseData: "allEntries" }, id: "wb07-t1", name: "Brain Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [0, 300] },
    { parameters: { options: { systemMessage: "You are the AI Brain of the West Bengal Public Support System. You provide intelligent complaint analysis using historical data and government policies.\n\nCapabilities:\n1. Similar Case Analysis - Find similar resolved complaints\n2. Resolution Suggestions - Recommend proven solutions\n3. Policy Compliance - Check relevant regulations\n4. Trend Analysis - Identify patterns\n5. Escalation Prediction - Assess escalation likelihood\n6. Citizen Sentiment - Analyze emotional tone\n\nAlways provide structured, actionable intelligence.", maxIterations: 5 } }, id: "wb07-t2", name: "AI Brain Agent", type: "@n8n/n8n-nodes-langchain.agent", typeVersion: 1.9, position: [220, 300] },
    code("wb07-t4", "Process Response", 'const agent = $input.first().json;\nconst query = $("Brain Webhook").first().json;\nreturn [{ json: { query: query.complaintId || query.query || "unknown", analysis: agent.text || agent.output || JSON.stringify(agent), analyzedAt: new Date().toISOString() } }];', [460, 300]),
    code("wb07-t5", "Recommendations", 'const data = $input.first().json;\nreturn [{ json: { ...data, recommendations: data.analysis.substring(0, 2000), smartActions: ["Review similar cases", "Apply suggested resolution", "Check policy compliance"], confidence: 0.85 } }];', [660, 300]),
    http("wb07-t6", "Sync Airtable", "POST", "https://n8n.srv1347095.hstgr.cloud/api/airtable/sync-analysis", [880, 300], '={{ JSON.stringify({ complaintId: $json.query, analysis: $json.analysis, recommendations: $json.recommendations }) }}'),
    { parameters: { respondWith: "json", responseBody: '={{ JSON.stringify({ success: true, analysis: $json.analysis, recommendations: $json.recommendations }) }}' }, id: "wb07-t7", name: "Return Intel", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [1100, 300] }
  ],
  connections: {
    "Brain Webhook": { main: [[{ node: "AI Brain Agent", type: "main", index: 0 }]] },
    "AI Brain Agent": { main: [[{ node: "Process Response", type: "main", index: 0 }]] },
    "Process Response": { main: [[{ node: "Recommendations", type: "main", index: 0 }]] },
    "Recommendations": { main: [[{ node: "Sync Airtable", type: "main", index: 0 }]] },
    "Sync Airtable": { main: [[{ node: "Return Intel", type: "main", index: 0 }]] }
  }
};

// ============================================================
// WB-08: Airtable Bidirectional Sync
// ============================================================
const WB08 = {
  name: "WB-08 Airtable Bidirectional Sync",
  nodes: [
    doc("wb08-doc", "## WB-08: Airtable Bidirectional Sync\n\n1. Schedule 30m -> Fetch Portal + Airtable\n2. Smart Diff Engine -> Has Changes?\n3. Push/Pull -> Sync both ways", [-50, -100]),
    { parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 30 }] } }, id: "wb08-t1", name: "Every 30 Min", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 300] },
    http("wb08-t2", "Fetch Portal", "GET", "https://n8n.srv1347095.hstgr.cloud/api/complaints?limit=100", [220, 200], null),
    http("wb08-t3", "Fetch Airtable", "GET", "https://n8n.srv1347095.hstgr.cloud/api/airtable/complaints", [220, 400], null),
    code("wb08-t4", "Smart Diff", 'const portal = $("Fetch Portal").first().json?.data || [];\nconst airtable = $("Fetch Airtable").first().json?.data || [];\nconst pMap = new Map(portal.map(c => [c.id, c]));\nconst aMap = new Map(airtable.map(c => [c.id, c]));\nconst toPush = [], toPull = [];\npMap.forEach((p, id) => {\n  const a = aMap.get(id);\n  if (!a || new Date(p.updatedAt) > new Date(a.updatedAt)) toPush.push(p);\n});\naMap.forEach((a, id) => {\n  const p = pMap.get(id);\n  if (!p || new Date(a.updatedAt) > new Date(p.updatedAt)) toPull.push(a);\n});\nreturn [{ json: { toPush: toPush.length, toPull: toPull.length, toPushData: toPush, toPullData: toPull, syncTime: new Date().toISOString() } }];', [440, 300]),
    { parameters: { rule: { conditions: { combinator: "or", conditions: [{ leftValue: "={{ $json.toPush }}", rightValue: 0, operator: { type: "number", operation: "gt" } }, { leftValue: "={{ $json.toPull }}", rightValue: 0, operator: { type: "number", operation: "gt" } }] } } }, id: "wb08-t5", name: "Has Changes?", type: "n8n-nodes-base.if", typeVersion: 2.2, position: [660, 300] },
    http("wb08-t6", "Push to Airtable", "POST", "https://n8n.srv1347095.hstgr.cloud/api/airtable/bulk-upsert", [880, 200], '={{ JSON.stringify({ records: $json.toPushData || [] }) }}'),
    http("wb08-t7", "Pull from Airtable", "POST", "https://n8n.srv1347095.hstgr.cloud/api/complaints/bulk-update", [880, 400], '={{ JSON.stringify({ records: $json.toPullData || [] }) }}'),
    { parameters: {}, id: "wb08-t8", name: "No Changes", type: "n8n-nodes-base.noOp", typeVersion: 1, position: [880, 600] }
  ],
  connections: {
    "Every 30 Min": { main: [[{ node: "Fetch Portal", type: "main", index: 0 }, { node: "Fetch Airtable", type: "main", index: 0 }]] },
    "Fetch Portal": { main: [[{ node: "Smart Diff", type: "main", index: 0 }]] },
    "Fetch Airtable": { main: [[{ node: "Smart Diff", type: "main", index: 0 }]] },
    "Smart Diff": { main: [[{ node: "Has Changes?", type: "main", index: 0 }]] },
    "Has Changes?": { main: [[{ node: "Push to Airtable", type: "main", index: 0 }, { node: "Pull from Airtable", type: "main", index: 0 }], [{ node: "No Changes", type: "main", index: 0 }]] }
  }
};

// ============================================================
// WB-09: Error Handler (AI Diagnostics)
// ============================================================
const WB09 = {
  name: "WB-09 Error Handler (AI Diagnostics)",
  nodes: [
    doc("wb09-doc", "## WB-09: Error Handler (AI Diagnostics)\n\n1. Error Trigger -> AI Error Analyzer\n2. Parse Diagnosis -> Severity Check\n3. Critical: Email + WhatsApp Alert\n4. Wait & Retry", [-50, -100]),
    { parameters: {}, id: "wb09-t1", name: "Error Trigger", type: "n8n-nodes-base.errorTrigger", typeVersion: 1, position: [0, 300] },
    { parameters: { systemMessage: "You are an n8n workflow error diagnostic AI. Analyze errors and provide: root cause diagnosis, severity (LOW/MEDIUM/HIGH/CRITICAL), suggested fix, prevention recommendation.\n\nJSON: {\"diagnosis\":\"...\",\"severity\":\"...\",\"suggestedFix\":\"...\",\"prevention\":\"...\",\"autoFixable\":true/false}", options: { temperature: 0.1 } }, id: "wb09-t2", name: "AI Error Analyzer", type: "@n8n/n8n-nodes-langchain.chainLlm", typeVersion: 1.4, position: [220, 300] },
    code("wb09-t3", "Parse Diagnosis", 'const ai = $input.first().json;\nconst error = $("Error Trigger").first().json;\nlet diag;\ntry { diag = JSON.parse((ai.text||"{}").match(/\\{[\\s\\S]*\\}/)?.[0] || "{}"); } catch(e) { diag = { diagnosis: "Unknown", severity: "MEDIUM", suggestedFix: "Review manually", prevention: "N/A", autoFixable: false }; }\nreturn [{ json: { error: { workflow: error.workflow?.name, node: error.execution?.error?.node?.name || "unknown", message: error.execution?.error?.message || "unknown", ts: error.execution?.startedAt || new Date().toISOString() }, diagnosis: diag, analyzedAt: new Date().toISOString() } }];', [440, 300]),
    { parameters: { rule: { conditions: { combinator: "and", conditions: [{ leftValue: "={{ $json.diagnosis.severity }}", rightValue: "CRITICAL", operator: { type: "string", operation: "equals" } }] } } }, id: "wb09-t4", name: "Is Critical?", type: "n8n-nodes-base.if", typeVersion: 2.2, position: [660, 300] },
    { parameters: { subject: "CRITICAL: Workflow Error - {{ $json.error.workflow }}", body: "Workflow: {{ $json.error.workflow }}\nNode: {{ $json.error.node }}\nError: {{ $json.error.message }}\n\nDiagnosis: {{ $json.diagnosis.diagnosis }}\nFix: {{ $json.diagnosis.suggestedFix }}", options: {} }, id: "wb09-t5", name: "Critical Email", type: "n8n-nodes-base.emailSend", typeVersion: 2.2, position: [880, 200] },
    { parameters: { body: "*Critical Workflow Error*\\n*Workflow:* {{ $json.error.workflow }}\\n*Error:* {{ $json.error.message }}\\n*Fix:* {{ $json.diagnosis.suggestedFix }}", options: {} }, id: "wb09-t6", name: "Critical WA", type: "n8n-nodes-base.whatsApp", typeVersion: 1, position: [880, 400] },
    { parameters: { amount: 300, unit: "seconds" }, id: "wb09-t7", name: "Wait 5 Min", type: "n8n-nodes-base.wait", typeVersion: 1.1, position: [1100, 200] }
  ],
  connections: {
    "Error Trigger": { main: [[{ node: "AI Error Analyzer", type: "main", index: 0 }]] },
    "AI Error Analyzer": { main: [[{ node: "Parse Diagnosis", type: "main", index: 0 }]] },
    "Parse Diagnosis": { main: [[{ node: "Is Critical?", type: "main", index: 0 }]] },
    "Is Critical?": { main: [[{ node: "Critical Email", type: "main", index: 0 }, { node: "Critical WA", type: "main", index: 0 }], []] },
    "Critical Email": { main: [[{ node: "Wait 5 Min", type: "main", index: 0 }]] }
  }
};

// ============================================================
// BUILD ALL
// ============================================================
async function buildAll() {
  const workflows = [
    { id: 'kceP9TClewDI9RMZ', data: WB01, label: 'WB-01' },
    { id: 'H7FuDC0qPG6iZnry', data: WB02, label: 'WB-02' },
    { id: 'l9r561Hejlf5GSmw', data: WB03, label: 'WB-03' },
    { id: 'L5s03O5pou5h5sRH', data: WB04, label: 'WB-04' },
    { id: '30fISSu1vbXsqm2o', data: WB05, label: 'WB-05' },
    { id: 'JRzTuWlEwqNzbkWk', data: WB06, label: 'WB-06' },
    { id: 'nLfawAROfgmGFeFu', data: WB07, label: 'WB-07' },
    { id: 'trLsm6dqEtnI2PnF', data: WB08, label: 'WB-08' },
    { id: '84oREiBrV1GmqO8f', data: WB09, label: 'WB-09' }
  ];

  console.log('🚀 Building all 9 WB workflows...\n');
  
  for (const wf of workflows) {
    try {
      const result = await updateWorkflow(wf.id, wf.data);
      console.log('✅ ' + wf.label + ': ' + result.name + ' (' + (result.nodes?.length || 0) + ' nodes)');
    } catch (e) {
      console.error('❌ ' + wf.label + ': ' + e.message);
    }
  }
  
  console.log('\n🎉 All workflows deployed!');
}

buildAll().catch(e => console.error('Fatal:', e.message));
