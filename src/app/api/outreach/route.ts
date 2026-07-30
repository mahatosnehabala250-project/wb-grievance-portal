export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import type { JWTPayload } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';
import {
  buildAudience, withOptOut, normalisePhone, inQuietHours,
  MAX_RECIPIENTS, SEND_ROLES, AUDIENCE_KINDS, type AudienceKind,
} from '@/lib/outreach';

/**
 * /api/outreach — messaging the people this office has already served.
 *
 * The office knows 579 households by name and number because those households
 * came to it for help. Reaching them afterwards — "your road work is
 * sanctioned", "pension camp in your GP on Tuesday" — is the single most
 * valuable thing that list can do, and also the fastest way to become a
 * nuisance. The guardrails in @/lib/outreach are therefore not optional
 * decoration: consent gating, opt-out, quiet hours and a size cap.
 *
 * This route never sends anything itself. It builds and queues; an n8n workflow
 * pulls the queue over /api/outreach/queue and does the delivery, the same
 * inbound-secret pattern the rest of the automation uses.
 *
 * GET                       — campaigns in the caller's scope
 * POST { action:'preview' } — who would receive this, and who is excluded and why
 * POST { action:'create' }  — save as a draft with its recipient list frozen
 * POST { action:'send' }    — release the draft to the queue
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AnyRecord = Record<string, unknown>;

interface Filterable {
  eq(column: string, value: unknown): Filterable;
  in(column: string, values: unknown[]): Filterable;
}
function applyScope<T>(query: T, payload: JWTPayload): T {
  const where = getComplaintScopeFilter(payload) as AnyRecord;
  let q = query as unknown as Filterable;
  for (const [key, value] of Object.entries(where)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && 'in' in (value as AnyRecord)) {
      q = q.in(key, (value as { in: unknown[] }).in);
    } else {
      q = q.eq(key, value);
    }
  }
  return q as unknown as T;
}

function ownGeography(u: JWTPayload) {
  return {
    assembly_constituency: u.constituency || null,
    district: u.district || null,
    block: u.block && u.block.toUpperCase() !== 'ALL' ? u.block : null,
  };
}

async function auth(request: NextRequest): Promise<JWTPayload | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}

function canSend(p: JWTPayload): boolean {
  return p.role === 'ADMIN' || SEND_ROLES.includes(p.role_level || '');
}

/** Complaint filters an operator can narrow an audience by. */
interface AudienceFilters {
  village?: string;
  gpName?: string;
  block?: string;
  category?: string;
  status?: string;
  sinceDays?: number;
}

/**
 * Fetch the complaint rows an audience is drawn from, always under the caller's
 * scope — the filters below can only narrow it, never widen it.
 */
async function fetchCandidates(payload: JWTPayload, f: AudienceFilters) {
  // Column names on this table are a mix of camelCase and snake_case; they are
  // spelled here exactly as Postgres holds them.
  let q = supabase.from('complaints').select('id, phone, citizenName, village, block, gp_name, category, status, createdAt');
  q = applyScope(q, payload) as typeof q;

  if (f.village)  q = q.ilike('village', `%${f.village}%`);
  if (f.gpName)   q = q.ilike('gp_name', `%${f.gpName}%`);
  if (f.block)    q = q.ilike('block', `%${f.block}%`);
  if (f.category) q = q.eq('category', f.category);
  if (f.status)   q = q.eq('status', f.status);
  if (f.sinceDays && f.sinceDays > 0) {
    const since = new Date(Date.now() - f.sinceDays * 86400_000).toISOString();
    q = q.gte('createdAt', since);
  }

  // Newest first, so if the cap bites it keeps the most recent contact.
  const { data, error } = await q.order('createdAt', { ascending: false }).limit(5000);
  if (error) throw error;
  return (data || []) as Array<{
    id: string; phone: string | null; citizenName: string | null; village: string | null;
  }>;
}

/** Opt-outs and recorded consent, as phone sets keyed the same way as candidates. */
async function loadPermissionSets() {
  const [{ data: outs }, { data: cons }] = await Promise.all([
    supabase.from('outreach_optouts').select('phone'),
    supabase.from('citizen_consent').select('phone, consent_given').eq('consent_given', true),
  ]);
  return {
    optedOut: new Set((outs || []).map((r) => normalisePhone(r.phone as string))),
    consented: new Set((cons || []).map((r) => normalisePhone(r.phone as string))),
  };
}

