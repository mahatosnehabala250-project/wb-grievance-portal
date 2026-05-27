import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Valid donation types */
const VALID_DONATION_TYPES = ['whole_blood', 'platelets', 'plasma', 'double_red'] as const;

/**
 * Calculate the next eligible donation date based on gender and donation type.
 * Cooldown rules (per NACO/NBTC + WHO guidelines):
 *   - whole_blood + male:   donated_date + 90 days
 *   - whole_blood + female: donated_date + 120 days
 *   - platelets:            donated_date + 14 days
 *   - plasma:               donated_date + 14 days
 *   - double_red:           donated_date + 168 days
 */
function calculateNextEligibleDate(
  donatedDate: string,
  donationType: string,
  gender: string
): string {
  const date = new Date(donatedDate);
  let days: number;

  switch (donationType) {
    case 'whole_blood':
      days = gender === 'female' ? 120 : 90;
      break;
    case 'platelets':
      days = 14;
      break;
    case 'plasma':
      days = 14;
      break;
    case 'double_red':
      days = 168;
      break;
    default:
      days = 90; // fallback to safest default
  }

  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * GET /api/blood-donors/me
 *
 * Returns the authenticated donor's full profile.
 *
 * Auth: Donor JWT (Bearer token).
 * The JWT payload has { donorId, phone, role: 'DONOR' }.
 *
 * Validates:
 * - Token is present and valid
 * - payload.role === 'DONOR'
 * - Donor exists in blood_donors table
 *
 * Returns: { ok: true, data: { ...donor profile (excluding permanent_deferral_reason_enc) } }
 *
 * Requirements: 17.2 — Design §API Endpoint Contracts
 */
export async function GET(request: NextRequest) {
  try {
    // ─── Auth: extract and verify donor JWT ───
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized', message: 'No token provided' },
        { status: 401 }
      );
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // ─── Verify donor role ───
    // The donor JWT payload has { donorId, phone, role: 'DONOR' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const donorPayload = payload as any;

    if (donorPayload.role !== 'DONOR') {
      return NextResponse.json(
        { ok: false, error: 'Forbidden', message: 'Donor access required' },
        { status: 403 }
      );
    }

    const donorId = donorPayload.donorId;
    if (!donorId) {
      return NextResponse.json(
        { ok: false, error: 'Forbidden', message: 'Invalid donor token: missing donorId' },
        { status: 403 }
      );
    }

    // ─── Query donor profile ───
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: donor, error } = await supabase
      .from('blood_donors')
      .select(
        `id, phone, name, blood_group, gender, date_of_birth, weight_kg,
         district, block, last_donated_date, last_donation_type,
         next_eligible_date, is_available, is_paused, total_donations,
         total_offers_accepted, donations_this_year, deferral_until,
         deferral_reason, permanently_deferred, created_at`
      )
      .eq('id', donorId)
      .single();

    if (error || !donor) {
      if (error?.code === 'PGRST116') {
        // No rows returned
        return NextResponse.json(
          { ok: false, error: 'NOT_FOUND', message: 'Donor profile not found' },
          { status: 404 }
        );
      }
      console.error('[blood-donors/me] Supabase query error:', error);
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch donor profile', details: error?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: donor,
    });
  } catch (error) {
    console.error('[blood-donors/me] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}


/**
 * PATCH /api/blood-donors/me
 *
 * Updates the authenticated donor's editable profile fields.
 *
 * Auth: Donor JWT (Bearer token).
 * The JWT payload has { donorId, phone, role: 'DONOR' }.
 *
 * Editable fields (all optional):
 * - name: string
 * - district: string
 * - block: string
 * - weight_kg: number (must be >= 45)
 * - is_available: boolean
 * - last_donated_date: string (YYYY-MM-DD)
 * - last_donation_type: string (whole_blood | platelets | plasma | double_red)
 *
 * If last_donated_date is updated, recalculates next_eligible_date using
 * the same cooldown logic as register (gender-based cooldown periods).
 *
 * Returns: { ok: true, data: { id, name, ...updated fields } }
 *
 * Requirements: 17.2, 17.4 — Design §API Endpoint Contracts
 */
export async function PATCH(request: NextRequest) {
  try {
    // ─── Auth: extract and verify donor JWT ───
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized', message: 'No token provided' },
        { status: 401 }
      );
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // ─── Verify donor role ───
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const donorPayload = payload as any;

    if (donorPayload.role !== 'DONOR') {
      return NextResponse.json(
        { ok: false, error: 'Forbidden', message: 'Donor access required' },
        { status: 403 }
      );
    }

    const donorId = donorPayload.donorId;
    if (!donorId) {
      return NextResponse.json(
        { ok: false, error: 'Forbidden', message: 'Invalid donor token: missing donorId' },
        { status: 403 }
      );
    }

    // ─── Parse body ───
    const body = await request.json();
    const {
      name,
      district,
      block,
      weight_kg,
      is_available,
      last_donated_date,
      last_donation_type,
    } = body;

    // ─── Validation ───
    const errors: string[] = [];

    if (weight_kg !== undefined && weight_kg !== null) {
      if (typeof weight_kg !== 'number' || weight_kg < 45) {
        errors.push('weight_kg must be a number >= 45');
      }
    }

    if (last_donation_type !== undefined && last_donation_type !== null) {
      if (!VALID_DONATION_TYPES.includes(last_donation_type as typeof VALID_DONATION_TYPES[number])) {
        errors.push(`last_donation_type must be one of: ${VALID_DONATION_TYPES.join(', ')}`);
      }
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', details: errors },
        { status: 400 }
      );
    }

    // ─── Build update data ───
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) updateData.name = name;
    if (district !== undefined) updateData.district = district;
    if (block !== undefined) updateData.block = block;
    if (weight_kg !== undefined && weight_kg !== null) updateData.weight_kg = weight_kg;
    if (is_available !== undefined) updateData.is_available = is_available;
    if (last_donated_date !== undefined) updateData.last_donated_date = last_donated_date;
    if (last_donation_type !== undefined) updateData.last_donation_type = last_donation_type;

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', details: ['No fields provided to update'] },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // ─── Recalculate next_eligible_date if last_donated_date changes ───
    if (last_donated_date !== undefined) {
      // Need the donor's gender for cooldown calculation
      const { data: existingDonor, error: fetchError } = await supabase
        .from('blood_donors')
        .select('gender, last_donation_type')
        .eq('id', donorId)
        .single();

      if (fetchError || !existingDonor) {
        return NextResponse.json(
          { ok: false, error: 'NOT_FOUND', message: 'Donor profile not found' },
          { status: 404 }
        );
      }

      // Use the provided donation type, or the one being updated, or the existing one
      const donationType =
        last_donation_type || existingDonor.last_donation_type || 'whole_blood';
      const gender = existingDonor.gender || 'male';

      updateData.next_eligible_date = calculateNextEligibleDate(
        last_donated_date,
        donationType,
        gender
      );
    } else if (last_donation_type !== undefined && last_donation_type !== null) {
      // If only donation type changed but we have an existing last_donated_date,
      // recalculate with the new type
      const { data: existingDonor, error: fetchError } = await supabase
        .from('blood_donors')
        .select('gender, last_donated_date')
        .eq('id', donorId)
        .single();

      if (fetchError || !existingDonor) {
        return NextResponse.json(
          { ok: false, error: 'NOT_FOUND', message: 'Donor profile not found' },
          { status: 404 }
        );
      }

      if (existingDonor.last_donated_date) {
        const gender = existingDonor.gender || 'male';
        updateData.next_eligible_date = calculateNextEligibleDate(
          existingDonor.last_donated_date,
          last_donation_type,
          gender
        );
      }
    }

    // ─── Update blood_donors ───
    const { data: updatedDonor, error: updateError } = await supabase
      .from('blood_donors')
      .update(updateData)
      .eq('id', donorId)
      .select(
        `id, name, district, block, weight_kg, is_available,
         last_donated_date, last_donation_type, next_eligible_date`
      )
      .single();

    if (updateError || !updatedDonor) {
      if (updateError?.code === 'PGRST116') {
        return NextResponse.json(
          { ok: false, error: 'NOT_FOUND', message: 'Donor profile not found' },
          { status: 404 }
        );
      }
      console.error('[blood-donors/me PATCH] Supabase update error:', updateError);
      return NextResponse.json(
        { ok: false, error: 'Failed to update donor profile', details: updateError?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: updatedDonor,
    });
  } catch (error) {
    console.error('[blood-donors/me PATCH] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
