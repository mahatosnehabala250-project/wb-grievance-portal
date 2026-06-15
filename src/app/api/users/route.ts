export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import {
  creatableRoleLevels,
  validateNewUserScope,
  getUserListScope,
  userInManageScope,
  ROLE_LEVEL_RANK,
  actorRank,
} from '@/lib/rbac';
import { hashSync } from 'bcryptjs';

const USER_SELECT = {
  id: true, username: true, role: true, name: true,
  block: true, district: true, isActive: true, createdAt: true,
  whatsappPhone: true, telegramChatId: true, email: true, isDistrictHead: true,
  role_level: true, constituency: true, lok_sabha_constituency: true,
  gp_code: true, gp_name: true, assigned_villages: true,
};

// GET /api/users — list users within the actor's jurisdiction.
// ADMIN sees all; MP sees their seat; MLA their AC; etc.
// KARYAKARTA/OFFICER get 403 (no user management).
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const creatable = creatableRoleLevels(payload);
  if (creatable.length === 0) {
    return NextResponse.json({ error: 'Your role cannot manage users' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const role = searchParams.get('role');

  try {
    const scope = await getUserListScope(payload);
    const where: Record<string, unknown> = { ...scope.where };
    if (role && role !== 'ALL') where.role = role;

    let users = await db.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    // MP/MLA scope needs in-memory filtering (multi-column geography match)
    if (scope.postFilter) {
      users = users.filter(scope.postFilter);
    }

    // Non-admin: hide users at/above own rank (an MLA shouldn't list the MP)
    if (payload.role !== 'ADMIN') {
      const aRank = actorRank(payload);
      users = users.filter((u: Record<string, unknown>) => {
        const r = ROLE_LEVEL_RANK[(u.role_level as string) || 'OFFICER'] ?? 6;
        return r > aRank || u.id === payload.userId;
      });
    }

    return NextResponse.json({ users, meta: { creatableRoles: creatable } });
  } catch (error) {
    console.error('List users error:', error);
    return NextResponse.json({ error: 'Failed to list users' }, { status: 500 });
  }
}

// POST /api/users — hierarchical user creation.
// Actor may create ONLY role_levels below their own rank, and ONLY within
// their own geography. Both rules enforced server-side via rbac.ts.
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  try {
    const body = await request.json();
    const {
      username, password, role, name, block, location, district,
      whatsappPhone, telegramChatId, email, isDistrictHead,
      role_level, constituency, lok_sabha_constituency,
      gp_code, gp_name, assigned_villages,
    } = body;

    const blockValue = block || location || '';
    const targetLevel = role_level || 'OFFICER';

    if (!username || !password || !name) {
      return NextResponse.json(
        { error: 'Username, password and name are required' },
        { status: 400 }
      );
    }
    if (String(password).length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // ── Hierarchy + jurisdiction validation (server-side, authoritative) ──
    const verdict = await validateNewUserScope(payload, {
      role_level: targetLevel,
      constituency: constituency || null,
      lok_sabha_constituency: lok_sabha_constituency || null,
      district: district || null,
      block: blockValue || null,
      gp_code: gp_code || null,
      gp_name: gp_name || null,
      assigned_villages: assigned_villages || null,
    });
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.error }, { status: 403 });
    }

    // Base role: only ADMIN can mint ADMIN/STATE base roles
    const requestedRole = role || 'BLOCK';
    if (['ADMIN', 'STATE'].includes(requestedRole) && payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only admin can create admin/state users' }, { status: 403 });
    }

    const existing = await db.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
    }

    // Authoritative geography = the resolved scope from validateNewUserScope.
    // Every omitted/forced field is already anchored inside the creator's
    // jurisdiction, so we persist `rg` rather than raw client input.
    const rg = verdict.geo;

    const user = await db.user.create({
      data: {
        username,
        passwordHash: hashSync(password, 12),
        role: requestedRole,
        name,
        block: rg.block || '',
        district: rg.district || null,
        whatsappPhone: whatsappPhone || null,
        telegramChatId: telegramChatId || null,
        email: email || null,
        isDistrictHead: payload.role === 'ADMIN' ? (isDistrictHead || false) : false,
        role_level: targetLevel,
        constituency: rg.constituency || null,
        lok_sabha_constituency: rg.lok_sabha_constituency || null,
        gp_code: rg.gp_code || null,
        gp_name: rg.gp_name || null,
        assigned_villages: rg.assigned_villages || [],
      },
      select: USER_SELECT,
    });

    return NextResponse.json({ user, success: true }, { status: 201 });
  } catch (error) {
    console.error('Create user error:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}

// PATCH /api/users — update user.
// ADMIN: any user. Others: only users below their rank AND inside their
// geography (userInManageScope). Role/jurisdiction escalation is blocked.
export async function PATCH(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  try {
    const body = await request.json();
    const {
      id, isActive, password, name, role, location, block, district,
      whatsappPhone, telegramChatId, email, isDistrictHead,
      role_level, constituency, lok_sabha_constituency,
      gp_code, gp_name, assigned_villages,
    } = body;

    if (!id) return NextResponse.json({ error: 'User ID required' }, { status: 400 });

    const target = await db.user.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // ── Manage-scope check ──
    if (payload.role !== 'ADMIN') {
      const allowed = await userInManageScope(payload, target as Record<string, unknown>);
      if (!allowed) {
        return NextResponse.json({ error: 'User is outside your jurisdiction' }, { status: 403 });
      }
    }

    const data: Record<string, unknown> = {};
    if (isActive !== undefined) data.isActive = isActive;
    if (password) {
      if (String(password).length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
      }
      data.passwordHash = hashSync(password, 12);
    }
    if (name) data.name = name;
    if (whatsappPhone !== undefined) data.whatsappPhone = whatsappPhone || null;
    if (telegramChatId !== undefined) data.telegramChatId = telegramChatId || null;
    if (email !== undefined) data.email = email || null;

    // Role / jurisdiction changes: validate as if creating at the new level
    const changingScope = role || role_level || location || block ||
      district !== undefined || constituency !== undefined ||
      lok_sabha_constituency !== undefined || gp_code !== undefined ||
      assigned_villages !== undefined;

    if (changingScope) {
      const newLevel = role_level || (target as Record<string, unknown>).role_level as string || 'OFFICER';
      const verdict = await validateNewUserScope(payload, {
        role_level: newLevel,
        constituency: constituency !== undefined ? constituency : (target as Record<string, unknown>).constituency as string | null,
        lok_sabha_constituency: lok_sabha_constituency !== undefined ? lok_sabha_constituency : (target as Record<string, unknown>).lok_sabha_constituency as string | null,
        district: district !== undefined ? district : (target as Record<string, unknown>).district as string | null,
        block: (block || location) !== undefined ? (block || location) : (target as Record<string, unknown>).block as string | null,
        gp_code: gp_code !== undefined ? gp_code : (target as Record<string, unknown>).gp_code as string | null,
        assigned_villages: assigned_villages !== undefined ? assigned_villages : (target as Record<string, unknown>).assigned_villages as string[] | null,
      });
      if (!verdict.ok) {
        return NextResponse.json({ error: verdict.error }, { status: 403 });
      }
      if (role) {
        if (['ADMIN', 'STATE'].includes(role) && payload.role !== 'ADMIN') {
          return NextResponse.json({ error: 'Only admin can grant admin/state role' }, { status: 403 });
        }
        data.role = role;
      }
      if (role_level) data.role_level = role_level;
      if (location || block) data.block = block || location;
      if (district !== undefined) data.district = district || null;
      if (constituency !== undefined) data.constituency = constituency || null;
      if (lok_sabha_constituency !== undefined) data.lok_sabha_constituency = lok_sabha_constituency || null;
      if (gp_code !== undefined) data.gp_code = gp_code || null;
      if (gp_name !== undefined) data.gp_name = gp_name || null;
      if (assigned_villages !== undefined) data.assigned_villages = assigned_villages || [];
    }
    if (isDistrictHead !== undefined && payload.role === 'ADMIN') data.isDistrictHead = isDistrictHead;

    const user = await db.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });

    return NextResponse.json({ user, success: true });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
