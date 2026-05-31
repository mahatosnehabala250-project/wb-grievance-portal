import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * WhatsApp inbound webhook signature verification (Phase 1 P0 security).
 *
 * Meta signs every webhook POST with `X-Hub-Signature-256: sha256=<hmac>` where
 * the HMAC is computed over the RAW request body using the app's App Secret.
 * The n8n WhatsApp Trigger does not verify this by itself in all setups, so the
 * JS-01 "Parse Message" step can call this endpoint first to confirm the payload
 * genuinely came from Meta (prevents spoofed/forged inbound messages).
 *
 * Two modes:
 *   GET  — Meta webhook verification handshake (hub.mode=subscribe). Echoes
 *          hub.challenge when hub.verify_token matches WHATSAPP_VERIFY_TOKEN.
 *   POST — Verify X-Hub-Signature-256 over the raw body. Returns { ok, valid }.
 *
 * Env:
 *   WHATSAPP_APP_SECRET   — Meta app secret (for HMAC).
 *   WHATSAPP_VERIFY_TOKEN — token chosen in the Meta webhook config (for GET).
 *
 * Fail-closed when WHATSAPP_APP_SECRET is set: an invalid signature → 401.
 * If WHATSAPP_APP_SECRET is NOT configured, returns { ok: true, valid: true,
 * skipped: true } so the workflow keeps working during initial rollout (and a
 * warning is logged). Set the secret to enforce.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ── GET: Meta webhook verification handshake ─────────────────────────────────
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && verifyToken && token === verifyToken) {
    // Meta expects the raw challenge string echoed back.
    return new Response(challenge || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return NextResponse.json({ ok: false, error: 'verification_failed' }, { status: 403 });
}

// ── POST: verify X-Hub-Signature-256 over the raw body ───────────────────────
export async function POST(request: NextRequest) {
  try {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    const raw = await request.text();

    if (!appSecret) {
      // Not yet configured — allow but flag, so rollout is not blocked.
      console.warn('[whatsapp-verify] WHATSAPP_APP_SECRET not set — signature check skipped');
      return NextResponse.json({ ok: true, valid: true, skipped: true });
    }

    const sigHeader =
      request.headers.get('x-hub-signature-256') || request.headers.get('X-Hub-Signature-256') || '';
    const provided = sigHeader.startsWith('sha256=') ? sigHeader.slice('sha256='.length) : sigHeader;

    const expected = crypto.createHmac('sha256', appSecret).update(raw, 'utf8').digest('hex');
    const valid = !!provided && timingSafeEqualHex(provided, expected);

    if (!valid) {
      return NextResponse.json({ ok: false, valid: false, error: 'invalid_signature' }, { status: 401 });
    }
    return NextResponse.json({ ok: true, valid: true });
  } catch (error) {
    console.error('[whatsapp-verify] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
