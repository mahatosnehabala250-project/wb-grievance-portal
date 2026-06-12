export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

/**
 * POST /api/users/telegram-link — generate a one-time Telegram link code
 * for the LOGGED-IN user (staff self-service, no admin needed).
 *
 * Flow: Settings → "Connect Telegram" → this API returns a code →
 * user opens t.me/<bot>?start=staff_<code> → JS-12 matches the code and
 * writes their chat id onto users.telegramChatId → daily briefs start.
 *
 * The code is single-use: JS-12 clears it after linking.
 */
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  try {
    // Telegram /start payload allows [A-Za-z0-9_-], max 64 chars total.
    // "staff_" prefix + 20 hex chars stays well inside the limit.
    const code = randomBytes(10).toString('hex');

    await db.user.update({
      where: { id: payload.userId },
      data: { telegram_link_code: code },
      select: { id: true },
    });

    const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || null;

    return NextResponse.json({
      code: `staff_${code}`,
      deepLink: botUsername ? `https://t.me/${botUsername}?start=staff_${code}` : null,
      botUsername,
    });
  } catch (error) {
    console.error('Telegram link code error:', error);
    return NextResponse.json({ error: 'Failed to generate link code' }, { status: 500 });
  }
}
