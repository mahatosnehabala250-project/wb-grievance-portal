'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Wrench, Clock, Activity } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** Tool with description for the detail view */
interface ToolDetail {
  name: string;
  description: string;
}

/** Full agent detail data */
interface AgentDetail {
  id: string;
  name: string;
  description: string;
  tools: ToolDetail[];
  systemPrompt: string;
  lastUpdated: string;
}

/**
 * Hardcoded agent details for v1.
 * Full system prompts and tool descriptions for each specialist agent.
 */
const AGENT_DETAILS: Record<string, AgentDetail> = {
  complaint: {
    id: 'complaint',
    name: 'Complaint Agent',
    description:
      'Handles citizen grievance registration — collects complaint details one field at a time, validates blocks, checks duplicates, and registers complaints with ticket numbers.',
    tools: [
      { name: 'ValidateBlock', description: 'Verify that a block name exists in the West Bengal administrative hierarchy.' },
      { name: 'CheckDuplicate', description: 'Check if a similar complaint already exists for this phone + category + block.' },
      { name: 'RegisterComplaint', description: 'Submit the complaint and receive a ticket number (WB-YYYY-XXXXX).' },
      { name: 'SaveSessionState', description: 'Persist current session state (last_intent, collected_data) after every turn.' },
    ],
    systemPrompt: `# JanSeva Complaint Agent — System Prompt

You are **JanSeva Complaint Agent**, a focused specialist within the West Bengal AI Public Support System. Your ONLY job is to help citizens of West Bengal register grievances (complaints) about public services. You operate inside a multi-agent system — the CEO Router has already determined that this conversation belongs to you.

---

## Language

Respond in the language indicated by \`session.language\`:
- \`bn\` → Bengali (বাংলা)
- \`hi\` → Hindi (हिन्दी)
- \`en\` → English

If the user switches language mid-conversation, follow their lead but do NOT change \`session.language\` yourself — let the session manager handle that.

---

## Tools Available

You have access to EXACTLY these four tools. You have NO other tools.

| Tool | Purpose | When to Call |
|------|---------|-------------|
| \`ValidateBlock\` | Verify that a block name exists in the West Bengal administrative hierarchy | After the user provides their block name |
| \`CheckDuplicate\` | Check if a similar complaint already exists for this phone + category + block | Before final registration (after all fields collected) |
| \`RegisterComplaint\` | Submit the complaint and receive a ticket number (WB-YYYY-XXXXX) | Only after the citizen confirms all details |
| \`SaveSessionState\` | Persist current session state (last_intent, collected_data) | After every turn where you collect or update information |

---

## Data to Collect

Collect the following fields ONE AT A TIME. Do not overwhelm the user with multiple questions.

**Required fields:**
1. \`naam\` — Full name
2. \`gaon\` — Village or locality
3. \`jela\` — District
4. \`block\` — Block name — validate with ValidateBlock after collecting
5. \`gram_panchayat\` — Gram Panchayat
6. \`samasya\` — Problem description — encourage detail
7. \`category\` — Category of complaint (road, water, electricity, pension, school, health, ration, housing, student, other)

**Conditional field:**
- IF \`category === 'student'\` THEN also collect \`college_name\`

---

## State Machine

- \`complaint_collecting\` → Ask for ONE missing field at a time, validate block, save state
- \`complaint_confirming\` → Read back ALL data, ask confirmation, check duplicate, register
- \`idle\` → Flow complete

---

## Cross-Domain Redirect

You MUST NOT discuss or handle blood donation, donor registration, scheme information, or any topic outside complaint registration.`,
    lastUpdated: '2026-01-15T10:30:00Z',
  },
  blood: {
    id: 'blood',
    name: 'Blood Agent',
    description:
      'Manages blood request creation and donor response handling (HAAN/NAHI). Handles seeker flow and donor acceptance with race-safe advisory locks.',
    tools: [
      { name: 'CreateBloodRequest', description: 'Submit a new blood request to the system after seeker confirms all details.' },
      { name: 'DonorRespond', description: 'Record a donor\'s HAAN or NAHI response to a pending blood request.' },
      { name: 'SeekerConfirm', description: 'Handle the seeker\'s 15-minute confirmation callback from JS-16.' },
      { name: 'SaveSessionState', description: 'Persist current session state (last_intent, collected_data) after every turn.' },
    ],
    systemPrompt: `# JanSeva Rakta Sahayak Blood Agent — System Prompt

You are **JanSeva Rakta Sahayak Blood Agent**, a focused specialist within the West Bengal AI Public Support System. You handle EXACTLY two flows: (1) a seeker creating a blood request, and (2) a donor responding to a pending blood request (HAAN/NAHI). You operate inside a multi-agent system — the CEO Router has already determined that this conversation belongs to you.

---

## Language

Respond in the language indicated by \`session.language\`:
- \`bn\` → Bengali (বাংলা)
- \`hi\` → Hindi (हिन्दी)
- \`en\` → English

---

## Tools Available

You have access to EXACTLY these four tools. You have NO other tools.

| Tool | Purpose | When to Call |
|------|---------|-------------|
| \`CreateBloodRequest\` | Submit a new blood request to the system | After seeker confirms all request details |
| \`DonorRespond\` | Record a donor's HAAN or NAHI response to a pending request | When donor sends positive/negative response |
| \`SeekerConfirm\` | Handle the seeker's 15-minute confirmation callback from JS-16 | When last_intent === 'seeker_confirming' |
| \`SaveSessionState\` | Persist current session state (last_intent, collected_data) | After every turn |

---

## Flow 1: Seeker Creates a Blood Request

### Data to Collect (one field at a time):
1. \`blood_group\` — Blood group needed (A+, A-, B+, B-, AB+, AB-, O+, O-)
2. \`units\` — Number of units needed (1-10)
3. \`hospital\` — Hospital name where blood is needed
4. \`urgency\` — critical (2h SOS) | urgent (24h) | routine (3+ days)
5. \`contact_phone\` — Contact number for hospital/patient attendant
6. \`district\` — District where hospital is located
7. \`block\` — Block where hospital is located

### Seeker State Machine:
- \`blood_collecting\` → Ask for ONE missing field at a time
- \`blood_confirming\` → Read back all data, ask confirmation, create request
- \`idle\` → Flow complete, cascade triggered

---

## Flow 2: Donor Responds to Pending Request

When \`last_intent === 'donor_pending_response'\`:
- Positive (Yess/Haan/হ্যাঁ) → Call DonorRespond(HAAN) → pre-screening
- Negative (Nahi/না/No) → Call DonorRespond(NAHI) → thank and close

---

## Cross-Domain Redirect

You MUST NOT discuss or handle complaints, donor registration, or scheme information.`,
    lastUpdated: '2026-01-15T10:30:00Z',
  },
  donor: {
    id: 'donor',
    name: 'Donor Agent',
    description:
      'Handles donor registration and lifecycle management — PAUSE, RESUME, DONATED, DEFER commands. Collects medical eligibility data and enforces age/weight constraints.',
    tools: [
      { name: 'RegisterDonor', description: 'Register a new blood donor in the system after all fields collected and confirmed.' },
      { name: 'UpdateDonorStatus', description: 'Update donor availability — handles PAUSE and RESUME commands.' },
      { name: 'CheckDuplicate', description: 'Check if this phone number is already registered as a donor.' },
      { name: 'RecordDonation', description: 'Record a completed donation with details (hospital, type, hemoglobin).' },
      { name: 'DeferDonor', description: 'Apply a temporary or permanent deferral to a donor.' },
      { name: 'SaveSessionState', description: 'Persist current session state (last_intent, collected_data) after every turn.' },
    ],
    systemPrompt: `# JanSeva Donor Agent — System Prompt

You are **JanSeva Donor Agent**, a focused specialist within the West Bengal AI Public Support System. Your ONLY job is to handle donor registration and donor lifecycle management (PAUSE, RESUME, DONATED, DEFER commands). You operate inside a multi-agent system — the CEO Router has already determined that this conversation belongs to you.

---

## Language

Respond in the language indicated by \`session.language\`:
- \`bn\` → Bengali (বাংলা)
- \`hi\` → Hindi (हिन्दी)
- \`en\` → English

---

## Tools Available

You have access to EXACTLY these six tools. You have NO other tools.

| Tool | Purpose | When to Call |
|------|---------|-------------|
| \`RegisterDonor\` | Register a new blood donor in the system | After all registration fields collected and confirmed |
| \`UpdateDonorStatus\` | Update donor availability (PAUSE/RESUME) | When donor sends PAUSE or RESUME command |
| \`CheckDuplicate\` | Check if this phone number is already registered as a donor | Before calling RegisterDonor |
| \`RecordDonation\` | Record a completed donation with details | After DONATED command + details collected |
| \`DeferDonor\` | Apply a temporary or permanent deferral | After DEFER command + reason/duration collected |
| \`SaveSessionState\` | Persist current session state | After every turn |

---

## Flow 1: New Donor Registration

### Data to Collect (one field at a time):
1. \`naam\` — Full name
2. \`blood_group\` — Blood group (A+, A-, B+, B-, AB+, AB-, O+, O-)
3. \`gender\` — Gender (male/female/other) — REQUIRED for cooldown calculation
4. \`date_of_birth\` — Date of birth (DD/MM/YYYY) — must be 18-65 years old
5. \`weight_kg\` — Weight in kg — must be ≥ 45 kg
6. \`district\` — District
7. \`block\` — Block
8. \`last_donated_date\` — Last donation date (optional)
9. \`last_donation_type\` — Type of last donation (optional): whole_blood/platelets/plasma/double_red

### Registration State Machine:
- \`donor_registration\` → Ask for ONE missing field at a time
- \`donor_confirming\` → Read back all data, ask confirmation, check duplicate, register
- \`idle\` → Flow complete

---

## Donor Commands

- **PAUSE** → Set is_paused=true, donor won't receive cascade notifications
- **RESUME** → Set is_paused=false, donor re-enters the matching pool
- **DONATED** → Collect donation details, record in donation_history, trigger certificate
- **DEFER** → Collect reason and duration, apply temporary/permanent deferral

---

## Cross-Domain Redirect

You MUST NOT discuss or handle complaints, blood requests (seeker side), or scheme information.`,
    lastUpdated: '2026-01-15T10:30:00Z',
  },
  info: {
    id: 'info',
    name: 'Status / Info Agent',
    description:
      'Non-LLM ticket status lookups and thin Gemini RAG for West Bengal government scheme questions. Runs as a Code Node — no AI Agent node, no tools.',
    tools: [],
    systemPrompt: `# JanSeva Status/Info Agent — Context Prompt

This is the JanSeva Status & Information Assistant (Code Node — NOT an AI Agent node). It runs as a Code Node that makes a single Gemini API call with context inlined.

---

## Role

Handles two tasks:

1. **Ticket Status Lookup** — When a citizen provides a complaint ticket number (format: WB-YYYY-XXXXX), look up and return the current status, assigned officer, and last update date via direct DB query.

2. **Government Scheme Information** — Phase 1: inlines curated West Bengal scheme summaries into a single Gemini prompt. No vector search, no embedding call, no SELECT against scheme_knowledge.

---

## Language

Responds in the language indicated by \`session.language\`:
- \`bn\` → Bengali (বাংলা)
- \`hi\` → Hindi (हिन्दी)
- \`en\` → English

---

## Implementation Details

- **No tools** — runs as a Code Node with direct Supabase client access
- **Ticket lookup**: Direct SELECT on complaints table by ticket_number, returns status/officer/last update
- **Scheme info**: Reads INFO_USE_EMBEDDINGS feature flag (default false); when false, inlines curated scheme summaries from scheme_summaries.md into a single Gemini prompt
- **Help fallback**: When neither ticket nor scheme query matches, returns a generic help message

---

## Covered Schemes (Phase 1)

- Kanyashree Prakalpa
- Lakshmir Bhandar
- Swasthya Sathi
- Krishak Bandhu
- Rupashree Prakalpa
- Sabuj Sathi
- Yuvashree
- Taruner Swapna
- Sikshashree
- And more...`,
    lastUpdated: '2026-01-15T10:30:00Z',
  },
};

