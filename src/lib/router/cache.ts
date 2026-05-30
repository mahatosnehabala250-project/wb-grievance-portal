/**
 * Router Classifier Cache (task 18.2).
 *
 * Normalize + lookup + write-through helpers for the `router_classifier_cache`
 * table (migration `20260201_001_router_classifier_cache_and_session_columns`).
 * The cache lets the Hybrid CEO Router avoid redundant Gemini Flash calls for
 * repeated or near-identical messages within a TTL window (Design §v1.1.1).
 *
 * Table shape (authoritative):
 *   router_classifier_cache (
 *     id               uuid PK,
 *     normalized_query text NOT NULL UNIQUE,
 *     intent           text NOT NULL,
 *     confidence       float NOT NULL,
 *     created_at       timestamptz NOT NULL DEFAULT now(),
 *     expires_at       timestamptz NOT NULL DEFAULT now() + interval '7 days'
 *   )
 *
 * The cache key is the *normalized query text* itself (not a hash) — the table
 * stores `normalized_query` directly with a UNIQUE constraint. {@link normalizeQuery}
 * produces a stable key so whitespace / case / punctuation variants collapse to
 * one row (Property 16: classifier cache idempotence).
 *
 * These functions take an injectable Supabase client so they are testable
 * against a mock and reusable from both API routes and scripts.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.1 (normalization + lookup)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 20.3, 20.4
 */

import type { Intent } from './classifier';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A cache lookup result — the cached decision, or null on miss/expiry. */
export interface CachedDecision {
  intent: string;
  confidence: number;
}

/**
 * Minimal subset of the Supabase client surface this module relies on.
 *
 * Declared structurally (rather than importing `SupabaseClient`) so callers can
 * inject the real `@supabase/supabase-js` client OR a lightweight mock in tests
 * without a type mismatch.
 */
export interface SupabaseLike {
  from(table: string): {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        gt: (column: string, value: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
    upsert: (
      values: Record<string, unknown>,
      options?: { onConflict?: string },
    ) => Promise<{ data: unknown; error: unknown }>;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default cache TTL in days (Design §v1.1.1 — 7-day write-through). */
export const DEFAULT_TTL_DAYS = 7;

const TABLE = 'router_classifier_cache';

/**
 * Punctuation strip set. We remove ASCII punctuation and common Unicode
 * punctuation (including the Devanagari danda `।` and Bengali/Devanagari
 * double danda `॥`) so "blood chahiye!" and "blood chahiye" hash identically.
 * Letters, digits, and combining marks across all scripts are preserved.
 */
const PUNCTUATION_RE = /[!-/:-@[-`{-~\u00A1-\u00BF\u2000-\u206F\u0964\u0965]/gu;

/** Runs of any Unicode whitespace (incl. non-breaking space). */
const WHITESPACE_RE = /\s+/gu;

// ─── Normalization ─────────────────────────────────────────────────────────

/**
 * Normalize a raw message into a stable cache key.
 *
 * Steps (order matters):
 *   1. Unicode NFC normalization (canonical composition).
 *   2. Lowercase (locale-insensitive).
 *   3. Strip punctuation (ASCII + common Unicode + danda marks).
 *   4. Collapse all whitespace runs to a single space.
 *   5. Trim leading / trailing whitespace.
 *
 * Pure function — same input always yields the same output.
 *
 * @example normalizeQuery("  Blood   CHAHIYE!! ") // => "blood chahiye"
 */
export function normalizeQuery(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(PUNCTUATION_RE, ' ')
    .replace(WHITESPACE_RE, ' ')
    .trim();
}

// ─── Cache I/O ───────────────────────────────────────────────────────────────

/**
 * Look up a non-expired cache entry for a normalized query.
 *
 * Queries `router_classifier_cache WHERE normalized_query = $1 AND expires_at > now()`.
 * Returns `{ intent, confidence }` on a fresh hit, or `null` on a miss, an
 * expired row, or any DB error (fail-soft: a cache error must never break the
 * router — the caller will just classify fresh).
 *
 * @param normalizedQuery Result of {@link normalizeQuery}.
 * @param supabase        Injected Supabase client.
 */
export async function lookupCache(
  normalizedQuery: string,
  supabase: SupabaseLike,
): Promise<CachedDecision | null> {
  if (!normalizedQuery) return null;

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from(TABLE)
      .select('intent, confidence')
      .eq('normalized_query', normalizedQuery)
      .gt('expires_at', nowIso)
      .maybeSingle();

    if (error || !data) return null;

    const row = data as { intent?: unknown; confidence?: unknown };
    if (typeof row.intent !== 'string') return null;

    return {
      intent: row.intent,
      confidence: typeof row.confidence === 'number' ? row.confidence : Number(row.confidence) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Write (upsert) a classifier decision into the cache with a TTL.
 *
 * Upserts on the UNIQUE `normalized_query` column so repeated stores for the
 * same key refresh the decision, confidence, and expiry rather than inserting
 * duplicates. Fail-soft: a write error is swallowed (the decision was already
 * computed and returned to the user; a missed cache write only costs a future
 * recompute).
 *
 * @param normalizedQuery Result of {@link normalizeQuery}.
 * @param intent          The classified intent.
 * @param confidence      Confidence in [0, 1].
 * @param supabase        Injected Supabase client.
 * @param ttlDays         TTL in days (default 7).
 */
export async function storeCache(
  normalizedQuery: string,
  intent: Intent | string,
  confidence: number,
  supabase: SupabaseLike,
  ttlDays: number = DEFAULT_TTL_DAYS,
): Promise<void> {
  if (!normalizedQuery) return;

  try {
    const now = Date.now();
    const expiresAt = new Date(now + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from(TABLE).upsert(
      {
        normalized_query: normalizedQuery,
        intent,
        confidence,
        expires_at: expiresAt,
      },
      { onConflict: 'normalized_query' },
    );
  } catch {
    // Fail-soft — a cache write failure must not surface to the router.
  }
}
