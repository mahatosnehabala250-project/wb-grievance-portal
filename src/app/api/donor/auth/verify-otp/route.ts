import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'wb-gov-support-system-secret-key-2024'
);

/**
 * Signs a donor-specific JWT with payload: { donorId, phone, role: 'DONOR' }
 * Uses the same jose-based signing as the project's existing @/lib/jwt module.
 */
async function signDonorToken(payload: {
  donorId: string;
  phone: string;
  role: string;
}): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET);
}

/**
 * POST /api/donor/auth/verify-otp
 *
 * Verifies the OTP and returns a donor JWT.
 * This is a PUBLIC endpoint (no auth required — this IS the auth flow).
 *
 * Body: { phone: "+919876543210", otp: "123456" }
 *
 * Flow:
 * 1. Validate inputs
 * 2. Verify OTP via Supabase Auth's verifyOtp({ phone, token, type: 'sms' })
 * 3. Look up donor in blood_donors by phone
 * 4. Link auth_user_id if not already linked
 * 5. Generate a donor JWT with payload: { donorId, phone, role: 'DONOR' }
 * 6. Return token + donor info
 *
 * Requirements: 17.1, NFR Security
 */
export async function POST(request: NextRequest) {
  try {
    // ─── Parse body ───
    const body = await request.json();
    const { phone, otp } = body;

    // ─── Validate inputs ───
    if (!phone || typeof phone !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'phone is required and must be a string' },
        { status: 400 }
      );
    }

    if (!otp || typeof otp !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'otp is required and must be a string' },
        { status: 400 }
      );
    }

    // Basic phone format validation (E.164 format)
    const phoneRegex = /^\+[1-9]\d{6,14}$/;
    if (!phoneRegex.test(phone)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid phone format. Use E.164 format (e.g., +919876543210)' },
        { status: 400 }
      );
    }

    // OTP should be 6 digits
    const otpRegex = /^\d{6}$/;
    if (!otpRegex.test(otp)) {
      return NextResponse.json(
        { ok: false, error: 'OTP must be a 6-digit number' },
        { status: 400 }
      );
    }

    // ─── Verify OTP via Supabase Auth ───
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: authData, error: verifyError } = await supabase.auth.verifyOtp({
      phone,
      token: otp,
      type: 'sms',
    });

    if (verifyError || !authData?.user) {
      console.error('[donor/auth/verify-otp] OTP verification failed:', verifyError);
      return NextResponse.json(
        { ok: false, error: 'Invalid or expired OTP' },
        { status: 401 }
      );
    }

    const authUserId = authData.user.id;

    // ─── Look up donor in blood_donors by phone ───
    const { data: donor, error: lookupError } = await supabase
      .from('blood_donors')
      .select('id, name, blood_group, auth_user_id')
      .eq('phone', phone)
      .maybeSingle();

    if (lookupError) {
      console.error('[donor/auth/verify-otp] DB lookup error:', lookupError);
      return NextResponse.json(
        { ok: false, error: 'Failed to look up donor profile' },
        { status: 500 }
      );
    }

    if (!donor) {
      return NextResponse.json(
        { ok: false, error: 'Donor profile not found for this phone number' },
        { status: 404 }
      );
    }

    // ─── Link auth_user_id if not already linked ───
    if (!donor.auth_user_id) {
      const { error: linkError } = await supabase
        .from('blood_donors')
        .update({ auth_user_id: authUserId })
        .eq('id', donor.id);

      if (linkError) {
        console.error('[donor/auth/verify-otp] Failed to link auth_user_id:', linkError);
        // Non-fatal — continue with token generation
      }
    }

    // ─── Generate donor JWT ───
    const token = await signDonorToken({
      donorId: donor.id,
      phone,
      role: 'DONOR',
    });

    return NextResponse.json({
      ok: true,
      data: {
        token,
        donor: {
          id: donor.id,
          name: donor.name,
          blood_group: donor.blood_group,
        },
      },
    });
  } catch (error) {
    console.error('[donor/auth/verify-otp] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
