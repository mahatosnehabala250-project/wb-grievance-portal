import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Valid self-deferral reasons */
const VALID_REASONS = [
  'illness',
  'surgery',
  'pregnancy',
  'tattoo',
  'vaccination',
  'medication',
  'travel',
  'other',
] as const;
type DeferralReason = (typeof VALID_REASONS)[number];

/** Default deferral durations (days) by reason */
const DEFAULT_DURATIONS: Record<DeferralReason, number> = {
  illness: 14,
  surgery: 180,
  pregnancy: 365,
  tattoo: 180,
  vaccination: 14,
  medication: 7,
  travel: 28,
  other: 30,
};

/**
 * POST /api/blood-donors/self-defer
 *
 * Donor self-service deferral endpoint. Allows an authenticated donor to
 * temporarily defer themselves from the donor pool.
 *
 * Auth: Donor JWT (Bearer token). Requires payload.role === 'DONOR'.
 *
 * Request body:
 * {
 *   reason: "illness" | "surgery" | "pregnancy" | "tattoo" | "vaccination" | "medication" | "travel" | "other",
 *   duration_days?: number (positive integer, defaults per reason if omitted),
 *   notes?: string (optional free-text)
 * }
 *
 * Logic:
 * 1. Validate donor JWT
 * 2. Validate reason enum
 * 3. Calculate deferral_until = today + duration_days
 * 4. UPDATE blood_donors SET deferral_until, deferral_reason WHERE id = donorId
 * 5. Return { ok: true, data: { donor_id, deferral_until, deferral_reason } }
 *
 * Requirements: 17.5 — Design §Frontend Components
 */
export async function POST(request: NextRequest) {
  try {
    // ─── Step 1: Validate donor JWT ───
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

    // ─── Parse request body ───
    let body: {
      reason?: string;
      duration_days?: number;
      notes?: string;
    };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { reason, duration_days, notes } = body;

    // ─── Step 2: Validate reason enum ───
    if (!reason || !VALID_REASONS.includes(reason as DeferralReason)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'VALIDATION_FAILED',
          message: `reason is required and must be one of: ${VALID_REASONS.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // ─── Resolve duration_days (use default if not provided) ───
    const resolvedDuration =
      duration_days !== undefined && duration_days !== null
        ? duration_days
        : DEFAULT_DURATIONS[reason as DeferralReason];

    if (
      typeof resolvedDuration !== 'number' ||
      !Number.isInteger(resolvedDuration) ||
      resolvedDuration <= 0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: 'VALIDATION_FAILED',
          message: 'duration_days must be a positive integer',
        },
        { status: 400 }
      );
    }

    // ─── Step 3: Calculate deferral_until = today + duration_days ───
    const today = new Date();
    const deferralUntil = new Date(today);
    deferralUntil.setDate(deferralUntil.getDate() + resolvedDuration);
    const deferralUntilStr = deferralUntil.toISOString().split('T')[0]; // YYYY-MM-DD

    // Build the deferral reason string (include notes if provided)
    const deferralReason = notes
      ? `${reason}: ${notes.trim()}`
      : reason;

    // ─── Step 4: UPDATE blood_donors ───
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data, error } = await supabase
      .from('blood_donors')
      .update({
        deferral_until: deferralUntilStr,
        deferral_reason: deferralReason,
      })
      .eq('id', donorId)
      .select('id, deferral_until, deferral_reason')
      .single();

    if (error) {
      console.error('[blood-donors/self-defer] Supabase update error:', error);
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { ok: false, error: 'NOT_FOUND', message: 'Donor not found' },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { ok: false, error: 'Failed to apply self-deferral', details: error.message },
        { status: 500 }
      );
    }

    // ─── Step 5: Return success ───
    return NextResponse.json({
      ok: true,
      data: {
        donor_id: data.id,
        deferral_until: data.deferral_until,
        deferral_reason: data.deferral_reason,
      },
    });
  } catch (error) {
    console.error('[blood-donors/self-defer] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
