export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { JWTPayload } from '@/lib/jwt';
import { computeIntelligenceBrief, formatBriefForTelegram } from '@/lib/intelligence';

/**
 * GET /api/cron/daily-briefs — 7AM push-brief generator (Level 3).
 *
 * Called by n8n (JS-21) every morning with header `x-cron-secret`.
 * Returns one Telegram-ready HTML message per governance user who has
 * a telegramChatId — n8n then loops and sends via its Telegram credential.
 *
 * Each user's brief is computed through their OWN scope (same
 * getComplaintScopeFilter boundary) — a karyakarta's morning brief is
 * village-level, the MP's is seat-level. No client-side trust anywhere.
 */

const GOVERNANCE_LEVELS = ['MP', 'MLA', 'DISTRICT_ADMIN', 'BLOCK_COORD', 'GP_COORD', 'KARYAKARTA'];

export async function GET(request: NextRequest) {
  // Auth: shared secret only (no user JWT — this is machine-to-machine)
  const secret = request.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const users = await db.user.findMany({
      where: { isActive: true },
      select: {
        id: true, username: true, role: true, name: true, block: true, district: true,
        telegramChatId: true, role_level: true, constituency: true,
        lok_sabha_constituency: true, gp_code: true, gp_name: true, assigned_villages: true,
      },
    });

    const recipients = (users as Array<Record<string, unknown>>).filter(u =>
      typeof u.telegramChatId === 'string' && u.telegramChatId &&
      (GOVERNANCE_LEVELS.includes((u.role_level as string) || '') || u.role === 'ADMIN')
    );

    const messages: Array<{ chat_id: string; username: string; role_level: string; text: string }> = [];
    const errors: Array<{ username: string; error: string }> = [];

    for (const u of recipients) {
      try {
        const payload: JWTPayload = {
          userId: u.id as string,
          username: u.username as string,
          role: u.role as string,
          name: u.name as string,
          block: u.block as string,
          district: (u.district as string) || null,
          role_level: (u.role_level as string) || 'OFFICER',
          constituency: (u.constituency as string) || null,
          lok_sabha_constituency: (u.lok_sabha_constituency as string) || null,
          gp_code: (u.gp_code as string) || null,
          gp_name: (u.gp_name as string) || null,
          assigned_villages: (u.assigned_villages as string[]) || null,
        };
        const brief = await computeIntelligenceBrief(payload);
        // Skip empty jurisdictions — no point waking someone for zero data
        if (brief.kpis.total === 0) continue;
        messages.push({
          chat_id: u.telegramChatId as string,
          username: u.username as string,
          role_level: (u.role_level as string) || 'OFFICER',
          text: formatBriefForTelegram(brief),
        });
      } catch (e) {
        errors.push({ username: u.username as string, error: e instanceof Error ? e.message : 'unknown' });
      }
    }

    return NextResponse.json({
      generated: messages.length,
      skipped: recipients.length - messages.length - errors.length,
      errors,
      messages,
    });
  } catch (error) {
    console.error('Daily briefs cron error:', error);
    return NextResponse.json({ error: 'Failed to generate briefs' }, { status: 500 });
  }
}