export async function GET(request: NextRequest) {
  const payload = await auth(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    let q = supabase.from('outreach_campaigns').select('*');
    q = applyScope(q, payload) as typeof q;
    const { data, error } = await q.order('created_at', { ascending: false }).limit(100);
    if (error) throw error;

    return NextResponse.json({
      campaigns: data || [],
      canSend: canSend(payload),
      quietHours: inQuietHours(),
    });
  } catch (error) {
    console.error('[outreach] GET error:', error);
    return NextResponse.json({ error: 'Failed to load campaigns' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const payload = await auth(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (payload.role_level === 'KARYAKARTA') {
    return NextResponse.json({ error: 'Your role cannot send messages' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'preview');

    // ── preview / create share audience construction ─────────────────────
    if (action === 'preview' || action === 'create') {
      const kind = (AUDIENCE_KINDS as readonly string[]).includes(body.audienceKind)
        ? (body.audienceKind as AudienceKind) : 'SERVICE';
      const filters: AudienceFilters = {
        village: body.village || undefined,
        gpName: body.gpName || undefined,
        block: body.block || undefined,
        category: body.category || undefined,
        status: body.status || undefined,
        sinceDays: body.sinceDays ? Number(body.sinceDays) : undefined,
      };

      const [candidates, sets] = await Promise.all([
        fetchCandidates(payload, filters),
        loadPermissionSets(),
      ]);
      const audience = buildAudience(candidates, kind, sets.optedOut, sets.consented);

      if (action === 'preview') {
        return NextResponse.json({
          count: audience.recipients.length,
          excluded: audience.excluded,
          capped: audience.capped,
          cap: MAX_RECIPIENTS,
          sample: audience.recipients.slice(0, 8).map((r) => ({
            name: r.citizen_name, village: r.village,
            phone: `${r.phone.slice(0, 2)}••••${r.phone.slice(-2)}`,   // enough to recognise, not to dial
          })),
        });
      }

      // create
      const name = String(body.name || '').trim();
      const message = String(body.message || '').trim();
      if (!name) return NextResponse.json({ error: 'Campaign name is required' }, { status: 400 });
      if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 });
      if (audience.recipients.length === 0) {
        return NextResponse.json({ error: 'No one matches this audience' }, { status: 400 });
      }

      const { data: campaign, error: cErr } = await supabase.from('outreach_campaigns').insert({
        name: name.slice(0, 160),
        audience_kind: kind,
        channel: ['WHATSAPP', 'TELEGRAM', 'SMS'].includes(body.channel) ? body.channel : 'WHATSAPP',
        message: withOptOut(message).slice(0, 4000),
        filters,
        recipient_count: audience.recipients.length,
        status: 'DRAFT',
        created_by: payload.username || payload.userId || null,
        ...ownGeography(payload),
      }).select('*').single();
      if (cErr) throw cErr;

      const rows = audience.recipients.map((r) => ({
        campaign_id: campaign.id,
        phone: r.phone,
        citizen_name: r.citizen_name,
        village: r.village,
        complaint_id: r.complaint_id,
        status: 'QUEUED',
      }));
      // Chunked so a large village does not hit the request size limit.
      for (let i = 0; i < rows.length; i += 500) {
        const { error: rErr } = await supabase.from('outreach_recipients').insert(rows.slice(i, i + 500));
        if (rErr) throw rErr;
      }

      return NextResponse.json({ success: true, campaign, excluded: audience.excluded, capped: audience.capped });
    }

    // ── send ─────────────────────────────────────────────────────────────
    if (action === 'send') {
      if (!canSend(payload)) {
        return NextResponse.json({ error: 'Only the MLA, MP or district president can send' }, { status: 403 });
      }
      if (inQuietHours() && !body.overrideQuietHours) {
        return NextResponse.json({
          error: 'It is quiet hours (9pm–8am). Schedule this for the morning, or confirm to send anyway.',
          quietHours: true,
        }, { status: 409 });
      }

      const id = String(body.id || '');
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

      let check = supabase.from('outreach_campaigns').select('id, status');
      check = applyScope(check, payload) as typeof check;
      const { data: found, error: fErr } = await check.eq('id', id).maybeSingle();
      if (fErr) throw fErr;
      if (!found) return NextResponse.json({ error: 'Campaign not found in your jurisdiction' }, { status: 404 });
      if (found.status !== 'DRAFT') {
        return NextResponse.json({ error: `This campaign is already ${String(found.status).toLowerCase()}` }, { status: 400 });
      }

      // Opt-outs recorded since the draft was built still win.
      const { optedOut } = await loadPermissionSets();
      if (optedOut.size) {
        await supabase.from('outreach_recipients')
          .update({ status: 'SKIPPED', skip_reason: 'opted out' })
          .eq('campaign_id', id).eq('status', 'QUEUED')
          .in('phone', Array.from(optedOut));
      }

      const { count } = await supabase.from('outreach_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', id).eq('status', 'QUEUED');

      const { data: updated, error: uErr } = await supabase.from('outreach_campaigns').update({
        status: 'SENDING',
        sent_at: new Date().toISOString(),
        approved_by: payload.username || payload.userId || null,
        recipient_count: count ?? 0,
      }).eq('id', id).select('*').single();
      if (uErr) throw uErr;

      return NextResponse.json({ success: true, campaign: updated, queued: count ?? 0 });
    }

    if (action === 'cancel') {
      const id = String(body.id || '');
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

      let check = supabase.from('outreach_campaigns').select('id');
      check = applyScope(check, payload) as typeof check;
      const { data: found } = await check.eq('id', id).maybeSingle();
      if (!found) return NextResponse.json({ error: 'Campaign not found in your jurisdiction' }, { status: 404 });

      await supabase.from('outreach_recipients')
        .update({ status: 'SKIPPED', skip_reason: 'campaign cancelled' })
        .eq('campaign_id', id).eq('status', 'QUEUED');
      const { data, error } = await supabase.from('outreach_campaigns')
        .update({ status: 'CANCELLED' }).eq('id', id).select('*').single();
      if (error) throw error;
      return NextResponse.json({ success: true, campaign: data });
    }

    return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400 });
  } catch (error) {
    console.error('[outreach] POST error:', error);
    return NextResponse.json({ error: 'Outreach request failed' }, { status: 500 });
  }
}
