import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

/**
 * GET & PATCH /api/admin/webhook-target
 *
 * Admin endpoint to read and update the active n8n workflow that receives
 * WhatsApp webhook triggers. Enables < 60s rollback between JS-01 (v1)
 * and JS-01v2 (multi-agent router) without redeployment.
 *
 * GET  — returns current active_workflow value (admin JWT required)
 * PATCH — updates active_workflow to a new target (admin JWT required)
 *
 * Body for PATCH: { target: "JS-01" | "JS-01v2" }
 * Response: { ok: true, data: { active_workflow: string, updated_at: string } }
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md §Migration Strategy
 * @see Requirements 19.1, 19.3, NFR Security
 */

const VALID_TARGETS = ['JS-01', 'JS-01v2'] as const;
type WebhookTarget = (typeof VALID_TARGETS)[number];

// Supabase client with service_role key (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Auth helper ───────────────────────────────────────────────────────────────
async function requireAdmin(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) {
    return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) };
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return { error: NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 401 }) };
  }

  if (payload.role !== 'ADMIN') {
    return { error: NextResponse.json({ ok: false, error: 'Admin access required' }, { status: 403 }) };
  }

  return { payload };
}

// ─── GET: Read current active_workflow ──────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth && auth.error) return auth.error;

  const { data, error } = await supabase
    .from('n8n_webhook_config')
    .select('value, updated_at')
    .eq('key', 'active_workflow')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: 'Failed to read webhook config' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      active_workflow: data.value,
      updated_at: data.updated_at,
    },
  });
}

// ─── PATCH: Update active_workflow ──────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth && auth.error) return auth.error;

  // Parse body
  let body: { target?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate target
  const target = body.target as WebhookTarget | undefined;
  if (!target || !VALID_TARGETS.includes(target as WebhookTarget)) {
    return NextResponse.json(
      { ok: false, error: `target must be one of: ${VALID_TARGETS.join(', ')}` },
      { status: 400 }
    );
  }

  // Update the active_workflow row
  const { data, error } = await supabase
    .from('n8n_webhook_config')
    .update({ value: target })
    .eq('key', 'active_workflow')
    .select('value, updated_at')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: 'Failed to update webhook config' },
      { status: 500 }
    );
  }

  // Audit log the flip
  const adminPayload = 'payload' in auth ? auth.payload : null;
  try {
    await supabase.from('activity_logs').insert({
      action: 'WEBHOOK_TARGET_CHANGED',
      description: `Webhook target changed to ${target} by ${adminPayload?.username ?? 'unknown'}`,
      actor_name: adminPayload?.name ?? adminPayload?.username ?? 'admin',
      metadata: {
        previous_target: null, // Could be enriched by reading before update
        new_target: target,
        changed_by: adminPayload?.userId,
      },
    });
  } catch {
    // Audit log failure should not block the response
    console.error('[webhook-target] Failed to write audit log');
  }

  return NextResponse.json({
    ok: true,
    data: {
      active_workflow: data.value,
      updated_at: data.updated_at,
    },
  });
}
