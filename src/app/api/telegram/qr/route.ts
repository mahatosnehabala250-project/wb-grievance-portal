export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { botUsername, citizenDeepLink } from '@/lib/telegram-invite';

/**
 * GET /api/telegram/qr?ticket=WB-26-PUR-001044 — a scannable link onto Telegram.
 *
 * Walk-ins are the office's largest daily contact and its only channel to
 * households that never messaged on WhatsApp: outside a 24-hour window there is
 * no way to reach them at all. A slip with a QR turns that visit into a
 * permanent channel.
 *
 * With a ticket, the link carries it and JS-12 resolves the phone and links the
 * citizen in one tap. Without one, it still opens the bot, which answers with
 * instructions — better than sending someone away with nothing.
 *
 * Returns SVG so it prints sharply at any size and needs no image hosting.
 */

/**
 * Exactly what JS-12 parses — `WB-\d{2}-[A-Z]{3}-\d{6}` — and nothing wider.
 *
 * A looser pattern here would mint links for tickets the bot cannot resolve
 * (the seeded WB-DEMO-… ones), which open the bot and then do nothing. Falling
 * back to the plain bot link is better: the contact-share button links them
 * anyway.
 */
const TICKET_RE = /^WB-\d{2}-[A-Z]{3}-\d{6}$/;

export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const bot = botUsername();
  if (!bot) {
    return NextResponse.json({ error: 'No Telegram bot configured' }, { status: 503 });
  }

  const ticket = (request.nextUrl.searchParams.get('ticket') || '').trim().toUpperCase();
  const link = ticket && TICKET_RE.test(ticket)
    ? citizenDeepLink(ticket)
    : `https://t.me/${bot}`;

  if (!link) return NextResponse.json({ error: 'Could not build a link' }, { status: 400 });

  try {
    const svg = await QRCode.toString(link, {
      type: 'svg',
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
    });
    return NextResponse.json({ svg, link, botUsername: bot, ticketed: link.includes('?start=') });
  } catch (error) {
    console.error('[telegram/qr] error:', error);
    return NextResponse.json({ error: 'Failed to render the code' }, { status: 500 });
  }
}
