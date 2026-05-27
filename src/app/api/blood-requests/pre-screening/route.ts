import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/blood-requests/pre-screening
 *
 * Called by the Blood Agent (n8n) after a donor sends HAAN and before
 * final acceptance. Evaluates 5 pre-donation health screening questions
 * and applies deferral rules per Requirement 9.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET env var.
 *
 * Request body:
 * {
 *   donor_id: string (uuid),
 *   blood_request_id: string (uuid),
 *   answers: {
 *     fever: boolean,        // recent fever/cough/cold in last 14 days
 *     tattoo: boolean,       // tattoo/piercing/surgery in last 6 months
 *     vaccination: boolean,  // vaccination in last 14 days
 *     food: boolean,         // had food today (false = soft warning, not deferral)
 *     medication: boolean    // medication today/yesterday
 *   }
 * }
 *
 * Screening rules:
 * - fever = true       → deferral 14 days (recent illness)
 * - tattoo = true      → deferral 180 days (6 months)
 * - vaccination = true → deferral 14 days
 * - food = false       → NOT a deferral, soft warning "should eat before donating"
 * - medication = true  → deferral 14 days (conservative)
 *
 * Takes the LONGEST deferral if multiple apply.
 *
 * Steps:
 * 1. Validate inputs
 * 2. Evaluate screening rules
 * 3. INSERT into screening_log
 * 4. If deferral needed:
 *    - UPDATE blood_donors SET deferral_until, deferral_reason
 *    - UPDATE blood_donor_responses SET response_status = 'declined'
 *    - Return { ok: true, data: { passed: false, deferred_until, eligible_from_message } }
 * 5. If all clear:
 *    - Return { ok: true, data: { passed: true, next_step: 'proceed_to_accept' } }
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4 — Design §Property 12
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Deferral rules (days) ───
const DEFERRAL_RULES: Record<string, { days: number; reason: string }> = {
  fever: { days: 14, reason: 'recent_illness' },
  tattoo: { days: 180, reason: 'tattoo_piercing_surgery' },
  vaccination: { days: 14, reason: 'recent_vaccination' },
  medication: { days: 14, reason: 'medication' },
};

