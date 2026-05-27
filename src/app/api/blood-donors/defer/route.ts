import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Valid deferral types */
const VALID_TYPES = ['temporary', 'permanent'] as const;
type DeferralType = (typeof VALID_TYPES)[number];

/**
 * POST /api/blood-donors/defer
 *
 * Called by the Donor Agent (via DeferDonor tool) to apply a temporary or
 * permanent deferral to a blood donor.
 *
 * Temporary deferral path:
 *   - Auth: X-N8N-SECRET header
 *   - Sets deferral_until = CURRENT_DATE + duration_days, deferral_reason
 *
 * Permanent deferral path:
 *   - Auth: Admin JWT (Bearer token) — role must be ADMIN
 *   - Sets permanently_deferred = true
 *   - Stores permanent_reason in permanent_deferral_reason_enc as UTF-8 bytes
 *     (v1: plain text in bytea column; TODO: proper pgp_sym_encrypt via pgcrypto)
 *
 * Request body:
 * {
 *   donor_id: string (uuid, required),
 *   type: "temporary" | "permanent" (required),
 *   reason: string (required for temporary),
 *   duration_days: number (required for temporary, positive integer),
 *   permanent_reason: string (required for permanent)
 * }
 *
 * Response: { ok: true, data: { donor_id, deferral_until?, permanently_deferred } }
 *
 * @see Requirements 7.7, 8.1, NFR Security
 * @see Design §API Endpoint Contracts, §Medical Compliance
 */
export async function POST(request: NextRequest) {
  try {
    // ─── Parse body first to determine auth path ───
    let body: {
      donor_id?: string;
      type?: string;
      reason?: string;
      duration_days?: number;
      permanent_reason?: string;
    };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { donor_id, type, reason, duration_days, permanent_reason } = body;

    // ─── Common validation ───
    if (!donor_id || typeof donor_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'donor_id is required and must be a string (uuid)' },
        { status: 400 }
      );
    }

    if (!type || !VALID_TYPES.includes(type as DeferralType)) {
      return NextResponse.json(
        { ok: false, error: `type is required and must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // ─── Auth + type-specific validation ───
    if (type === 'temporary') {
      // Temporary deferral: X-N8N-SECRET auth
      const secret = request.headers.get('x-n8n-secret');
      const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

      if (!expectedSecret || secret !== expectedSecret) {
        return NextResponse.json(
          { ok: false, error: 'Unauthorized' },
          { status: 401 }
        );
      }

      // Validate reason and duration_days
      if (!reason || typeof reason !== 'string' || reason.trim() === '') {
        return NextResponse.json(
          { ok: false, error: 'reason is required for temporary deferral' },
          { status: 400 }
        );
      }

      if (
        duration_days === undefined ||
        duration_days === null ||
        typeof duration_days !== 'number' ||
        !Number.isInteger(duration_days) ||
        duration_days <= 0
      ) {
        return NextResponse.json(
          { ok: false, error: 'duration_days is required and must be a positive integer' },
          { status: 400 }
        );
      }

      // ─── Temporary deferral: update blood_donors ───
      const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

      // Calculate deferral_until = CURRENT_DATE + duration_days
      const today = new Date();
      const deferralUntil = new Date(today);
      deferralUntil.setDate(deferralUntil.getDate() + duration_days);
      const deferralUntilStr = deferralUntil.toISOString().split('T')[0]; // YYYY-MM-DD

      const { data, error } = await supabase
        .from('blood_donors')
        .update({
          deferral_until: deferralUntilStr,
          deferral_reason: reason.trim(),
        })
        .eq('id', donor_id)
        .select('id, deferral_until, permanently_deferred')
        .single();

      if (error) {
        console.error('[blood-donors/defer] Supabase update error:', error);
        if (error.code === 'PGRST116') {
          return NextResponse.json(
            { ok: false, error: 'Donor not found' },
            { status: 404 }
          );
        }
        return NextResponse.json(
          { ok: false, error: 'Failed to apply deferral', details: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        data: {
          donor_id: data.id,
          deferral_until: data.deferral_until,
          permanently_deferred: data.permanently_deferred,
        },
      });
    } else {
      // ─── Permanent deferral: Admin JWT required ───
      const token = getTokenFromRequest(request);
      if (!token) {
        return NextResponse.json(
          { ok: false, error: 'Unauthorized — admin JWT required for permanent deferral' },
          { status: 401 }
        );
      }

      const payload = await verifyToken(token);
      if (!payload) {
        return NextResponse.json(
          { ok: false, error: 'Invalid token' },
          { status: 401 }
        );
      }

      if (payload.role !== 'ADMIN') {
        return NextResponse.json(
          { ok: false, error: 'Admin access required for permanent deferral' },
          { status: 403 }
        );
      }

      // Validate permanent_reason
      if (!permanent_reason || typeof permanent_reason !== 'string' || permanent_reason.trim() === '') {
        return NextResponse.json(
          { ok: false, error: 'permanent_reason is required for permanent deferral' },
          { status: 400 }
        );
      }

      // ─── Permanent deferral: update blood_donors ───
      const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

      // Store permanent_reason as UTF-8 bytes in bytea column
      // v1: plain text encoded as hex for Supabase bytea column
      // TODO: Replace with pgp_sym_encrypt via pgcrypto RPC for proper encryption
      const reasonHex = Buffer.from(permanent_reason.trim(), 'utf-8').toString('hex');

      const { data, error } = await supabase
        .from('blood_donors')
        .update({
          permanently_deferred: true,
          permanent_deferral_reason_enc: `\\x${reasonHex}`,
        })
        .eq('id', donor_id)
        .select('id, deferral_until, permanently_deferred')
        .single();

      if (error) {
        console.error('[blood-donors/defer] Supabase permanent deferral error:', error);
        if (error.code === 'PGRST116') {
          return NextResponse.json(
            { ok: false, error: 'Donor not found' },
            { status: 404 }
          );
        }
        return NextResponse.json(
          { ok: false, error: 'Failed to apply permanent deferral', details: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        data: {
          donor_id: data.id,
          deferral_until: data.deferral_until,
          permanently_deferred: data.permanently_deferred,
        },
      });
    }
  } catch (error) {
    console.error('[blood-donors/defer] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
