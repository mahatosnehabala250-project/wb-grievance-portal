import { createClient } from '@supabase/supabase-js';
import { getComplaintScopeFilter } from '@/lib/jwt';
import type { JWTPayload } from '@/lib/jwt';
import { normalisePhone } from '@/lib/outreach';

/**
 * Which citizens' conversations may this account read?
 *
 * The chat RPCs (`get_chat_list`, `get_chat_history`) take no jurisdiction
 * argument — they return every citizen who ever messaged, statewide. That is
 * fine for the RPC and wrong for a route, so the boundary is drawn here.
 *
 * A citizen is in scope when they filed a complaint that is in scope. The
 * complaint filter is the one already used everywhere else
 * (getComplaintScopeFilter), so chat cannot drift away from what the same
 * account sees on the complaints screen.
 *
 * Returns `null` for accounts that legitimately see everything — a null means
 * "no restriction", and callers must treat it as distinct from an empty set,
 * which means "this account may see nobody".
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AnyRecord = Record<string, unknown>;

interface Filterable {
  eq(column: string, value: unknown): Filterable;
  in(column: string, values: unknown[]): Filterable;
}

export async function phonesInScope(payload: JWTPayload): Promise<Set<string> | null> {
  if (payload.role === 'ADMIN' || payload.role === 'STATE') return null;

  const where = getComplaintScopeFilter(payload) as AnyRecord;
  // An empty filter from a non-admin means the account has no geography to
  // scope by. Fail closed rather than hand over every citizen in the state.
  if (Object.keys(where).length === 0) return new Set<string>();

  let q = supabase.from('complaints').select('phone') as unknown as Filterable;
  for (const [key, value] of Object.entries(where)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && 'in' in (value as AnyRecord)) {
      q = q.in(key, (value as { in: unknown[] }).in);
    } else {
      q = q.eq(key, value);
    }
  }

  const { data, error } = await (q as unknown as {
    limit(n: number): Promise<{ data: AnyRecord[] | null; error: unknown }>;
  }).limit(20000);
  if (error) throw error;

  const set = new Set<string>();
  for (const row of data || []) {
    const p = normalisePhone(row.phone as string);
    if (p.length >= 10) set.add(p);
  }
  return set;
}

/** True when this account may read the given citizen's conversation. */
export function phoneAllowed(scope: Set<string> | null, phone: string): boolean {
  if (scope === null) return true;
  return scope.has(normalisePhone(phone));
}
