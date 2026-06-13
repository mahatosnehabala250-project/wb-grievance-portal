/**
 * advisor.ts — AI Chief-of-Staff (Level 9).
 *
 * The politician/officer asks a natural-language question (Bengali/Hindi/English)
 * and gets an evidence-cited answer grounded ONLY in their scope-locked data.
 *
 * Powered by DeepSeek (strong reasoning, cheap). Provider-flexible: DEEPSEEK_API_KEY
 * (OpenAI-compatible) primary; falls back to Gemini/Anthropic if you ever point it
 * there. The data fed in is already scope-filtered by the caller — the model only
 * ever sees the user's own jurisdiction.
 *
 * ETHICS: answers operate on aggregate civic data + ticket-level facts the user can
 * already see. No individual-voter profiling, no targeting recommendations.
 */

import type { IntelligenceBrief } from '@/lib/intelligence';

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

export function advisorEnabled(): boolean {
  return !!DEEPSEEK_KEY;
}

export interface NlpContext {
  clusters: Array<{ rootCause: string; count: number; villages: string[]; avgAnger: number }>;
  angerHotspots: Array<{ name: string; avgAnger: number; count: number }>;
  entityWatch: Array<{ type: string; name: string; count: number }>;
}

/** Turn the scoped intelligence brief + NLP into a compact factual context block. */
export function buildContext(b: IntelligenceBrief, nlp: NlpContext | null): string {
  const L: string[] = [];
  L.push(`SCOPE: ${b.scope.label} (level: ${b.scope.level})`);
  L.push(`RISK INDEX: ${b.riskIndex.score}/100 (${b.riskIndex.grade}). Drivers: ${b.riskIndex.drivers.join('; ') || 'none'}`);
  const k = b.kpis;
  L.push(`KPIs: total=${k.total}, active=${k.active}, resolved=${k.resolved}, critical=${k.critical}, SLA_breached=${k.slaBreached}, resolution_rate=${k.resolutionRate}%, avg_resolution_days=${k.avgResolutionDays ?? 'NA'}, avg_rating=${k.avgRating ?? 'NA'}/5, last7days=${k.filed7} (momentum ${k.momentumPct >= 0 ? '+' : ''}${k.momentumPct}% WoW)`);

  if (b.hotspots.length) {
    L.push(`HOTSPOTS (by ${b.scope.subAreaLabel}): ` + b.hotspots.slice(0, 6).map(h => `${h.name}[active=${h.active}${h.critical ? `,crit=${h.critical}` : ''},risk=${h.risk}]`).join(', '));
  }
  if (b.categorySurges.length) {
    L.push(`SURGING CATEGORIES: ` + b.categorySurges.slice(0, 5).map(s => `${s.category}(+${s.pctChange}%, ${s.previous}->${s.current})`).join(', '));
  }
  if (b.warnings.length) {
    L.push(`WARNINGS: ` + b.warnings.slice(0, 5).map(w => `[${w.severity}] ${w.title} — ${w.detail}`).join(' | '));
  }
  if (b.officers.length) {
    L.push(`OFFICERS: ` + b.officers.slice(0, 6).map(o => `${o.name}(score=${o.score}%, ${o.resolved}/${o.total})`).join(', '));
  }
  if (b.benchmark && b.benchmark.peers.length) {
    const self = b.benchmark.peers.find(p => p.isSelf);
    L.push(`PEER BENCHMARK (${b.benchmark.label}): you=${self ? self.resolutionRate + '%' : 'NA'}, percentile=${b.benchmark.percentile ?? 'NA'}. Peers: ` + b.benchmark.peers.slice(0, 6).map(p => `${p.name}${p.isSelf ? '*' : ''}=${p.resolutionRate}%`).join(', '));
  }
  if (b.quickWins.length) {
    L.push(`QUICK WINS (old, easy to close): ` + b.quickWins.slice(0, 5).map(q => `${q.ticketNo}(${q.village || q.category}, ${q.daysOld}d)`).join(', '));
  }
  if (b.wins.length) {
    L.push(`RECENT RESOLVED (PR-worthy): ` + b.wins.slice(0, 5).map(w => `${w.ticketNo}(${w.village || w.category}${w.rating ? `, ${w.rating}star` : ''})`).join(', '));
  }
  if (nlp) {
    if (nlp.clusters.length) {
      L.push(`ROOT-CAUSE CLUSTERS (AI): ` + nlp.clusters.slice(0, 6).map(c => `"${c.rootCause}" x${c.count}${c.villages.length ? ` [${c.villages.join(',')}]` : ''}${c.avgAnger >= 60 ? ` anger=${c.avgAnger}` : ''}`).join(' | '));
    }
    if (nlp.angerHotspots.length) {
      L.push(`ANGER HOTSPOTS (AI, 0-100): ` + nlp.angerHotspots.slice(0, 6).map(h => `${h.name}=${h.avgAnger}`).join(', '));
    }
    if (nlp.entityWatch.length) {
      L.push(`ENTITY WATCH (recurring): ` + nlp.entityWatch.slice(0, 6).map(e => `${e.name}(${e.type}, ${e.count}x)`).join(', '));
    }
  }
  return L.join('\n');
}

const SYSTEM = `You are the AI Chief-of-Staff for a West Bengal public representative / officer. You answer the user's question using ONLY the DATA block provided — never invent numbers, tickets, names, or villages that are not in the data.

Rules:
- Answer in the SAME language as the question (Bengali, Hindi, or English).
- Be concise, direct, and action-oriented — like a sharp political strategist, not a chatbot.
- ALWAYS cite specifics from the data: ticket numbers, village/area names, percentages, officer names.
- When asked "where should I go / what to do", recommend concrete priorities (hotspots, critical clusters, quick wins) with the reason.
- If the data does not contain the answer, say so plainly — do not guess.
- This is aggregate civic intelligence. Do NOT profile individual citizens or suggest voter targeting. Focus on governance, resolution, and accountability.
- Keep answers under ~180 words unless the user asks for a full report.`;

/** Ask the advisor. Returns the answer text, or null if DeepSeek is not configured / fails. */
export async function askAdvisor(question: string, context: string): Promise<string | null> {
  if (!DEEPSEEK_KEY) return null;
  try {
    const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `DATA (your jurisdiction only):\n${context}\n\nQUESTION: ${question}` },
        ],
        max_tokens: 700,
        temperature: 0.3,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[advisor] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const json = await res.json();
    return json?.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[advisor] call failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
