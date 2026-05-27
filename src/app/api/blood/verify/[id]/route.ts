import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/blood/verify/[id]
 *
 * Public, unauthenticated endpoint for verifying a donation certificate.
 * Anyone scanning the QR code on a certificate lands here.
 *
 * The `id` param is the certificate_id (which equals the donation_history.id in v1).
 *
 * Returns minimal public info: donor first name, blood group, donated date, hospital.
 * No phone, DOB, or other PII is exposed.
 *
 * Requirements: 10.5 — Design §API Endpoint Contracts, §Security
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      return NextResponse.json(
        { ok: false, verified: false, error: 'Certificate ID is required' },
        { status: 400 }
      );
    }

    // Look up the donation by id (used as certificate_id in v1)
    // Join with blood_donors to get donor name and blood_group
    const { data: donation, error } = await supabase
      .from('donation_history')
      .select(`
        id,
        donated_date,
        hospital,
        units,
        donation_type,
        created_at,
        blood_donors!inner (
          name,
          blood_group
        )
      `)
      .eq('id', id)
      .single();

    if (error || !donation) {
      return NextResponse.json(
        { ok: false, verified: false, error: 'Certificate not found or invalid' },
        { status: 404 }
      );
    }

    // Extract donor info from the joined relation
    const donorInfo = donation.blood_donors as unknown as {
      name: string;
      blood_group: string;
    };

    return NextResponse.json({
      ok: true,
      verified: true,
      data: {
        certificate_id: donation.id,
        donor_name: donorInfo.name,
        blood_group: donorInfo.blood_group,
        donated_date: donation.donated_date,
        hospital: donation.hospital,
        units: donation.units,
        donation_type: donation.donation_type,
        verified_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[blood/verify] Error:', error);
    return NextResponse.json(
      { ok: false, verified: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
