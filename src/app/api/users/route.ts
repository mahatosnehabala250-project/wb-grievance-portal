import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { hashSync } from 'bcryptjs';

// GET /api/users — list users (admin only)
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const role = searchParams.get('role');

  const where: Record<string, unknown> = {};
  if (role && role !== 'ALL') where.role = role;

  const users = await db.user.findMany({
    where,
    select: {
      id: true,
      username: true,
      role: true,
      name: true,
      block: true,
      district: true,
      isActive: true,
      createdAt: true,
      whatsappPhone: true,
      telegramChatId: true,
      email: true,
      isDistrictHead: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ users });
}

// POST /api/users — create user (admin only)
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { username, password, role, name, block, location, district, whatsappPhone, telegramChatId, email, isDistrictHead } = body;

    // Accept both 'block' and 'location' for backward compatibility
    const blockValue = block || location || '';

    if (!username || !password || !role || !name || !blockValue) {
      return NextResponse.json(
        { error: 'Username, password, role, name, and block are required' },
        { status: 400 }
      );
    }

    const existing = await db.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
    }

    const user = await db.user.create({
      data: {
        username,
        passwordHash: hashSync(password, 12),
        role,
        name,
        block: blockValue,
        district: district || null,
        whatsappPhone: whatsappPhone || null,
        telegramChatId: telegramChatId || null,
        email: email || null,
        isDistrictHead: isDistrictHead || false,
      },
      select: {
        id: true, username: true, role: true, name: true,
        block: true, district: true, isActive: true, createdAt: true,
        whatsappPhone: true, telegramChatId: true, email: true,
      },
    });

    return NextResponse.json({ user, success: true }, { status: 201 });
  } catch (error) {
    console.error('Create user error:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}

// PATCH /api/users — update user (admin only)
export async function PATCH(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, isActive, password, name, role, location, block, district, whatsappPhone, telegramChatId, email, isDistrictHead } = body;

    if (!id) return NextResponse.json({ error: 'User ID required' }, { status: 400 });

    const data: Record<string, unknown> = {};
    if (isActive !== undefined) data.isActive = isActive;
    if (password) data.passwordHash = hashSync(password, 12);
    if (name) data.name = name;
    if (role) data.role = role;
    if (location || block) data.block = block || location;
    if (district !== undefined) data.district = district || null;
    if (whatsappPhone !== undefined) data.whatsappPhone = whatsappPhone || null;
    if (telegramChatId !== undefined) data.telegramChatId = telegramChatId || null;
    if (email !== undefined) data.email = email || null;
    if (isDistrictHead !== undefined) data.isDistrictHead = isDistrictHead;

    const user = await db.user.update({
      where: { id },
      data,
      select: {
        id: true, username: true, role: true, name: true,
        block: true, district: true, isActive: true, createdAt: true,
        whatsappPhone: true, telegramChatId: true, email: true, isDistrictHead: true,
      },
    });

    return NextResponse.json({ user, success: true });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
