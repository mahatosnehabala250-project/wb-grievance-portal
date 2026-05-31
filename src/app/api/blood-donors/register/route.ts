import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { withIdempotency } from '@/lib/idempotency/middleware';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// pg Pool used exclusively for the idempotency middleware DB client.
const idempotencyPool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
});

/** Valid blood groups per Indian NACO/NBTC standards */
const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

/** Valid gender values */
const VALID_GENDERS = ['male', 'female', 'other'] as const;

/** Valid donation types */
const VALID_DONATION_TYPES = ['whole_blood', 'platelets', 'plasma', 'double_red'] as const;

const ENDPOINT = '/api/blood-donors/register';

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
  // Return as YYYY-MM-DD
  return date.toISOString().split('T')[0];
}

/**
 * Calculate age from date of birth.
 */
function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/**
 * POST /api/blood-donors/register
 *
 * Called by the Donor Agent (n8n) to register a new blood donor with
 * medical eligibility fields.
 *
 * Wrapped with idempotency middleware (Req 28.1–28.4): an optional
 * `Idempotency-Key` header dedupes retries for 24 hours.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET env var.
 *
 * Request body:
 * {
 *   phone: string (required),
 *   name: string (required),
 *   blood_group: string (required, one of A+, A-, B+, B-, AB+, AB-, O+, O-),
 *   gender: string (required, one of male, female, other),
 *   date_of_birth: string (YYYY-MM-DD, age must be 18-65),
 *   weight_kg: number (must be >= 45),
 *   district: string (required),
 *   block: string (optional),
 *   last_donated_date: string (optional, YYYY-MM-DD),
 *   last_donation_type: string (optional, one of whole_blood, platelets, plasma, double_red)
 * }
 *
 * Validation:
 * - phone, name, blood_group, gender, district required
 * - gender must be male, female, or other
 * - blood_group must be one of the 8 valid groups
 * - date_of_birth: age must be 18-65
 * - weight_kg: must be >= 45
 * - last_donation_type if provided must be valid
 *
 * On insert, if last_donated_date is provided, calculates next_eligible_date
 * using cooldown rules.
 *
 * Returns: { ok: true, data: { id, phone, name, blood_group, next_eligible_date } }
 */
export async function POST(request: NextRequest) {
  return withIdempotency(
    request,
    ENDPOINT,
    () => handleRegister(request),
    idempotencyPool,
  );
}

async function handleRegister(request: NextRequest): Promise<Response> {
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
      phone,
      name,
      blood_group,
      gender,
      date_of_birth,
      weight_kg,
      district,
      block,
      last_donated_date,
      last_donation_type,
    } = body;

    // ─── Validation ───
    const errors: string[] = [];

    // Required fields
    if (!phone || typeof phone !== 'string') {
      errors.push('phone is required and must be a string');
    }
    if (!name || typeof name !== 'string') {
      errors.push('name is required and must be a string');
    }
    if (!blood_group || typeof blood_group !== 'string') {
      errors.push('blood_group is required and must be a string');
    }
    if (!gender || typeof gender !== 'string') {
      errors.push('gender is required and must be a string');
    }
    if (!district || typeof district !== 'string') {
      errors.push('district is required and must be a string');
    }

    // Return early if required fields are missing
    if (errors.length > 0) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', details: errors },
        { status: 400 }
      );
    }

    // Gender enum validation
    if (!VALID_GENDERS.includes(gender as typeof VALID_GENDERS[number])) {
      errors.push(`gender must be one of: ${VALID_GENDERS.join(', ')}`);
    }

    // Blood group enum validation
    if (!VALID_BLOOD_GROUPS.includes(blood_group as typeof VALID_BLOOD_GROUPS[number])) {
      errors.push(`blood_group must be one of: ${VALID_BLOOD_GROUPS.join(', ')}`);
    }

    // Age validation (18-65)
    if (date_of_birth) {
      const age = calculateAge(date_of_birth);
      if (age < 18) {
        errors.push('Donor must be at least 18 years old');
      }
      if (age > 65) {
        errors.push('Donor must be 65 years or younger');
      }
    }

    // Weight validation (>= 45 kg)
    if (weight_kg !== undefined && weight_kg !== null) {
      if (typeof weight_kg !== 'number' || weight_kg < 45) {
        errors.push('weight_kg must be a number >= 45');
      }
    }

    // last_donation_type validation (if provided)
    if (last_donation_type !== undefined && last_donation_type !== null) {
      if (!VALID_DONATION_TYPES.includes(last_donation_type as typeof VALID_DONATION_TYPES[number])) {
        errors.push(`last_donation_type must be one of: ${VALID_DONATION_TYPES.join(', ')}`);
      }
    }

    // Return validation errors
    if (errors.length > 0) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', details: errors },
        { status: 400 }
      );
    }

    // ─── Calculate next_eligible_date if last_donated_date is provided ───
    let next_eligible_date: string | null = null;

    if (last_donated_date) {
      const donationType = last_donation_type || 'whole_blood';
      next_eligible_date = calculateNextEligibleDate(
        last_donated_date,
        donationType,
        gender
      );
    }

    // ─── Build insert data ───
    const insertData: Record<string, unknown> = {
      phone,
      name,
      blood_group,
      gender,
      district,
    };

    if (block) insertData.block = block;
    if (date_of_birth) insertData.date_of_birth = date_of_birth;
    if (weight_kg !== undefined && weight_kg !== null) insertData.weight_kg = weight_kg;
    if (last_donated_date) insertData.last_donated_date = last_donated_date;
    if (last_donation_type) insertData.last_donation_type = last_donation_type;
    if (next_eligible_date) insertData.next_eligible_date = next_eligible_date;

    // ─── Insert into blood_donors ───
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data, error } = await supabase
      .from('blood_donors')
      .insert(insertData)
      .select('id, phone, name, blood_group, next_eligible_date')
      .single();

    if (error) {
      console.error('[blood-donors/register] Supabase insert error:', error);
      return NextResponse.json(
        { ok: false, error: 'Failed to register donor', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        id: data.id,
        phone: data.phone,
        name: data.name,
        blood_group: data.blood_group,
        next_eligible_date: data.next_eligible_date,
      },
    });
  } catch (error) {
    console.error('[blood-donors/register] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
