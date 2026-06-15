export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest, JWTPayload } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';

/**
 * /api/branding — DB-backed white-label branding (multi-tenant theming).
 * GET: resolve the logged-in user's branding by scope (most-specific first).
 * POST: a governance leader (or ADMIN) saves branding for their own scope.
 * DELETE: reset (remove) the caller's scope branding → falls back to config.
 * Table is service_role-only (RLS forced); all access goes through this route.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const norm = (s?: string | null) => (s || '').trim().toLowerCase();

// Ordered scope keys (most specific → least) used to RESOLVE branding on read.
function scopeKeysForRead(u: JWTPayload): string[] {
  return [norm(u.constituency), norm(u.lok_sabha_constituency), norm(u.district), norm(u.block)].filter(Boolean);
}

// The single scope key a user is allowed to WRITE, + whether they may write at all.
function scopeKeyForWrite(u: JWTPayload, bodyScopeKey?: string): { key: string | null; reason?: string } {
  if (u.role === 'ADMIN' || u.role === 'STATE') {
    const k = norm(bodyScopeKey);
    return k ? { key: k } : { key: null, reason: 'ADMIN must pass scopeKey' };
  }
  const lvl = u.role_level;
  if (lvl === 'MP' && u.lok_sabha_constituency) return { key: norm(u.lok_sabha_constituency) };
  if (lvl === 'MLA' && u.constituency) return { key: norm(u.constituency) };
  if ((lvl === 'DISTRICT_ADMIN' || u.role === 'DISTRICT') && (u.district || u.block)) return { key: norm(u.district || u.block) };
  if ((lvl === 'BLOCK_COORD' || u.role === 'BLOCK') && u.block) return { key: norm(u.block) };
  return { key: null, reason: 'Your role cannot set branding' };
}

async function auth(request: NextRequest): Promise<JWTPayload | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(request: NextRequest) {
  const payload = await auth(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const keys = scopeKeysForRead(payload);
    if (keys.length === 0) return NextResponse.json({ branding: null });
    const { data, error } = await supabase.from('client_branding').select('*').in('scope_key', keys);
    if (error) throw error;
    const rows = (data || []) as Array<Record<string, unknown>>;
    // Pick the most-specific match (keys are ordered specific → least).
    const byKey = new Map(rows.map(r => [String(r.scope_key), r]));
    const hit = keys.map(k => byKey.get(k)).find(Boolean) || null;
    const branding = hit ? {
      orgName: hit.org_name, leaderName: hit.leader_name, tagline: hit.tagline,
      accent: hit.accent, accentSoft: hit.accent_soft,
    } : null;
    return NextResponse.json({ branding });
  } catch (e) {
    console.error('[branding] GET error:', e);
    return NextResponse.json({ branding: null });
  }
}

export async function POST(request: NextRequest) {
  const payload = await auth(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const { key, reason } = scopeKeyForWrite(payload, body.scopeKey);
    if (!key) return NextResponse.json({ error: reason || 'Cannot set branding' }, { status: 403 });

    const orgName = (body.orgName || '').toString().trim();
    if (!orgName) return NextResponse.json({ error: 'orgName is required' }, { status: 400 });
    const accent = /^#([0-9a-fA-F]{6})$/.test(body.accent) ? body.accent : '#BA7517';

    const row = {
      scope_key: key,
      org_name: orgName.slice(0, 80),
      leader_name: (body.leaderName || '').toString().trim().slice(0, 80),
      tagline: (body.tagline || '').toString().trim().slice(0, 120),
      accent,
      accent_soft: (body.accentSoft || `${accent}1f`).toString().slice(0, 40),
      updated_by: payload.userId || payload.username || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('client_branding').upsert(row, { onConflict: 'scope_key' });
    if (error) throw error;
    return NextResponse.json({
      success: true,
      branding: { orgName: row.org_name, leaderName: row.leader_name, tagline: row.tagline, accent: row.accent, accentSoft: row.accent_soft },
    });
  } catch (e) {
    console.error('[branding] POST error:', e);
    return NextResponse.json({ error: 'Failed to save branding' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const payload = await auth(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const { key, reason } = scopeKeyForWrite(payload, searchParams.get('scopeKey') || undefined);
    if (!key) return NextResponse.json({ error: reason || 'Cannot reset branding' }, { status: 403 });
    const { error } = await supabase.from('client_branding').delete().eq('scope_key', key);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[branding] DELETE error:', e);
    return NextResponse.json({ error: 'Failed to reset branding' }, { status: 500 });
  }
}
