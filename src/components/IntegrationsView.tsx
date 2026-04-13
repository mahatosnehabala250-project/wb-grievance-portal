'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Zap, Database, ArrowRight, Copy, CheckCircle, AlertTriangle,
  RefreshCw, Settings, Eye, EyeOff, Link, Unlink, ExternalLink,
  Code, FileJson, Layers, GitBranch, Webhook, Shield,
  ChevronRight, Clock, Globe, Smartphone, MessageSquare,
  PhoneCall, Server, Monitor, CheckCircle2, XCircle,
  Info, BookOpen, Rocket, ArrowUpRight, Table, Key,
  ClipboardCopy, Loader2, Signal,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/auth-store';
import { motion } from 'framer-motion';
import { NAVY, NAVY_DARK } from '@/lib/constants';
import { authHeaders, safeGetLocalStorage, safeSetLocalStorage } from '@/lib/helpers';

/* ──────────────── animation variants ──────────────── */
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' as const } },
};

/* ──────────────── code block helper ──────────────── */
function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="relative group rounded-xl overflow-hidden border border-border/50">
      {label && (
        <div className="flex items-center justify-between px-4 py-2 bg-muted/80 border-b border-border/50">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
          <button onClick={handleCopy} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            {copied ? <CheckCircle className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      <pre className="p-4 text-xs leading-relaxed overflow-x-auto custom-scrollbar" style={{ background: 'linear-gradient(135deg, #0d1117, #161b22)' }}>
        <code className="text-emerald-300 font-mono whitespace-pre">{code}</code>
      </pre>
      {!label && (
        <button onClick={handleCopy} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg bg-white/10 hover:bg-white/20">
          {copied ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-gray-400" />}
        </button>
      )}
    </div>
  );
}

/* ──────────────── Status Dot ──────────────── */
function StatusDot({ status }: { status: 'connected' | 'error' | 'pending' | 'disconnected' }) {
  const cfg: Record<string, { color: string; label: string; dot: string }> = {
    connected: { color: 'text-emerald-600 dark:text-emerald-400', label: 'Connected', dot: 'bg-emerald-500' },
    error: { color: 'text-red-600 dark:text-red-400', label: 'Error', dot: 'bg-red-500' },
    pending: { color: 'text-amber-600 dark:text-amber-400', label: 'Pending', dot: 'bg-amber-500' },
    disconnected: { color: 'text-gray-500', label: 'Disconnected', dot: 'bg-gray-400' },
  };
  const c = cfg[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${c.color}`}>
      <span className="relative flex h-2 w-2">
        {status === 'connected' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${c.dot}`} />
      </span>
      {c.label}
    </span>
  );
}

/* ──────────────── N8N Flow Diagram ──────────────── */
function N8NFlowDiagram() {
  const nodes = [
    { icon: Smartphone, label: 'WhatsApp / SMS', color: '#25D366', sublabel: 'Citizen Report' },
    { icon: PhoneCall, label: 'Phone Call', color: '#0EA5E9', sublabel: 'IVR Input' },
    { icon: GitBranch, label: 'n8n Workflow', color: '#EA580C', sublabel: 'AI Processing' },
    { icon: Webhook, label: 'Portal API', color: '#0A2463', sublabel: 'Webhook POST' },
    { icon: Database, label: 'Database', color: '#7C3AED', sublabel: 'SQLite Store' },
    { icon: Monitor, label: 'Dashboard', color: '#16A34A', sublabel: 'Analytics & Status' },
  ];
  return (
    <div className="relative overflow-x-auto pb-2">
      <div className="flex items-center gap-0 min-w-[640px] justify-center">
        {nodes.map((node, i) => (
          <div key={node.label} className="flex items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.12 }}
              className="flex flex-col items-center gap-1.5 w-[100px]"
            >
              <div
                className="h-12 w-12 rounded-xl flex items-center justify-center shadow-lg border border-white/20"
                style={{ backgroundColor: node.color }}
              >
                <node.icon className="h-5 w-5 text-white" />
              </div>
              <span className="text-[11px] font-bold text-foreground text-center leading-tight">{node.label}</span>
              <span className="text-[9px] text-muted-foreground text-center">{node.sublabel}</span>
            </motion.div>
            {i < nodes.length - 1 && (
              <motion.div
                initial={{ opacity: 0, scaleX: 0 }}
                animate={{ opacity: 1, scaleX: 1 }}
                transition={{ delay: i * 0.12 + 0.06 }}
                className="flex items-center mx-1"
              >
                <div className="w-6 h-[2px] rounded-full bg-gradient-to-r from-muted-foreground/40 to-muted-foreground/20" />
                <ChevronRight className="h-3 w-3 text-muted-foreground/40 -ml-1" />
              </motion.div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────── n8n Workflow JSON ──────────────── */
const N8N_WORKFLOW_JSON = `{
  "name": "WB Grievance Portal - Complaint Ingestion",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "incoming-complaint",
        "responseMode": "responseNode"
      },
      "name": "WhatsApp Webhook Trigger",
      "type": "n8n-nodes-base.webhook",
      "position": [250, 300]
    },
    {
      "parameters": {
        "jsCode": "const body = $input.first().json.body;\\nconst complaint = {\\n  citizenName: body.sender_name || 'WhatsApp User',\\n  phone: body.sender_phone || '',\\n  issue: body.message || 'No issue provided',\\n  category: 'Other',\\n  block: body.location_block || 'Unknown',\\n  district: body.location_district || 'Unknown',\\n  urgency: 'MEDIUM',\\n  source: 'WhatsApp'\\n};\\nreturn [{ json: complaint }];"
      },
      "name": "Format Complaint Data",
      "type": "n8n-nodes-base.code",
      "position": [470, 300]
    },
    {
      "parameters": {
        "url": "{{ $env.WB_PORTAL_URL }}/api/webhook/complaint",
        "method": "POST",
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            { "name": "citizenName", "value": "={{ $json.citizenName }}" },
            { "name": "phone", "value": "={{ $json.phone }}" },
            { "name": "issue", "value": "={{ $json.issue }}" },
            { "name": "category", "value": "={{ $json.category }}" },
            { "name": "block", "value": "={{ $json.block }}" },
            { "name": "district", "value": "={{ $json.district }}" },
            { "name": "urgency", "value": "={{ $json.urgency }}" },
            { "name": "source", "value": "={{ $json.source }}" }
          ]
        }
      },
      "name": "POST to WB Portal",
      "type": "n8n-nodes-base.httpRequest",
      "position": [690, 300]
    },
    {
      "parameters": {
        "jsCode": "const resp = $input.first().json;\\nconst ticketNo = resp.ticketNo || 'Unknown';\\nconst msg = \`Thank you for your complaint! Your ticket number is: \${ticketNo}. We will review it shortly. - WB Grievance Portal\`;\\nreturn [{ json: { message: msg, phone: $input.first().json.phone } }];"
      },
      "name": "Build Reply Message",
      "type": "n8n-nodes-base.code",
      "position": [910, 300]
    },
    {
      "parameters": {
        "phoneNumberId": "{{ $env.WA_PHONE_NUMBER_ID }}",
        "recipientPhoneNumber": "={{ $json.phone }}",
        "text": "={{ $json.message }}"
      },
      "name": "Send WhatsApp Reply",
      "type": "n8n-nodes-base.whatsApp",
      "position": [1130, 300]
    }
  ],
  "connections": {
    "WhatsApp Webhook Trigger": {
      "main": [[{ "node": "Format Complaint Data", "type": "main", "index": 0 }]]
    },
    "Format Complaint Data": {
      "main": [[{ "node": "POST to WB Portal", "type": "main", "index": 0 }]]
    },
    "POST to WB Portal": {
      "main": [[{ "node": "Build Reply Message", "type": "main", "index": 0 }]]
    },
    "Build Reply Message": {
      "main": [[{ "node": "Send WhatsApp Reply", "type": "main", "index": 0 }]]
    }
  }
}`;

/* ──────────────── Webhook Payload Example ──────────────── */
const WEBHOOK_PAYLOAD = `{
  "citizenName": "Rajesh Kumar",
  "phone": "+91 98765 43210",
  "issue": "No water supply in our area for the past 3 days. Multiple families affected.",
  "category": "Water Supply",
  "block": "Krishnanagar-I",
  "district": "Nadia",
  "urgency": "HIGH",
  "source": "WhatsApp"
}`;

const WEBHOOK_RESPONSE = `{
  "success": true,
  "ticketNo": "WB-2025-00182",
  "message": "Complaint registered successfully",
  "complaintId": "clx..."
}`;

/* ──────────────── API Endpoints ──────────────── */
const API_ENDPOINTS = [
  { method: 'POST', path: '/api/webhook/complaint', desc: 'Receive complaint from n8n / external source', auth: 'None (public endpoint)' },
  { method: 'GET', path: '/api/complaints', desc: 'List complaints with filters (status, district, urgency, page)', auth: 'JWT Bearer' },
  { method: 'GET', path: '/api/complaints/[id]', desc: 'Get complaint details by ID', auth: 'JWT Bearer' },
  { method: 'PATCH', path: '/api/complaints/[id]', desc: 'Update complaint status, resolution, assignment', auth: 'JWT Bearer' },
  { method: 'PATCH', path: '/api/complaints/[id]/escalate', desc: 'Escalate urgency level (LOW → MEDIUM → HIGH → CRITICAL)', auth: 'JWT Bearer' },
  { method: 'POST', path: '/api/complaints/bulk', desc: 'Bulk status update for selected complaints', auth: 'JWT Bearer' },
  { method: 'GET', path: '/api/search?q=xxx', desc: 'Global search across complaints and users', auth: 'JWT Bearer' },
  { method: 'GET', path: '/api/dashboard', desc: 'Dashboard statistics (role-filtered)', auth: 'JWT Bearer' },
  { method: 'GET', path: '/api/dashboard?from=...&to=...', desc: 'Dashboard stats for custom date range', auth: 'JWT Bearer' },
  { method: 'POST', path: '/api/integrations/test-webhook', desc: 'Send a test complaint via webhook (mock data)', auth: 'JWT Bearer' },
  { method: 'POST', path: '/api/integrations/airtable-test', desc: 'Test Airtable connection', auth: 'JWT Bearer' },
  { method: 'POST', path: '/api/integrations/airtable-sync', desc: 'Sync all complaints to Airtable', auth: 'JWT Bearer' },
  { method: 'POST', path: '/api/auth/login', desc: 'Authenticate user and get JWT token', auth: 'None' },
  { method: 'GET', path: '/api/auth/me', desc: 'Verify current session', auth: 'Cookie' },
];

/* ──────────────── Airtable Field Mapping ──────────────── */
const FIELD_MAPPINGS = [
  { our: 'ticketNo', airtable: 'Ticket Number', type: 'Single line text' },
  { our: 'citizenName', airtable: 'Citizen Name', type: 'Single line text' },
  { our: 'phone', airtable: 'Phone', type: 'Phone number' },
  { our: 'issue', airtable: 'Issue Description', type: 'Long text' },
  { our: 'category', airtable: 'Category', type: 'Single select' },
  { our: 'block', airtable: 'Block', type: 'Single line text' },
  { our: 'district', airtable: 'District', type: 'Single line text' },
  { our: 'urgency', airtable: 'Urgency', type: 'Single select: Low/Medium/High/Critical' },
  { our: 'status', airtable: 'Status', type: 'Single select: Open/In Progress/Resolved/Rejected' },
  { our: 'source', airtable: 'Source', type: 'Single select: WhatsApp/Manual/Web' },
  { our: 'createdAt', airtable: 'Created At', type: 'Date' },
  { our: 'updatedAt', airtable: 'Updated At', type: 'Date' },
];

/* ══════════════════════════════════════════════════════════
   INTEGRATIONS VIEW — MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */
export default function IntegrationsView() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';

  // ── Webhook test state ──
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookResult, setWebhookResult] = useState<string | null>(null);
  const [webhookStatus, setWebhookStatus] = useState<'connected' | 'error' | 'pending' | 'disconnected'>('pending');

  // ── Airtable config state ──
  const [airtableToken, setAirtableToken] = useState('');
  const [airtableBaseId, setAirtableBaseId] = useState('');
  const [airtableTableName, setAirtableTableName] = useState('Complaints');
  const [showToken, setShowToken] = useState(false);
  const [airtableTestLoading, setAirtableTestLoading] = useState(false);
  const [airtableSyncLoading, setAirtableSyncLoading] = useState(false);
  const [airtableStatus, setAirtableStatus] = useState<'connected' | 'error' | 'pending' | 'disconnected'>('disconnected');
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // ── Webhook URL ──
  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/webhook/complaint` : '/api/webhook/complaint';

  /* ── Webhook Status Check ── */
  const checkWebhookStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/webhook/complaint', { method: 'OPTIONS' });
      if (res.ok || res.status === 405) {
        setWebhookStatus('connected');
      } else {
        setWebhookStatus('error');
      }
    } catch {
      setWebhookStatus('error');
    }
  }, []);

  // ── Initialize from localStorage ──
  useEffect(() => {
    setAirtableToken(safeGetLocalStorage('wb_airtable_token') || '');
    setAirtableBaseId(safeGetLocalStorage('wb_airtable_base_id') || '');
    setAirtableTableName(safeGetLocalStorage('wb_airtable_table_name') || 'Complaints');
    setLastSyncTime(safeGetLocalStorage('wb_airtable_last_sync') || null);
    // Check webhook status on mount
    checkWebhookStatus();
  }, [checkWebhookStatus]);

  // ── Persist Airtable config ──
  useEffect(() => { safeSetLocalStorage('wb_airtable_token', airtableToken); }, [airtableToken]);
  useEffect(() => { safeSetLocalStorage('wb_airtable_base_id', airtableBaseId); }, [airtableBaseId]);
  useEffect(() => { safeSetLocalStorage('wb_airtable_table_name', airtableTableName); }, [airtableTableName]);

  /* ── Test Webhook ── */
  const handleTestWebhook = useCallback(async () => {
    if (!isAdmin) return;
    setWebhookLoading(true);
    setWebhookResult(null);
    try {
      const res = await fetch('/api/integrations/test-webhook', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      setWebhookResult(JSON.stringify(data, null, 2));
      if (res.ok) {
        setWebhookStatus('connected');
        toast.success('Webhook test successful', { description: data.ticketNo ? `Ticket: ${data.ticketNo}` : 'Complaint created' });
      } else {
        setWebhookStatus('error');
        toast.error('Webhook test failed', { description: data.error || 'Unknown error' });
      }
    } catch {
      setWebhookResult(JSON.stringify({ error: 'Network error - could not reach the server' }, null, 2));
      setWebhookStatus('error');
      toast.error('Connection failed', { description: 'Could not reach the server' });
    }
    setWebhookLoading(false);
  }, [isAdmin]);

  /* ── Test Airtable Connection ── */
  const handleTestAirtable = useCallback(async () => {
    if (!isAdmin) return;
    if (!airtableToken || !airtableBaseId) {
      toast.error('Missing configuration', { description: 'Please enter your Airtable Personal Access Token and Base ID' });
      return;
    }
    setAirtableTestLoading(true);
    try {
      const res = await fetch('/api/integrations/airtable-test', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: airtableToken, baseId: airtableBaseId, tableName: airtableTableName }),
      });
      const data = await res.json();
      if (res.ok) {
        setAirtableStatus('connected');
        toast.success('Airtable connection successful', { description: data.message || 'Connected to your Airtable base' });
      } else {
        setAirtableStatus('error');
        toast.error('Airtable connection failed', { description: data.error || 'Check your credentials' });
      }
    } catch {
      setAirtableStatus('error');
      toast.error('Connection failed', { description: 'Could not reach the server' });
    }
    setAirtableTestLoading(false);
  }, [isAdmin, airtableToken, airtableBaseId, airtableTableName]);

  /* ── Sync Airtable ── */
  const handleSyncAirtable = useCallback(async () => {
    if (!isAdmin) return;
    if (!airtableToken || !airtableBaseId) {
      toast.error('Missing configuration', { description: 'Please enter your Airtable credentials and test connection first' });
      return;
    }
    setAirtableSyncLoading(true);
    try {
      const res = await fetch('/api/integrations/airtable-sync', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: airtableToken, baseId: airtableBaseId, tableName: airtableTableName }),
      });
      const data = await res.json();
      const now = new Date().toLocaleString('en-IN');
      if (res.ok) {
        setAirtableStatus('connected');
        setLastSyncTime(now);
        safeSetLocalStorage('wb_airtable_last_sync', now);
        toast.success('Sync completed', { description: data.message || `${data.synced || 0} complaints synced` });
      } else {
        setAirtableStatus('error');
        toast.error('Sync failed', { description: data.error || 'Check your configuration' });
      }
    } catch {
      setAirtableStatus('error');
      toast.error('Sync failed', { description: 'Could not reach the server' });
    }
    setAirtableSyncLoading(false);
  }, [isAdmin, airtableToken, airtableBaseId, airtableTableName]);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ═══ Page Header ═══ */}
      <div className="relative overflow-hidden rounded-2xl shadow-lg">
        <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${NAVY_DARK}, ${NAVY}, #1a3a7a)` }} />
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 50%, white 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="relative px-6 py-8 sm:px-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-12 w-12 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
              <Layers className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white tracking-tight">Integrations Hub</h2>
              <p className="text-sm text-blue-200/70">Connect n8n workflows, Airtable, and external services</p>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-4 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20">
              <Webhook className="h-3.5 w-3.5 text-emerald-300" />
              <span className="text-xs font-medium text-white">n8n Webhooks</span>
              <StatusDot status={webhookStatus} />
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20">
              <Table className="h-3.5 w-3.5 text-sky-300" />
              <span className="text-xs font-medium text-white">Airtable Sync</span>
              <StatusDot status={airtableStatus} />
            </div>
            {isAdmin && (
              <Badge className="bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 text-[10px]">
                <Shield className="h-3 w-3 mr-1" /> Admin Access
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Tabs ═══ */}
      <Tabs defaultValue="n8n" className="space-y-5">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="n8n" className="gap-1.5 text-xs">
            <Zap className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">n8n Workflow</span>
            <span className="sm:hidden">n8n</span>
          </TabsTrigger>
          <TabsTrigger value="airtable" className="gap-1.5 text-xs">
            <Database className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Airtable</span>
            <span className="sm:hidden">DB</span>
          </TabsTrigger>
          <TabsTrigger value="api" className="gap-1.5 text-xs">
            <Code className="h-3.5 w-3.5" />
            API Docs
          </TabsTrigger>
          <TabsTrigger value="setup" className="gap-1.5 text-xs">
            <Rocket className="h-3.5 w-3.5" />
            Setup
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════
            TAB 1: n8n INTEGRATION
            ═══════════════════════════════════════════════════════ */}
        <TabsContent value="n8n">
          <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
            {/* Architecture Diagram */}
            <motion.div variants={fadeUp}>
              <Card className="border-0 shadow-sm overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <GitBranch className="h-4 w-4" style={{ color: NAVY }} />
                    Integration Architecture
                  </CardTitle>
                  <CardDescription className="text-xs">
                    How citizen complaints flow from WhatsApp/SMS through n8n to the portal
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <N8NFlowDiagram />
                </CardContent>
              </Card>
            </motion.div>

            {/* How n8n Works */}
            <motion.div variants={fadeUp}>
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Info className="h-4 w-4" style={{ color: NAVY }} />
                    How n8n Integration Works
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { step: 1, icon: MessageSquare, title: 'Citizen Reports', desc: 'Citizens send complaints via WhatsApp, SMS, or phone calls through government helplines.' },
                      { step: 2, icon: GitBranch, title: 'n8n Processes', desc: 'n8n receives the message, uses AI to classify category and urgency, formats the data.' },
                      { step: 3, icon: Webhook, title: 'Webhook POST', desc: 'n8n sends a POST request to /api/webhook/complaint with structured complaint data.' },
                      { step: 4, icon: CheckCircle2, title: 'Auto-Confirmation', desc: 'Portal creates a ticket and n8n sends back the ticket number to the citizen via WhatsApp.' },
                    ].map((s) => (
                      <div key={s.step} className="flex items-start gap-3 p-3 rounded-xl bg-muted/50 border border-border/50">
                        <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 font-black text-xs text-white" style={{ backgroundColor: NAVY }}>
                          {s.step}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                            <s.icon className="h-3.5 w-3.5" style={{ color: NAVY }} />
                            {s.title}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{s.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Webhook URL & Payload */}
            <motion.div variants={fadeUp}>
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Link className="h-4 w-4" style={{ color: NAVY }} />
                    Webhook Endpoint
                  </CardTitle>
                  <CardDescription className="text-xs">The URL that n8n should POST complaint data to</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* URL Display */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-4 py-2.5 rounded-xl bg-muted/80 border border-border/50 font-mono text-xs text-foreground truncate">
                      {webhookUrl}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(webhookUrl);
                        toast.success('Webhook URL copied');
                      }}
                      className="h-9 gap-1.5 text-xs shrink-0"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                  </div>

                  {/* Connection Status */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50 border border-border/50">
                    <div className="flex items-center gap-2">
                      <Signal className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs font-semibold text-foreground">Connection Status</span>
                    </div>
                    <StatusDot status={webhookStatus} />
                  </div>

                  <Separator />

                  {/* Required Payload */}
                  <div>
                    <p className="text-xs font-bold text-foreground mb-2">Required JSON Payload:</p>
                    <CodeBlock code={WEBHOOK_PAYLOAD} label="POST /api/webhook/complaint" />
                  </div>

                  {/* Example Response */}
                  <div>
                    <p className="text-xs font-bold text-foreground mb-2">Example Response:</p>
                    <CodeBlock code={WEBHOOK_RESPONSE} label="200 OK Response" />
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Webhook Test Panel */}
            <motion.div variants={fadeUp}>
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-500" />
                    Webhook Test Panel
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Send a test complaint to verify the webhook is working
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isAdmin ? (
                    <>
                      <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30">
                        <div className="flex items-start gap-2.5">
                          <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                          <div className="text-xs text-amber-700 dark:text-amber-300">
                            <p className="font-semibold mb-0.5">What happens when you test?</p>
                            <p className="text-amber-600/80 dark:text-amber-400/80">A mock complaint will be sent to the webhook with sample data. You will see the response including the generated ticket number.</p>
                          </div>
                        </div>
                      </div>
                      <Button
                        onClick={handleTestWebhook}
                        disabled={webhookLoading}
                        className="gap-2 text-sm font-semibold"
                        style={{ backgroundColor: NAVY, color: 'white' }}
                      >
                        {webhookLoading ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Testing...</>
                        ) : (
                          <><Zap className="h-4 w-4" /> Send Test Complaint</>
                        )}
                      </Button>
                      {webhookResult && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                        >
                          <CodeBlock
                            code={webhookResult}
                            label={webhookResult.includes('"success": true') ? '✅ Success Response' : '❌ Error Response'}
                          />
                        </motion.div>
                      )}
                    </>
                  ) : (
                    <div className="p-4 rounded-xl bg-muted/50 border border-border/50 text-center">
                      <Shield className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">Webhook testing is available for <span className="font-bold text-foreground">Administrators</span> only.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* n8n Workflow JSON Template */}
            <motion.div variants={fadeUp}>
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <FileJson className="h-4 w-4" style={{ color: NAVY }} />
                    n8n Workflow Template
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Import this JSON into n8n to get started quickly. Click copy and paste into n8n&apos;s workflow import dialog.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <Smartphone className="h-3 w-3" /> WhatsApp Trigger
                    </Badge>
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <Code className="h-3 w-3" /> Format Data
                    </Badge>
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <Webhook className="h-3 w-3" /> HTTP POST
                    </Badge>
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <MessageSquare className="h-3 w-3" /> WhatsApp Reply
                    </Badge>
                  </div>
                  <CodeBlock code={N8N_WORKFLOW_JSON} label="n8n Workflow JSON — Import Ready" />
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 2: AIRTABLE INTEGRATION
            ═══════════════════════════════════════════════════════ */}
        <TabsContent value="airtable">
          <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
            {/* Explanation */}
            <motion.div variants={fadeUp}>
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Database className="h-4 w-4" style={{ color: NAVY }} />
                    Why Airtable?
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Use Airtable as an external spreadsheet for advanced reporting and cross-department sharing
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { icon: Layers, title: 'Advanced Reporting', desc: 'Airtable Views, Grouping, Filtering, and Charts for powerful analysis' },
                      { icon: Globe, title: 'Cross-Department', desc: 'Share live complaint data with other departments without portal access' },
                      { icon: RefreshCw, title: 'Two-Way Sync', desc: 'Keep Airtable and Portal in sync with one-click synchronization' },
                    ].map((item) => (
                      <div key={item.title} className="p-4 rounded-xl bg-muted/50 border border-border/50 text-center">
                        <div className="h-10 w-10 rounded-xl mx-auto mb-2 flex items-center justify-center" style={{ backgroundColor: `${NAVY}15` }}>
                          <item.icon className="h-5 w-5" style={{ color: NAVY }} />
                        </div>
                        <p className="text-xs font-bold text-foreground">{item.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">{item.desc}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Field Mapping */}
            <motion.div variants={fadeUp}>
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <ArrowRight className="h-4 w-4" style={{ color: NAVY }} />
                    Field Mapping
                  </CardTitle>
                  <CardDescription className="text-xs">
                    How portal fields map to Airtable columns
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-xl border border-border/50 overflow-hidden">
                    <div className="overflow-x-auto custom-scrollbar">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/80 border-b border-border/50">
                            <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px]">Portal Field</th>
                            <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px]">→</th>
                            <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px]">Airtable Field</th>
                            <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px] hidden sm:table-cell">Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {FIELD_MAPPINGS.map((f, i) => (
                            <tr key={f.our} className={`border-b border-border/30 ${i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}`}>
                              <td className="px-4 py-2.5">
                                <code className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-semibold">
                                  {f.our}
                                </code>
                              </td>
                              <td className="px-4 py-2.5 text-muted-foreground">
                                <ArrowRight className="h-3 w-3" />
                              </td>
                              <td className="px-4 py-2.5 font-medium text-foreground">{f.airtable}</td>
                              <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                                <Badge variant="outline" className="text-[10px] font-normal">{f.type}</Badge>
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

            {/* Sync Configuration Panel */}
            <motion.div variants={fadeUp}>
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Settings className="h-4 w-4" style={{ color: NAVY }} />
                    Sync Configuration
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Configure your Airtable connection and sync complaints
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isAdmin ? (
                    <>
                      {/* Connection Status */}
                      <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50 border border-border/50">
                        <div className="flex items-center gap-2">
                          <Signal className="h-4 w-4 text-muted-foreground" />
                          <span className="text-xs font-semibold text-foreground">Airtable Status</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {lastSyncTime && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Last sync: {lastSyncTime}
                            </span>
                          )}
                          <StatusDot status={airtableStatus} />
                        </div>
                      </div>

                      {/* Token Input */}
                      <div className="space-y-2">
                        <Label htmlFor="airtable-token" className="text-xs font-semibold flex items-center gap-1.5">
                          <Key className="h-3.5 w-3.5" />
                          Personal Access Token <span className="text-red-500">*</span>
                        </Label>
                        <div className="relative">
                          <Input
                            id="airtable-token"
                            type={showToken ? 'text' : 'password'}
                            placeholder="pat..."
                            value={airtableToken}
                            onChange={(e) => setAirtableToken(e.target.value)}
                            className="h-9 text-sm pr-10 font-mono"
                          />
                          <button
                            onClick={() => setShowToken(!showToken)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Create at airtable.com/create/tokens — Requires &quot;data.records:read&quot; and &quot;data.records:write&quot; scopes
                        </p>
                      </div>

                      {/* Base ID */}
                      <div className="space-y-2">
                        <Label htmlFor="airtable-base-id" className="text-xs font-semibold flex items-center gap-1.5">
                          <Database className="h-3.5 w-3.5" />
                          Base ID <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="airtable-base-id"
                          placeholder="appXXXXXXXXXXXXXX"
                          value={airtableBaseId}
                          onChange={(e) => setAirtableBaseId(e.target.value)}
                          className="h-9 text-sm font-mono"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Found in your Airtable base URL: airtable.com/app{'{'}XXXXXX{'}'}/...
                        </p>
                      </div>

                      {/* Table Name */}
                      <div className="space-y-2">
                        <Label htmlFor="airtable-table" className="text-xs font-semibold flex items-center gap-1.5">
                          <Table className="h-3.5 w-3.5" />
                          Table Name
                        </Label>
                        <Input
                          id="airtable-table"
                          placeholder="Complaints"
                          value={airtableTableName}
                          onChange={(e) => setAirtableTableName(e.target.value)}
                          className="h-9 text-sm"
                        />
                      </div>

                      {/* Action Buttons */}
                      <div className="flex flex-col sm:flex-row gap-2 pt-1">
                        <Button
                          onClick={handleTestAirtable}
                          disabled={airtableTestLoading || !airtableToken || !airtableBaseId}
                          variant="outline"
                          className="h-9 gap-2 text-xs flex-1"
                        >
                          {airtableTestLoading ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing...</>
                          ) : (
                            <><Link className="h-3.5 w-3.5" /> Test Connection</>
                          )}
                        </Button>
                        <Button
                          onClick={handleSyncAirtable}
                          disabled={airtableSyncLoading || !airtableToken || !airtableBaseId || airtableStatus !== 'connected'}
                          className="h-9 gap-2 text-xs flex-1"
                          style={{ backgroundColor: NAVY, color: 'white' }}
                        >
                          {airtableSyncLoading ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Syncing...</>
                          ) : (
                            <><RefreshCw className="h-3.5 w-3.5" /> Sync Data</>
                          )}
                        </Button>
                      </div>

                      {airtableStatus !== 'connected' && airtableStatus !== 'disconnected' && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Test connection before syncing data
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="p-6 rounded-xl bg-muted/50 border border-border/50 text-center">
                      <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                      <p className="text-sm font-semibold text-foreground">Read-Only Access</p>
                      <p className="text-xs text-muted-foreground mt-1">Airtable sync configuration is available for <span className="font-bold text-foreground">Administrators</span> only.</p>
                      <p className="text-xs text-muted-foreground mt-1">Contact your system administrator to set up Airtable integration.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* How to Create Airtable Base */}
            <motion.div variants={fadeUp}>
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <BookOpen className="h-4 w-4" style={{ color: NAVY }} />
                    Step-by-Step: Create Your Airtable Base
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[
                      { step: 1, title: 'Create Airtable Account', desc: 'Go to airtable.com and sign up (free tier supports 1,200 records)' },
                      { step: 2, title: 'Create a New Base', desc: 'Click "Create a base" → "Start from scratch". Name it "WB Grievance Portal"' },
                      { step: 3, title: 'Add Table', desc: 'Rename "Table 1" to "Complaints" (this matches the default table name)' },
                      { step: 4, title: 'Add Fields (Columns)', desc: 'Add the fields from the mapping table above. Use the exact types specified (Single line text, Long text, Single select, Phone number, Date).' },
                      { step: 5, title: 'Configure Select Options', desc: 'For Category select: Water Supply, Road Damage, Electricity, Sanitation, Healthcare, Education, Public Transport, Agriculture, Housing, Other. For Urgency: Low, Medium, High, Critical. For Status: Open, In Progress, Resolved, Rejected. For Source: WhatsApp, Manual, Web.' },
                      { step: 6, title: 'Get API Token', desc: 'Go to airtable.com/create/tokens → Create new token → Add scopes: "data.records:read", "data.records:write" → Add your base → Copy the token.' },
                      { step: 7, title: 'Find Your Base ID', desc: 'Open your base in Airtable → Look at the URL: airtable.com/appXXXXXXXXXXXXXX/... — the appXXXXXXXXXXXXXX part is your Base ID.' },
                      { step: 8, title: 'Connect in Portal', desc: 'Come back to this page, enter your token and Base ID above, click "Test Connection", then "Sync Data".' },
                    ].map((s) => (
                      <div key={s.step} className="flex items-start gap-3 p-3 rounded-xl bg-muted/50 border border-border/50 hover:bg-muted/80 transition-colors">
                        <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-black text-white" style={{ backgroundColor: NAVY }}>
                          {s.step}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-foreground">{s.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{s.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 p-3 rounded-xl bg-sky-50 dark:bg-sky-950/20 border border-sky-200/50 dark:border-sky-800/30">
                    <a
                      href="https://airtable.com/developers/web"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Airtable API Documentation
                      <ArrowUpRight className="h-3 w-3" />
                    </a>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 3: API DOCUMENTATION
            ═══════════════════════════════════════════════════════ */}
        <TabsContent value="api">
          <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
            {/* Auth Info */}
            <motion.div variants={fadeUp}>
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Shield className="h-4 w-4" style={{ color: NAVY }} />
                    Authentication
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="p-4 rounded-xl bg-muted/50 border border-border/50">
                    <p className="text-xs font-semibold text-foreground mb-2">All protected endpoints require a JWT Bearer token in the Authorization header:</p>
                    <CodeBlock
                      code={`Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...\n\n# Or use Cookie-based auth (after login):\nCookie: wb_session=<token>`}
                      label="Request Headers"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30">
                      <div className="flex items-center gap-1.5 mb-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Public Endpoints</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">POST /api/webhook/complaint and POST /api/auth/login do not require authentication</p>
                    </div>
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30">
                      <div className="flex items-center gap-1.5 mb-1">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                        <span className="text-xs font-bold text-amber-700 dark:text-amber-400">Role-Based Access</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">All endpoints filter data based on the authenticated user&apos;s role (ADMIN, STATE, DISTRICT, BLOCK)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Endpoints Table */}
            <motion.div variants={fadeUp}>
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Code className="h-4 w-4" style={{ color: NAVY }} />
                    API Endpoints Reference
                  </CardTitle>
                  <CardDescription className="text-xs">All available REST API endpoints for the portal</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-xl border border-border/50 overflow-hidden">
                    <div className="overflow-x-auto custom-scrollbar max-h-[480px] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm">
                          <tr className="border-b border-border/50">
                            <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px] w-[80px]">Method</th>
                            <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px]">Endpoint</th>
                            <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px] hidden lg:table-cell">Description</th>
                            <th className="text-left px-4 py-2.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px] w-[100px]">Auth</th>
                          </tr>
                        </thead>
                        <tbody>
                          {API_ENDPOINTS.map((ep, i) => {
                            const methodColors: Record<string, string> = {
                              GET: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
                              POST: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400',
                              PATCH: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
                              DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
                            };
                            return (
                              <tr key={`${ep.method}-${ep.path}`} className={`border-b border-border/30 hover:bg-muted/30 transition-colors ${i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}`}>
                                <td className="px-4 py-2.5">
                                  <Badge className={`${methodColors[ep.method] || 'bg-gray-100 text-gray-700'} text-[10px] font-bold px-2 py-0 border-0`}>
                                    {ep.method}
                                  </Badge>
                                </td>
                                <td className="px-4 py-2.5">
                                  <code className="font-mono text-[11px] text-foreground font-semibold">{ep.path}</code>
                                </td>
                                <td className="px-4 py-2.5 text-muted-foreground hidden lg:table-cell">{ep.desc}</td>
                                <td className="px-4 py-2.5">
                                  <span className={`text-[10px] font-semibold ${ep.auth === 'None' ? 'text-emerald-600 dark:text-emerald-400' : ep.auth === 'Cookie' ? 'text-purple-600 dark:text-purple-400' : 'text-muted-foreground'}`}>
                                    {ep.auth}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Example Request/Response */}
            <motion.div variants={fadeUp}>
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Webhook className="h-4 w-4" style={{ color: NAVY }} />
                    Webhook Endpoint — Full Example
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-[10px] font-bold">POST</span>
                      /api/webhook/complaint
                    </p>
                    <CodeBlock
                      code={`curl -X POST ${webhookUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "citizenName": "Rajesh Kumar",
    "phone": "+91 98765 43210",
    "issue": "No water supply for 3 days",
    "category": "Water Supply",
    "block": "Krishnanagar-I",
    "district": "Nadia",
    "urgency": "HIGH",
    "source": "WhatsApp"
  }'`}
                      label="cURL Request"
                    />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-foreground mb-2">Response (200 OK):</p>
                    <CodeBlock
                      code={`{
  "success": true,
  "ticketNo": "WB-2025-00182",
  "message": "Complaint registered successfully",
  "complaint": {
    "id": "clx_abc123...",
    "ticketNo": "WB-2025-00182",
    "status": "OPEN",
    "urgency": "HIGH",
    "createdAt": "2025-06-13T10:30:00.000Z"
  }
}`}
                      label="200 OK Response"
                    />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-foreground mb-2">Error Response (400 Bad Request):</p>
                    <CodeBlock
                      code={`{
  "success": false,
  "error": "Missing required fields: issue, category, block, district"
}`}
                      label="400 Error Response"
                    />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 4: QUICK SETUP GUIDE
            ═══════════════════════════════════════════════════════ */}
        <TabsContent value="setup">
          <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
            <motion.div variants={fadeUp}>
              <Card className="border-0 shadow-sm overflow-hidden">
                <div className="px-6 py-4" style={{ background: `linear-gradient(135deg, ${NAVY_DARK}, ${NAVY})` }}>
                  <h3 className="text-lg font-black text-white">Quick Setup Guide</h3>
                  <p className="text-xs text-blue-200/70 mt-1">Get everything connected in 3 simple steps</p>
                </div>
                <CardContent className="p-6 space-y-6">
                  {/* Step 1: n8n */}
                  <div className="relative">
                    <div className="absolute left-5 top-12 bottom-0 w-[2px] bg-gradient-to-b from-orange-300/50 to-sky-300/50" />
                    <motion.div variants={fadeUp} className="relative">
                      <div className="flex items-start gap-4">
                        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-lg" style={{ backgroundColor: '#EA580C' }}>
                          <GitBranch className="h-5 w-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-orange-600 dark:text-orange-400">Step 1</span>
                            <Badge variant="outline" className="text-[10px] gap-1 border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400">
                              <Clock className="h-3 w-3" /> ~15 min
                            </Badge>
                          </div>
                          <h4 className="text-sm font-black text-foreground">Set Up n8n Workflow</h4>
                          <div className="mt-3 space-y-2">
                            {[
                              { text: 'Install n8n (Docker recommended): docker run -it --rm --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n n8nio/n8n' },
                              { text: 'Open n8n at localhost:5678 and create a new workflow' },
                              { text: 'Import the workflow JSON template from the n8n tab above' },
                              { text: 'Set the environment variable WB_PORTAL_URL to your portal\'s base URL' },
                              { text: 'Configure the WhatsApp Business API credentials in the WhatsApp node' },
                              { text: 'Activate the workflow — it will generate a webhook URL' },
                              { text: 'Point your WhatsApp Business webhook to n8n\'s webhook URL' },
                            ].map((item, idx) => (
                              <div key={idx} className="flex items-start gap-2">
                                <CheckCircle className="h-3.5 w-3.5 text-orange-500 mt-0.5 shrink-0" />
                                <p className="text-[11px] text-muted-foreground leading-relaxed">{item.text}</p>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3">
                            <a
                              href="https://docs.n8n.io/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
                            >
                              <ExternalLink className="h-3 w-3" /> n8n Documentation
                              <ArrowUpRight className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </div>

                  {/* Step 2: Airtable */}
                  <div className="relative">
                    <div className="absolute left-5 top-12 bottom-0 w-[2px] bg-gradient-to-b from-sky-300/50 to-emerald-300/50" />
                    <motion.div variants={fadeUp} className="relative">
                      <div className="flex items-start gap-4">
                        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-lg" style={{ backgroundColor: '#0284C7' }}>
                          <Database className="h-5 w-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400">Step 2</span>
                            <Badge variant="outline" className="text-[10px] gap-1 border-sky-200 dark:border-sky-800 text-sky-600 dark:text-sky-400">
                              <Clock className="h-3 w-3" /> ~10 min
                            </Badge>
                          </div>
                          <h4 className="text-sm font-black text-foreground">Set Up Airtable Base</h4>
                          <div className="mt-3 space-y-2">
                            {[
                              { text: 'Create an account at airtable.com (free plan available)' },
                              { text: 'Create a new base and rename the table to "Complaints"' },
                              { text: 'Add all fields from the Field Mapping table (see Airtable tab)' },
                              { text: 'Configure select options for Category, Urgency, Status, and Source fields' },
                              { text: 'Go to airtable.com/create/tokens and create a Personal Access Token' },
                              { text: 'Grant "data.records:read" and "data.records:write" scopes, select your base' },
                              { text: 'Copy the token and your Base ID (from the base URL)' },
                            ].map((item, idx) => (
                              <div key={idx} className="flex items-start gap-2">
                                <CheckCircle className="h-3.5 w-3.5 text-sky-500 mt-0.5 shrink-0" />
                                <p className="text-[11px] text-muted-foreground leading-relaxed">{item.text}</p>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3">
                            <a
                              href="https://airtable.com/developers/web"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 transition-colors"
                            >
                              <ExternalLink className="h-3 w-3" /> Airtable API Documentation
                              <ArrowUpRight className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </div>

                  {/* Step 3: Connect */}
                  <div className="relative">
                    <motion.div variants={fadeUp} className="relative">
                      <div className="flex items-start gap-4">
                        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-lg" style={{ backgroundColor: '#16A34A' }}>
                          <Link className="h-5 w-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Step 3</span>
                            <Badge variant="outline" className="text-[10px] gap-1 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400">
                              <Clock className="h-3 w-3" /> ~5 min
                            </Badge>
                          </div>
                          <h4 className="text-sm font-black text-foreground">Connect Everything</h4>
                          <div className="mt-3 space-y-2">
                            {[
                              { text: 'Go to the n8n tab above and click "Send Test Complaint" to verify the webhook' },
                              { text: 'Go to the Airtable tab and enter your token, Base ID, and table name' },
                              { text: 'Click "Test Connection" to verify Airtable connectivity' },
                              { text: 'Click "Sync Data" to push all existing complaints to Airtable' },
                              { text: 'Set up a schedule in n8n to periodically sync new complaints (e.g., every 30 min)' },
                              { text: 'Monitor the connection status indicators on this page' },
                            ].map((item, idx) => (
                              <div key={idx} className="flex items-start gap-2">
                                <CheckCircle className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                                <p className="text-[11px] text-muted-foreground leading-relaxed">{item.text}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </div>

                  {/* Success Banner */}
                  <motion.div
                    variants={fadeUp}
                    className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800"
                    style={{ background: 'linear-gradient(135deg, #F0FDF4, #ECFDF5)' }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">You&apos;re All Set!</p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                          Once configured, citizen complaints from WhatsApp will automatically appear in the portal dashboard, and all complaint data will be synced to Airtable for advanced reporting.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
