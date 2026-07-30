export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalisePhone, inQuietHours } from '@/lib/outreach';

/**
 * /api/outreach/queue — the delivery side, for n8n.
 *
 * The app decides who may be messaged and what is said; n8n does the sending.
 * Keeping the two apart means a bug in a workflow can slow delivery but cannot
 * widen an audience, and the consent and opt-out rules live in exactly one
 * place.
 *
 * GET    ?limit=  — the next batch of queued recipients across sending campaigns
 * POST   { results:[{ id, status, error? }] } — record what happened
 * DELETE                                      — not offered; nothing here is deleted
 *
 * Auth: X-N8N-SECRET, the same fail-closed inbound pattern as the other
 * automation endpoints.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function authOk(request: NextRequest): boolean {
  const expected = process.env.N8N_WEBHOOK_SECRET;
  return !!expected && request.headers.get('x-n8n-secret') === expected;
}

export async function GET(request: NextRequest) {
  if (!authOk(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    // Quiet hours are enforced here too, not only at the send button: a campaign
    // released at 8pm must not keep delivering through the night if the workflow
    // falls behind.
    if (inQuietHours()) {
      return NextResponse.json({ ok: true, paused: 'quiet hours', batch: [] });
    }

    const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 50), 200);

    const { data: campaigns, error: cErr } = await supabase
      .from('outreach_campaigns')
      .select('id, name, message, channel, audience_kind')
      .eq('status', 'SENDING')
      .order('sent_at', { ascending: true })
      .limit(5);
    if (cErr) throw cErr;
    if (!campaigns?.length) return NextResponse.json({ ok: true, batch: [] });

    const batch: Array<Record<string, unknown> & { phone: string; telegramChatId?: string | null }> = [];
    for (const c of campaigns) {
      if (batch.length >= limit) break;
      const { data: recips, error: rErr } = await supabase
        .from('outreach_recipients')
        .select('id, phone, citizen_name, village')
        .eq('campaign_id', c.id)
        .eq('status', 'QUEUED')
        .limit(limit - batch.length);
      if (rErr) throw rErr;

      if (!recips?.length) {
        // Drained — close the campaign out with its final tallies.
        const [{ count: sent }, { count: failed }] = await Promise.all([
          supabase.from('outreach_recipients').select('id', { count: 'exact', head: true })
            .eq('campaign_id', c.id).eq('status', 'SENT'),
          supabase.from('outreach_recipients').select('id', { count: 'exact', head: true })
            .eq('campaign_id', c.id).eq('status', 'FAILED'),
        ]);
        await supabase.from('outreach_campaigns')
          .update({ status: 'SENT', sent_count: sent ?? 0, failed_count: failed ?? 0 })
          .eq('id', c.id);
        continue;
      }

      for (const r of recips) {
        batch.push({
          recipientId: r.id,
          campaignId: c.id,
          campaignName: c.name,
          channel: c.channel,
          kind: c.audience_kind,
          phone: r.phone,
          name: r.citizen_name,
          village: r.village,
          message: c.message,
        });
      }
    }

    // Telegram chat ids for the whole batch in one query, so the workflow does
    // not make a lookup per recipient. Telegram is preferred where it exists:
    // it has no 24-hour session rule, so an office message always lands.
    if (batch.length) {
      const { data: links } = await supabase
        .from('citizen_telegram_links')
        .select('phone, telegram_chat_id')
        .eq('is_active', true);
      const byPhone = new Map<string, string>();
      for (const l of links || []) {
        const p = normalisePhone(l.phone as string);
        if (p && l.telegram_chat_id) byPhone.set(p, String(l.telegram_chat_id));
      }
      for (const b of batch) {
        b.telegramChatId = byPhone.get(normalisePhone(String(b.phone))) || null;
      }
    }

    return NextResponse.json({ ok: true, batch, count: batch.length });
  } catch (error) {
    console.error('[outreach/queue] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to read the queue' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!authOk(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));

    // A citizen replying STOP is the highest-priority thing this endpoint does,
    // so it is handled first and independently of any batch result.
    if (body.optOut) {
      const phone = normalisePhone(String(body.optOut));
      if (phone.length < 10) {
        return NextResponse.json({ ok: false, error: 'A valid phone is required' }, { status: 400 });
      }
      await supabase.from('outreach_optouts')
        .upsert({ phone, reason: String(body.reason || 'replied STOP').slice(0, 200) }, { onConflict: 'phone' });
      // Pull them out of anything still queued, immediately.
      await supabase.from('outreach_recipients')
        .update({ status: 'SKIPPED', skip_reason: 'opted out' })
        .eq('phone', phone).eq('status', 'QUEUED');
      return NextResponse.json({ ok: true, optedOut: phone });
    }

    const results = Array.isArray(body.results) ? body.results : [];
    if (!results.length) return NextResponse.json({ ok: false, error: 'results[] is required' }, { status: 400 });

    let sent = 0, failed = 0;
    for (const r of results) {
      const id = String(r.id || r.recipientId || '');
      if (!id) continue;
      const ok = r.status === 'SENT' || r.status === 'sent' || r.ok === true;
      await supabase.from('outreach_recipients').update({
        status: ok ? 'SENT' : 'FAILED',
        error: ok ? null : String(r.error || 'delivery failed').slice(0, 400),
        sent_at: ok ? new Date().toISOString() : null,
      }).eq('id', id);
      if (ok) sent++; else failed++;
    }

    return NextResponse.json({ ok: true, sent, failed });
  } catch (error) {
    console.error('[outreach/queue] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to record results' }, { status: 500 });
  }
}