// UUID v4 regex for validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ScreeningAnswers {
  fever: boolean;
  tattoo: boolean;
  vaccination: boolean;
  food: boolean;
  medication: boolean;
}

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
    const { donor_id, blood_request_id, answers } = body;

    // ─── Validation ───
    if (!donor_id || typeof donor_id !== 'string' || !UUID_REGEX.test(donor_id)) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'donor_id is required and must be a valid UUID' },
        { status: 400 }
      );
    }

    if (!blood_request_id || typeof blood_request_id !== 'string' || !UUID_REGEX.test(blood_request_id)) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'blood_request_id is required and must be a valid UUID' },
        { status: 400 }
      );
    }

    if (!answers || typeof answers !== 'object') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'answers object is required' },
        { status: 400 }
      );
    }

    // Validate all answer fields are present and boolean
    const requiredFields: (keyof ScreeningAnswers)[] = ['fever', 'tattoo', 'vaccination', 'food', 'medication'];
    for (const field of requiredFields) {
      if (typeof answers[field] !== 'boolean') {
        return NextResponse.json(
          { ok: false, error: 'VALIDATION_FAILED', message: `answers.${field} is required and must be a boolean` },
          { status: 400 }
        );
      }
    }

    const screeningAnswers: ScreeningAnswers = {
      fever: answers.fever,
      tattoo: answers.tattoo,
      vaccination: answers.vaccination,
      food: answers.food,
      medication: answers.medication,
    };

    // ─── Evaluate screening rules ───
    // Collect all applicable deferrals and take the longest
    const appliedDeferrals: { field: string; days: number; reason: string }[] = [];

    for (const [field, rule] of Object.entries(DEFERRAL_RULES)) {
      if (screeningAnswers[field as keyof ScreeningAnswers] === true) {
        appliedDeferrals.push({ field, days: rule.days, reason: rule.reason });
      }
    }

    const deferralApplied = appliedDeferrals.length > 0;
    const screeningPassed = !deferralApplied;

    // Determine max deferral (longest wins)
    let maxDeferralDays = 0;
    if (deferralApplied) {
      for (const d of appliedDeferrals) {
        if (d.days > maxDeferralDays) {
          maxDeferralDays = d.days;
        }
      }
    }

    // Build combined reason string for all applied deferrals
    const combinedReason = deferralApplied
      ? 'pre_screening:' + appliedDeferrals.map(d => d.reason).join(',')
      : '';

    // ─── Step 3: INSERT into screening_log ───
    const { error: logError } = await supabase
      .from('screening_log')
      .insert({
        donor_id,
        blood_request_id,
        screening_answers: screeningAnswers,
        screening_passed: screeningPassed,
        deferral_applied: deferralApplied,
      });

    if (logError) {
      console.error('[blood-requests/pre-screening] screening_log insert error:', logError);
      return NextResponse.json(
        { ok: false, error: 'Failed to log screening', details: logError.message },
        { status: 500 }
      );
    }

    // ─── Step 4: If deferral needed ───
    if (deferralApplied) {
      // Calculate deferral_until date
      const deferralUntil = new Date();
      deferralUntil.setDate(deferralUntil.getDate() + maxDeferralDays);
      const deferralUntilStr = deferralUntil.toISOString().split('T')[0]; // YYYY-MM-DD

      // UPDATE blood_donors SET deferral_until, deferral_reason
      const { error: donorUpdateError } = await supabase
        .from('blood_donors')
        .update({
          deferral_until: deferralUntilStr,
          deferral_reason: combinedReason,
        })
        .eq('id', donor_id);

      if (donorUpdateError) {
        console.error('[blood-requests/pre-screening] donor update error:', donorUpdateError);
        return NextResponse.json(
          { ok: false, error: 'Failed to update donor deferral', details: donorUpdateError.message },
          { status: 500 }
        );
      }

      // UPDATE blood_donor_responses SET response_status = 'declined'
      const { error: responseUpdateError } = await supabase
        .from('blood_donor_responses')
        .update({ response_status: 'declined' })
        .eq('donor_id', donor_id)
        .eq('blood_request_id', blood_request_id);

      if (responseUpdateError) {
        console.error('[blood-requests/pre-screening] response update error:', responseUpdateError);
        return NextResponse.json(
          { ok: false, error: 'Failed to update donor response', details: responseUpdateError.message },
          { status: 500 }
        );
      }

      // Format the eligible-from date in a user-friendly way
      const eligibleFromFormatted = deferralUntil.toLocaleDateString('hi-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

      // Build soft warnings
      const warnings: string[] = [];
      if (screeningAnswers.food === false) {
        warnings.push('Donate karne se pehle kuch kha lein.');
      }

      return NextResponse.json({
        ok: true,
        data: {
          passed: false,
          deferred_until: deferralUntilStr,
          deferral_days: maxDeferralDays,
          deferral_reasons: appliedDeferrals.map(d => d.reason),
          eligible_from_message: `Aap ${eligibleFromFormatted} ke baad donate kar sakte hain`,
          ...(warnings.length > 0 && { warnings }),
        },
      });
    }

    // ─── Step 5: All clear — proceed to accept ───
    // Build soft warnings for food
    const warnings: string[] = [];
    if (screeningAnswers.food === false) {
      warnings.push('Donate karne se pehle kuch kha lein.');
    }

    return NextResponse.json({
      ok: true,
      data: {
        passed: true,
        next_step: 'proceed_to_accept',
        ...(warnings.length > 0 && { warnings }),
      },
    });
  } catch (error) {
    console.error('[blood-requests/pre-screening] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
