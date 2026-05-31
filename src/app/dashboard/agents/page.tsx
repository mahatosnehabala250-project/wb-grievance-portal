'use client';

import { AgentCard, AgentInfo } from '@/components/admin/AgentCard';
import { CEORouterTester } from '@/components/admin/CEORouterTester';
import { CacheHitRateWidget } from '@/components/admin/v1_1/CacheHitRateWidget';
import { Separator } from '@/components/ui/separator';

/**
 * Hardcoded agent data for v1.
 * Prompts are read-only — loaded from the prompt files at build time.
 * Tool lists match the design spec exactly.
 */
const AGENTS: AgentInfo[] = [
  {
    id: 'complaint',
    name: 'Complaint Agent',
    description:
      'Handles citizen grievance registration — collects complaint details one field at a time, validates blocks, checks duplicates, and registers complaints with ticket numbers.',
    tools: ['ValidateBlock', 'CheckDuplicate', 'RegisterComplaint', 'SaveSessionState'],
    promptPreview:
      'You are JanSeva Complaint Agent, a focused specialist within the West Bengal AI Public Support System. Your ONLY job is to help citizens of West Bengal register grievances (complaints) about public services. You operate inside a multi-agent system — the CEO Router has already determined that this conversation belongs to you.\n\nTools: ValidateBlock, CheckDuplicate, RegisterComplaint, SaveSessionState\n\nState machine: complaint_collecting → complaint_confirming → idle\n\nLanguage: Responds in bn/hi/en based on session.language. Collects naam, gaon, jela, block, gram_panchayat, samasya, category one at a time. Validates block via ValidateBlock. Reads back all data for confirmation before registering.',
    lastUpdated: '2026-01-15T10:30:00Z',
    n8nNodeUrl: undefined,
  },
  {
    id: 'blood',
    name: 'Blood Agent',
    description:
      'Manages blood request creation and donor response handling (HAAN/NAHI). Handles seeker flow (collecting blood group, units, hospital, urgency) and donor acceptance with race-safe advisory locks.',
    tools: ['CreateBloodRequest', 'DonorRespond', 'SeekerConfirm', 'SaveSessionState'],
    promptPreview:
      'You are JanSeva Rakta Sahayak Blood Agent, a focused specialist within the West Bengal AI Public Support System. You handle EXACTLY two flows: (1) a seeker creating a blood request, and (2) a donor responding to a pending blood request (HAAN/NAHI).\n\nTools: CreateBloodRequest, DonorRespond, SeekerConfirm, SaveSessionState\n\nSeeker flow: blood_collecting → blood_confirming → idle\nDonor flow: donor_pending_response → accepted/standby/declined\n\nCollects blood_group, units, hospital, urgency, contact_phone, district, block for seekers. Handles HAAN/NAHI responses for donors with pre-screening.',
    lastUpdated: '2026-01-15T10:30:00Z',
    n8nNodeUrl: undefined,
  },
  {
    id: 'donor',
    name: 'Donor Agent',
    description:
      'Handles donor registration and lifecycle management — PAUSE, RESUME, DONATED, DEFER commands. Collects medical eligibility data (DOB, weight, gender) and enforces age/weight constraints.',
    tools: ['RegisterDonor', 'UpdateDonorStatus', 'CheckDuplicate', 'RecordDonation', 'DeferDonor', 'SaveSessionState'],
    promptPreview:
      'You are JanSeva Donor Agent, a focused specialist within the West Bengal AI Public Support System. Your ONLY job is to handle donor registration and donor lifecycle management (PAUSE, RESUME, DONATED, DEFER commands).\n\nTools: RegisterDonor, UpdateDonorStatus, CheckDuplicate, RecordDonation, DeferDonor, SaveSessionState\n\nRegistration flow: donor_registration → donor_confirming → idle\nCommands: PAUSE (toggle is_paused), RESUME (toggle is_paused), DONATED (record donation + certificate), DEFER (apply deferral)\n\nCollects naam, blood_group, gender, date_of_birth, weight_kg, district, block, last_donated_date, last_donation_type.',
    lastUpdated: '2026-01-15T10:30:00Z',
    n8nNodeUrl: undefined,
  },
  {
    id: 'info',
    name: 'Status / Info Agent',
    description:
      'Non-LLM ticket status lookups and thin Gemini RAG for West Bengal government scheme questions. Runs as a Code Node (no AI Agent node) — direct DB query for tickets, single Gemini call for scheme info.',
    tools: [],
    promptPreview:
      'This is the JanSeva Status & Information Assistant (Code Node — not an AI Agent). Handles two tasks:\n\n1. Ticket Status Lookup — When a citizen provides a complaint ticket number (WB-YYYY-XXXXX), queries the complaints table directly and returns status, assigned officer, and last update.\n\n2. Government Scheme Information — Phase 1: inlines curated West Bengal scheme summaries into a single Gemini prompt (no vector search, no embeddings). Covers Kanyashree Prakalpa, Lakshmir Bhandar, Swasthya Sathi, Krishak Bandhu, Rupashree Prakalpa, and more.\n\nNo tools — runs as a Code Node with direct DB access and a single API call.',
    lastUpdated: '2026-01-15T10:30:00Z',
    n8nNodeUrl: undefined,
  },
];

/**
 * Agent Configuration page — lists all 4 specialist agents,
 * shows the Semantic Cache hit-rate widget, and includes the CEO Router
 * test runner at the bottom.
 *
 * @see Requirements 15.1, 15.2, 15.3, 26.6
 */
export default function AgentsPage() {
  return (
    <div className="container mx-auto max-w-5xl py-8 px-4 space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agent Configuration</h1>
        <p className="text-muted-foreground mt-1">
          View specialist agent prompts, tool assignments, and test the CEO Router dispatch logic.
        </p>
      </div>

      {/* Agent cards grid */}
      <div className="grid grid-cols-1 gap-6">
        {AGENTS.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>

      <Separator />

      {/* Semantic Cache hit-rate widget (Req 26.6 — Design §v1.1.7) */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Semantic Cache</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Cache hit rate per category over the last 24 hours and 7 days. Hits are served from
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">query_cache</code>
            without calling Gemini or the primary lookup.
          </p>
        </div>
        <CacheHitRateWidget />
      </div>

      <Separator />

      {/* CEO Router Test Runner */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">CEO Router Test Runner</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Test which agent the deterministic CEO Router would dispatch to for any given message and session state.
          </p>
        </div>
        <CEORouterTester />
      </div>
    </div>
  );
}
