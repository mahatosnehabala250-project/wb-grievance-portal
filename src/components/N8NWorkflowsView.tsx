'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Copy, CheckCircle, ClipboardList, Database, Workflow, 
  ChevronRight, Sparkles, BookOpen, Zap, Users, Bell,
  MessageSquare, Mail, Shield, Timer, RefreshCw, AlertTriangle,
  Layers, FileText, Globe, Info, ExternalLink, ArrowRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { NAVY } from '@/lib/constants';

/* ══════════════════════════════════════════════════════════════
   THE COMPLETE PROMPT — copy-paste this to Claude in VS Code
   ══════════════════════════════════════════════════════════════ */
const CLAUDE_PROMPT = `# West Bengal AI Public Support System — n8n Workflow Builder Prompt

## Project Overview
Ye ek West Bengal Government ka **Grievance / Complaint Management Portal** hai. Citizens WhatsApp pe message karke apni shikayat kar sakte hain. Portal automatically complaint receive karta hai, AI se category detect karta hai, officers ko assign karta hai, aur citizen ko WhatsApp pe status update bhejta hai.

**Frontend**: Next.js web dashboard (admin officers use karte hain)
**Database**: Supabase PostgreSQL
**AI**: AI Brain — complaint text se category, urgency, department detect karta hai
**Messaging**: WhatsApp Business API
**Airtable**: Optional — spreadsheet jaisa collaboration tool hai jo database ke saath sync hota hai

---

## DATABASE STRUCTURE — Ye sab tables/fields hain database mein

### TABLE 1: users
Ye admin/officer accounts hain jo dashboard login karke complaints manage karte hain.

| Field | Type | Kya hai |
|-------|------|---------|
| id | Auto ID | Unique identifier |
| username | Text | Login username (e.g. "admin", "officer_krishnagar") |
| passwordHash | Text | Encrypted password |
| role | Text | 4 roles: ADMIN (super admin), BLOCK (block officer), DISTRICT (district officer), STATE (state level) |
| name | Text | Officer ka display name |
| location | Text | Officer ka area (e.g. "Krishnanagar", "Nadia") |
| district | Text (optional) | District name — block level officers ke liye |
| isActive | True/False | Account active hai ya nahi |
| createdAt | Date | Kab account bana |

### TABLE 2: complaints
Ye main table hai — har ek citizen complaint yahan stored hai.

| Field | Type | Kya hai |
|-------|------|---------|
| id | Auto ID | Unique identifier |
| ticketNo | Text (unique) | Ticket number — auto-generated, format: WB-01001, WB-01002 etc. |
| citizenName | Text (optional) | Citizen ka naam |
| phone | Text (optional) | Citizen ka phone number (WhatsApp number) |
| issue | Text | Complaint ka main text — citizen ne jo likha/bole |
| category | Text | AI ya manual se assigned category — jaise: "Water Supply", "Road Damage", "Electricity", "Sanitation", "Healthcare", "Education", "Other" |
| block | Text | Block name jahan problem hai (e.g. "Krishnanagar-I") |
| district | Text | District name (e.g. "Nadia") |
| urgency | Text | Priority level: LOW, MEDIUM (default), HIGH, CRITICAL |
| status | Text | Current status: OPEN (default), IN_PROGRESS, RESOLVED, REJECTED |
| description | Text (optional) | Detailed description — AI ya officer ne likha |
| resolution | Text (optional) | Jab resolve ho toh resolution text |
| assignedToId | Text (optional) | Kaunsa officer/user is complaint ko handle kar raha hai (users table ka id) |
| source | Text | Complaint kahan se aaya: WHATSAPP (default), MANUAL, WEB |
| satisfactionRating | Number (optional) | Citizen ne 1-5 diya hai satisfaction rating |
| airtableRecordId | Text (optional) | Airtable mein ye complaint ka record ID — bidirectional sync ke liye |
| createdAt | Date | Kab complaint aaya |
| updatedAt | Date | Last update kab hua |

### TABLE 3: activity_logs
Complaint pe kya kya hua — sab activity ka history yahan hai.

| Field | Type | Kya hai |
|-------|------|---------|
| id | Auto ID | Unique identifier |
| complaintId | Text | Kaunsi complaint pe ye activity (complaints table ka id) |
| action | Text | Activity type: CREATED, STATUS_CHANGED, ASSIGNED, RESOLVED, REJECTED, UNASSIGNED, ESCALATED |
| description | Text | Kya hua — detail mein (e.g. "Status changed from OPEN to IN_PROGRESS") |
| actorId | Text (optional) | Kisne kiya (users table ka id) — ya "System" agar automated |
| actorName | Text (optional) | Kisne kiya — naam |
| metadata | Text (optional) | Extra JSON data |
| createdAt | Date | Kab hua |

### TABLE 4: comments
Officers aur admins complaint pe comments kar sakte hain — internal discussion.

| Field | Type | Kya hai |
|-------|------|---------|
| id | Auto ID | Unique identifier |
| complaintId | Text | Kaunsi complaint pe comment |
| content | Text | Comment ka text |
| actorId | Text (optional) | Kisne likha (users table ka id) |
| actorName | Text (optional) | Kaun likhne wala — naam |
| createdAt | Date | Kab likha |

### TABLE 5: feedback
Citizens portal pe feedback de sakte hain — general feedback system.

| Field | Type | Kya hai |
|-------|------|---------|
| id | Auto ID | Unique identifier |
| name | Text | Feedback dene wale ka naam |
| email | Text (optional) | Email |
| message | Text | Feedback text |
| category | Text | Category: "General" (default) etc. |
| rating | Number | 1-5 rating (default 5) |
| createdAt | Date | Kab diya |

---

## WORKFLOWS — Ye 9 workflows banane hain n8n mein

### WORKFLOW 1: WhatsApp Complaint Intake
**Kya karta hai**: Jab citizen WhatsApp pe message bhejta hai, ye workflow complaint receive karta hai.

**Process**:
1. WhatsApp se message aata hai — usme hota hai: message text, sender phone number, citizen naam, block/district info
2. AI Brain ko bhejta hai complaint text — AI batata hai: category (Water/Road/Electricity etc.), urgency (LOW/MEDIUM/HIGH/CRITICAL), summary
3. Agar AI kaam nahi karta toh keyword matching se category guess karta hai (water keyword = Water Supply, road = Road Damage etc.)
4. Supabase database mein naya complaint create karta hai — sab fields fill karta hai: citizenName, phone, issue, category, block, district, urgency, source="WHATSAPP"
5. Database se ticket number receive karta hai (WB-01001 jaisa)
6. Citizen ko WhatsApp pe confirmation message bhejta hai: "Aapka shikayat register ho gaya! Ticket: WB-01001"

**Data flow**: WhatsApp → AI Brain → Database → WhatsApp Reply

---

### WORKFLOW 2: Auto-Assignment Engine
**Kya karta hai**: Jo complaints abhi tak kisi officer ko assign nahi hain, unhe automatically block/district ke hisab se officer ko assign karta hai.

**Process**:
1. Har 5 minute mein check karta hai — database mein wo complaints dhundhta hai jinka status OPEN hai aur assignedToId null hai (kisi ko assign nahi hua)
2. Har complaint ka block aur district dekhta hai
3. Officers list mein se us block/district ka matching officer dhundhta hai
4. Complaint ko us officer ko assign kar deta hai (assignedToId update)
5. Activity log mein entry add hoti hai: "Assigned to [Officer Name]"

**Data flow**: Timer (5 min) → Fetch unassigned complaints → Match block/district → Assign officer → Update database

---

### WORKFLOW 3: Citizen Status Notification
**Kya karta hai**: Jab officer complaint ka status change karta hai (OPEN → IN_PROGRESS, IN_PROGRESS → RESOLVED etc.), citizen ko WhatsApp pe update bhejta hai.

**Process**:
1. Portal se trigger aata hai jab complaint ka status change hota hai
2. Database se complaint ki full details le aata hai (ticketNo, citizenName, phone, issue, new status, resolution)
3. Status ke hisab se WhatsApp message banata hai:
   - IN_PROGRESS: "Aapka shikayat ab process ho raha hai..."
   - RESOLVED: "Aapka shikayat resolve ho gaya!" + resolution text
   - REJECTED: "Aapka shikayat process nahi ho paya..."
4. Citizen ke phone pe WhatsApp message bhejta hai
5. Agar WhatsApp fail ho toh SMS fallback bhejta hai

**Data flow**: Status Change Trigger → Get complaint details → Format message → WhatsApp/SMS to citizen

---

### WORKFLOW 4: Officer Assignment Notification
**Kya karta hai**: Jab complaint kisi officer ko assign hota hai, use WhatsApp aur Email pe notification bhejta hai.

**Process**:
1. Trigger aata hai jab complaint assign hota hai (auto ya manual)
2. Complaint ki details le aata hai: ticketNo, issue, category, citizenName, urgency, block, district
3. Assigned officer ki details le aata hai: naam, phone, email
4. Officer ko WhatsApp pe message bhejta hai: "Naya shikayat aapko assign hua! Ticket: WB-01001, Category: Water Supply..."
5. Officer ko Email bhi bhejta hai — HTML format mein ek professional email with complaint details
6. Message Hindi + English dono mein hota hai

**Data flow**: Assignment Trigger → Get complaint + officer details → WhatsApp + Email to officer

---

### WORKFLOW 5: SLA Breach Escalation
**Kya karta hai**: Jo complaints 7 din se zyada open hain (SLA breach), unki urgency badhata hai aur district admin ko email alert bhejta hai.

**Process**:
1. Roz subah 9 baje check karta hai
2. Database mein wo complaints dhundhta hai jinka status OPEN ya IN_PROGRESS hai aur 7 din purane hain (createdAt se 7+ din)
3. Breach kiye complaints ki urgency CRITICAL kar deta hai
4. District admin ko email bhejta hai — ek HTML report format mein:
   - Kitne complaints breach hue
   - Har complaint ka: Ticket, Issue, District, Kitne din open, Urgency
5. Activity log mein entry add hoti hai: "SLA Breach — Escalated to CRITICAL"

**Data flow**: Timer (daily 9 AM) → Find 7+ day open complaints → Escalate urgency → Email to admin

---

### WORKFLOW 6: Daily Summary Report
**Kya karta hai**: Roz shaam 6 baje district admins ko ek daily summary email bhejta hai — kitne complaints aaye, kitne resolve hue, kitne open hain etc.

**Process**:
1. Roz shaam 6 baje trigger hota hai
2. Database se statistics le aata hai: total complaints, open, in_progress, resolved, rejected, critical count, resolution rate
3. Ek beautiful HTML email report banata hai — cards mein numbers dikhata hai
4. District admins ke email pe bhejta hai
5. Email mein hota hai: total count, open count, resolved count, critical count, resolution rate percentage

**Data flow**: Timer (daily 6 PM) → Fetch dashboard stats → Format HTML report → Email to admins

---

### WORKFLOW 7: AI Complaint Brain
**Kya karta hai**: Complaint text analyze karke category, urgency, department, summary, smart reply generate karta hai. Ye AI ka main brain hai.

**Process**:
1. Trigger hota hai jab naya complaint aata hai (WhatsApp ya manual)
2. Complaint text AI model ko bhejta hai
3. AI return karta hai: category, urgency, department, summary, sentiment (positive/negative/neutral)
4. Smart reply bhi generate karta hai — citizen ko bhejne ke liye ready-made reply (English + Bengali)
5. Agar Airtable configured hai toh Airtable mein bhi sync karta hai

**Data flow**: Complaint Trigger → AI Analysis → Smart Reply Generation → Airtable Sync (optional)

---

### WORKFLOW 8: Airtable Bidirectional Sync
**Kya karta hai**: Supabase database aur Airtable ke beech har 30 minute mein sync karta hai — data dono taraf copy hota hai.

**Process**:
1. Har 30 minute mein run hota hai
2. Supabase se saare complaints le kar Airtable mein push karta hai (new + updated)
3. Airtable se bhi data pull karta hai — agar Airtable mein koi change hua hai toh Supabase mein update karta hai
4. Har complaint ka airtableRecordId track karta hai database mein — taaki duplicate na bane
5. Agar sync fail ho toh error log karta hai

**Data flow**: Timer (30 min) → Push DB→Airtable → Pull Airtable→DB → Check sync status → Log errors

---

### WORKFLOW 9: Error Handler
**Kya karta hai**: Agar koi bhi workflow mein error aaye toh admin ko alert bhejta hai. Ye sab workflows ka global error handler hai.

**Process**:
1. Koi bhi workflow fail ho toh ye trigger hota hai
2. Error details format karta hai: kaunsi workflow fail hui, kaunsa node fail hua, error message, time
3. Check karta hai — retry karna chahiye ya nahi (max 3 retries, authentication errors ko nahi retry karte)
4. Admin ko email bhejta hai — HTML format mein full error details
5. Slack ya Discord pe bhi error message post karta hai (if configured)
6. Agar retry possible hai toh 60 second wait karke retry karta hai

**Data flow**: Error Trigger → Format error → Check retry count → Email admin + Slack/Discord → Wait & Retry (if needed)

---

## IMPORTANT NOTES FOR BUILDING

1. **Supabase PostgreSQL** is the main database — all data lives here
2. **WhatsApp Business API** — citizens message karte hain, officers ko bhi WhatsApp pe notify hota hai
3. **Portal Web App** — Next.js dashboard hai jahan officers complaints manage karte hain. Portal automatically webhooks fire karta hai jab status change hota hai
4. **AI Brain** — optional but recommended. Fallback mein keyword matching hai
5. **Airtable** — optional collaboration layer. Supabase database primary hai
6. **Language**: Citizens Hindi/English dono mein baat karte hain. WhatsApp messages Hindi+English mein hone chahiye
7. **SLA Rule**: 7 days — uske baad automatic escalation
8. **Ticket Format**: WB-XXXXX (WB-01001, WB-01002 etc.)
9. **Categories**: Water Supply, Road Damage, Electricity, Sanitation, Healthcare, Education, Other
10. **Urgency Levels**: LOW, MEDIUM, HIGH, CRITICAL
11. **Status Flow**: OPEN → IN_PROGRESS → RESOLVED (ya REJECTED)
12. **User Roles**: ADMIN (full access), BLOCK (block level), DISTRICT (district level), STATE (state level)

Please build all 9 workflows in n8n with proper error handling, retry logic, and connections between workflows where needed. Use environment variables for all credentials and URLs.

---

## TOOLS & SKILLS — Inko install karke use karna hai

### TOOL 1: n8n-mcp (MCP Server for n8n)
**GitHub**: https://github.com/czlonkowski/n8n-mcp
**Kya hai**: Ye ek MCP (Model Context Protocol) server hai jo Claude ko n8n ke 1,396 nodes ki documentation, properties, aur operations ka access deta hai. Isse Claude ko n8n ki har node ka kaam pata hota hai aur wo directly tumhare n8n instance mein workflow bana sakta hai.

**Features**:
- 1,396 n8n nodes ka knowledge (812 core + 584 community)
- Node properties ka 99% coverage
- 265 AI-capable tool variants
- 2,709 workflow templates
- Node search, validation, aur template access

**Install karne ke tarike**:
- Cloud (easiest): https://dashboard.n8n-mcp.com — sign up, get API key, connect MCP client
- Claude Code: Claude Code ke andar n8n-mcp ko MCP server ke taur pe add karo
- npx: \`npx n8n-mcp\` run karo terminal mein
- Docker: \`docker run ghcr.io/czlonkowski/n8n-mcp\`
- Railway pe bhi deploy ho sakta hai

**IMPORTANT**: Production workflows ko hamesha AI se edit karne se pehle backup lo!

---

### TOOL 2: n8n-skills (Claude Code Skills for n8n)
**GitHub**: https://github.com/czlonkowski/n8n-skills
**Kya hai**: Ye 7 Claude Code skills hain jo specifically n8n workflow building ke liye designed hain. Ye skills n8n-mcp ke saath kaam karti hain aur Claude ko teach karti hain ki:
- n8n expressions sahi kaise likhne hain (\`{{}}\` syntax)
- n8n-mcp ke tools ko kaise efficiently use karna hai
- Proven workflow patterns kaise apply karni hain
- Validation errors ko kaise fix karna hai
- Node configuration kaise karni hai
- Code nodes mein JavaScript kaise likhna hai

**7 Skills**:
1. **n8n Expression Syntax** — \`\${{ }}\` syntax, \$json, \$node, \$env variables, common mistakes
2. **n8n MCP Tools Expert** (MOST IMPORTANT) — kaunsa tool kiske liye, nodeType format, validation profiles
3. **n8n Workflow Patterns** — 5 proven patterns: webhook processing, HTTP API, database, AI, scheduled
4. **n8n Validation Expert** — validation errors interpret karna aur fix karna
5. **n8n Node Configuration** — node properties, dependencies, operation-specific settings
6. **n8n Code JavaScript** — Code nodes mein JS likhna, \$input.all(), \$helpers.httpRequest(), dates
7. **n8n Code Python** — Python Code nodes mein pandas, data processing

**Installation (Claude Code mein)**:
Method 1 (Recommended): \`/plugin install czlonkowski/n8n-skills\`
Method 2: \`/plugin marketplace add czlonkowski/n8n-skills\` phir \`/plugin install\`
Method 3 (Manual): \`git clone https://github.com/czlonkowski/n8n-skills.git\` phir \`cp -r n8n-skills/skills/* ~/.claude/skills/\`

**IMPORTANT**: n8n-skills ko use karne ke liye n8n-mcp MCP server pehle se installed hona chahiye!

---

### TOOL 3: GitHub MCP Server
**GitHub**: https://github.com/github/github-mcp-server
**Kya hai**: GitHub ka official MCP server hai. Isse AI tools directly GitHub ke saath connect ho sakte hain — repositories browse karna, issues/PRs manage karna, code analyze karna, GitHub Actions monitor karna.

**Use Cases**:
- Repository management — code browse, search, commits analyze
- Issue & PR automation — bugs triage, code review, project boards
- CI/CD monitoring — GitHub Actions workflow runs, build failures, releases
- Code analysis — security findings, Dependabot alerts, code patterns

**Installation (VS Code)**:
Remote (easiest): VS Code 1.101+ mein: Settings → MCP → Add Server → type "http", URL: "https://api.githubcopilot.com/mcp/"
Manual: VS Code settings mein add karo:
\`\`\`json
{
  "servers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
\`\`\`

Claude Desktop, Cursor, Windsurf mein bhi install ho sakta hai. GitHub PAT (Personal Access Token) bhi use kar sakte ho for private repos.

---

### TOOL 4: Frontend Design Skill
**Source**: https://github.com/anthropics/claude-code (plugins/frontend-design/skills/frontend-design/SKILL.md)
**Kya hai**: Ye Claude Code ka built-in skill hai jo distinctive, production-grade frontend interfaces banata hai — generic "AI slop" aesthetics avoid karta hai.

**Kya karta hai**:
- Bold aesthetic direction choose karta hai (minimalist, maximalist, retro-futuristic, luxury etc.)
- Unique typography, color themes, motion animations
- Production-grade functional code
- Visually striking aur memorable designs

**Installation**: Claude Code mein already available hai — bas use karo jab frontend design chahiye.
Claude Code command: frontend design related query do, skill automatically activate hogi.

---

## HOW TO USE THESE TOOLS TOGETHER

### Step-by-Step Setup:
1. **Install n8n-mcp** — MCP server setup karo (cloud ya self-hosted)
2. **Install n8n-skills** — Claude Code mein \`/plugin install czlonkowski/n8n-skills\`
3. **Install GitHub MCP** — VS Code mein add karo for repo management
4. **Frontend Design Skill** — Already available in Claude Code

### Workflow Building Process:
1. Pehle n8n-mcp install karo aur connect karo apne n8n instance se
2. n8n-skills install karo — ye automatically activate hongi jab n8n related queries doge
3. Upar diye gaye 9 workflows ka business process samjho (DATABASE STRUCTURE + WORKFLOWS sections)
4. Claude ko bolo "Build Workflow 1: WhatsApp Complaint Intake" — n8n-skills automatically activate hongi
5. Har workflow ke liye n8n-mcp tools se nodes search karo, validate karo, templates use karo
6. Validation errors aaye toh n8n Validation Expert skill automatically help karegi
7. GitHub MCP se workflows ko GitHub repo mein save/manage karo
8. Frontend Design Skill se agar koi custom UI page banana ho toh use karo

**All tools work together seamlessly!**`;

