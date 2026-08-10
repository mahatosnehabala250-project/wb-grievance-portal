export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { n8nSecretOk } from '@/lib/n8nAuth';

/**
 * POST /api/complaints/field-update — a karyakarta closing the loop from Telegram.
 *
 * They are the person who actually walks to the village and sees whether the
 * road is broken, and they live on a phone, not on a portal. This is the same
 * update the portal performs, reached from the one place they will really use.
 *
 * Identity comes from the Telegram chat id, not from anything the caller
 * asserts: the chat id is resolved to a user, and that user's own jurisdiction
 * decides which complaints they may touch. A worker in one GP cannot close a
 * complaint in another by sending its ticket number.
 *
 * Only status and a note may be set — deciding the owning officer or the
 * urgency stays with the office, exactly as it does in the portal.
 *
 * Auth: X-N8N-SECRET, the same inbound pattern as the rest of the automation.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_STATUS = ['IN_PROGRESS', 'RESOLVED', 'REJECTED'];

type AnyRecord = Record<string, unknown>;

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Does this worker's jurisdiction contain this complaint? */
function inWorkerScope(user: AnyRecord, c: AnyRecord): boolean {
  const villages = Array.isArray(user.assigned_villages) ? (user.assigned_villages as string[]) : null;
  if (villages && villages.length) {
    return villages.some((v) => norm(v) === norm(c.village));
  }
  if (user.gp_code) return norm(user.gp_code) === norm(c.gp_code);
  if (user.block) return norm(user.block) === norm(c.block);
  return false;   // no jurisdiction recorded means no authority, not blanket authority
}

export async function POST(request: NextRequest) {
  if (!n8nSecretOk(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const chatId = String(body.telegramChatId || '').trim();
    const ticketNo = String(body.ticketNo || '').trim().toUpperCase();
    const status = String(body.status || '').trim().toUpperCase();
    const note = body.note ? String(body.note).slice(0, 1000) : null;

    if (!chatId || !ticketNo) {
      return NextResponse.json(
        { ok: false, error: 'telegramChatId and ticketNo are required' }, { status: 400 });
    }
    if (!ALLOWED_STATUS.includes(status)) {
      return NextResponse.json(
        { ok: false, error: `status must be one of ${ALLOWED_STATUS.join(', ')}` }, { status: 400 });
    }

    /**
     * One Telegram account, possibly several portal accounts.
     *
     * A chat id was resolved with .maybeSingle(), which errors the moment more
     * than one row matches — and one person legitimately holds several accounts
     * here. Six of them shared a single chat id in Purulia, so the lookup
     * returned nothing and every button tap answered "this Telegram account is
     * not linked to a worker". The field-update path was unusable for the only
     * karyakarta who had ever linked.
     *
     * So: fetch every account on this chat id and let the *complaint* pick.
     * The right account is the one whose jurisdiction contains this ticket,
     * which is precisely the question already being asked below. Ties go to the
     * narrowest role, so a village-level worker is credited over a district
     * account that happens to share the phone.
     */
    const { data: candidates } = await supabase
      .from('users')
      .select('id, name, username, role_level, gp_code, block, district, assigned_villages, isActive')
      .eq('telegramChatId', chatId);

    const linked = (candidates || []).filter((u) => u.isActive !== false);
    if (!linked.length) {
      return NextResponse.json(
        { ok: false, error: 'This Telegram account is not linked to a worker' }, { status: 403 });
    }

    const { data: complaint } = await supabase
      .from('complaints')
      .select('id, "ticketNo", status, village, gp_code, block, district')
      .eq('ticketNo', ticketNo)
      .maybeSingle();

    if (!complaint) {
      return NextResponse.json({ ok: false, error: 'No such ticket' }, { status: 404 });
    }

    // Narrowest first, so the credit lands on the person who actually covers
    // the village rather than on whichever account was created earliest.
    const SPECIFICITY = ['KARYAKARTA', 'GP_COORD', 'BLOCK_COORD'];
    const rank = (u: AnyRecord) => {
      const i = SPECIFICITY.indexOf(String(u.role_level || ''));
      return i === -1 ? SPECIFICITY.length : i;
    };
    const user = linked
      .filter((u) => inWorkerScope(u as AnyRecord, complaint as AnyRecord))
      .sort((a, b) => rank(a as AnyRecord) - rank(b as AnyRecord))[0];

    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'That complaint is not in your area' }, { status: 403 });
    }

    const previous = String(complaint.status);
    const { error: updErr } = await supabase
      .from('complaints')
      .update({
        status,
        ...(note ? { resolution: note } : {}),
        updatedAt: new Date().toISOString(),
      })
      .eq('id', complaint.id);
    if (updErr) throw updErr;

    // Logged with the worker's own name — the point of letting them update at
    // all is that the office can see who said the work was done.
    await supabase.from('activity_logs').insert({
      complaintId: complaint.id,
      action: 'STATUS_CHANGED',
      description:
        `Status changed from ${previous} to ${status} by ${user.name || user.username} (field worker, via Telegram)` +
        (note ? ` — ${note}` : ''),
      actorId: user.id,
      actorName: user.name || user.username,
      metadata: JSON.stringify({ from: previous, to: status, channel: 'telegram', note }),
    });

    return NextResponse.json({
      ok: true,
      data: { ticketNo, from: previous, to: status, by: user.name || user.username },
    });
  } catch (error) {
    console.error('[complaints/field-update] error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to update the complaint' }, { status: 500 });
  }
}
