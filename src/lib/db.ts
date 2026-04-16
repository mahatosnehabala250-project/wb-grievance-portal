/**
 * db.ts — 3-Mode Database Adapter
 *
 * Mode 1: SUPABASE_SERVICE_ROLE_KEY set → Supabase REST API via @supabase/supabase-js
 * Mode 2: DATABASE_URL starts with postgresql://  → Prisma direct (PostgreSQL)
 * Mode 3: DATABASE_URL starts with file://         → Prisma with SQLite
 *
 * All modes export `db` with the same Prisma-like API:
 *   db.user.findUnique / findMany / create / update / count
 *   db.complaint.findUnique / findMany / findFirst / create / update / updateMany / count / groupBy
 *   db.activityLog.findMany / findFirst / create / count
 *   db.comment.findMany / create
 *   db.feedback.create
 */

import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

type WhereInput = Record<string, unknown>
type OrderByInput = Record<string, 'asc' | 'desc'>
type SelectInput = Record<string, boolean>
type IncludeInput = Record<string, { select?: SelectInput }>

interface FindManyArgs {
  where?: WhereInput
  orderBy?: OrderByInput
  skip?: number
  take?: number
  select?: SelectInput
  include?: IncludeInput
  distinct?: string[]
}

interface FindUniqueArgs {
  where: WhereInput
  select?: SelectInput
  include?: IncludeInput
}

interface FindFirstArgs {
  where?: WhereInput
  orderBy?: OrderByInput
  select?: SelectInput
}

interface CountArgs {
  where?: WhereInput
}

interface CreateArgs {
  data: Record<string, unknown>
  select?: SelectInput
}

interface UpdateArgs {
  where: WhereInput
  data: Record<string, unknown>
  select?: SelectInput
}

interface UpdateManyArgs {
  where: WhereInput
  data: Record<string, unknown>
}

interface DeleteManyArgs {
  where?: WhereInput
}

interface CreateManyArgs {
  data: Record<string, unknown>[]
  skipDuplicates?: boolean
}

interface GroupByArgs {
  by: string[]
  where?: WhereInput
  _count?: Record<string, boolean>
  orderBy?: Record<string, Record<string, 'asc' | 'desc'>>
  take?: number
}

// ═══════════════════════════════════════════════════════════════
// MODE DETECTION
// ═══════════════════════════════════════════════════════════════

type DbMode = 'supabase' | 'prisma-pg' | 'prisma-sqlite'

const databaseUrl = process.env.DATABASE_URL || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''

let mode: DbMode
if (supabaseServiceRoleKey && supabaseUrl) {
  mode = 'supabase'
} else if (databaseUrl.startsWith('postgresql://')) {
  mode = 'prisma-pg'
} else if (databaseUrl.startsWith('file://')) {
  mode = 'prisma-sqlite'
} else {
  throw new Error(
    '[DB] No valid database configuration found. ' +
    'Set SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL, or DATABASE_URL (postgresql:// or file://).'
  )
}

// ═══════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════

const DATE_FIELDS = new Set(['createdAt', 'updatedAt', 'resolvedAt', 'escalatedAt'])

/** Recursively convert ISO date strings back to Date objects for known date fields. */
function parseDates<T>(row: T): T {
  if (!row || typeof row !== 'object') return row
  const result = { ...row } as Record<string, unknown>
  for (const key of Object.keys(result)) {
    const val = result[key]
    if (DATE_FIELDS.has(key) && typeof val === 'string') {
      result[key] = new Date(val)
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      result[key] = parseDates(val)
    } else if (Array.isArray(val)) {
      result[key] = val.map(parseDates)
    }
  }
  return result as T
}

/** Convert any Date values in a data object to ISO strings for Supabase. */
function serializeDates(data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data }
  for (const key of Object.keys(result)) {
    if (result[key] instanceof Date) {
      result[key] = (result[key] as Date).toISOString()
    }
  }
  return result
}