/* ══════════════════════════════════════════════════════════════
   TOOLS & SKILLS (for card display)
   ══════════════════════════════════════════════════════════════ */
const TOOLS_SKILLS = [
  {
    id: 1,
    name: 'n8n-mcp',
    subtitle: 'MCP Server for n8n',
    icon: Zap,
    color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400',
    github: 'czlonkowski/n8n-mcp',
    description: 'Claude ko n8n ke 1,396 nodes ka knowledge deta hai — directly n8n instance mein workflow bana sakta hai',
    install: 'npx n8n-mcp ya dashboard.n8n-mcp.com',
    keyFeatures: ['1,396 nodes knowledge', '2,709 templates', 'Node search + validation', 'AI tool variants'],
  },
  {
    id: 2,
    name: 'n8n-skills',
    subtitle: '7 Claude Code Skills',
    icon: Sparkles,
    color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400',
    github: 'czlonkowski/n8n-skills',
    description: '7 skills jo Claude ko n8n workflow building sikhati hain — expressions, patterns, validation, code',
    install: '/plugin install czlonkowski/n8n-skills',
    keyFeatures: ['Expression syntax', 'Workflow patterns', 'Validation expert', 'Node configuration', 'Code JS/Python'],
  },
  {
    id: 3,
    name: 'GitHub MCP Server',
    subtitle: 'Official GitHub MCP',
    icon: Globe,
    color: 'text-gray-600 bg-gray-50 dark:bg-gray-950/30 dark:text-gray-400',
    github: 'github/github-mcp-server',
    description: 'GitHub ke saath direct connect — repos browse, issues manage, code analyze, CI/CD monitor',
    install: 'VS Code: Settings → MCP → Add Server → https://api.githubcopilot.com/mcp/',
    keyFeatures: ['Repository management', 'Issue & PR automation', 'CI/CD monitoring', 'Code analysis'],
  },
  {
    id: 4,
    name: 'Frontend Design Skill',
    subtitle: 'Claude Code Built-in',
    icon: Layers,
    color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400',
    github: 'anthropics/claude-code',
    description: 'Distinctive, production-grade frontend interfaces — generic AI aesthetics avoid karta hai',
    install: 'Already in Claude Code — automatically activates',
    keyFeatures: ['Bold aesthetics', 'Unique typography', 'Motion animations', 'Production-grade code'],
  },
];

