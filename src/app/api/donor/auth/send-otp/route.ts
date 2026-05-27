import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * POST /api/donor/auth/send-otp
 *
 * Sends an OTP to a donor's phone number via Supabase Auth's built-in phone OTP.
 * This is a PUBLIC endpoint (no auth required — this IS the auth flow).
 *
 * Body: { phone: "+919876543210" }
 *
 * Flow:
 * 1. Validate phone format
 * 2. Check that the phone exists in blood_donors table
 * 3. Use Supabase Auth's signInWithOtp({ phone }) to send SMS
 * 4. Return success response
 *
 * Requirements: 17.1, NFR Security
 */
export async function POST(request: NextRequest) {
  try {
    // ─── Parse body ───
    const body = await request.json();
    const { phone } = body;

    // ─── Validate phone ───
    if (!phone || typeof phone !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'phone is required and must be a string' },
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

    // ─── Check donor exists in blood_donors table ───
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: donor, error: lookupError } = await supabase
      .from('blood_donors')
      .select('id, phone')
      .eq('phone', phone)
      .maybeSingle();

    if (lookupError) {
      console.error('[donor/auth/send-otp] DB lookup error:', lookupError);
      return NextResponse.json(
        { ok: false, error: 'Failed to verify donor registration' },
        { status: 500 }
      );
    }

    if (!donor) {
      return NextResponse.json(
        { ok: false, error: 'Phone number not registered as a donor. Please register first via WhatsApp.' },
        { status: 404 }
      );
    }

    // ─── Send OTP via Supabase Auth ───
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone,
    });

    if (otpError) {
      console.error('[donor/auth/send-otp] Supabase OTP error:', otpError);
      return NextResponse.json(
        { ok: false, error: 'Failed to send OTP. Please try again later.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        phone,
        message: 'OTP sent',
      },
    });
  } catch (error) {
    console.error('[donor/auth/send-otp] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
