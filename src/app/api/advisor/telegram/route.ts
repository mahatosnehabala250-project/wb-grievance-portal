import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { n8nSecretOk } from '@/lib/n8nAuth';
import { getComplaintScopeFilter, applyComplaintScope } from '@/lib/jwt';
import type { JWTPayload } from '@/lib/jwt';
import { askAdvisor, advisorEnabled } from '@/lib/advisor';
import { isBreached } from '@/lib/sla';
import { dbTime } from '@/lib/db-time';
import { prettyBlock } from '@/lib/block-name';

/**
 * /api/advisor/telegram — the chief of staff, answering in Telegram.
 *
 * n8n owns the transport (it already receives Telegram and already links staff
 * accounts to chat ids in JS-12). This route owns the two things transport must
 * never own: who the caller is, and what they are allowed to see.
 *
 * Scope comes from getComplaintScopeFilter — the same function the complaints
 * screen uses. It is imported rather than reimplemented on purpose: a second
 * copy of a jurisdiction rule is how one of them silently drifts, and this
 * codebase has already paid for that once (raw `block` equality vs `block_norm`
 * left whole blocks reading empty).
 *
 * The caller is identified by telegram_chat_id, never by anything in the body.
 * n8n is trusted to relay a chat id; it is not trusted to say who that is.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DAY = 86_400_000;
const CLOSED = new Set(['RESOLVED', 'REJECTED', 'CLOSED']);

type AnyRecord = Record<string, unknown>;

interface Filterable {
  eq(column: string, value: unknown): Filterable;
  in(column: string, values: unknown[]): Filterable;
}

/** Apply the caller's jurisdiction to a query. Mirrors the pattern in rollup. */
function scoped<T>(query: T, payload: JWTPayload): T {
  return applyComplaintScope(query, payload);
}

function scopeLabel(u: JWTPayload): string {
  switch (u.role_level) {
    case 'MP': return `${u.lok_sabha_constituency} (Lok Sabha)`;
    case 'MLA': return `${u.constituency} (Assembly)`;
    case 'DISTRICT_ADMIN': return `${u.district || u.block} district`;
    case 'BLOCK_COORD': return `${prettyBlock(u.block)} block`;
    case 'GP_COORD': return `${u.gp_name || u.gp_code} GP`;
    case 'KARYAKARTA': return `${(u.assigned_villages || []).length} assigned villages`;
    default: return u.role === 'ADMIN' ? 'the whole system' : prettyBlock(u.block);
  }
}

/**
 * The factual block the model reasons over. Everything here is already inside
 * the caller's jurisdiction, so the model is never in a position to leak
 * across one — it simply never sees the other seats.
 */