/* ══════════════════════════════════════════════════════════════
   WORKFLOW SUMMARIES (for card display)
   ══════════════════════════════════════════════════════════════ */
const WORKFLOWS = [
  {
    id: 1,
    name: 'WhatsApp Complaint Intake',
    icon: MessageSquare,
    color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400',
    description: 'Citizen WhatsApp message → AI Brain analysis → Database save → WhatsApp confirmation reply',
    trigger: 'WhatsApp Webhook (jab message aata hai)',
    data: 'Complaint text, phone, name → category, urgency, summary → new complaint row',
  },
  {
    id: 2,
    name: 'Auto-Assignment Engine',
    icon: Users,
    color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-400',
    description: 'Unassigned complaints ko block/district ke hisab se officers ko automatically assign karta hai',
    trigger: 'Har 5 minute (scheduled)',
    data: 'Open unassigned complaints → match by block → update assignedToId',
  },
  {
    id: 3,
    name: 'Citizen Status Notification',
    icon: Bell,
    color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400',
    description: 'Jab officer status change karta hai, citizen ko WhatsApp pe update bhejta hai',
    trigger: 'Portal webhook (jab status change hota hai)',
    data: 'Complaint status, resolution → WhatsApp message → citizen phone',
  },
  {
    id: 4,
    name: 'Officer Assignment Notification',
    icon: Mail,
    color: 'text-orange-600 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-400',
    description: 'Officer ko WhatsApp + Email pe notification — naya complaint assign hua hai',
    trigger: 'Portal webhook (jab assign hota hai)',
    data: 'Complaint details + Officer details → WhatsApp + Email',
  },
  {
    id: 5,
    name: 'SLA Breach Escalation',
    icon: AlertTriangle,
    color: 'text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400',
    description: '7 din se open complaints ki urgency CRITICAL kar deta hai + admin ko email alert',
    trigger: 'Roz subah 9 baje (scheduled)',
    data: '7+ day open complaints → escalate urgency → email report to admin',
  },
  {
    id: 6,
    name: 'Daily Summary Report',
    icon: FileText,
    color: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 dark:text-cyan-400',
    description: 'Roz shaam 6 baje district admins ko daily stats email bhejta hai',
    trigger: 'Roz shaam 6 baje (scheduled)',
    data: 'Dashboard stats → HTML report → email to district admins',
  },
  {
    id: 7,
    name: 'AI Complaint Brain',
    icon: Sparkles,
    color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400',
    description: 'Complaint text analyze karke category, urgency, department, smart reply generate karta hai',
    trigger: 'Jab naya complaint aata hai',
    data: 'Complaint text → AI analysis → category, urgency, summary, smart reply',
  },
  {
    id: 8,
    name: 'Airtable Bidirectional Sync',
    icon: RefreshCw,
    color: 'text-teal-600 bg-teal-50 dark:bg-teal-950/30 dark:text-teal-400',
    description: 'Supabase ↔ Airtable sync — har 30 minute mein data dono taraf copy',
    trigger: 'Har 30 minute (scheduled)',
    data: 'Complaints push to Airtable + pull changes from Airtable',
  },
  {
    id: 9,
    name: 'Error Handler',
    icon: Shield,
    color: 'text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400',
    description: 'Sab workflows ka global error handler — admin email + Slack alert + auto retry',
    trigger: 'Jab koi workflow fail ho (error trigger)',
    data: 'Error details → admin email + Slack → retry (max 3)',
  },
];

