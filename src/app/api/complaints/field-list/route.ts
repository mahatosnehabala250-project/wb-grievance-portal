export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { n8nSecretOk } from '@/lib/n8nAuth';

/**
 * POST /api/complaints/field-list — the Telegram AI agent's eyes.
 *
 * "mera kitna pending complaint hai?" should be answerable in the chat the
 * worker already lives in, not behind a portal login. The agent calls this
 * with the chat id; the worker is resolved server-side (same rule as
 * field-update — the caller never asserts who they are) and gets back his own
 * cases with the fields a conversation needs: ticket, status, urgency, age,
 * village, one-line issue.
 *
 * Returns two views so the agent can answer both natural questions without
 * a second round trip: everything assigned-ish to him, and the open subset
 * (the "pending" answer).
 *
 * Auth: X-N8N-SECRET, the same inbound pattern as the rest of the automation.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AnyRecord = Record<string, unknown>;
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Same jurisdiction shape as field-update's inWorkerScope. */
function inWorkerScope(user: AnyRecord, c: AnyRecord): boolean {
  if (user.id && c.assignedToId && String(user.id) === String(c.assignedToId)) return true;
  const villages = Array.isArray(user.assigned_villages) ? (user.assigned_villages as string[]) : null;
  if (villages && villages.length) {
    return villages.some((v) => norm(v) === norm(c.village));
  }
  if (user.gp_code) return norm(user.gp_code) === norm(c.gp_code);
  if (user.block) return norm(user.block) === norm(c.block);
  return false;
}

const CLOSED = new Set(['RESOLVED', 'REJECTED']);

export async function POST(request: NextRequest) {
  if (!n8nSecretOk(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const chatId = String(body.telegramChatId || '').trim();
    const ticketNo = String(body.ticketNo || '').trim().toUpperCase() || null;
    if (!chatId) {
      return NextResponse.json({ ok: false, error: 'telegramChatId is required' }, { status: 400 });
    }

    // One Telegram account, possibly several portal accounts (the Purulia
    // six-on-one-chat lesson from field-update): collect all, let the
    // complaint pick its own worker.
    const { data: candidates } = await supabase
      .from('users')
      .select('id, name, username, role_level, gp_code, block, district, assigned_villages, isActive')
      .eq('telegramChatId', chatId);
    const linked = (candidates || []).filter((u) => u.isActive !== false);
    if (!linked.length) {
      return NextResponse.json(
        { ok: false, error: 'This Telegram account is not linked to a worker' }, { status: 403 });
    }

    // Complaints in any of the linked workers' jurisdictions. Block-scoped
    // workers can see a block's worth; a karyakarta sees his villages.
    const blocks = [...new Set(linked.map((u) => String(u.block || '')).filter(Boolean))];
    const gps = [...new Set(linked.map((u) => String(u.gp_code || '')).filter(Boolean))];
    let q = supabase
      .from('complaints')
      .select('id, ticketNo, status, urgency, category, village, gp_code, block, issue, assignedToId, createdAt, satisfactionRating')
      .order('createdAt', { ascending: false })
      .range(0, 499);
    if (blocks.length === 1) q = q.eq('block', blocks[0]);
    else if (gps.length === 1) q = q.eq('gp_code', gps[0]);
    else if (blocks.length > 1) q = q.in('block', blocks);
    else {
      return NextResponse.json({ ok: true, worker: linked[0].name, complaints: [], pending: 0, note: 'no jurisdiction recorded' });
    }

    const { data: rows, error } = await q;
    if (error) throw error;

    // Narrow to what the chat's workers actually cover.
    const mine = (rows || []).filter((c) =>
      linked.some((u) => inWorkerScope(u as AnyRecord, c as AnyRecord)),
    );

    // Single-ticket detail mode: the agent asking "tell me about this one".
    if (ticketNo) {
      const one = mine.find((c) => String(c.ticketNo).toUpperCase() === ticketNo);
      if (!one) return NextResponse.json({ ok: false, error: 'No such ticket in your area' }, { status: 404 });
      return NextResponse.json({ ok: true, worker: linked[0].name, complaint: one });
    }

    const shape = (c: AnyRecord) => ({
      ticketNo: c.ticketNo,
      status: c.status,
      urgency: c.urgency,
      category: c.category,
      village: c.village,
      issue: String(c.issue || '').slice(0, 80),
      ageDays: Math.floor((Date.now() - new Date(String(c.createdAt)).getTime()) / 86400000),
      rated: c.satisfactionRating != null,
    });

    const pending = mine.filter((c) => !CLOSED.has(String(c.status))).map(shape);
    return NextResponse.json({
      ok: true,
      worker: linked[0].name || linked[0].username,
      pendingCount: pending.length,
      pending,
      recent: mine.slice(0, 10).map(shape),
    });
  } catch (error) {
    console.error('[complaints/field-list] error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to list complaints' }, { status: 500 });
  }
}