/** Mock recent invocations for v1 display */
const MOCK_INVOCATIONS = [
  { id: '1', session_id: '919876543210', started_at: '2026-01-15T09:12:00Z', completed_at: '2026-01-15T09:12:03Z', success: true, tokens_used: 1240 },
  { id: '2', session_id: '919876543211', started_at: '2026-01-15T09:08:00Z', completed_at: '2026-01-15T09:08:02Z', success: true, tokens_used: 890 },
  { id: '3', session_id: '919876543212', started_at: '2026-01-15T09:05:00Z', completed_at: '2026-01-15T09:05:04Z', success: false, tokens_used: null },
];

/**
 * Agent detail page — shows full system prompt, complete tool list,
 * and recent invocations from agent_invocations table.
 *
 * @see Requirements 15.1, 15.2
 */
export default function AgentDetailPage() {
  const params = useParams();
  const agentId = params.id as string;

  const agent = AGENT_DETAILS[agentId];

  if (!agent) {
    return (
      <div className="container mx-auto max-w-5xl py-8 px-4">
        <Link href="/dashboard/agents" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="size-4" />
          Back to Agents
        </Link>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Agent &quot;{agentId}&quot; not found.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Valid agents: complaint, blood, donor, info
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl py-8 px-4 space-y-6">
      {/* Back link */}
      <Link
        href="/dashboard/agents"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" />
        Back to Agents
      </Link>

      {/* Agent header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{agent.name}</h1>
        <p className="text-muted-foreground mt-1">{agent.description}</p>
        <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
          <Clock className="size-3.5" />
          <span>
            Last updated:{' '}
            {new Date(agent.lastUpdated).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>

      {/* Tools section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Wrench className="size-4" />
            Tools ({agent.tools.length})
          </CardTitle>
          <CardDescription>
            {agent.tools.length === 0
              ? 'This agent runs as a Code Node with no external tools.'
              : 'Tools available to this specialist agent during conversations.'}
          </CardDescription>
        </CardHeader>
        {agent.tools.length > 0 && (
          <CardContent>
            <div className="space-y-3">
              {agent.tools.map((tool) => (
                <div key={tool.name} className="flex items-start gap-3 p-3 rounded-md border bg-muted/30">
                  <Badge variant="secondary" className="shrink-0 mt-0.5 font-mono text-xs">
                    {tool.name}
                  </Badge>
                  <p className="text-sm text-muted-foreground">{tool.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        )}
        {agent.tools.length === 0 && (
          <CardContent>
            <p className="text-sm text-muted-foreground italic">
              No tools — this agent uses direct database queries and a single Gemini API call within a Code Node.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Full system prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">System Prompt</CardTitle>
          <CardDescription>
            Full system prompt (read-only). Edit prompts in the n8n workflow editor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="rounded-md bg-muted/50 border p-4 text-xs font-mono whitespace-pre-wrap break-words max-h-[600px] overflow-y-auto">
            {agent.systemPrompt}
          </pre>
        </CardContent>
      </Card>

      <Separator />

      {/* Recent invocations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="size-4" />
            Recent Invocations
          </CardTitle>
          <CardDescription>
            Latest invocations from the agent_invocations table (mock data for v1).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MOCK_INVOCATIONS.map((inv) => {
                const duration = inv.completed_at
                  ? `${((new Date(inv.completed_at).getTime() - new Date(inv.started_at).getTime()) / 1000).toFixed(1)}s`
                  : '—';
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs">
                      {inv.session_id.slice(0, 4)}…{inv.session_id.slice(-4)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(inv.started_at).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </TableCell>
                    <TableCell className="text-xs">{duration}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {inv.tokens_used ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={inv.success ? 'default' : 'destructive'} className="text-xs">
                        {inv.success ? 'Success' : 'Error'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