/* ══════════════════════════════════════════════════════════════
   DATABASE TABLE INFO (for card display)
   ══════════════════════════════════════════════════════════════ */
const DB_TABLES = [
  {
    name: 'users',
    icon: Users,
    count: '9 fields',
    description: 'Admin aur officer accounts — dashboard login karne ke liye',
    keyFields: ['role (ADMIN/BLOCK/DISTRICT/STATE)', 'name', 'location', 'district', 'isActive'],
  },
  {
    name: 'complaints',
    icon: FileText,
    count: '16 fields',
    description: 'Main table — har ek citizen complaint yahan stored hai',
    keyFields: ['ticketNo (WB-01001)', 'citizenName', 'phone', 'issue', 'category', 'block', 'district', 'urgency', 'status', 'assignedToId', 'source', 'resolution', 'satisfactionRating'],
  },
  {
    name: 'activity_logs',
    icon: Timer,
    count: '7 fields',
    description: 'Complaint pe kya kya hua — sab activity ka history',
    keyFields: ['complaintId', 'action (CREATED/STATUS_CHANGED/ASSIGNED etc.)', 'description', 'actorName'],
  },
  {
    name: 'comments',
    icon: MessageSquare,
    count: '5 fields',
    description: 'Officers/admins ki internal discussion — complaint pe comments',
    keyFields: ['complaintId', 'content', 'actorName'],
  },
  {
    name: 'feedback',
    icon: Globe,
    count: '6 fields',
    description: 'Citizens ka general feedback — portal pe feedback form',
    keyFields: ['name', 'email', 'message', 'category', 'rating (1-5)'],
  },
];

