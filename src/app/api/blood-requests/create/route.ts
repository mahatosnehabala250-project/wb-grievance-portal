import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/blood-requests/create  (n8n internal — Blood Agent tool)
 *
 * Creates a blood request after the seeker confirms details (JS-01v2 →
 * "Blood: CreateBloodRequest"). Wraps the `create_blood_request` Postgres
 * function (generates request_no, triggers JS-15 matching). The trigger
 * `trigger_js15_blood_match` then fans out to matching donors.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET.
 *
 * Body: {
 *   seeker_phone, seeker_name?, blood_group, units|units_needed,
 *   hospital|hospital_name, doctor?, district, block?, urgency?
 * }
 * Response: { ok: true, data: { request_no, status } }
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function pick(body: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

const VALID_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

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

    const seekerPhone = pick(body, 'seeker_phone', 'phone', 'session_id');
    const seekerName = pick(body, 'seeker_name', 'naam', 'name');
    const bloodGroup = pick(body, 'blood_group', 'bloodGroup').toUpperCase();
    const unitsRaw = pick(body, 'units', 'units_needed');
    const units = Math.max(1, Math.min(10, parseInt(unitsRaw || '1', 10) || 1));
    const hospital = pick(body, 'hospital', 'hospital_name', 'hospitalName');
    const doctor = pick(body, 'doctor', 'doctor_name');
    const district = pick(body, 'district', 'jela');
    const block = pick(body, 'block');
    const urgency = (pick(body, 'urgency') || 'routine').toLowerCase();

    if (!seekerPhone || !bloodGroup || !hospital || !district) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'seeker_phone, blood_group, hospital, and district are required' },
        { status: 400 }
      );
    }
    if (!VALID_GROUPS.includes(bloodGroup)) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: `blood_group must be one of: ${VALID_GROUPS.join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Preferred: the create_blood_request RPC (8-arg overload incl. block).
    const rpc = await supabase.rpc('create_blood_request', {
      p_seeker_phone: seekerPhone,
      p_seeker_name: seekerName,
      p_blood_group: bloodGroup,
      p_units: units,
      p_hospital: hospital,
      p_doctor: doctor,
      p_district: district,
      p_block: block,
    });

    if (!rpc.error && rpc.data) {
      const requestNo =
        typeof rpc.data === 'string'
          ? rpc.data
          : (rpc.data as Record<string, unknown>).request_no ||
            (Array.isArray(rpc.data) && rpc.data[0] ? (rpc.data[0] as Record<string, unknown>).request_no : null);
      // Best-effort: stamp urgency (RPC may default to routine).
      if (requestNo && urgency !== 'routine') {
        await supabase.from('blood_requests').update({ urgency }).eq('request_no', requestNo);
      }
      return NextResponse.json({ ok: true, data: { request_no: requestNo, status: 'OPEN' } });
    }

    // Fallback: direct insert.
    const requestNo = `BR-${Date.now().toString().slice(-8)}`;
    const { error: insErr } = await supabase.from('blood_requests').insert({
      request_no: requestNo,
      seeker_phone: seekerPhone,
      seeker_name: seekerName || null,
      blood_group: bloodGroup,
      units_needed: units,
      hospital_name: hospital,
      doctor_name: doctor || null,
      district,
      block: block || null,
      urgency: ['critical', 'urgent', 'routine'].includes(urgency) ? urgency : 'routine',
      status: 'OPEN',
    });
    if (insErr) {
      return NextResponse.json(
        { ok: false, error: 'Failed to create blood request', details: insErr.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, data: { request_no: requestNo, status: 'OPEN' } });
  } catch (error) {
    console.error('[blood-requests/create] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
