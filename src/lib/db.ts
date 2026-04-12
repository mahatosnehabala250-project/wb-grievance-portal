import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL || ''

  // Supabase Connection Pooler (PgBouncer) requires pgbouncer=true
  // to disable prepared statements and avoid "prepared statement already exists" error
  const poolerUrl = databaseUrl.includes('pooler.supabase.com')
    ? databaseUrl + (databaseUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&connect_timeout=15&connection_limit=5'
    : databaseUrl

  const client = new PrismaClient({
    datasourceUrl: poolerUrl,
    log: process.env.NODE_ENV === 'development' ? ['query'] : ['error'],
  })

  // Pre-warm connection on first query (reduces cold start latency)
  client.$connect().catch(() => {})

  return client
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

// Cache Prisma client globally (critical for Vercel serverless - reuses connections across invocations)
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = db
}
