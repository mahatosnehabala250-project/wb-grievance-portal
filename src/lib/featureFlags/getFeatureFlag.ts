/**
 * Feature Flag Resolution — getFeatureFlag / isFeatureEnabled
 *
 * Reads runtime configuration from the `system_config` table with a 60-second
 * in-memory cache to avoid hitting the database on every request.
 *
 * Resolution order (first hit wins):
 *   1. system_config row WHERE key = $1 (cached for 60s)
 *   2. process.env[$1]
 *   3. Hardcoded DEFAULTS map
 *   4. Caller-provided defaultValue or 'false'
 *
 * Requirements: 11.3, 11.5 — Design §Components → Status / Info Code Path
 */

import { createClient } from '@supabase/supabase-js';

// ─── Supabase client (same pattern as other files in the project) ───
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Hardcoded defaults (fallback when DB and env are both missing) ───
const DEFAULTS: Record<string, string> = {
  INFO_USE_EMBEDDINGS: 'false',
  ACTIVE_WORKFLOW_VERSION: 'v2',
  DONOR_CASCADE_ENABLED: 'true',
  MAX_CASCADE_TIER: '4',
};

// ─── In-memory cache with 60s TTL ───
interface CacheEntry {
  value: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds
const cache = new Map<string, CacheEntry>();

/**
 * Retrieve a feature flag / config value by key.
 *
 * @param key - The configuration key (e.g., 'INFO_USE_EMBEDDINGS')
 * @param defaultValue - Optional fallback if not found anywhere (defaults to 'false')
 * @returns The resolved string value
 */
export async function getFeatureFlag(
  key: string,
  defaultValue?: string
): Promise<string> {
  // 1. Check in-memory cache
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  // 2. Query system_config table
  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', key)
      .single();

    if (!error && data?.value !== undefined) {
      const value = data.value as string;
      cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    }
  } catch {
    // DB lookup failed — fall through to env/defaults
  }

  // 3. Check process.env
  const envValue = process.env[key];
  if (envValue !== undefined) {
    cache.set(key, { value: envValue, expiresAt: Date.now() + CACHE_TTL_MS });
    return envValue;
  }

  // 4. Hardcoded defaults map
  if (key in DEFAULTS) {
    const value = DEFAULTS[key];
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  // 5. Caller-provided default or 'false'
  const fallback = defaultValue ?? 'false';
  cache.set(key, { value: fallback, expiresAt: Date.now() + CACHE_TTL_MS });
  return fallback;
}

/**
 * Convenience helper — returns true if the flag value is the string 'true'.
 *
 * @param key - The configuration key
 * @returns true if the resolved value is 'true', false otherwise
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  const value = await getFeatureFlag(key);
  return value === 'true';
}

/**
 * Invalidate a specific cache entry (useful after admin updates a flag).
 */
export function invalidateFlag(key: string): void {
  cache.delete(key);
}

/**
 * Clear the entire feature flag cache (useful for testing).
 */
export function clearFlagCache(): void {
  cache.clear();
}
