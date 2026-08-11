import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveCategory } from '@/lib/categorise';

/**
 * POST /api/complaints/register  (n8n internal — Complaint Agent tool)
 *
 * Final complaint submission. Called by the Complaint Agent only after the
 * citizen confirms all details (JS-01v2 → "Complaint: RegisterComplaint").
 * Wraps the `register_complaint` Postgres function which generates the
 * WB-YYYY-XXXXX ticket number and creates the row + initial activity log.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET.
 *
 * Body: {
 *   naam|citizen_name, phone, gaon|village, gram_panchayat|panchayat,
 *   block, jela|district, samasya|issue, description?, category?, language?
 * }
 * Response: { ok: true, data: { ticket_no, status } }
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Accept both the agent's collected-data field names and canonical names. */
function pick(body: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get('x-n8n-secret');
    if (!process.env.N8N_WEBHOOK_SECRET || secret !== process.env.N8N_WEBHOOK_SECRET) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: 'VALIDATION_FAILED', message: 'JSON body required' }, { status: 400 });
    }

    const citizenName = pick(body, 'naam', 'citizen_name', 'citizenName');
    const phone = pick(body, 'phone', 'session_id');
    const village = pick(body, 'gaon', 'village');
    const panchayat = pick(body, 'gram_panchayat', 'panchayat');
    const block = pick(body, 'block');
    const district = pick(body, 'jela', 'district');
    const issue = pick(body, 'samasya', 'issue');
    const description = pick(body, 'description', 'samasya', 'issue');
    /**
     * What the complaint is about.
     *
     * This line used to read `pick(body, 'category') || 'other'`, and the value
     * was then never passed anywhere: register_complaint had no category
     * parameter and hardcoded 'OTHER' into its INSERT, so the category was
     * assembled and thrown away on every call. Forty-three percent of real
     * WhatsApp complaints in the database still read OTHER, including ones whose
     * whole text is "drinking water".
     *
     * Now: the agent's category if it is one we recognise — it also arrives as
     * free text like 'Flood Control' and 'Ration/Food', which matched no label
     * and no colour and rendered as a grey raw string — otherwise read it out of
     * what the citizen actually wrote, otherwise OTHER.
     */
    const category = resolveCategory(pick(body, 'category'), issue, description);
    const language = pick(body, 'language') || 'bn';

    // Minimum required to file a routable complaint.
    if (!issue || !block || !district) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'issue, block, and district are required' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Preferred path: the register_complaint RPC (handles ticket generation + logs).
    const rpc = await supabase.rpc('register_complaint', {
      p_citizen_name: citizenName,
      p_phone: phone,
      p_village: village,
      p_panchayat: panchayat,
      p_block: block,
      p_district: district,
      p_issue: issue,
      p_description: description,
      p_source: 'WHATSAPP',
      p_language: language,
      p_category: category,
    });

    if (!rpc.error && rpc.data) {
      // RPC may return a ticket string or a row object.
      const ticket =
        typeof rpc.data === 'string'
          ? rpc.data
          : (rpc.data as Record<string, unknown>).ticket_no ||
            (rpc.data as Record<string, unknown>).ticketNo ||
            (Array.isArray(rpc.data) && rpc.data[0]
              ? (rpc.data[0] as Record<string, unknown>).ticket_no ?? (rpc.data[0] as Record<string, unknown>).ticketNo
              : null);
      return NextResponse.json({ ok: true, data: { ticket_no: ticket, status: 'OPEN' } });
    }

    // Fallback: direct insert with a generated ticket number (camelCase columns).
    const { count } = await supabase.from('complaints').select('*', { count: 'exact', head: true });
    const ticketNo = `WB-${String(1000 + (count ?? 0) + 1).padStart(5, '0')}`;
    const { error: insErr } = await supabase.from('complaints').insert({
      ticketNo,
      citizenName: citizenName || null,
      phone: phone || null,
      issue,
      category,
      block,
      district,
      village: village || null,
      description: description || null,
      urgency: 'MEDIUM',
      status: 'OPEN',
      source: 'WHATSAPP',
      language,
    });
    if (insErr) {
      return NextResponse.json(
        { ok: false, error: 'Failed to register complaint', details: insErr.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, data: { ticket_no: ticketNo, status: 'OPEN' } });
  } catch (error) {
    console.error('[complaints/register] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
