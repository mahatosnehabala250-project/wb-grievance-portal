import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Valid donation types per donation_history CHECK constraint. */
const VALID_DONATION_TYPES = ['whole_blood', 'platelets', 'plasma', 'double_red'] as const;

/**
 * POST /api/blood-donors/record-donation
 *
 * Called by the Donor Agent (n8n) via the RecordDonation tool after a donor
 * reports a completed donation (DONATED command + details).
 *
 * Inserts a row into `donation_history`. The DB trigger
 * `trg_update_donor_after_donation` automatically updates the donor's
 * `last_donated_date`, `last_donation_type`, `next_eligible_date`,
 * `total_donations`, and `donations_this_year` on `blood_donors`.
 *
 * After insert, reads back the donor's updated fields and checks yearly cap.
 * Fires a certificate generation job (fire-and-forget).
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET env var.
 *
 * Body:
 * {
 *   donor_id: uuid (required),
 *   blood_request_id?: uuid | null,
 *   donated_date: string "YYYY-MM-DD" (required),
 *   donation_type: "whole_blood" | "platelets" | "plasma" | "double_red" (required),
 *   units?: number (default 1),
 *   hospital: string (required),
 *   hemoglobin_level?: number | null,
 *   notes?: string | null
 * }
 *
 * Returns: { ok: true, data: { donation_id, next_eligible_date, total_donations, cap_reached } }
 */
export async function POST(request: NextRequest) {
  try {
    // ─── Auth: verify n8n webhook secret ───
    const secret = request.headers.get('x-n8n-secret');
    const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // ─── Parse body ───
    const body = await request.json();
    const {
      donor_id,
      blood_request_id,
      donated_date,
      donation_type,
      units,
      hospital,
      hemoglobin_level,
      notes,
    } = body;

    // ─── Validation ───
    if (!donor_id) {
      return NextResponse.json(
        { ok: false, error: 'donor_id is required' },
        { status: 400 }
      );
    }

    if (!donated_date) {
      return NextResponse.json(
        { ok: false, error: 'donated_date is required' },
        { status: 400 }
      );
    }

    if (!donation_type) {
      return NextResponse.json(
        { ok: false, error: 'donation_type is required' },
        { status: 400 }
      );
    }

    if (!VALID_DONATION_TYPES.includes(donation_type)) {
      return NextResponse.json(
        {
          ok: false,
          error: `donation_type must be one of: ${VALID_DONATION_TYPES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (!hospital || typeof hospital !== 'string' || hospital.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: 'hospital is required' },
        { status: 400 }
      );
    }

    // ─── Defaults ───
    const resolvedUnits = units ?? 1;

    // ─── Insert into donation_history ───
    // The DB trigger `trg_update_donor_after_donation` will automatically
    // update blood_donors (last_donated_date, next_eligible_date, etc.)
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: donation, error: insertError } = await supabase
      .from('donation_history')
      .insert({
        donor_id,
        blood_request_id: blood_request_id || null,
        donated_date,
        donation_type,
        units: resolvedUnits,
        hospital: hospital.trim(),
        hemoglobin_level: hemoglobin_level ?? null,
        notes: notes || null,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[blood-donors/record-donation] Insert error:', insertError);
      return NextResponse.json(
        { ok: false, error: 'Failed to record donation', details: insertError.message },
        { status: 500 }
      );
    }

    const donationId = donation.id;

    // ─── Read back updated donor fields (trigger has already fired) ───
    const { data: donor, error: readError } = await supabase
      .from('blood_donors')
      .select('next_eligible_date, total_donations, donations_this_year, gender, last_donation_type')
      .eq('id', donor_id)
      .single();

    if (readError) {
      console.error('[blood-donors/record-donation] Read-back error:', readError);
      // Donation was recorded successfully, but we can't read back the donor.
      // Return partial success with the donation_id.
      return NextResponse.json({
        ok: true,
        data: {
          donation_id: donationId,
          next_eligible_date: null,
          total_donations: null,
          cap_reached: null,
        },
      });
    }

    // ─── Check yearly cap ───
    let capReached = false;
    const { donations_this_year, gender, last_donation_type } = donor;

    if (last_donation_type === 'whole_blood' || donation_type === 'whole_blood') {
      if (gender === 'male') {
        capReached = donations_this_year >= 4;
      } else if (gender === 'female') {
        capReached = donations_this_year >= 3;
      }
    } else if (last_donation_type === 'platelets' || donation_type === 'platelets') {
      capReached = donations_this_year >= 24;
    }

    // ─── Fire-and-forget certificate generation ───
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    fetch(`${appUrl}/api/blood/generate-certificate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ donor_id, donation_id: donationId }),
    }).catch(() => {}); // fire-and-forget — don't block response

    // ─── Return response ───
    return NextResponse.json({
      ok: true,
      data: {
        donation_id: donationId,
        next_eligible_date: donor.next_eligible_date,
        total_donations: donor.total_donations,
        cap_reached: capReached,
      },
    });
  } catch (error) {
    console.error('[blood-donors/record-donation] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