/* ══════════════════════════════════════════════════════════════
   ANIMATION VARIANTS
   ══════════════════════════════════════════════════════════════ */
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } },
};

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */
export default function N8NWorkflowsView() {
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(CLAUDE_PROMPT);
      setCopied(true);
      toast.success('Prompt Copied!', {
        description: 'VS Code mein Claude ko paste karo — wo workflows bana dega!',
      });
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error('Copy failed — manually select and copy');
    }
  }, []);

  const promptStats = useMemo(() => ({
    workflows: 9,
    tables: 5,
    tools: 4,
    totalFields: 43,
    words: CLAUDE_PROMPT.split(/\s+/).length,
  }), []);

  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      {/* ═══ HEADER ═══ */}
      <motion.div variants={fadeUp} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl flex items-center justify-center shadow-sm" style={{ backgroundColor: NAVY }}>
            <Workflow className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-black text-foreground">n8n Workflow Builder</h2>
            <p className="text-xs text-muted-foreground">Claude ko prompt copy karo — wo khud n8n mein workflows bana dega</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(true)}
            className="h-9 gap-2 text-xs"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Preview Prompt
          </Button>
          <Button
            size="sm"
            onClick={handleCopy}
            className="h-9 gap-2 text-xs font-bold shadow-sm"
            style={{ backgroundColor: copied ? '#16A34A' : NAVY }}
          >
            {copied ? (
              <>
                <CheckCircle className="h-4 w-4" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy Full Prompt for Claude
              </>
            )}
          </Button>
        </div>
      </motion.div>

      {/* ═══ HOW TO USE ═══ */}
      <motion.div variants={fadeUp}>
        <Card className="border-dashed border-2" style={{ borderColor: NAVY + '40' }}>
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: NAVY + '15' }}>
                <Info className="h-4.5 w-4.5" style={{ color: NAVY }} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold mb-1.5">Kaise use karna hai?</h3>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/50 font-medium">
                    <span className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-black text-white" style={{ backgroundColor: NAVY }}>1</span>
                    <span>Copy Prompt</span>
                  </div>
                  <ArrowRight className="h-3 w-3 text-muted-foreground/50 hidden sm:block" />
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/50 font-medium">
                    <span className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-black text-white" style={{ backgroundColor: NAVY }}>2</span>
                    <span>VS Code mein Claude ko paste karo</span>
                  </div>
                  <ArrowRight className="h-3 w-3 text-muted-foreground/50 hidden sm:block" />
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/50 font-medium">
                    <span className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-black text-white" style={{ backgroundColor: NAVY }}>3</span>
                    <span>Claude khud n8n workflows bana dega</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ PROMPT STATS ═══ */}
      <motion.div variants={fadeUp} className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Workflows', value: promptStats.workflows, icon: Workflow, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Tools & Skills', value: promptStats.tools, icon: Sparkles, color: 'text-amber-600 dark:text-amber-400' },
          { label: 'DB Tables', value: promptStats.tables, icon: Database, color: 'text-blue-600 dark:text-blue-400' },
          { label: 'Total Fields', value: promptStats.totalFields, icon: Layers, color: 'text-purple-600 dark:text-purple-400' },
          { label: 'Words', value: promptStats.words, icon: FileText, color: 'text-orange-600 dark:text-orange-400' },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <stat.icon className={`h-3.5 w-3.5 ${stat.color}`} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{stat.label}</span>
            </div>
            <p className="text-2xl font-black text-foreground">{stat.value}</p>
          </Card>
        ))}
      </motion.div>

      {/* ═══ TOOLS & SKILLS ═══ */}
      <motion.div variants={fadeUp}>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-5 w-5" style={{ color: NAVY }} />
          <h3 className="text-base font-bold">Tools & Skills — Install karke use karna hai</h3>
          <Badge variant="secondary" className="text-[10px]">4 Tools</Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {TOOLS_SKILLS.map((tool) => (
            <Card key={tool.id} className="p-4 hover:shadow-md transition-shadow group">
              <div className="flex items-start gap-3">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${tool.color}`}>
                  <tool.icon className="h-4.5 w-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-bold">{tool.name}</span>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0">#{tool.id}</Badge>
                    <span className="text-[10px] text-muted-foreground">— {tool.subtitle}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-2">{tool.description}</p>
                  <div className="flex items-start gap-1.5 mb-2">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mt-px shrink-0">Install:</span>
                    <span className="text-[11px] text-muted-foreground font-mono">{tool.install}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {tool.keyFeatures.map((feat) => (
                      <Badge key={feat} variant="secondary" className="text-[9px] px-1.5 py-0 bg-muted/50">{feat}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </motion.div>

      {/* ═══ DATABASE SCHEMA ═══ */}
      <motion.div variants={fadeUp}>
        <div className="flex items-center gap-2 mb-3">
          <Database className="h-5 w-5" style={{ color: NAVY }} />
          <h3 className="text-base font-bold">Database Schema</h3>
          <Badge variant="secondary" className="text-[10px]">Supabase PostgreSQL</Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {DB_TABLES.map((table) => (
            <Card key={table.name} className="p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-2.5">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${table.color}`}>
                  <table.icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold font-mono">{table.name}</span>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0">{table.count}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{table.description}</p>
                </div>
              </div>
              <div className="space-y-1">
                {table.keyFields.map((field) => (
                  <div key={field} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/50" />
                    <span className="font-mono">{field}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </motion.div>

      {/* ═══ WORKFLOWS LIST ═══ */}
      <motion.div variants={fadeUp}>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-5 w-5" style={{ color: NAVY }} />
          <h3 className="text-base font-bold">Workflows — Business Process</h3>
          <Badge variant="secondary" className="text-[10px]">9 Workflows</Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {WORKFLOWS.map((wf) => (
            <Card key={wf.id} className="p-4 hover:shadow-md transition-shadow group">
              <div className="flex items-start gap-3">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${wf.color}`}>
                  <wf.icon className="h-4.5 w-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold">{wf.name}</span>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0">#{wf.id}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-2">{wf.description}</p>
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70 mt-px shrink-0">Trigger:</span>
                      <span className="text-[11px] text-muted-foreground">{wf.trigger}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70 mt-px shrink-0">Data:</span>
                      <span className="text-[11px] text-muted-foreground">{wf.data}</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </motion.div>

      {/* ═══ BOTTOM COPY BAR ═══ */}
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden" style={{ background: `linear-gradient(135deg, ${NAVY} 0%, #1a3a7a 100%)` }}>
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
              <div className="text-white">
                <h3 className="text-base font-bold flex items-center justify-center sm:justify-start gap-2">
                  <Sparkles className="h-5 w-5" />
                  Ready to Build!
                </h3>
                <p className="text-white/70 text-xs mt-1">
                  Copy the complete prompt — database schema, 9 workflows, 4 tools & skills with installation guides. Paste into Claude in VS Code.
                </p>
              </div>
              <Button
                size="lg"
                onClick={handleCopy}
                className="gap-2 font-bold shadow-lg bg-white text-gray-900 hover:bg-gray-100"
              >
                {copied ? (
                  <>
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span className="text-green-600">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-5 w-5" />
                    Copy Full Prompt
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ PREVIEW DIALOG ═══ */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="p-5 pb-3 border-b border-border/50 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: NAVY }}>
                  <ClipboardList className="h-4 w-4 text-white" />
                </div>
                <div>
                  <DialogTitle className="text-sm font-bold">Prompt Preview</DialogTitle>
                  <DialogDescription className="text-[11px]">{promptStats.words} words — Copy and paste into Claude in VS Code</DialogDescription>
                </div>
              </div>
              <Button size="sm" onClick={handleCopy} className="h-8 gap-1.5 text-xs font-bold" style={{ backgroundColor: NAVY }}>
                {copied ? <CheckCircle className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </DialogHeader>
          <ScrollArea className="flex-1">
            <pre className="p-5 text-xs font-mono leading-relaxed whitespace-pre-wrap text-foreground/90 bg-muted/30">
              {CLAUDE_PROMPT}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
