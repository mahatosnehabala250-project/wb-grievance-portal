import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/health — system health check
export async function GET() {
  let dbStatus = 'connected';
  let dbLatency = 0;
  try {
    const start = Date.now();
    await db.user.count();
    dbLatency = Date.now() - start;
  } catch {
    dbStatus = 'error';
  }

  return NextResponse.json({
    status: 'ok',
    version: '2.7.0',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    db: dbStatus,
    dbLatency: `${dbLatency}ms`,
    environment: process.env.NODE_ENV || 'development',
  });
}