function buildBrief(
  rows: AnyRecord[],
  label: string,
  evidence: AnyRecord[],
  memory: AnyRecord[]
): string {
  const now = Date.now();
  const since = (d: number) => now - d * DAY;

  const open = rows.filter((c) => !CLOSED.has(String(c.status).toUpperCase()));
  const breached = open.filter((c) =>
    isBreached(c.createdAt as string, c.urgency as string, c.status as string)
  );
  const unowned = open.filter((c) => !c.assignedToId);
  const filed7 = rows.filter((c) => dbTime(c.createdAt as string) >= since(7));
  const filed30 = rows.filter((c) => dbTime(c.createdAt as string) >= since(30));
  const closed7 = rows.filter((c) => c.resolvedAt && dbTime(c.resolvedAt as string) >= since(7));
  const closed30 = rows.filter((c) => c.resolvedAt && dbTime(c.resolvedAt as string) >= since(30));

  const L: string[] = [];
  L.push(`SCOPE: ${label}`);
  L.push(`LAST 7 DAYS: filed ${filed7.length}, closed ${closed7.length}, net ${filed7.length - closed7.length}`);
  L.push(`LAST 30 DAYS: filed ${filed30.length}, closed ${closed30.length}`);
  L.push(`OPEN NOW: ${open.length} (past deadline ${breached.length}, nobody assigned ${unowned.length})`);

  // Who is carrying what, and who has stopped.
  const byWorker = new Map<string, { open: number; closed: number; last: number }>();
  for (const c of rows) {
    const who = c.assignedOfficerName as string;
    if (!who) continue;
    const w = byWorker.get(who) || { open: 0, closed: 0, last: 0 };
    if (c.resolvedAt) w.closed++; else w.open++;
    const t = Math.max(dbTime(c.resolvedAt as string) || 0, dbTime(c.createdAt as string) || 0);
    if (t > w.last) w.last = t;
    byWorker.set(who, w);
  }
  if (byWorker.size) {
    L.push('WORKERS: ' + [...byWorker.entries()]
      .sort((a, b) => b[1].open - a[1].open)
      .slice(0, 8)
      .map(([n, w]) => `${n}[open=${w.open},closed=${w.closed},idle_days=${Math.round((now - w.last) / DAY)}]`)
      .join(', '));
  } else {
    L.push('WORKERS: nobody has ever been assigned a case in this scope.');
  }

  // Villages that have stopped filing. Silence is not the same as contentment,
  // and the model is told so explicitly further down.
  const lastByVillage = new Map<string, number>();
  for (const c of rows) {
    const v = c.village as string;
    if (!v) continue;
    const t = dbTime(c.createdAt as string);
    if (t > (lastByVillage.get(v) || 0)) lastByVillage.set(v, t);
  }
  const quiet = [...lastByVillage.entries()]
    .map(([v, t]) => ({ v, d: Math.round((now - t) / DAY) }))
    .filter((x) => x.d > 60)
    .sort((a, b) => b.d - a.d)
    .slice(0, 10);
  if (quiet.length) {
    L.push('VILLAGES GONE QUIET (>60d): ' + quiet.map((x) => `${x.v}(${x.d}d)`).join(', '));
  }

  // The oldest open cases, named, so advice can point at something specific.
  const oldest = [...open]
    .sort((a, b) => dbTime(a.createdAt as string) - dbTime(b.createdAt as string))
    .slice(0, 8);
  if (oldest.length) {
    L.push('OLDEST OPEN: ' + oldest.map((c) =>
      `${c.ticketNo}[${c.category},${c.village || '?'},${Math.round((now - dbTime(c.createdAt as string)) / DAY)}d,${c.assignedOfficerName || 'unassigned'}]`
    ).join(', '));
  }

  if (evidence.length) {
    L.push('WHAT HAS ACTUALLY WORKED HERE: ' + evidence.map((e) =>
      `${e.verb}(tried ${e.tried}, closed ${e.led_to_resolution}, moved ${e.led_to_movement}, nothing ${e.led_to_nothing})`
    ).join('; '));
  } else {
    L.push('WHAT HAS ACTUALLY WORKED HERE: no intervention has been observed long enough to judge. Say so rather than guessing.');
  }

  if (memory.length) {
    L.push('REMEMBERED (beliefs, not facts): ' + memory.map((m) =>
      `"${m.claim}" [confidence ${m.confidence}, ${m.observed_count} observations]`
    ).join(' | '));
  }

  return L.join('\n');
}

const HOUSE_RULES = `
HOW TO ANSWER (these override any habit of writing dashboards):
- Report what CHANGED, not what IS. "Ramesh has not touched a case in 9 days" is
  worth saying; "12 cases are open" is not.
- End every point in a decision the reader can make now, answerable yes or no.
- Give counts, never a bare percentage. "1 of 12" tells the truth "8%" hides.
- A remembered belief is never a fact. Say the confidence and the number of
  observations whenever you use one.
- A village going quiet is NOT good news by default. It is as likely to mean
  nobody there is reaching this office any more.
- If nothing here is decidable today, say exactly that in one line and stop.
- Short lines. No tables, no headings, no jargon. This is read on a phone
  between two other conversations.`;

