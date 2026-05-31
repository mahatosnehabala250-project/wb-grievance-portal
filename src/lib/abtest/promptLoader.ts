/**
 * Prompt loader — sticky, weighted A/B selection of specialist-agent prompts.
 *
 * Loads the active prompt versions for one specialist agent from
 * `agent_prompt_versions`, then defers to {@link pickVersion} (the pure sticky
 * selector in `./sticky`, task 31.1) to deterministically pick exactly one
 * version for the given `sessionId`. The same session always resolves to the
 * same prompt within a release (Property 33), while traffic across many
 * sessions splits in proportion to each row's `weight`.
 *
 * Authoritative table shape (`agent_prompt_versions`, migration
 * `20260201_004`, Req 34.14 / Design §v1.1.14):
 *   agent_prompt_versions (
 *     id         uuid PRIMARY KEY,
 *     agent      text   NOT NULL CHECK (agent IN ('complaint','blood','donor','info')),
 *     version    text   NOT NULL,            -- human-facing version label
 *     prompt_md  text   NOT NULL,            -- the prompt markdown payload
 *     weight     float  NOT NULL DEFAULT 1,  -- relative selection weight
 *     active     boolean NOT NULL DEFAULT false,
 *     status     text   NOT NULL DEFAULT 'staging',
 *     UNIQUE (agent, version)
 *   )
 *
 * Design points faithful to §v1.1.14:
 *   - Only `active = true` rows are fetched; staging rows (`active = false`,
 *     `weight = 0`) are excluded from the selection pool at the SQL level, and
 *     {@link pickVersion} further drops anything with `weight <= 0`.
 *   - When `opts.compact` is set (driven by the v1.1.11 token-budget mode), the
 *     query is narrowed to the registered `version = 'compact'` variants, so
 *     compact mode is itself A/B-able if several compact variants are
 *     registered (Design §v1.1.14, Req 30.5).
 *   - The DB client is INJECTED (pg-style `query(sql, params) => { rows }`),
 *     following the convention in `src/lib/router/cache.ts`, so this function
 *     is unit-testable against an in-memory mock without a live database.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.14 (prompt loader)
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.15
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 33.1
 */

import { pickVersion, type Versioned } from './sticky';

// ─── Types ───────────────────────────────────────────────────────────────────

/** The four specialist agents that own prompt versions (Design §v1.1.14). */
export type Agent = 'complaint' | 'blood' | 'donor' | 'info';

/** Optional knobs for {@link loadPrompt}. */
export interface LoadPromptOptions {
  /**
   * When true, restrict the selection pool to the registered
   * `version = 'compact'` variants (v1.1.11 token-budget mode, Req 30.5).
   */
  compact?: boolean;
}

/**
 * The resolved prompt for a session: the chosen markdown plus the version
 * label that produced it (Design §v1.1.14 `LoadedPrompt`).
 */
export interface LoadedPrompt {
  promptMd: string;
  version: string;
}

/** A single row returned by a DB query. */
export interface DbQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
}

/**
 * Minimal injectable DB client surface.
 *
 * Matches the node-postgres `Pool`/`Client` shape (`query(text, params)`
 * resolving to `{ rows }`), the same structural contract used by
 * `src/lib/router/cache.ts`. Any object exposing a compatible `query` method
 * (a real pg client in production, a lightweight mock in tests, or a thin
 * Supabase adapter) satisfies it.
 */
export interface DbClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<DbQueryResult<Row>>;
}

/** The columns selected from `agent_prompt_versions`. */
interface PromptVersionRow {
  id: string;
  version: string;
  prompt_md: string;
  weight: number | string;
  active: boolean;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Thrown when an agent has no eligible (`active = true`, `weight > 0`) prompt
 * version to select from. {@link pickVersion} raises a generic error for the
 * empty pool; this typed variant lets callers distinguish "misconfigured /
 * unseeded agent" from other failures and fall back (e.g. to a hard-coded
 * skeleton prompt) without string-matching error messages.
 */
export class NoActivePromptVersionError extends Error {
  /** The agent that had no eligible version. */
  readonly agent: Agent;
  /** Whether the lookup was restricted to compact variants. */
  readonly compact: boolean;

  constructor(agent: Agent, compact: boolean) {
    super(
      `no active prompt version registered for agent='${agent}'` +
        (compact ? " (compact)" : ''),
    );
    this.name = 'NoActivePromptVersionError';
    this.agent = agent;
    this.compact = compact;
  }
}

// ─── SQL ─────────────────────────────────────────────────────────────────────

/**
 * Select the active prompt versions for one agent. `agent` is bound as `$1`;
 * the optional `AND version = 'compact'` clause is a fixed literal (never user
 * input), so the interpolation carries no injection risk.
 */
function buildSelectSql(compact: boolean): string {
  return `SELECT id, version, prompt_md, weight, active
       FROM agent_prompt_versions
      WHERE agent = $1 AND active = true${compact ? " AND version = 'compact'" : ''}`;
}

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load the prompt for `agent` and stickily pick one active version for
 * `sessionId` (Design §v1.1.14, Req 33.1).
 *
 * Flow:
 *   1. `SELECT ... FROM agent_prompt_versions WHERE agent = $1 AND active`
 *      (optionally narrowed to compact variants).
 *   2. Map rows → {@link Versioned}<string> with `payload = prompt_md`.
 *   3. Defer to {@link pickVersion} for the deterministic, weighted choice.
 *
 * Pure with respect to the DB result: for a fixed `sessionId` and version set,
 * the same version is always returned (the stickiness Property 33 relies on).
 *
 * @param agent     Specialist agent whose prompt to load.
 * @param sessionId Stable session key used for the sticky bucket.
 * @param db        Injected pg-style DB client.
 * @param opts      Optional flags (e.g. `compact`).
 * @returns The chosen prompt markdown and its version label.
 * @throws {NoActivePromptVersionError} If no eligible version exists.
 */
export async function loadPrompt(
  agent: Agent,
  sessionId: string,
  db: DbClient,
  opts?: LoadPromptOptions,
): Promise<LoadedPrompt> {
  const compact = opts?.compact === true;

  const result = await db.query<PromptVersionRow>(buildSelectSql(compact), [agent]);

  const versions: Versioned<string>[] = result.rows.map((r) => ({
    id: r.id,
    version: r.version,
    weight: Number(r.weight),
    active: r.active,
    payload: r.prompt_md,
  }));

  let picked: Versioned<string>;
  try {
    picked = pickVersion(sessionId, versions);
  } catch {
    // pickVersion throws a generic Error on an empty eligible pool; rethrow a
    // typed error the caller can branch on and recover from gracefully.
    throw new NoActivePromptVersionError(agent, compact);
  }

  return { promptMd: picked.payload, version: picked.version };
}
