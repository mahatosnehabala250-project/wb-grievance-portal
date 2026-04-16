'use client';

import { useState, useMemo } from 'react';
import {
  MessageSquare, Bot, Brain, Database, ArrowRight, ArrowDown,
  Shield, CheckCircle, XCircle, HelpCircle, AlertTriangle,
  Clock, Phone, User, MapPin, Hash, Zap, RefreshCw, Filter,
  ChevronDown, ChevronRight, Copy, ExternalLink, Workflow,
  Sparkles, Send, FileText, Tag, Globe, ShieldCheck, Code,
  Users, Bell, Search, Split, Merge
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion, AnimatePresence } from 'framer-motion';
import { NAVY } from '@/lib/constants';
import { toast } from 'sonner';

/* ════════════════════════════════════════════════════════════════════════════
   WB-01 ADVANCED v3.0 — Workflow Visualization Component
   ════════════════════════════════════════════════════════════════════════════ */

type NodeStatus = 'active' | 'pending' | 'error' | 'success';

interface WFNode {
  id: string;
  name: string;
  type: 'trigger' | 'code' | 'ai' | 'database' | 'messaging' | 'router' | 'http' | 'output';
  description: string;
  details?: string[];
  status: NodeStatus;
  icon: React.ElementType;
  color: string;
  position?: string;
}

interface WFRoutingPath {
  id: string;
  name: string;
  nameBn: string;
  condition: string;
  nodes: WFNode[];
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ElementType;
  badge: string;
}

/* ════════════════════════════════════════════════════════════════════════════
   ALL NODES IN WB-01 ADVANCED v3.0
   ════════════════════════════════════════════════════════════════════════════ */

const TRIGGER_NODE: WFNode = {
  id: 'n1', name: 'WhatsApp Trigger', type: 'trigger',
  description: 'Meta Cloud API webhook receives incoming WhatsApp messages from citizens',
  details: ['Credential: WhatsApp Business Account', 'Output: contacts[], messages[]', 'Supports: text, interactive, location'],
  status: 'active', icon: Phone, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400'
};

const PARSE_NODE: WFNode = {
  id: 'n2', name: 'Parse & Smart Route', type: 'code',
  description: 'Advanced message parser — extracts phone, text, contact name, detects language, handles multiple message types',
  details: ['6-way message routing', 'Language detection (bn/en/hi)', 'Interactive message support', 'Emoji detection', 'Message validation'],
  status: 'active', icon: Code, color: 'text-sky-600 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-400'
};

const ROUTER_NODE: WFNode = {
  id: 'n3', name: '6-Way Smart Router', type: 'router',
  description: 'Routes messages based on pattern matching: WB-XXXXX (status), 1-5 (rating), help/hi (menu), stop (unsubscribe), short (<10 char), or new complaint',
  details: ['Status Check: /WB-\\d{5}/i', 'Rating: /^[1-5]$/', 'Help: hi|hello|help|menu', 'Stop: stop|unsubscribe', 'Too Short: <10 chars', 'New Complaint: default'],
  status: 'active', icon: Split, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400'
};

/* ════════════════════════════════════════════════════════════════════════════
   6 ROUTING PATHS
   ════════════════════════════════════════════════════════════════════════════ */

