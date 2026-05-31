import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Valid urgency values (matches blood_requests.urgency CHECK). */
const VALID_URGENCY = ['critical', 'urgent', 'routine'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Coerce an incoming value to a non-negative integer, or null when absent.
 * Returns the sentinel `Symbol` `INVALID` when the value is present but not a
 * valid non-negative integer so the caller can return VALIDATION_FAILED.
 */
const INVALID = Symbol('invalid');
function toNonNegInt(value: unknown): number | null | typeof INVALID {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return INVALID;
  return n;
}

/**
 * Coerce an incoming value to an integer within [min, max], or null when
 * absent. Returns INVALID when present but out of range / non-integer.
 */
function toBoundedInt(
  value: unknown,
  min: number,
  max: number
): number | null | typeof INVALID {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    return INVALID;
  }
  return n;
}

/**
 * POST /api/cascade/log-outcome
 *
 * Called by the JS-15B Donor Cascade Engine "Outcome Logger" node at cascade
 * end (request fulfilled OR final tier reached) to record one bandit-training
 * row in `cascade_outcomes`. The nightly Bandit Trainer (task 21.6) reads these
 * rows to update the Thompson-sampling posteriors per arm, and the Policy
 * Resolver (task 21.1) counts them for cold-start safety.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET env var.
 *
 * Request body (canonical bandit shape — Req 18.5, 23.4, design §v1.1.4):
 * {
 *   blood_request_id: string (uuid, required),
 *   district?: string,
 *   blood_group?: string,
 *   urgency?: "critical" | "urgent" | "routine",
 *   hour_of_day?: int (0-23),
 *   day_of_week?: int (0-6, 0 = Sunday),
 *   tier_size?: int (>= 0)            // size of the tier batch used
 *   wait_minutes?: int (>= 0),        // wait used before this tier
 *   time_to_first_accept_minutes?: int (>= 0),
 *   total_accepted?: int (>= 0),
 *   total_invited?: int (>= 0),
 *   tier_reached?: int (>= 0),        // legacy column (final tier reached)
 *   policy_id?: string (uuid),        // resolved policy that produced the action
 *   success?: boolean                 // request fulfilled? (derived if omitted)
 * }
 *
 * Idempotency: the cascade may be replayed by n8n. If an outcome row already
 * exists for the blood_request_id, this returns an idempotent no-op rather than
 * inserting a duplicate (which would skew the bandit training signal).
 *
 * Response: { ok: true, data: { id, blood_request_id, already_logged } }
 *
 * Requirements: 23.4, 18.5 — Design §v1.1.4 Adaptive Donor Cascade
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
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const blood_request_id = body.blood_request_id;

    // ─── Validation: blood_request_id ───
    if (!blood_request_id || typeof blood_request_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'blood_request_id is required' },
        { status: 400 }
      );
    }
    if (!UUID_RE.test(blood_request_id)) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'blood_request_id must be a valid UUID' },
        { status: 400 }
      );
    }

    // ─── Validation: urgency enum (when provided) ───
    let urgency: string | null = null;
    if (body.urgency !== null && body.urgency !== undefined) {
      if (
        typeof body.urgency !== 'string' ||
        !VALID_URGENCY.includes(body.urgency as (typeof VALID_URGENCY)[number])
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: 'VALIDATION_FAILED',
            message: `urgency must be one of: ${VALID_URGENCY.join(', ')}`,
          },
          { status: 400 }
        );
      }
      urgency = body.urgency;
    }

    // ─── Validation: bounded / non-negative integers ───
    const hour_of_day = toBoundedInt(body.hour_of_day, 0, 23);
    const day_of_week = toBoundedInt(body.day_of_week, 0, 6);
    const tier_size = toNonNegInt(body.tier_size);
    const wait_minutes = toNonNegInt(body.wait_minutes);
    const time_to_first_accept_minutes = toNonNegInt(body.time_to_first_accept_minutes);
    const total_accepted = toNonNegInt(body.total_accepted);
    const total_invited = toNonNegInt(body.total_invited);
    const tier_reached = toNonNegInt(body.tier_reached);

    const intFields: Record<string, number | null | typeof INVALID> = {
      hour_of_day,
      day_of_week,
      tier_size,
      wait_minutes,
      time_to_first_accept_minutes,
      total_accepted,
      total_invited,
      tier_reached,
    };
    for (const [field, val] of Object.entries(intFields)) {
      if (val === INVALID) {
        return NextResponse.json(
          {
            ok: false,
            error: 'VALIDATION_FAILED',
            message: `${field} must be a valid integer within its allowed range`,
          },
          { status: 400 }
        );
      }
    }

    // ─── Validation: optional district / blood_group are strings ───
    if (body.district !== null && body.district !== undefined && typeof body.district !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'district must be a string' },
        { status: 400 }
      );
    }
    if (
      body.blood_group !== null &&
      body.blood_group !== undefined &&
      typeof body.blood_group !== 'string'
    ) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'blood_group must be a string' },
        { status: 400 }
      );
    }

    // ─── Validation: optional policy_id is a UUID ───
    let policy_id: string | null = null;
    if (body.policy_id !== null && body.policy_id !== undefined) {
      if (typeof body.policy_id !== 'string' || !UUID_RE.test(body.policy_id)) {
        return NextResponse.json(
          { ok: false, error: 'VALIDATION_FAILED', message: 'policy_id must be a valid UUID' },
          { status: 400 }
        );
      }
      policy_id = body.policy_id;
    }

    // ─── Idempotency: skip if an outcome row already exists for this request ───
    const { data: existing, error: existingError } = await supabase
      .from('cascade_outcomes')
      .select('id')
      .eq('blood_request_id', blood_request_id)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.error('[cascade/log-outcome] Existing-row check error:', existingError);
      return NextResponse.json(
        { ok: false, error: 'Failed to check existing outcome', details: existingError.message },
        { status: 500 }
      );
    }

    if (existing) {
      return NextResponse.json({
        ok: true,
        data: {
          id: existing.id,
          blood_request_id,
          already_logged: true,
        },
      });
    }

    // ─── Derive `success` when not explicitly provided ───
    // Fulfilled = at least one donor accepted (cascade ended on fulfillment).
    let success: boolean | null = null;
    if (typeof body.success === 'boolean') {
      success = body.success;
    } else if (typeof total_accepted === 'number') {
      success = total_accepted > 0;
    }

    // ─── Insert canonical outcome row. Mirror counts into the legacy columns
    //     (donors_invited/accepted) so older bandit queries stay consistent. ───
    const insertRow: Record<string, unknown> = {
      blood_request_id,
      policy_id,
      district: (body.district as string | undefined) ?? null,
      blood_group: (body.blood_group as string | undefined) ?? null,
      urgency,
      hour_of_day: hour_of_day as number | null,
      day_of_week: day_of_week as number | null,
      tier_size: tier_size as number | null,
      wait_minutes: wait_minutes as number | null,
      time_to_first_accept_minutes: time_to_first_accept_minutes as number | null,
      total_accepted: total_accepted as number | null,
      total_invited: total_invited as number | null,
      // legacy columns (20260201_002_adaptive_cascade.sql) kept in sync
      tier_reached: tier_reached as number | null,
      donors_notified: total_invited as number | null,
      donors_accepted: total_accepted as number | null,
      success,
    };

    const { data, error } = await supabase
      .from('cascade_outcomes')
      .insert(insertRow)
      .select('id')
      .single();

    if (error) {
      console.error('[cascade/log-outcome] Insert error:', error);
      return NextResponse.json(
        { ok: false, error: 'Failed to log cascade outcome', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        id: data.id,
        blood_request_id,
        already_logged: false,
      },
    });
  } catch (error) {
    console.error('[cascade/log-outcome] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
