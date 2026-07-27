/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * agent.ts — the assistant "brain": a server-side function-calling loop.
 *
 * Uses DeepSeek (OpenAI-compatible `tools`) to turn a multilingual question/
 * command into tool calls. READ tools run here (scope-locked). NAVIGATE and
 * WRITE tools are captured as a client directive / a proposed action (writes are
 * NEVER executed here — the human confirms, then the existing audited route runs).
 */

import type { JWTPayload } from '@/lib/jwt';
import {
  ToolCtx, getToolSchemas, executeReadTool, WRITE_TOOL_NAMES, NAV_DESTINATIONS,
} from '@/lib/assistant/tools';

const KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const MAX_ITERS = 5;

export function assistantEnabled(): boolean {
  return !!KEY;
}

export interface ChatMsg { role: 'user' | 'assistant'; content: string }

export interface NavigateDirective { destination: string; view: string; room?: string; label: string }
export interface ProposedAction { id: string; kind: 'assign' | 'status' | 'escalate' | 'note' | 'reopen'; ticketNo: string; params: Record<string, unknown>; label: string }
export interface AssistantResult {
  answer: string;
  navigate?: NavigateDirective;
  proposedActions: ProposedAction[];
  usedTools: string[];
}

export function buildSystemPrompt(payload: JWTPayload): string {
  const role = payload.role_level || payload.role;
  const dests = NAV_DESTINATIONS.map((d) => `${d.id} (${d.label})`).join(', ');
  return `You are "Saathi", the voice assistant inside JanSunwai — a grievance-redressal command centre for a West Bengal public representative / officer. The current user's role is ${role}.

YOUR JOB: understand the user's spoken request, call the right tools to fetch real data or to act, then reply in ONE short spoken-style answer.

LANGUAGE: reply in the SAME language the user used (Bengali, Hindi/Hinglish, or English). Keep it short and clear — this is read aloud. Speak in 1-3 plain sentences. NEVER use asterisks (*), hashes, bullets, or any markdown — the reply is spoken aloud, so symbols get read out literally (e.g. "*" becomes "star"). Plain text only.

TOOLS:
- Use READ tools (get_overview, search_complaints, get_complaint, top_hotspots, get_forecast, get_nlp_insights, get_priority_areas, get_network, get_pending_actions, get_leaderboard, list_team) to ground EVERY factual claim. Never invent numbers, tickets, areas, or names. If a tool returns an error or nothing, say so plainly.
- Use the navigate tool when the user wants to open/see a page ("map kholo", "show forecast", "open complaints"). Available pages: ${dests}. After navigating, confirm in one short line.
- WRITE tools (assign_officer, update_status, escalate_complaint, add_note, reopen_complaint) only PROPOSE an action — they are NOT executed until the user taps confirm. When you call one, tell the user you have prepared it and ask them to confirm.

RULES:
- All data is already limited to the user's own jurisdiction by the system — answer only from what tools return.
- For a question about a specific place/area, call area_breakdown or query_complaints WITH that area. If a tool returns total 0 or a "not found / not understood" note, SAY that area wasn't found and ask for the spelling — NEVER report the overall/global numbers as if they belong to that area.
- This is aggregate civic governance. NEVER profile individual citizens or suggest voter targeting. Do not reveal citizen phone numbers.
- If the user just chats, answer briefly without forcing a tool call.`;
}

async function deepseek(messages: any[], tools: any[] | null): Promise<any> {
  const body: any = { model: MODEL, messages, temperature: 0.2, max_tokens: 800 };
  if (tools) { body.tools = tools; body.tool_choice = 'auto'; }
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`DeepSeek HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function runAssistant(history: ChatMsg[], ctx: ToolCtx): Promise<AssistantResult> {
  const tools = getToolSchemas(ctx.payload);
  const messages: any[] = [
    { role: 'system', content: buildSystemPrompt(ctx.payload) },
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
  ];

  const usedTools: string[] = [];
  const proposedActions: ProposedAction[] = [];
  let navigate: NavigateDirective | undefined;
  let answer = '';

  for (let i = 0; i < MAX_ITERS; i++) {
    const json = await deepseek(messages, tools);
    const msg = json?.choices?.[0]?.message;
    if (!msg) break;
    messages.push(msg);

    const calls = msg.tool_calls as any[] | undefined;
    if (!calls || calls.length === 0) {
      answer = (msg.content || '').trim();
      break;
    }

    for (const tc of calls) {
      const name = tc.function?.name as string;
      let args: any = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* ignore */ }
      usedTools.push(name);
      let result: any;

      if (name === 'navigate') {
        const dest = NAV_DESTINATIONS.find((d) => d.id === args.destination);
        if (dest) { navigate = { destination: dest.id, view: dest.view, room: dest.room, label: dest.label }; result = { ok: true, opening: dest.label }; }
        else { result = { error: `unknown destination ${args.destination}` }; }
      } else if (WRITE_TOOL_NAMES.has(name)) {
        const ticketNo = String(args.ticketNo || '').trim();
        const kind = name === 'assign_officer' ? 'assign' : name === 'escalate_complaint' ? 'escalate' : name === 'add_note' ? 'note' : name === 'reopen_complaint' ? 'reopen' : 'status';
        const label = kind === 'assign' ? `Assign ${args.officer} to ${ticketNo}`
          : kind === 'escalate' ? `Escalate ${ticketNo} by one urgency level`
          : kind === 'note' ? `Add note to ${ticketNo}: "${String(args.note || '').slice(0, 60)}"`
          : kind === 'reopen' ? `Reopen ${ticketNo}`
          : `Set ${ticketNo} → ${args.status}${args.resolutionNote ? ' (with note)' : ''}`;
        proposedActions.push({ id: `${name}:${ticketNo}:${proposedActions.length}`, kind: kind as ProposedAction['kind'], ticketNo, params: args, label });
        result = { ok: true, status: 'prepared — awaiting user confirmation' };
      } else {
        result = await executeReadTool(name, args, ctx);
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 4000) });
    }
  }

  // If the loop ended on a tool call without a final spoken answer, force one.
  if (!answer) {
    try {
      const json = await deepseek(messages, null);
      answer = (json?.choices?.[0]?.message?.content || '').trim();
    } catch { /* ignore */ }
  }
  if (!answer) {
    answer = navigate ? `${navigate.label} khol raha hoon.` : proposedActions.length ? 'I have prepared the action — please confirm.' : 'Sorry, I could not answer that just now.';
  }

  return { answer, navigate, proposedActions, usedTools };
}