const ROUTING_PATHS: WFRoutingPath[] = [
  {
    id: 'status_check', name: 'Status Check', nameBn: 'স্ট্যাটাস চেক',
    condition: 'Message matches WB-XXXXX pattern',
    color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-950/20',
    borderColor: 'border-blue-200 dark:border-blue-800', icon: Search, badge: 'WB-XXXXX',
    nodes: [
      { id: 'sc1', name: 'Is Status Check?', type: 'router', description: 'Regex match: /WB-\\d{5}/i', status: 'active', icon: Filter, color: 'text-blue-500' },
      { id: 'sc2', name: 'Call WB-05 Status Check', type: 'http', description: 'HTTP POST → /webhook/wb-status-check → Queries Supabase by ticketNo → Formats status reply → WhatsApp Send', details: ['Timeout: 10s', 'Payload: { ticketNo, phone, contactName }', 'Returns: formatted status message'], status: 'active', icon: ArrowRight, color: 'text-blue-500' }
    ]
  },
  {
    id: 'rating', name: 'Rating Collection', nameBn: 'রেটিং সংগ্রহ',
    condition: 'Message is single digit 1-5',
    color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-950/20',
    borderColor: 'border-amber-200 dark:border-amber-800', icon: Sparkles, badge: '1-5',
    nodes: [
      { id: 'rt1', name: 'Is Rating?', type: 'router', description: 'Regex match: /^[1-5]$/', status: 'active', icon: Filter, color: 'text-amber-500' },
      { id: 'rt2', name: 'Call WB-06 Rating', type: 'http', description: 'HTTP POST → /webhook/wb-rate → Finds resolved complaint by phone → Updates satisfactionRating → Sends thank you', details: ['Timeout: 10s', 'Payload: { phone, rating, contactName }', 'Updates: complaints.satisfactionRating'], status: 'active', icon: ArrowRight, color: 'text-amber-500' }
    ]
  },
  {
    id: 'help_menu', name: 'Help Menu', nameBn: 'সাহায্য মেনু',
    condition: 'Message is hi/hello/help/menu',
    color: 'text-teal-600 dark:text-teal-400', bgColor: 'bg-teal-50 dark:bg-teal-950/20',
    borderColor: 'border-teal-200 dark:border-teal-800', icon: HelpCircle, badge: 'help/hi',
    nodes: [
      { id: 'hm1', name: 'Is Help Menu?', type: 'router', description: 'Pattern: hi|hello|hey|namaste|help|menu|status|track', status: 'active', icon: Filter, color: 'text-teal-500' },
      { id: 'hm2', name: 'Build Help Menu', type: 'code', description: 'Generates comprehensive bilingual (bn+en) help guide with usage instructions', details: ['File Complaint instructions', 'Check Status instructions', 'Rating instructions', 'Stop instructions', 'Examples provided'], status: 'active', icon: FileText, color: 'text-teal-500' },
      { id: 'hm3', name: 'Send Help Menu', type: 'messaging', description: 'WhatsApp Send → displays formatted help guide to citizen', status: 'active', icon: Send, color: 'text-teal-500' }
    ]
  },
  {
    id: 'stop_unsubscribe', name: 'Stop / Unsubscribe', nameBn: 'থামাও / আনসাবস্ক্রাইব',
    condition: 'Message is stop/unsubscribe',
    color: 'text-gray-600 dark:text-gray-400', bgColor: 'bg-gray-50 dark:bg-gray-950/20',
    borderColor: 'border-gray-200 dark:border-gray-800', icon: XCircle, badge: 'stop',
    nodes: [
      { id: 'su1', name: 'Is Stop Request?', type: 'router', description: 'Pattern: stop|unsubscribe|don\'t|off', status: 'active', icon: Filter, color: 'text-gray-500' },
      { id: 'su2', name: 'Build Stop Message', type: 'code', description: 'Generates graceful opt-out confirmation message', status: 'active', icon: FileText, color: 'text-gray-500' },
      { id: 'su3', name: 'Send Stop Confirmation', type: 'messaging', description: 'WhatsApp Send → acknowledges stop request', status: 'active', icon: Send, color: 'text-gray-500' }
    ]
  },
  {
    id: 'too_short', name: 'Too Short — Ask Details', nameBn: 'খুব ছোট — বিস্তারিত চাই',
    condition: 'Message is less than 10 characters',
    color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-50 dark:bg-orange-950/20',
    borderColor: 'border-orange-200 dark:border-orange-800', icon: AlertTriangle, badge: '<10 char',
    nodes: [
      { id: 'ts1', name: 'Is Too Short?', type: 'router', description: 'Check: message.length < 10 (and not a command)', status: 'active', icon: Filter, color: 'text-orange-500' },
      { id: 'ts2', name: 'Build Short Message Prompt', type: 'code', description: 'Generates clarification prompt with examples showing how to write a proper complaint', details: ['Includes examples', 'Asks for block, district', 'Shows minimum detail needed'], status: 'active', icon: FileText, color: 'text-orange-500' },
      { id: 'ts3', name: 'Send Short Prompt', type: 'messaging', description: 'WhatsApp Send → asks citizen for more details', status: 'active', icon: Send, color: 'text-orange-500' }
    ]
  },
  {
    id: 'new_complaint', name: 'New Complaint Pipeline', nameBn: 'নতুন অভিযোগ পাইপলাইন',
    condition: 'Default — any other message (>=10 chars)',
    color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-50 dark:bg-emerald-950/20',
    borderColor: 'border-emerald-200 dark:border-emerald-800', icon: FileText, badge: 'DEFAULT',
    nodes: [
      { id: 'nc1', name: 'Check Recent Complaints (24h)', type: 'database', description: 'Supabase query: Find complaints from same phone in last 24 hours (duplicate detection)', details: ['Table: complaints', 'Filter: phone = $phone, createdAt > 24h ago', 'Limit: 5 results', 'Prevents spam complaints'], status: 'active', icon: Database, color: 'text-emerald-500' },
      { id: 'nc2', name: 'Is Duplicate (24h)?', type: 'router', description: 'If recent complaint exists from same phone → send duplicate warning instead', status: 'active', icon: Filter, color: 'text-emerald-500' },
      { id: 'nc3', name: 'AI Complaint Classifier v3', type: 'ai', description: 'GPT-4o Mini + 12-Field Structured Output: category, urgency, sentiment, language, summary, block, district, village, keywords, confidence, department, urgent_attention, duplicate_likely', details: ['Model: gpt-4o-mini (temperature: 0.05)', 'Max Tokens: 500', 'Timeout: 15 seconds', '12 output fields', 'WB district/block awareness'], status: 'active', icon: Brain, color: 'text-emerald-500' },
      { id: 'nc4', name: 'Merge & Normalize Data', type: 'code', description: 'Merges AI classification output with original message data. Validates category, urgency, language. Creates tags JSON with sentiment, department, keywords, confidence.', details: ['Validates: 10 categories', 'Validates: 4 urgency levels', 'Validates: 3 languages', 'Builds JSON tags metadata', 'Sets: hasRequired, hasLocation flags'], status: 'active', icon: Code, color: 'text-emerald-500' },
      { id: 'nc5', name: 'Has Required Fields?', type: 'router', description: 'Validates: issue.length >= 5', details: ['Required: issue (min 5 chars)', 'Optional: block, district, village'], status: 'active', icon: Filter, color: 'text-emerald-500' },
      { id: 'nc6', name: 'Create Complaint in Supabase', type: 'database', description: 'Supabase INSERT into complaints table with all normalized fields', details: ['Table: complaints', 'Auto-generates: id, ticketNo, createdAt', 'Sets: source=WHATSAPP, status=OPEN'], status: 'active', icon: Database, color: 'text-emerald-500' },
      { id: 'nc7', name: 'Log CREATED Activity', type: 'database', description: 'Supabase INSERT into activity_logs with detailed metadata', details: ['Table: activity_logs', 'Action: CREATED', 'Actor: WhatsApp Bot v3', 'Metadata: source, language, department, AI confidence'], status: 'active', icon: Database, color: 'text-emerald-500' },
      { id: 'nc8', name: 'Build Confirmation (bn+en)', type: 'code', description: 'Generates rich bilingual confirmation: ticket number, issue, category, location, urgency, department, rating instructions, status check instructions', details: ['Bilingual: Bengali + English', 'Includes: ticket, issue, category, location, urgency', 'Instructions: status check, rating', 'Government branding'], status: 'active', icon: FileText, color: 'text-emerald-500' },
      { id: 'nc9', name: 'Send Confirmation', type: 'messaging', description: 'WhatsApp Send → sends rich formatted confirmation to citizen', status: 'active', icon: Send, color: 'text-emerald-500' },
      { id: 'nc10', name: 'Trigger WB-02 Auto-Assign', type: 'http', description: 'HTTP POST → /webhook/wb-auto-assign → triggers officer auto-assignment workflow with full complaint context', details: ['Timeout: 15s', 'Payload: 13 fields (complaintId, ticketNo, issue, category, block, district, urgency, citizenName, phone, language, department)', 'Target: WB-02 Smart Auto-Assignment'], status: 'active', icon: ArrowRight, color: 'text-emerald-500' }
    ]
  }
];

