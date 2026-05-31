import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  RATE_LIMIT_BUCKETS,
  rateLimitWhatsAppReply,
  type RateLimitScope,
} from '@/lib/rateLimit/check';

/**
 * Per-phone rate limit check — anti-abuse (n8n internal, Phase 2 P1).
 *
 * The WhatsApp agent (JS-01) calls this on the inbound path, right after it
 * parses the message, before doing any AI / DB work. If the citizen has blown
 * past the bucket (default `wa_inbound`: 30 msgs / 5 min) the workflow short-
 * circuits and sends a localized "please wait" line instead of invoking the
 * agent — protecting the LLM budget and the DB from a flood / loop.
 *
 * Backed by the Postgres `rate_limit_check(phone, scope, limit, window)` stored
 * function (sliding window + advisory-lock atomicity). The helper's bucket table
 * (`RATE_LIMIT_BUCKETS`) is the single source of truth for limits.
 *
 * Fail-open: any error (DB blip, missing fn) returns `allowed: true` so a
 * limiter fault can never block a legitimate citizen (NFR Reliability).
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET.
 *
 * Body: { phone: string (required), scope?: RateLimitScope, language?: 'bn'|'hi'|'en' }
 * Response: { ok: true, data: { allowed, scope, retryAfterSeconds, reply } }
 *   - `reply` is the localized "please wait" line to send when allowed=false.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function authOk(request: NextRequest): boolean {
  const secret = request.headers.get('x-n8n-secret');
  const expected = process.env.N8N_WEBHOOK_SECRET;
  return !!expected && secret === expected;
}

function normalizeScope(v: unknown): RateLimitScope {
  return v === 'blood_request_create' || v === 'otp_request' || v === 'wa_inbound'
    ? v
    : 'wa_inbound';
}

export async function POST(request: NextRequest) {
  try {
    if (!authOk(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'request body must be a JSON object' },
        { status: 400 }
      );
    }

    const phoneRaw = (body as Record<string, unknown>).phone;
    if (typeof phoneRaw !== 'string' || phoneRaw.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'phone is required and must be a string' },
        { status: 400 }
      );
    }
    const phone = phoneRaw.trim();
    const scope = normalizeScope((body as Record<string, unknown>).scope);
    const language = (body as Record<string, unknown>).language;
    const bucket = RATE_LIMIT_BUCKETS[scope];

    let allowed = true; // fail-open default
    try {
      const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
      const { data, error } = await supabase.rpc('rate_limit_check', {
        p_phone: phone,
        p_scope: scope,
        p_limit: bucket.limit,
        p_window: bucket.windowSeconds,
      });
      if (error) {
        console.error('[ratelimit/check] rpc error (fail-open):', error.message);
      } else if (data === false) {
        allowed = false;
      }
    } catch (err) {
      console.error('[ratelimit/check] threw (fail-open):', err);
    }

    return NextResponse.json({
      ok: true,
      data: {
        allowed,
        scope,
        retryAfterSeconds: bucket.windowSeconds,
        reply: allowed ? null : rateLimitWhatsAppReply(typeof language === 'string' ? language : 'bn'),
      },
    });
  } catch (error) {
    console.error('[ratelimit/check] Error:', error);
    // Even on a hard failure, fail open so the agent can still respond.
    return NextResponse.json({
      ok: true,
      data: { allowed: true, scope: 'wa_inbound', retryAfterSeconds: 300, reply: null },
    });
  }
}
