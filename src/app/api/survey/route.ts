export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { n8nSecretOk } from '@/lib/n8nAuth';
import { householdKey } from '@/lib/household';

/**
 * POST /api/survey — the karyakarta survey bot's landing point.
 *
 * The bot chats five questions in Telegram (village, family, voters, booth,
 * problem, leaning — see n8n-workflows/SURVEY_BOT_SPEC.md) and posts the
 * answers here in one shot. Identity comes from the Telegram chat id exactly
 * as field-update resolves it — the caller never asserts who they are — and
 * the village must sit inside the surveyor's own jurisdiction, so a worker
 * cannot file a leaning against a family in someone else's patch.
 *
 * The row lands in household_surveys keyed the same way src/lib/household.ts
 * keys households, so GET /api/households stitches it onto the family's
 * ledger without re-matching names.
 *
 * Auth: X-N8N-SECRET, the same inbound pattern as the rest of the automation.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const LEANINGS = new Set(['POSITIVE', 'NEUTRAL', 'NEGATIVE']);

type AnyRecord = Record<string, unknown>;
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Same jurisdiction rule as field-update: the village must be the worker's own. */
function villageInScope(user: AnyRecord, village: string, block: string): boolean {
  const villages = Array.isArray(user.assigned_villages) ? (user.assigned_villages as string[]) : null;
  if (villages && villages.length) {
    return villages.some((v) => norm(v) === norm(village));
  }
  if (user.gp_code) return true; // GP-level: village verification comes with the roll (Phase 3)
  if (user.block) return norm(user.block) === norm(block);
  return false;
}

export async function POST(request: NextRequest) {
  if (!n8nSecretOk(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const chatId = String(body.telegramChatId || '').trim();
    const village = String(body.village || '').trim();
    const familyName = String(body.familyName || '').trim();
    const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
    const votersCount = Number(body.votersCount);
    const boothNo = body.boothNo != null ? String(body.boothNo).trim().slice(0, 12) : null;
    const problem = body.problem ? String(body.problem).slice(0, 500) : null;
    const leaningRaw = String(body.leaning || '').trim().toUpperCase();
    const leaning = LEANINGS.has(leaningRaw) ? leaningRaw : null;

    if (!chatId) {
      return NextResponse.json({ ok: false, error: 'telegramChatId is required' }, { status: 400 });
    }
    if (!village || !familyName) {
      return NextResponse.json({ ok: false, error: 'village and familyName are required' }, { status: 400 });
    }
    if (body.votersCount !== undefined && (!Number.isFinite(votersCount) || votersCount < 0 || votersCount > 30)) {
      return NextResponse.json({ ok: false, error: 'votersCount must be 0-30' }, { status: 400 });
    }
    // A survey that says nothing is a tap gone wrong, not a family.
    if (votersCount === 0 && !boothNo && !problem && !leaning) {
      return NextResponse.json({ ok: false, error: 'nothing to record' }, { status: 400 });
    }

    // Resolve the worker from the chat id (multi-account safe, as field-update).
    const { data: candidates } = await supabase
      .from('users')
      .select('id, name, username, role_level, gp_code, gp_name, block, district, assigned_villages, isActive, constituency')
      .eq('telegramChatId', chatId);
    const linked = (candidates || []).filter((u) => u.isActive !== false);
    if (!linked.length) {
      return NextResponse.json(
        { ok: false, error: 'This Telegram account is not linked to a worker' }, { status: 403 });
    }

    const user = linked.find((u) => villageInScope(u as AnyRecord, village, String(u.block || '')))
      || linked.sort((a, b) => String(a.role_level).localeCompare(String(b.role_level)))[0];
    if (!user) {
      return NextResponse.json({ ok: false, error: 'No active worker on this chat id' }, { status: 403 });
    }

    const key = householdKey({ phone: phone || null, citizenName: familyName, village });
    if (!key) {
      return NextResponse.json({ ok: false, error: 'Could not key this household' }, { status: 400 });
    }

    const row: AnyRecord = {
      household_key: key,
      village,
      family_name: familyName.slice(0, 120),
      phone: phone || null,
      voters_count: Number.isFinite(votersCount) ? Math.round(votersCount) : null,
      booth_no: boothNo,
      problem,
      leaning,
      karyakarta_id: user.id,
      karyakarta_name: user.name || user.username,
      assembly_constituency: user.constituency || null,
      block: user.block || null,
      gp_name: user.gp_name || null,
    };

    const { error } = await supabase.from('household_surveys').insert(row);
    if (error) {
      // The one failure an owner can fix from the dashboard, said plainly.
      if (String(error.message || '').includes('does not exist') || String(error.code) === '42P01') {
        return NextResponse.json({
          ok: false,
          error: 'household_surveys table not created yet — apply supabase/migrations/20260822_household_surveys.sql',
        }, { status: 503 });
      }
      throw error;
    }

    return NextResponse.json({
      ok: true,
      data: { householdKey: key, village, by: user.name || user.username },
    });
  } catch (error) {
    console.error('[survey] error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to record the survey' }, { status: 500 });
  }
}