/* ════════════════════════════════════════════════════════════════════════════
   ANIMATIONS
   ════════════════════════════════════════════════════════════════════════════ */

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } } };

/* ════════════════════════════════════════════════════════════════════════════
   NODE CARD COMPONENT
   ════════════════════════════════════════════════════════════════════════════ */

function NodeCard({ node, index, compact = false }: { node: WFNode; index: number; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const typeIcon = {
    trigger: Phone, code: Code, ai: Brain, database: Database,
    messaging: Send, router: Filter, http: ArrowRight, output: FileText
  }[node.type] || FileText;

  const typeLabel = {
    trigger: 'Trigger', code: 'Code', ai: 'AI Agent', database: 'Supabase',
    messaging: 'WhatsApp', router: 'Router', http: 'HTTP', output: 'Output'
  }[node.type] || 'Node';

  const typeBadgeColor = {
    trigger: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
    code: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
    ai: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
    database: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
    messaging: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
    router: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    http: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
    output: 'bg-gray-100 text-gray-700 dark:bg-gray-900/50 dark:text-gray-300',
  }[node.type];

  return (
    <motion.div
      variants={fadeUp}
      className={`${compact ? '' : 'mb-2'}`}
    >
      <div
        className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer hover:shadow-sm group ${
          node.type === 'ai' ? 'bg-gradient-to-r from-purple-50/80 to-transparent dark:from-purple-950/20 border-purple-200/60 dark:border-purple-800/40' :
          node.type === 'database' ? 'bg-gradient-to-r from-blue-50/50 to-transparent dark:from-blue-950/10 border-blue-200/40 dark:border-blue-800/30' :
          node.type === 'messaging' ? 'bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-950/10 border-green-200/40 dark:border-green-800/30' :
          node.type === 'trigger' ? 'bg-gradient-to-r from-emerald-50/50 to-transparent dark:from-emerald-950/10 border-emerald-200/40 dark:border-emerald-800/30' :
          'border-border/60 hover:border-border bg-card/50'
        }`}
        onClick={() => node.details && setExpanded(!expanded)}
      >
        {/* Node Number */}
        <div className={`h-7 w-7 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0 ${
          node.type === 'ai' ? 'bg-purple-500 text-white' :
          node.type === 'database' ? 'bg-blue-500 text-white' :
          node.type === 'messaging' ? 'bg-green-500 text-white' :
          node.type === 'trigger' ? 'bg-emerald-500 text-white' :
          'bg-muted text-muted-foreground'
        }`}>
          {index}
        </div>

        {/* Node Icon */}
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${node.color}`}>
          <node.icon className="h-4 w-4" />
        </div>

        {/* Node Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-foreground">{node.name}</span>
            <Badge className={`text-[8px] px-1.5 py-0 font-medium ${typeBadgeColor}`}>{typeLabel}</Badge>
            {node.status === 'active' && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{node.description}</p>
        </div>

        {/* Expand Arrow */}
        {node.details && (
          <button className="shrink-0 p-1 rounded hover:bg-muted/50 transition-colors">
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Expanded Details */}
      <AnimatePresence>
        {expanded && node.details && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="ml-16 mt-1 mb-2 p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="space-y-1.5">
                {node.details.map((detail, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                    <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/50" />
                    <span className="font-mono text-[10px]">{detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUTING PATH CARD
   ════════════════════════════════════════════════════════════════════════════ */

function RoutingPathCard({ path, isMain }: { path: WFRoutingPath; isMain: boolean }) {
  const [expanded, setExpanded] = useState(isMain);

  return (
    <motion.div variants={fadeUp} className={`rounded-xl border overflow-hidden transition-shadow hover:shadow-md ${path.borderColor}`}>
      {/* Header */}
      <button
        className={`w-full flex items-center gap-3 p-4 text-left ${path.bgColor}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${path.color}`}>
          <path.icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">{path.name}</span>
            <span className="text-[11px] text-muted-foreground">({path.nameBn})</span>
            <Badge variant="outline" className="text-[9px] px-1.5 py-0">{path.badge}</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{path.condition}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">{path.nodes.length} nodes</Badge>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Node List */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="p-3 bg-card/30">
              <div className="flex items-center gap-1.5 mb-3 px-1">
                <ArrowDown className="h-3 w-3 text-muted-foreground/50" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pipeline Nodes</span>
              </div>
              {path.nodes.map((node, i) => (
                <div key={node.id} className="relative">
                  {i < path.nodes.length - 1 && (
                    <div className="absolute left-[30px] top-[44px] w-px h-[calc(100%+4px)] bg-border/40" />
                  )}
                  <NodeCard node={node} index={i + 1} />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════════════ */

export default function WB01WorkflowDetailView() {
  const [activeTab, setActiveTab] = useState<'overview' | 'paths' | 'data' | 'code'>('overview');

  const totalNodes = useMemo(() => {
    return 3 + ROUTING_PATHS.reduce((sum, p) => sum + p.nodes.length, 0);
  }, []);

  const handleCopyCode = useCallback(() => {
    toast.success('SDK Code Copied!', { description: 'The WB-01 SDK code is in /n8n-sdk-v3/wb-01-whatsapp-intake-advanced.js' });
  }, []);

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">

      {/* ═══ HEADER ═══ */}
      <motion.div variants={fadeUp} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl flex items-center justify-center shadow-md" style={{ backgroundColor: NAVY }}>
            <Workflow className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-black text-foreground">WB-01: WhatsApp Intake + AI Router</h2>
              <Badge className="bg-emerald-500 text-white text-[9px] px-2 py-0 font-bold gap-0.5">
                ADVANCED v3.0
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              6-Way Smart Router + AI Classification + Duplicate Detection + Bilingual Messages — 24 Nodes
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            ACTIVE
          </Badge>
          <Badge variant="outline" className="text-[10px] gap-1 font-mono">
            {totalNodes} nodes
          </Badge>
        </div>
      </motion.div>

      {/* ═══ STATS ROW ═══ */}
      <motion.div variants={fadeUp} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Nodes', value: '24', sub: '6 paths', icon: Workflow, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Routing Paths', value: '6', sub: 'Status, Rating, Help, Stop, Short, Complaint', icon: Split, color: 'text-amber-600 dark:text-amber-400' },
          { label: 'AI Fields', value: '12', sub: 'Structured Output', icon: Brain, color: 'text-purple-600 dark:text-purple-400' },
          { label: 'DB Operations', value: '3', sub: '2 Supabase tables', icon: Database, color: 'text-blue-600 dark:text-blue-400' },
        ].map(stat => (
          <Card key={stat.label} className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <stat.icon className={`h-3 w-3 ${stat.color}`} />
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{stat.label}</span>
            </div>
            <p className="text-xl font-black text-foreground">{stat.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{stat.sub}</p>
          </Card>
        ))}
      </motion.div>

      {/* ═══ TAB NAVIGATION ═══ */}
      <motion.div variants={fadeUp} className="flex items-center gap-1 p-1 rounded-lg bg-muted/50 w-fit">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'paths', label: '6 Routing Paths' },
          { id: 'data', label: 'Data Flow' },
          { id: 'code', label: 'SDK Code' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </motion.div>

      {/* ═══ TAB: OVERVIEW ═══ */}
      {activeTab === 'overview' && (
        <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
          {/* Core Pipeline */}
          <motion.div variants={fadeUp}>
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
              <ArrowRight className="h-4 w-4" style={{ color: NAVY }} />
              Core Entry Pipeline
            </h3>
            <Card className="p-4">
              <div className="space-y-2">
                {[TRIGGER_NODE, PARSE_NODE, ROUTER_NODE].map((node, i) => (
                  <div key={node.id} className="relative">
                    {i < 2 && (
                      <div className="absolute left-[30px] top-[44px] w-px h-[calc(100%+4px)] bg-border/40" />
                    )}
                    <NodeCard node={node} index={i + 1} />
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>

          {/* Features Grid */}
          <motion.div variants={fadeUp}>
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4" style={{ color: NAVY }} />
              Advanced Features (v3.0)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { title: '6-Way Smart Router', desc: 'Routes messages to 6 different paths: Status Check, Rating, Help, Stop, Too Short, New Complaint', icon: Split, color: 'text-amber-500' },
                { title: 'AI 12-Field Classification', desc: 'GPT-4o Mini with structured output: category, urgency, sentiment, language, summary, block, district, village, keywords, confidence, department, urgent_attention', icon: Brain, color: 'text-purple-500' },
                { title: 'Duplicate Detection (24h)', desc: 'Checks Supabase for recent complaints from same phone in last 24 hours to prevent spam', icon: ShieldCheck, color: 'text-emerald-500' },
                { title: 'Multi-Language Support', desc: 'Auto-detects Bengali, English, Hindi from Unicode ranges. AI processes all 3 languages.', icon: Globe, color: 'text-sky-500' },
                { title: 'Bilingual Messages (bn+en)', desc: 'All WhatsApp messages sent in both Bengali and English for maximum accessibility', icon: MessageSquare, color: 'text-green-500' },
                { title: 'Error Handling & Fallbacks', desc: 'AI timeout (15s) → defaults, Supabase error → error message, Missing fields → clarification prompt', icon: Shield, color: 'text-red-500' },
                { title: 'Interactive Message Support', desc: 'Handles text, interactive list reply, and button reply message types from WhatsApp', icon: Zap, color: 'text-orange-500' },
                { title: 'Rich Activity Logging', desc: 'Detailed activity logs with JSON metadata: source, language, department, AI confidence score', icon: FileText, color: 'text-blue-500' },
              ].map(feature => (
                <Card key={feature.title} className="p-3 hover:shadow-sm transition-shadow">
                  <div className="flex items-start gap-2.5">
                    <feature.icon className={`h-4 w-4 mt-0.5 shrink-0 ${feature.color}`} />
                    <div>
                      <p className="text-xs font-bold">{feature.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{feature.desc}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </motion.div>

          {/* Credentials Used */}
          <motion.div variants={fadeUp}>
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4" style={{ color: NAVY }} />
              Credentials Used
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { name: 'WhatsApp Business Account', type: 'whatsAppTriggerApi', desc: 'WhatsApp Trigger + Send', used: '2 nodes' },
                { name: 'Supabase', type: 'supabaseApi', desc: 'Database CRUD operations', used: '4 nodes' },
                { name: 'OpenAI', type: 'openAiApi', desc: 'GPT-4o Mini classification', used: '2 nodes' },
              ].map(cred => (
                <Card key={cred.type} className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-xs font-bold">{cred.name}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono">{cred.type}</p>
                  <p className="text-[10px] text-muted-foreground">{cred.desc} — {cred.used}</p>
                </Card>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* ═══ TAB: ROUTING PATHS ═══ */}
      {activeTab === 'paths' && (
        <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-3">
          <motion.div variants={fadeUp} className="flex items-center justify-between">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Split className="h-4 w-4" style={{ color: NAVY }} />
              6-Way Message Routing
            </h3>
            <p className="text-[10px] text-muted-foreground">Click any path to expand its pipeline</p>
          </motion.div>
          {ROUTING_PATHS.map(path => (
            <RoutingPathCard
              key={path.id}
              path={path}
              isMain={path.id === 'new_complaint'}
            />
          ))}
        </motion.div>
      )}

      {/* ═══ TAB: DATA FLOW ═══ */}
      {activeTab === 'data' && (
        <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
          <motion.div variants={fadeUp}>
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
              <Database className="h-4 w-4" style={{ color: NAVY }} />
              Data Flow Diagram
            </h3>
            <Card className="p-4">
              <div className="space-y-3">
                {/* Step-by-step flow */}
                {[
                  { step: 1, title: 'WhatsApp Message Received', detail: 'Meta Cloud API → WhatsApp Trigger node → Raw payload with contacts[], messages[]', icon: Phone, color: 'bg-emerald-500' },
                  { step: 2, title: 'Parse & Smart Route', detail: 'Code node extracts: phone, waId, text, contactName, msgType, timestamp. Detects language. Routes to one of 6 paths.', icon: Code, color: 'bg-sky-500' },
                  { step: 3, title: 'Duplicate Check (24h window)', detail: 'Supabase query: complaints WHERE phone = $phone AND createdAt > now() - 24h. If found → send duplicate warning, stop.', icon: Database, color: 'bg-blue-500' },
                  { step: 4, title: 'AI Classification (12 fields)', detail: 'GPT-4o Mini → Structured Output Parser → category, urgency, sentiment, language, summary, suggested_block, suggested_district, village, keywords[], confidence, department, needs_urgent_attention, is_duplicate_likely', icon: Brain, color: 'bg-purple-500' },
                  { step: 5, title: 'Merge & Normalize', detail: 'Code node validates AI output against allowed values. Merges with original message data. Creates JSON tags metadata.', icon: Code, color: 'bg-sky-500' },
                  { step: 6, title: 'Validate Required Fields', detail: 'IF node checks: issue.length >= 5. FALSE → sends clarification prompt with examples.', icon: Filter, color: 'bg-amber-500' },
                  { step: 7, title: 'Create Complaint (Supabase)', detail: 'Supabase INSERT: complaints table. Fields: citizenName, phone, issue, category, block, district, village, urgency, description, language, source=WHATSAPP, tags, etc. Auto-generates: id (CUID), ticketNo (WB-XXXXX), createdAt, updatedAt, status=OPEN.', icon: Database, color: 'bg-blue-500' },
                  { step: 8, title: 'Log Activity (Supabase)', detail: 'Supabase INSERT: activity_logs table. Action=CREATED, Actor=WhatsApp Bot v3. Metadata: JSON with source, language, department, AI confidence.', icon: Database, color: 'bg-blue-500' },
                  { step: 9, title: 'Send Confirmation (WhatsApp)', detail: 'Rich bilingual message: ticket number, issue, category, location, urgency, department. Instructions for status check and rating. Government branding footer.', icon: Send, color: 'bg-green-500' },
                  { step: 10, title: 'Trigger WB-02 Auto-Assign', detail: 'HTTP POST → /webhook/wb-auto-assign. Payload: complaintId, ticketNo, issue, category, block, district, urgency, citizenName, phone, language, department (13 fields).', icon: ArrowRight, color: 'bg-orange-500' },
                ].map(item => (
                  <div key={item.step} className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <div className={`h-7 w-7 rounded-full ${item.color} text-white text-[10px] font-black flex items-center justify-center`}>
                        {item.step}
                      </div>
                      {item.step < 10 && <div className="w-px h-4 bg-border/60" />}
                    </div>
                    <div className="flex-1 min-w-0 pb-2">
                      <div className="flex items-center gap-2 mb-0.5">
                        <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-bold">{item.title}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {/* ═══ TAB: SDK CODE ═══ */}
      {activeTab === 'code' && (
        <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
          <motion.div variants={fadeUp}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Code className="h-4 w-4" style={{ color: NAVY }} />
                SDK Code — n8n-sdk-v3/wb-01-whatsapp-intake-advanced.js
              </h3>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[10px]" onClick={handleCopyCode}>
                <Copy className="h-3 w-3" /> Copy Path
              </Button>
            </div>
            <Card className="p-4">
              <div className="space-y-3 text-xs">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary" className="text-[9px] font-mono">@n8n/workflow-sdk</Badge>
                  <Badge variant="secondary" className="text-[9px] font-mono">24 nodes</Badge>
                  <Badge variant="secondary" className="text-[9px] font-mono">5 sticky notes</Badge>
                </div>
                {[
                  { label: 'Import', code: 'workflow, node, trigger, newCredential, ifElse, languageModel, outputParser, sticky, expr' },
                  { label: 'AI Model', code: '@n8n/n8n-nodes-langchain.lmChatOpenAi v1.3 — gpt-4o-mini (temp: 0.05)' },
                  { label: 'Output Parser', code: '@n8n/n8n-nodes-langchain.outputParserStructured v1.3 — 12-field JSON schema' },
                  { label: 'Trigger', code: 'n8n-nodes-base.whatsAppTrigger v1 — Credential: WhatsApp Business Account' },
                  { label: 'Router', code: '6x n8n-nodes-base.ifElse v2.2 — Nested conditions for message type detection' },
                  { label: 'AI Agent', code: '@n8n/n8n-nodes-langchain.agent v3.1 — GPT-4o Mini + Structured Output Parser' },
                  { label: 'Database', code: '3x n8n-nodes-base.supabase v1 — complaints + activity_logs (getAll, create)' },
                  { label: 'Messaging', code: '7x n8n-nodes-base.whatsApp v1.1 — Send confirmation, help, error, stop, duplicate, clarification, short prompt' },
                  { label: 'HTTP', code: '3x n8n-nodes-base.httpRequest v4.2 — Call WB-05, WB-06, WB-02 with timeouts' },
                  { label: 'Composition', code: '.add(trigger).to(parse).to(isStatus.onTrue(...).onFalse(isRating.onTrue(...).onFalse(isHelp...)))' },
                ].map(item => (
                  <div key={item.label} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-24 shrink-0 pt-px">{item.label}</span>
                    <span className="text-[11px] font-mono text-foreground leading-relaxed">{item.code}</span>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>

          {/* Workflow Composition Visual */}
          <motion.div variants={fadeUp}>
            <h3 className="text-sm font-bold mb-3">Workflow Composition Tree</h3>
            <Card className="p-4">
              <div className="font-mono text-[11px] space-y-1 leading-relaxed overflow-x-auto">
                <p className="text-emerald-600 dark:text-emerald-400">waTrigger → parseRoute → isStatusCheck</p>
                <p className="pl-6 text-muted-foreground">├─ TRUE → <span className="text-blue-500">callStatusCheck</span> → WB-05</p>
                <p className="pl-6 text-muted-foreground">└─ FALSE → isRating</p>
                <p className="pl-12 text-muted-foreground">├─ TRUE → <span className="text-amber-500">callRating</span> → WB-06</p>
                <p className="pl-12 text-muted-foreground">└─ FALSE → isHelp</p>
                <p className="pl-18 text-muted-foreground">├─ TRUE → <span className="text-teal-500">buildHelpMenu → sendHelpMenu</span></p>
                <p className="pl-18 text-muted-foreground">└─ FALSE → isStop</p>
                <p className="pl-24 text-muted-foreground">├─ TRUE → <span className="text-gray-500">buildStopMsg → sendStopMsg</span></p>
                <p className="pl-24 text-muted-foreground">└─ FALSE → isTooShort</p>
                <p className="pl-30 text-muted-foreground">├─ TRUE → <span className="text-orange-500">buildShortMsg → sendShortMsg</span></p>
                <p className="pl-30 text-muted-foreground">└─ FALSE → <span className="font-bold text-emerald-600 dark:text-emerald-400">NEW COMPLAINT PIPELINE</span></p>
                <p className="pl-36 text-muted-foreground">→ <span className="text-blue-500">checkDuplicates</span></p>
                <p className="pl-42 text-muted-foreground">→ isDuplicate</p>
                <p className="pl-48 text-muted-foreground">├─ TRUE → <span className="text-amber-500">buildDuplicateMsg → sendDuplicateMsg</span></p>
                <p className="pl-48 text-muted-foreground">└─ FALSE → <span className="text-purple-500">aiClassifier</span></p>
                <p className="pl-54 text-muted-foreground">→ <span className="text-sky-500">normalizeData</span> → checkRequired</p>
                <p className="pl-60 text-muted-foreground">├─ TRUE → <span className="text-blue-500">createComplaint</span></p>
                <p className="pl-66 text-muted-foreground">→ <span className="text-blue-500">logActivity</span></p>
                <p className="pl-72 text-muted-foreground">→ <span className="text-sky-500">buildConfirmation</span></p>
                <p className="pl-78 text-muted-foreground">→ <span className="text-green-500">sendConfirmation</span></p>
                <p className="pl-84 text-muted-foreground">→ <span className="text-orange-500">callAutoAssign</span> → WB-02</p>
                <p className="pl-60 text-muted-foreground">└─ FALSE → <span className="text-orange-500">buildClarification → sendClarification</span></p>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );
}
