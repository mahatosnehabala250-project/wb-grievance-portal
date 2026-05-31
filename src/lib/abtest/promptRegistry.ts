/**
 * Prompt-version registry — pure builder for `agent_prompt_versions` rows.
 *
 * Task 28.4 (Compact-mode prompt registration), Design §v1.1.11 / Req 30.5.
 *
 * The four specialist agents (complaint, blood, donor, info) each ship TWO
 * registered prompt versions in `agent_prompt_versions`:
 *
 *   - `version = 'full'`    — the v1 prompt skeleton (`<agent>.md`), used in
 *                             normal token-budget mode.
 *   - `version = 'compact'` — a terse variant (`<agent>.compact.md`) selected by
 *                             the v1.1.14 prompt loader when the v1.1.11
 *                             BudgetGuard sets `compact_mode` for a session that
 *                             is near or over its 24-hour token cap (Req 30.5).
 *
 * The markdown files under `n8n-workflows/prompts/` are the single source of
 * truth — the same files `deploy-workflows-v2.js` injects into the JS-01v2
 * workflow nodes. This module reads them and produces the INSERT payload so the
 * DB copy that {@link loadPrompt} reads from (`prompt_md`) never drifts from the
 * deployed prompt text.
 *
 * This module is intentionally I/O-light and dependency-free: the row builder
 * {@link buildPromptVersionRows} is a pure function over an injected "read this
 * file" callback, so it is unit-testable without a filesystem or a database.
 * The thin CLI wrapper (`scripts/register-prompt-versions.js`) supplies the
 * real `fs.readFileSync` reader and a `pg`/Supabase upsert.
 *
 * Selection semantics this registry must satisfy (see `./sticky`,
 * `./promptLoader`):
 *   - Both rows are `active = true` with `weight = 1` so each is eligible.
 *   - The loader narrows to `version = 'compact'` ONLY when compact mode is on,
 *     so `full` and `compact` never compete in the same selection pool. Within
 *     a mode there is exactly one registered version per agent, which keeps the
 *     sticky weighted pick deterministic.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.11 (Token Budget per Session)
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.14 (prompt loader)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 30.5
 */

import type { Agent } from './promptLoader';

/** The four specialist agents that own prompt versions (Design §v1.1.14). */
export const AGENTS: readonly Agent[] = ['complaint', 'blood', 'donor', 'info'] as const;

/** The two registered version labels per agent (Design §v1.1.11). */
export type PromptVersionLabel = 'full' | 'compact';

/**
 * A row destined for `agent_prompt_versions`. Mirrors the table shape from
 * migration `20260201_004` (Req 34.14) minus the DB-managed `id` / timestamps.
 */
export interface PromptVersionRowInput {
  agent: Agent;
  version: PromptVersionLabel;
  prompt_md: string;
  /** Both variants are eligible at equal weight (one per selection pool). */
  weight: number;
  /** Registered variants go straight to active so the loader can select them. */
  active: boolean;
  /** Lifecycle status column (CHECK in staging|active|archived). */
  status: 'active';
}

/**
 * Map an `(agent, version)` pair to its source markdown filename under
 * `n8n-workflows/prompts/`. The `full` variant is `<agent>.md`; the `compact`
 * variant is `<agent>.compact.md`. Keeping the mapping here (rather than in the
 * CLI) makes the filename convention testable and the single place to change
 * if the layout ever moves.
 */
export function promptFileName(agent: Agent, version: PromptVersionLabel): string {
  return version === 'full' ? `${agent}.md` : `${agent}.${version}.md`;
}

/** Signature of the injected file reader (typically `fs.readFileSync(p,'utf8')`). */
export type ReadPromptFile = (relativePath: string) => string;

/**
 * Build the full set of `agent_prompt_versions` rows for all four agents in
 * both `full` and `compact` variants.
 *
 * Pure with respect to `readFile`: given the same file contents it always
 * returns the same rows, in a stable order (agent-major, full-before-compact),
 * so callers and tests can assert deterministically.
 *
 * @param readFile Reads a prompt file's contents given its path relative to the
 *                 prompts directory (e.g. `"complaint.compact.md"`). Throwing or
 *                 returning empty/whitespace-only content is treated as an error
 *                 so a missing or empty prompt can never be registered.
 * @returns One {@link PromptVersionRowInput} per `(agent, version)` pair — 8 rows.
 * @throws {Error} If any prompt file is missing or its content is blank.
 */
export function buildPromptVersionRows(readFile: ReadPromptFile): PromptVersionRowInput[] {
  const versions: PromptVersionLabel[] = ['full', 'compact'];
  const rows: PromptVersionRowInput[] = [];

  for (const agent of AGENTS) {
    for (const version of versions) {
      const fileName = promptFileName(agent, version);
      let content: string;
      try {
        content = readFile(fileName);
      } catch (err) {
        throw new Error(
          `failed to read prompt file "${fileName}" for agent='${agent}' version='${version}': ${
            (err as Error).message
          }`,
        );
      }
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error(
          `prompt file "${fileName}" for agent='${agent}' version='${version}' is empty`,
        );
      }
      rows.push({
        agent,
        version,
        prompt_md: content,
        weight: 1,
        active: true,
        status: 'active',
      });
    }
  }

  return rows;
}

/**
 * Idempotent upsert SQL for one `agent_prompt_versions` row, keyed on the
 * table's `UNIQUE (agent, version)` constraint (migration `20260201_004`).
 *
 * Re-running registration overwrites `prompt_md`, re-activates the row, and
 * bumps `updated_at` without creating duplicates, so the script is safe to run
 * on every deploy. Parameter order: `[agent, version, prompt_md, weight, active, status]`.
 */
export const UPSERT_PROMPT_VERSION_SQL = `
INSERT INTO agent_prompt_versions (agent, version, prompt_md, weight, active, status)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (agent, version)
DO UPDATE SET
  prompt_md  = EXCLUDED.prompt_md,
  weight     = EXCLUDED.weight,
  active     = EXCLUDED.active,
  status     = EXCLUDED.status,
  updated_at = NOW()
`.trim();

/** Positional parameter array for {@link UPSERT_PROMPT_VERSION_SQL}. */
export function upsertParams(row: PromptVersionRowInput): unknown[] {
  return [row.agent, row.version, row.prompt_md, row.weight, row.active, row.status];
}
