import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

import { lookupOrClassify, type DbClient, type Lang } from '@/lib/router/cache';
import { classify } from '@/lib/router/classifier';

/**
 * POST /api/router/classify  (n8n internal)
 *
 * The LLM-fallback leg of the Hybrid CEO Router (Design §v1.1.1, §v1.1.15).
 * The CEO Router Code Node calls this endpoint only when the deterministic v1
 * rules produce no confident decision and the session is not in a hot-locked
 * state. It is a thin HTTP wrapper around `lookupOrClassify` (write-through
 * `router_classifier_cache` + Gemini Flash fallback): a cache hit reuses the
 * cached decision and bumps `hit_count` without calling Gemini (Req 20.4), and
 * a miss classifies once and writes through with a 7-day TTL (Req 20.2/20.3).
 *
 * A raw `pg` pool is used (rather than the Supabase REST builder) because
 * `lookupOrClassify` relies on an atomic `UPDATE ... RETURNING` cache lookup
 * and a jsonb `INSERT ... ON CONFLICT DO UPDATE` upsert that aren't expressible
 * through the Supabase query builder — mirroring the other n8n-internal pg
 * routes in this repo (e.g. blood-requests/donor-respond).
 *
 * Auth: `X-N8N-SECRET` header must match `process.env.N8N_WEBHOOK_SECRET`.
 *
 * Request body:
 * {
 *   message: string,            // raw inbound WhatsApp text
 *   language?: "en" | "hi" | "bn", // language hint (defaults to "en")
 *   trace_id?: string           // cross-node correlation id (Design §v1.1.8)
 * }
 *
 * Response (Design §v1.1.15 — `{ ok, data: ClassifierOutput }`):
 * - Success: { ok: true, data: { agent, secondary_agent, confidence, rationale, fromCache } }
 * - Bad input: { ok: false, error: "VALIDATION_FAILED", message } (400)
 * - Bad/missing secret: { ok: false, error: "Unauthorized" } (401)
 *
 * Requirements: 20.2, 20.4, 20.7 — Design §v1.1.1, §v1.1.15
 */

const VALID_LANGUAGES: readonly Lang[] = ['en', 'hi', 'bn'] as const;

/**
 * Whether a usable direct-Postgres connection string is configured. On a
 * REST-only / Supabase-managed setup (DATABASE_URL = "supabase://use-rest-api")
 * there is no pg endpoint, so the write-through classifier cache is skipped and
 * we classify directly via Gemini (no cache). The router still works; it just
 * does not cache decisions.
 */
function hasPgUrl(): boolean {
  const url = process.env.DATABASE_URL || process.env.DIRECT_URL || '';
  return /^postgres(ql)?:\/\//i.test(url);
}

// Lazy pool — only constructed when a real pg URL is configured, so module
// load never fails on a REST-only deployment.
let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
    });
  }
  return _pool;
}

/**
 * Adapt the node-postgres `Pool` to the structural {@link DbClient} surface
 * that `lookupOrClassify` injects. Keeps the call site decoupled from pg's
 * heavily-overloaded `query` typings.
 */
const db: DbClient = {
  async query<Row = Record<string, unknown>>(sql: string, params?: unknown[]) {
    const result = await getPool().query(sql, params as unknown[] | undefined);
    return { rows: result.rows as Row[] };
  },
};

export async function POST(request: NextRequest) {
  try {
    // ─── Auth: verify n8n webhook secret ───
    const secret = request.headers.get('x-n8n-secret');
    const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // ─── Parse body ───
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'request body must be a JSON object' },
        { status: 400 }
      );
    }

    const { message, language, trace_id } = body as {
      message?: unknown;
      language?: unknown;
      trace_id?: unknown;
    };

    // ─── Validation ───
    if (typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'message is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    // language is optional; default to "en" but reject any provided invalid value.
    let lang: Lang = 'en';
    if (language !== undefined && language !== null) {
      if (typeof language !== 'string' || !VALID_LANGUAGES.includes(language as Lang)) {
        return NextResponse.json(
          {
            ok: false,
            error: 'VALIDATION_FAILED',
            message: `language must be one of: ${VALID_LANGUAGES.join(', ')}`,
          },
          { status: 400 }
        );
      }
      lang = language as Lang;
    }

    // trace_id is optional; coerce to a string for cross-node correlation.
    if (trace_id !== undefined && trace_id !== null && typeof trace_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'VALIDATION_FAILED', message: 'trace_id must be a string' },
        { status: 400 }
      );
    }
    const traceId = typeof trace_id === 'string' ? trace_id : '';

    // ─── Cache lookup + classify (write-through, Gemini Flash fallback) ───
    // When a real Postgres URL is configured we use the write-through cache.
    // On a REST-only / Hobby deployment (no pg endpoint) — or if the cache DB
    // is transiently unavailable — we degrade gracefully to a direct Gemini
    // classification with no caching, so the router never 500s.
    let result;
    if (hasPgUrl()) {
      try {
        result = await lookupOrClassify(message, lang, traceId, db);
      } catch (cacheErr) {
        console.warn('[router/classify] cache unavailable, classifying without cache:', cacheErr);
        const out = await classify({ message, language: lang, traceId });
        result = {
          agent: out.agent,
          secondary_agent: out.secondary_agent ?? null,
          confidence: out.confidence,
          rationale: out.rationale,
          fromCache: false,
        };
      }
    } else {
      const out = await classify({ message, language: lang, traceId });
      result = {
        agent: out.agent,
        secondary_agent: out.secondary_agent ?? null,
        confidence: out.confidence,
        rationale: out.rationale,
        fromCache: false,
      };
    }

    return NextResponse.json({
      ok: true,
      data: {
        agent: result.agent,
        secondary_agent: result.secondary_agent,
        confidence: result.confidence,
        rationale: result.rationale,
        fromCache: result.fromCache,
      },
    });
  } catch (error) {
    console.error('[router/classify] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
