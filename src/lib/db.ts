import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL || ''

  // Supabase Connection Pooler (PgBouncer) requires pgbouncer=true
  // to disable prepared statements and avoid "prepared statement already exists" error
  const poolerUrl = databaseUrl.includes('pooler.supabase.com')
    ? databaseUrl + (databaseUrl.includes('?') ? '&' : '?') + 'pgbouncer=true'
    : databaseUrl

  return new PrismaClient({
    datasourceUrl: poolerUrl,
    log: process.env.NODE_ENV === 'development' ? ['query'] : ['error'],
  })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