/** Convert a value to ISO string if it's a Date. */
function toISO(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

// ═══════════════════════════════════════════════════════════════
// TABLE & RELATION MAPPINGS
// ═══════════════════════════════════════════════════════════════

/** Maps Prisma model names to Supabase table names. */
const TABLE_NAMES: Record<string, string> = {
  user: 'users',
  complaint: 'complaints',
  activityLog: 'activity_logs',
  comment: 'comments',
  feedback: 'feedback',
}

/** Maps Prisma relation names to Supabase table names per model. */
const RELATION_MAP: Record<string, Record<string, string>> = {
  complaint: { activities: 'activity_logs', comments: 'comments' },
  activityLog: { complaint: 'complaints' },
  comment: { complaint: 'complaints' },
}

// ═══════════════════════════════════════════════════════════════
// SUPABASE MODEL ADAPTER
// ═══════════════════════════════════════════════════════════════

class SupabaseModelAdapter {
  private supabase: ReturnType<typeof import('@supabase/supabase-js').createClient>
  private tableName: string
  private modelName: string
  private relationMap: Record<string, string>

  constructor(
    supabase: ReturnType<typeof import('@supabase/supabase-js').createClient>,
    tableName: string,
    modelName: string,
  ) {
    this.supabase = supabase
    this.tableName = tableName
    this.modelName = modelName
    this.relationMap = RELATION_MAP[modelName] || {}
  }

  // ─── Select string builder ───

  private buildSelectString(args: { select?: SelectInput; include?: IncludeInput }): string {
    if (!args.select && !args.include) return '*'

    const parts: string[] = []

    // Main table columns
    const mainColumns: string[] = []
    if (args.select) {
      for (const [key, val] of Object.entries(args.select)) {
        if (val && !this.relationMap[key]) {
          mainColumns.push(key)
        }
      }
    }

    // Relation embeddings
    const relationParts: string[] = []
    if (args.include) {
      for (const [relName, relConfig] of Object.entries(args.include)) {
        const relTable = this.relationMap[relName] || relName
        if (relConfig.select) {
          const cols = Object.entries(relConfig.select)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join(',')
          relationParts.push(`${relName}:${relTable}(${cols})`)
        } else {
          relationParts.push(`${relName}:${relTable}(*)`)
        }
      }
    }

    if (mainColumns.length > 0 && relationParts.length > 0) {
      return mainColumns.join(',') + ',' + relationParts.join(',')
    } else if (mainColumns.length > 0) {
      return mainColumns.join(',')
    } else if (relationParts.length > 0) {
      return '*' + ',' + relationParts.join(',')
    }
    return '*'
  }

  // ─── Where clause: single condition to PostgREST filter string ───

  private conditionToFilterString(field: string, value: unknown): string {
    if (value === null) return `${field}.is.null`
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>
      if ('not' in obj && obj.not === null) return `${field}.not.is.null`
      if ('in' in obj && Array.isArray(obj.in)) {
        const items = (obj.in as unknown[]).map(v => String(v)).join(',')
        return `${field}.in.(${items})`
      }
      if ('contains' in obj) return `${field}.ilike.%${String(obj.contains)}%`
    }
    return `${field}.eq.${String(value)}`
  }

  // ─── Where clause: apply to Supabase query builder ───

  private applyWhere<Q>(query: Q, where: WhereInput): Q {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = query as any
    const orConditions: WhereInput[] = []
    const nestedRelations: Record<string, WhereInput> = {}
    const rangeFilters: Record<string, { gte?: unknown; lte?: unknown; gt?: unknown; lt?: unknown }> = {}

    for (const [key, value] of Object.entries(where)) {
      // OR group — collect for later
      if (key === 'OR' && Array.isArray(value)) {
        orConditions.push(...(value as WhereInput[]))
        continue
      }

      // Nested relation where (e.g., complaint: { source: 'WHATSAPP' })
      if (this.relationMap[key] && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        nestedRelations[key] = value as WhereInput
        continue
      }

      // null check
      if (value === null) {
        q = q.is(key, null)
        continue
      }

      // Simple equality (string, number, boolean)
      if (typeof value !== 'object') {
        q = q.eq(key, value)
        continue
      }

      // Object filters
      const obj = value as Record<string, unknown>

      // not: null
      if ('not' in obj && obj.not === null) {
        q = q.not(key, 'is', null)
        continue
      }

      // in: [values]
      if ('in' in obj && Array.isArray(obj.in)) {
        q = q.in(key, obj.in as unknown[])
        continue
      }

      // Range operators (gte, lte, gt, lt) — collect per field
      if ('gte' in obj || 'lte' in obj || 'gt' in obj || 'lt' in obj) {
        if (!rangeFilters[key]) rangeFilters[key] = {}
        if ('gte' in obj) rangeFilters[key].gte = toISO(obj.gte)
        if ('lte' in obj) rangeFilters[key].lte = toISO(obj.lte)
        if ('gt' in obj) rangeFilters[key].gt = toISO(obj.gt)
        if ('lt' in obj) rangeFilters[key].lt = toISO(obj.lt)
        continue
      }

      // contains (case-insensitive LIKE)
      if ('contains' in obj) {
        q = q.ilike(key, `%${obj.contains}%`)
        continue
      }
    }

    // Apply range filters
    for (const [field, filters] of Object.entries(rangeFilters)) {
      if (filters.gte !== undefined) q = q.gte(field, filters.gte)
      if (filters.lte !== undefined) q = q.lte(field, filters.lte)
      if (filters.gt !== undefined) q = q.gt(field, filters.gt)
      if (filters.lt !== undefined) q = q.lt(field, filters.lt)
    }

    // Apply nested relation filters (using Prisma relation name as alias prefix)
    for (const [relName, relWhere] of Object.entries(nestedRelations)) {
      const relTable = this.relationMap[relName] || relName
      for (const [field, value] of Object.entries(relWhere)) {
        if (value === null) {
          q = q.is(`${relName}.${field}`, null)
        } else if (typeof value !== 'object') {
          q = q.eq(`${relName}.${field}`, value)
        } else {
          const nestedObj = value as Record<string, unknown>
          if ('in' in nestedObj && Array.isArray(nestedObj.in)) {
            q = q.in(`${relName}.${field}`, nestedObj.in as unknown[])
          } else if ('contains' in nestedObj) {
            q = q.ilike(`${relName}.${field}`, `%${nestedObj.contains}%`)
          }
        }
      }
    }

    // Apply OR conditions via Supabase .or() method
    if (orConditions.length > 0) {
      // Each OR entry becomes a group of ANDed conditions (comma-separated within the group)
      // Multiple OR entries are separated by commas at the top level
      const orParts = orConditions.map(cond => {
        return Object.entries(cond)
          .map(([field, value]) => this.conditionToFilterString(field, value))
          .join(',')
      })
      q = q.or(orParts.join(','))
    }

    return q as Q
  }

  // ─── OrderBy ───

  private applyOrderBy<Q>(query: Q, orderBy: OrderByInput): Q {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = query as any
    for (const [field, direction] of Object.entries(orderBy)) {
      q = q.order(field, { ascending: direction === 'asc' })
    }
    return q as Q
  }

  // ═══ CRUD OPERATIONS ═══

  async findMany<T = Record<string, unknown>>(args: FindManyArgs = {}): Promise<T[]> {
    const selectStr = this.buildSelectString(args)
    let query = this.supabase.from(this.tableName).select(selectStr)

    if (args.where) query = this.applyWhere(query, args.where)
    if (args.orderBy) query = this.applyOrderBy(query, args.orderBy)
    if (args.skip !== undefined && args.take !== undefined) {
      query = query.range(args.skip, args.skip + args.take - 1)
    } else if (args.take !== undefined) {
      query = query.limit(args.take)
    }

    const { data, error } = await query
    if (error) throw new Error(`[DB:${this.modelName}] findMany: ${error.message}`)

    let results = (data || []).map(parseDates) as T[]

    // In-memory distinct support
    if (args.distinct && args.distinct.length > 0) {
      const seen = new Set<string>()
      results = results.filter(row => {
        const key = String((row as Record<string, unknown>)[args.distinct![0]] ?? '')
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }

    return results
  }

  async findUnique<T = Record<string, unknown>>(args: FindUniqueArgs): Promise<T | null> {
    const selectStr = this.buildSelectString(args)
    let query = this.supabase.from(this.tableName).select(selectStr)

    // findUnique: exactly one unique field (id, username, ticketNo, etc.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = query as any
    for (const [field, value] of Object.entries(args.where)) {
      q = q.eq(field, value)
    }

    const { data, error } = await q.single()
    if (error) {
      if (error.code === 'PGRST116') return null // No rows returned
      throw new Error(`[DB:${this.modelName}] findUnique: ${error.message}`)
    }

    return data ? parseDates(data) : null
  }

  async findFirst<T = Record<string, unknown>>(args: FindFirstArgs = {}): Promise<T | null> {
    const selectStr = this.buildSelectString(args)
    let query = this.supabase.from(this.tableName).select(selectStr)

    if (args.where) query = this.applyWhere(query, args.where)
    if (args.orderBy) query = this.applyOrderBy(query, args.orderBy)

    const { data, error } = await query.limit(1).single()
    if (error) {
      if (error.code === 'PGRST116') return null
      throw new Error(`[DB:${this.modelName}] findFirst: ${error.message}`)
    }

    return data ? parseDates(data) : null
  }

  async count(args: CountArgs = {}): Promise<number> {
    let query = this.supabase.from(this.tableName).select('*', { count: 'exact', head: true })

    if (args.where) query = this.applyWhere(query, args.where)

    const { count, error } = await query
    if (error) throw new Error(`[DB:${this.modelName}] count: ${error.message}`)

    return count ?? 0
  }

  async create<T = Record<string, unknown>>(args: CreateArgs): Promise<T> {
    const now = new Date().toISOString()
    const data = {
      ...serializeDates(args.data),
      // Auto-generate UUID (Supabase REST API doesn't auto-generate like Prisma @default(cuid()))
      ...(args.data.id ? {} : { id: randomUUID() }),
      // Auto-set timestamps
      ...(args.data.createdAt ? {} : { createdAt: now }),
      ...(args.data.updatedAt ? {} : { updatedAt: now }),
    }

    const selectStr = this.buildSelectString({ select: args.select })
    const { data: result, error } = await this.supabase
      .from(this.tableName)
      .insert(data)
      .select(selectStr)
      .single()

    if (error) throw new Error(`[DB:${this.modelName}] create: ${error.message}`)
    return parseDates(result)
  }

  async update<T = Record<string, unknown>>(args: UpdateArgs): Promise<T> {
    const data = {
      ...serializeDates(args.data),
      updatedAt: new Date().toISOString(),
    }

    const selectStr = this.buildSelectString({ select: args.select })
    let query = this.supabase
      .from(this.tableName)
      .update(data)
      .select(selectStr)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = query as any
    for (const [field, value] of Object.entries(args.where)) {
      q = q.eq(field, value)
    }

    const { data: result, error } = await q.single()
    if (error) throw new Error(`[DB:${this.modelName}] update: ${error.message}`)
    return parseDates(result)
  }

  async updateMany(args: UpdateManyArgs): Promise<{ count: number }> {
    const data = {
      ...serializeDates(args.data),
      updatedAt: new Date().toISOString(),
    }

    let query = this.supabase.from(this.tableName).update(data)
    if (args.where) query = this.applyWhere(query, args.where)

    const { data: result, error } = await query.select()
    if (error) throw new Error(`[DB:${this.modelName}] updateMany: ${error.message}`)
    return { count: (result || []).length }
  }

  async deleteMany(args: DeleteManyArgs = {}): Promise<{ count: number }> {
    let query = this.supabase.from(this.tableName).delete()
    if (args.where) query = this.applyWhere(query, args.where)

    const { data, error } = await query.select()
    if (error) throw new Error(`[DB:${this.modelName}] deleteMany: ${error.message}`)
    return { count: (data || []).length }
  }

  async createMany(args: CreateManyArgs): Promise<{ count: number }> {
    const now = new Date().toISOString()
    const rows = (args.data || []).map(row => ({
      ...serializeDates(row),
      ...(row.id ? {} : { id: randomUUID() }),
      ...(row.createdAt ? {} : { createdAt: now }),
      ...(row.updatedAt ? {} : { updatedAt: now }),
    }))

    const { data, error } = await this.supabase.from(this.tableName).insert(rows)
    if (error) throw new Error(`[DB:${this.modelName}] createMany: ${error.message}`)
    return { count: (data || []).length }
  }

  /**
   * In-memory groupBy — Supabase REST API doesn't expose SQL GROUP BY directly.
   * Fetches matching rows and groups them in JavaScript.
   */
  async groupBy<T = Record<string, unknown>>(args: GroupByArgs): Promise<T[]> {
    const records = await this.findMany<Record<string, unknown>>({
      where: args.where,
      orderBy: args.orderBy as OrderByInput,
    })

    // Group by the specified fields
    const groups = new Map<string, { record: Record<string, unknown>; count: number }>()

    for (const record of records) {
      const key = args.by.map(field => String(record[field] ?? '\x00')).join('\x00')

      if (groups.has(key)) {
        groups.get(key)!.count++
      } else {
        const grouped: Record<string, unknown> = {}
        for (const field of args.by) {
          grouped[field] = record[field]
        }
        groups.set(key, { record: grouped, count: 1 })
      }
    }

    let results = Array.from(groups.values()).map(({ record, count }) => ({
      ...record,
      _count: args._count
        ? Object.fromEntries(
            Object.keys(args._count).map(k => [k, count])
          )
        : undefined,
    }))

    // Sort by _count if orderBy specifies it
    if (args.orderBy && '_count' in args.orderBy) {
      const direction = args.orderBy._count
      for (const [, dir] of Object.entries(direction)) {
        results.sort((a, b) => {
          const aCount = Object.values(a._count as Record<string, number>)[0] || 0
          const bCount = Object.values(b._count as Record<string, number>)[0] || 0
          return dir === 'desc' ? bCount - aCount : aCount - bCount
        })
      }
    }

    // Apply take limit
    if (args.take !== undefined) {
      results = results.slice(0, args.take)
    }

    return results as T[]
  }
}

// ═══════════════════════════════════════════════════════════════
// SUPABASE DB — Aggregates all model adapters
// ═══════════════════════════════════════════════════════════════

class SupabaseDb {
  user: SupabaseModelAdapter
  complaint: SupabaseModelAdapter
  activityLog: SupabaseModelAdapter
  comment: SupabaseModelAdapter
  feedback: SupabaseModelAdapter

  constructor(supabase: ReturnType<typeof import('@supabase/supabase-js').createClient>) {
    this.user = new SupabaseModelAdapter(supabase, 'users', 'user')
    this.complaint = new SupabaseModelAdapter(supabase, 'complaints', 'complaint')
    this.activityLog = new SupabaseModelAdapter(supabase, 'activity_logs', 'activityLog')
    this.comment = new SupabaseModelAdapter(supabase, 'comments', 'comment')
    this.feedback = new SupabaseModelAdapter(supabase, 'feedback', 'feedback')
  }
}

// ═══════════════════════════════════════════════════════════════
// PRISMA CLIENT (Modes 2 & 3)
// ═══════════════════════════════════════════════════════════════

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  let url = databaseUrl

  if (mode === 'prisma-pg') {
    console.log('[DB] Mode: Prisma PostgreSQL')
    // PgBouncer support: detect Supabase pooler URL and add pgbouncer=true
    if (url.includes('pooler.supabase.com')) {
      url += (url.includes('?') ? '&' : '?') + 'pgbouncer=true&connect_timeout=15&connection_limit=5'
    }
  } else {
    console.log('[DB] Mode: Prisma SQLite')
  }

  const client = new PrismaClient({
    datasourceUrl: url,
    log: process.env.NODE_ENV === 'development' ? ['query'] : ['error'],
  })

  // Pre-warm connection (reduces cold start latency)
  client.$connect().catch(() => {})

  return client
}

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any

if (mode === 'supabase') {
  console.log('[DB] Mode: Supabase REST API')
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require('@supabase/supabase-js')
    db = new SupabaseDb(createClient(supabaseUrl, supabaseServiceRoleKey))
  } catch {
    throw new Error(
      '[DB] @supabase/supabase-js is required for Supabase REST API mode. ' +
      'Install it with: bun add @supabase/supabase-js'
    )
  }
} else {
  const client = globalForPrisma.prisma ?? createPrismaClient()
  // Cache Prisma client globally (critical for Vercel serverless — reuses connections across invocations)
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = client
  }
  db = client
}

export { db }
