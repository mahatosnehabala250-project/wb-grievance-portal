export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { signToken, JWTPayload } from '@/lib/jwt';


// Simple in-memory rate limiter for login attempts
// In production, use Redis. This prevents brute force on single instance.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const key = ip;
  const entry = loginAttempts.get(key);
  
  if (entry) {
    if (now < entry.resetAt) {
      if (entry.count >= 5) return false; // 5 attempts per 15 min
      entry.count++;
    } else {
      loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    }
  } else {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
  }
  return true;
}

// Cleanup old entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of loginAttempts.entries()) {
    if (now > val.resetAt) loginAttempts.delete(key);
  }
}, 3600000);

export async function POST(request: NextRequest) {
  // Rate limit: 5 attempts per 15 minutes per IP
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() 
    || request.headers.get('x-real-ip') 
    || 'unknown';
  if (!checkLoginRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please wait 15 minutes.' },
      { status: 429 }
    );
  }
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({ where: { username } });

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: 'Account is deactivated. Contact admin.' },
        { status: 403 }
      );
    }

    const isValid = bcrypt.compareSync(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const payload: JWTPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      block: user.block,
      district: user.district,
      role_level: (user as any).role_level || 'OFFICER',
      constituency: (user as any).constituency || null,
      lok_sabha_constituency: (user as any).lok_sabha_constituency || null,
      gp_code: (user as any).gp_code || null,
      gp_name: (user as any).gp_name || null,
      assigned_villages: (user as any).assigned_villages || null,
    };

    const token = await signToken(payload);

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
        block: user.block,
        district: user.district,
        role_level: (user as any).role_level || 'OFFICER',
        constituency: (user as any).constituency || null,
        lok_sabha_constituency: (user as any).lok_sabha_constituency || null,
        gp_code: (user as any).gp_code || null,
        gp_name: (user as any).gp_name || null,
        assigned_villages: (user as any).assigned_villages || null,
      },
      token,
    });

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 86400, // 24h
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
