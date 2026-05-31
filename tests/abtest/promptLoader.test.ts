// Feature: sahayak-multi-agent-router, Task 31.2 — A/B prompt loader (Req 33.1)
//
// Unit tests for `loadPrompt`, which loads the active prompt versions for a
// specialist agent from `agent_prompt_versions` and defers to the pure sticky
// selector `pickVersion` (task 31.1) for a deterministic, weighted choice.
//
// Pure-logic tests — the DB client is an injectable in-memory mock, so no live
// database is required (Design §v1.1.14, §v1.1.15).

import { describe, it, expect } from 'vitest';

import {
  loadPrompt,
  NoActivePromptVersionError,
  type DbClient,
  type DbQueryResult,
} from '../../src/lib/abtest/promptLoader';

interface Row {
  id: string;
  version: string;
  prompt_md: string;
  weight: number | string;
  active: boolean;
}

/**
 * Build an in-memory pg-style client over a fixed set of rows. It mimics the
 * loader's SQL: filter by `agent = $1 AND active = true`, plus the optional
 * `version = 'compact'` clause detected from the SQL text.
 */
function makeDb(
  rowsByAgent: Record<string, Row[]>,
): DbClient & { calls: { sql: string; params?: unknown[] }[] } {
  const calls: { sql: string; params?: unknown[] }[] = [];
  return {
    calls,
    async query<R = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<DbQueryResult<R>> {
      calls.push({ sql, params });
      const agent = String(params?.[0]);
      const compact = /version = 'compact'/.test(sql);
      const rows = (rowsByAgent[agent] ?? [])
        .filter((r) => r.active)
        .filter((r) => (compact ? r.version === 'compact' : true));
      return { rows: rows as unknown as R[] };
    },
  };
}

describe('loadPrompt — selection + mapping', () => {
  it('returns the picked prompt markdown and its version label', async () => {
    const db = makeDb({
      complaint: [
        { id: 'a', version: 'full', prompt_md: '# full', weight: 1, active: true },
      ],
    });

    const res = await loadPrompt('complaint', 'session-xyz', db);
    expect(res).toEqual({ promptMd: '# full', version: 'full' });
  });

  it('binds the agent as $1 and queries agent_prompt_versions', async () => {
    const db = makeDb({
      blood: [{ id: 'b', version: 'full', prompt_md: 'b', weight: 1, active: true }],
    });

    await loadPrompt('blood', 's1', db);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].params).toEqual(['blood']);
    expect(db.calls[0].sql).toContain('FROM agent_prompt_versions');
    expect(db.calls[0].sql).toContain('active = true');
    expect(db.calls[0].sql).not.toContain("version = 'compact'");
  });

  it('coerces numeric/string weights from the DB driver', async () => {
    // node-postgres returns numeric columns as strings; the loader must Number()
    // them so pickVersion's weighted math works.
    const db = makeDb({
      donor: [
        { id: 'd1', version: 'full', prompt_md: 'full', weight: '0', active: true },
        { id: 'd2', version: 'compact', prompt_md: 'compact', weight: '5', active: true },
      ],
    });

    // weight '0' is ineligible, so the only eligible version ('compact') wins
    // regardless of the session key.
    const res = await loadPrompt('donor', 'any-session', db);
    expect(res.version).toBe('compact');
    expect(res.promptMd).toBe('compact');
  });
});

describe('loadPrompt — stickiness (Req 33.1, Property 33)', () => {
  it('returns the same version for the same session across calls', async () => {
    const rows: Row[] = [
      { id: '1', version: 'A', prompt_md: 'A', weight: 1, active: true },
      { id: '2', version: 'B', prompt_md: 'B', weight: 1, active: true },
    ];
    const db = makeDb({ info: rows });

    const first = await loadPrompt('info', 'sticky-session', db);
    const second = await loadPrompt('info', 'sticky-session', db);
    const third = await loadPrompt('info', 'sticky-session', db);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('splits distinct sessions across both versions (weighted distribution)', async () => {
    const rows: Row[] = [
      { id: '1', version: 'A', prompt_md: 'A', weight: 1, active: true },
      { id: '2', version: 'B', prompt_md: 'B', weight: 1, active: true },
    ];
    const db = makeDb({ complaint: rows });

    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const res = await loadPrompt('complaint', `session-${i}`, db);
      seen.add(res.version);
    }
    // With 50 distinct keys over two equal-weight versions, both should appear.
    expect(seen).toEqual(new Set(['A', 'B']));
  });
});

describe('loadPrompt — compact mode (Req 30.5)', () => {
  it('narrows the query to the compact variant when opts.compact is set', async () => {
    const db = makeDb({
      donor: [
        { id: 'f', version: 'full', prompt_md: 'full', weight: 1, active: true },
        { id: 'c', version: 'compact', prompt_md: 'compact', weight: 1, active: true },
      ],
    });

    const res = await loadPrompt('donor', 's1', db, { compact: true });
    expect(res.version).toBe('compact');
    expect(res.promptMd).toBe('compact');
    expect(db.calls[0].sql).toContain("version = 'compact'");
  });
});

describe('loadPrompt — graceful failure when no active version', () => {
  it('throws a typed NoActivePromptVersionError for an empty pool', async () => {
    const db = makeDb({ complaint: [] });
    await expect(loadPrompt('complaint', 's1', db)).rejects.toBeInstanceOf(
      NoActivePromptVersionError,
    );
  });

  it('throws NoActivePromptVersionError when only inactive/zero-weight rows exist', async () => {
    const db = makeDb({
      info: [
        { id: '1', version: 'staging', prompt_md: 'x', weight: 0, active: true },
      ],
    });
    const err = await loadPrompt('info', 's1', db).catch((e) => e);
    expect(err).toBeInstanceOf(NoActivePromptVersionError);
    expect((err as NoActivePromptVersionError).agent).toBe('info');
    expect((err as NoActivePromptVersionError).compact).toBe(false);
  });

  it('records compact=true on the error when raised in compact mode', async () => {
    const db = makeDb({ blood: [] });
    const err = await loadPrompt('blood', 's1', db, { compact: true }).catch((e) => e);
    expect(err).toBeInstanceOf(NoActivePromptVersionError);
    expect((err as NoActivePromptVersionError).compact).toBe(true);
  });
});
