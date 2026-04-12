import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/integrations/deployment-check — Check production readiness
export async function GET() {
  const checks: {
    name: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
  }[] = [];

  // 1. Production Database Check
  const dbUrl = process.env.DATABASE_URL || '';
  const isProductionDb =
    dbUrl.includes('postgresql://') || dbUrl.includes('mysql://') || dbUrl.includes('postgres://');
  const isFileDb = dbUrl.includes('file:') || dbUrl.includes('sqlite') || dbUrl === '';

  if (isProductionDb) {
    checks.push({
      name: 'Production Database',
      status: 'pass',
      detail: `Using ${dbUrl.includes('postgresql') || dbUrl.includes('postgres') ? 'PostgreSQL' : 'MySQL'} as the database backend.`,
    });
  } else if (isFileDb) {
    checks.push({
      name: 'Production Database',
      status: 'warn',
      detail: 'Using SQLite/file-based database. Consider migrating to PostgreSQL or MySQL for production.',
    });
  } else {
    checks.push({
      name: 'Production Database',
      status: 'fail',
      detail: 'DATABASE_URL is not configured or has an unsupported format.',
    });
  }

  // 2. JWT Secret Check
  const jwtSecret = process.env.JWT_SECRET || '';
  if (jwtSecret.length > 16) {
    checks.push({
      name: 'JWT Secret',
      status: 'pass',
      detail: `JWT_SECRET is set (${jwtSecret.length} characters).`,
    });
  } else if (jwtSecret.length > 0) {
    checks.push({
      name: 'JWT Secret',
      status: 'warn',
      detail: `JWT_SECRET is too short (${jwtSecret.length} characters). Use at least 16 characters for production.`,
    });
  } else {
    checks.push({
      name: 'JWT Secret',
      status: 'fail',
      detail: 'JWT_SECRET is not set. This is required for production authentication.',
    });
  }

  // 3. Environment Mode Check
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'production') {
    checks.push({
      name: 'Environment',
      status: 'pass',
      detail: 'Running in production mode (NODE_ENV=production).',
    });
  } else {
    checks.push({
      name: 'Environment',
      status: 'warn',
      detail: `Running in ${nodeEnv} mode. Set NODE_ENV=production for production deployments.`,
    });
  }

  // 4. Database Connection Health
  try {
    await db.$queryRaw`SELECT 1`;
    checks.push({
      name: 'Database Connection',
      status: 'pass',
      detail: 'Database connection is healthy.',
    });
  } catch (error) {
    checks.push({
      name: 'Database Connection',
      status: 'fail',
      detail: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }

  // 5. Data Volume Check
  try {
    const [complaintCount, userCount, activityCount, feedbackCount] = await Promise.all([
      db.complaint.count(),
      db.user.count(),
      db.activityLog.count(),
      db.feedback.count(),
    ]);

    const totalRecords = complaintCount + userCount + activityCount + feedbackCount;

    if (totalRecords > 0) {
      checks.push({
        name: 'Data Volume',
        status: 'pass',
        detail: `${totalRecords} total records: ${complaintCount} complaints, ${userCount} users, ${activityCount} activities, ${feedbackCount} feedback entries.`,
      });
    } else {
      checks.push({
        name: 'Data Volume',
        status: 'warn',
        detail: 'Database appears to be empty. You may need to run the seed script.',
      });
    }
  } catch (error) {
    checks.push({
      name: 'Data Volume',
      status: 'fail',
      detail: `Could not count records: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }

  // Calculate overall status
  const passedCount = checks.filter((c) => c.status === 'pass').length;
  const failedCount = checks.filter((c) => c.status === 'fail').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;

  let overall: 'ready' | 'partial' | 'not_ready';
  if (failedCount === 0 && warnCount === 0) {
    overall = 'ready';
  } else if (failedCount === 0) {
    overall = 'partial';
  } else {
    overall = 'not_ready';
  }

  return NextResponse.json({
    checks,
    overall,
    summary: `${passedCount} of ${checks.length} checks passed`,
    passedCount,
    warnCount,
    failedCount,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '2.3.0',
  });
}