export async function POST(request: NextRequest) {
  if (!n8nSecretOk(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!advisorEnabled()) {
    return NextResponse.json({ reply: null, error: 'advisor not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const chatId = String(body.chat_id ?? '').trim();
  const question = String(body.text ?? '').trim();
  if (!chatId) return NextResponse.json({ error: 'chat_id required' }, { status: 400 });

  // Identity comes from the chat id alone. Nothing in the body decides who the
  // caller is, so a compromised relay cannot promote itself.
  // "telegramChatId", not telegram_chat_id — the Prisma field carries no @map,
  // so the column is camelCase while its neighbour telegram_link_code is not.
  const { data: users, error: userErr } = await supabase
    .from('users')
    .select('id,username,name,role,role_level,constituency,lok_sabha_constituency,district,block,gp_code,gp_name,assigned_villages')
    .eq('telegramChatId', chatId)
    .eq('isActive', true)
    .limit(1);
  if (userErr) return NextResponse.json({ error: 'lookup failed' }, { status: 500 });

  const u = users?.[0];
  if (!u) {
    // Deliberately says nothing about what exists — an unlinked chat learns
    // only that it is unlinked.
    return NextResponse.json({
      reply: 'এই নম্বরটি কোনো অ্যাকাউন্টের সঙ্গে যুক্ত নয়। আপনার অফিস থেকে লিঙ্ক কোডটি নিন।\n\n' +
             'This chat is not linked to an account. Please get a link code from your office.',
      linked: false,
    });
  }

  const payload: JWTPayload = {
    userId: u.id, username: u.username, role: u.role, name: u.name,
    block: u.block, district: u.district,
    role_level: u.role_level, constituency: u.constituency,
    lok_sabha_constituency: u.lok_sabha_constituency,
    gp_code: u.gp_code, gp_name: u.gp_name,
    assigned_villages: u.assigned_villages,
  };
  const label = scopeLabel(payload);

  const { data: rows, error: rowErr } = await scoped(
    supabase
      .from('complaints')
      .select('id,"ticketNo",category,urgency,status,village,gp_name,block,"assignedToId","assignedOfficerName","createdAt","resolvedAt"')
      .limit(2000),
    payload
  );
  if (rowErr) return NextResponse.json({ error: 'query failed' }, { status: 500 });

  // Evidence and memory are constituency-scoped; a coordinator inherits their
  // seat's evidence because that is the level it was learned at.
  const ac = u.constituency || null;
  const [{ data: evidence }, { data: memory }] = await Promise.all([
    ac ? supabase.from('what_works').select('*').eq('constituency', ac)
       : Promise.resolve({ data: [] as AnyRecord[] }),
    ac ? supabase.from('usable_memory').select('claim,confidence,observed_count').eq('scope_id', ac).limit(10)
       : Promise.resolve({ data: [] as AnyRecord[] }),
  ]);

  const brief = buildBrief(
    (rows || []) as AnyRecord[], label,
    (evidence || []) as AnyRecord[], (memory || []) as AnyRecord[]
  );

  const asked = question ||
    'Give me today’s brief: what changed, what is slipping, and what should I decide now.';

  const reply = await askAdvisor(asked, `${brief}\n${HOUSE_RULES}`);
  if (!reply) return NextResponse.json({ error: 'advisor unavailable' }, { status: 502 });

  // Recorded as an agent action so that when a human then reassigns or calls
  // someone, that action can point back here via parent_action_id. Without this
  // row there is no way to ever ask whether the advice was worth following.
  const { data: logged } = await supabase
    .from('agent_actions')
    .insert({
      actor_type: 'agent',
      actor_id: u.id,
      actor_name: u.name,
      agent_id: 'telegram-advisor',
      model_version: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      verb: 'advised',
      subject_type: 'constituency',
      subject_id: ac,
      rationale: asked.slice(0, 500),
      input: { channel: 'telegram', scope: label },
      output: { reply: reply.slice(0, 2000) },
      constituency: ac,
      block: u.block,
      gp_code: u.gp_code,
    })
    .select('id')
    .single();

  return NextResponse.json({
    reply,
    linked: true,
    scope: label,
    role: u.role_level,
    // n8n passes this back on any follow-up action so the ledger can link them.
    advice_id: logged?.id ?? null,
  });
}
