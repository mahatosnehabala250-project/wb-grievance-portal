import { SignJWT, jwtVerify } from 'jose';
import { NextRequest } from 'next/server';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'wb-gov-support-system-secret-key-2024'
);

export interface JWTPayload {
  userId: string;
  username: string;
  role: string;
  name: string;
  block: string;
  district: string | null;
  role_level?: string;       // MP | MLA | DISTRICT_ADMIN | OFFICER
  constituency?: string | null; // Assembly constituency
  lok_sabha_constituency?: string | null;
}

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export function getTokenFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/token=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

// Helper: verify token and return payload
export async function getAuthUser(request: NextRequest): Promise<JWTPayload | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}

// Helper: check if user can access constituency data
export function canAccessConstituency(user: JWTPayload, targetConstituency: string): boolean {
  if (user.role_level === 'MP') return true;         // MP sees all
  if (user.role_level === 'DISTRICT_ADMIN') return true; // District admin sees all
  if (user.role === 'ADMIN') return true;             // System admin sees all
  if (user.role_level === 'MLA') {
    // MLA can only see their own constituency
    return user.constituency?.toLowerCase() === targetConstituency.toLowerCase();
  }
  return false;
}
