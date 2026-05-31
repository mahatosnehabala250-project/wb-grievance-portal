// Feature: sahayak-multi-agent-router, Task 28.4 — Compact-mode prompt registration
//   Design §v1.1.11 (Token Budget per Session) / Req 30.5
//
// Unit tests for `promptRegistry` — the pure builder that turns the prompt
// markdown files under n8n-workflows/prompts/ into `agent_prompt_versions` rows
// for both the `full` and `compact` variants of all four specialist agents.
//
// Pure-logic tests: the file reader is an injected callback, so no filesystem
// or database is required. A second block reads the REAL prompt files from disk
// to assert the compact variants exist and respect the design constraints
// (tool lists preserved, cross-domain redirect dropped).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  AGENTS,
  buildPromptVersionRows,
  promptFileName,
  upsertParams,
  UPSERT_PROMPT_VERSION_SQL,
  type PromptVersionRowInput,
} from '../../src/lib/abtest/promptRegistry';

// ─── promptFileName ────────────────────────────────────────────────────────

describe('promptFileName', () => {
  it('maps the full variant to <agent>.md', () => {
    expect(promptFileName('complaint', 'full')).toBe('complaint.md');
    expect(promptFileName('info', 'full')).toBe('info.md');
  });

  it('maps the compact variant to <agent>.compact.md', () => {
    expect(promptFileName('blood', 'compact')).toBe('blood.compact.md');
    expect(promptFileName('donor', 'compact')).toBe('donor.compact.md');
  });
});

// ─── buildPromptVersionRows ──────────────────────────────────────────────────

/** A reader that returns a deterministic stub keyed by filename. */
function stubReader(): (p: string) => string {
  return (p: string) => `# prompt for ${p}\nbody`;
}

describe('buildPromptVersionRows', () => {
  it('produces exactly one full + one compact row per agent (8 rows)', () => {
    const rows = buildPromptVersionRows(stubReader());
    expect(rows).toHaveLength(AGENTS.length * 2);
    expect(rows).toHaveLength(8);
  });

  it('emits both versions for every agent', () => {
    const rows = buildPromptVersionRows(stubReader());
    for (const agent of AGENTS) {
      const forAgent = rows.filter((r) => r.agent === agent);
      const versions = forAgent.map((r) => r.version).sort();
      expect(versions).toEqual(['compact', 'full']);
    }
  });

  it('registers every row active, weight 1, status active so the loader can pick it', () => {
    const rows = buildPromptVersionRows(stubReader());
    for (const r of rows) {
      expect(r.active).toBe(true);
      expect(r.weight).toBe(1);
      expect(r.status).toBe('active');
    }
  });

  it('loads each row prompt_md from the matching file', () => {
    const seen: string[] = [];
    const rows = buildPromptVersionRows((p) => {
      seen.push(p);
      return `CONTENT:${p}`;
    });
    // The full complaint row reads complaint.md; the compact reads complaint.compact.md.
    const full = rows.find((r) => r.agent === 'complaint' && r.version === 'full');
    const compact = rows.find((r) => r.agent === 'complaint' && r.version === 'compact');
    expect(full?.prompt_md).toBe('CONTENT:complaint.md');
    expect(compact?.prompt_md).toBe('CONTENT:complaint.compact.md');
    expect(seen).toContain('blood.compact.md');
    expect(seen).toContain('info.md');
  });

  it('is deterministic and stably ordered (agent-major, full before compact)', () => {
    const rows = buildPromptVersionRows(stubReader());
    const order = rows.map((r) => `${r.agent}/${r.version}`);
    expect(order).toEqual([
      'complaint/full',
      'complaint/compact',
      'blood/full',
      'blood/compact',
      'donor/full',
      'donor/compact',
      'info/full',
      'info/compact',
    ]);
  });

  it('throws when a prompt file is missing', () => {
    const reader = (p: string) => {
      if (p === 'donor.compact.md') throw new Error('ENOENT');
      return '# ok';
    };
    expect(() => buildPromptVersionRows(reader)).toThrow(/donor\.compact\.md/);
  });

  it('throws when a prompt file is empty or whitespace-only', () => {
    const reader = (p: string) => (p === 'info.compact.md' ? '   \n  ' : '# ok');
    expect(() => buildPromptVersionRows(reader)).toThrow(/info\.compact\.md.*empty/);
  });
});

// ─── upsert payload ──────────────────────────────────────────────────────────

describe('upsert SQL + params', () => {
  it('is an idempotent UPSERT keyed on (agent, version)', () => {
    expect(UPSERT_PROMPT_VERSION_SQL).toContain('INSERT INTO agent_prompt_versions');
    expect(UPSERT_PROMPT_VERSION_SQL).toContain('ON CONFLICT (agent, version)');
    expect(UPSERT_PROMPT_VERSION_SQL).toContain('DO UPDATE SET');
    expect(UPSERT_PROMPT_VERSION_SQL).toContain('updated_at = NOW()');
  });

  it('builds positional params in the documented order', () => {
    const row: PromptVersionRowInput = {
      agent: 'blood',
      version: 'compact',
      prompt_md: '# compact blood',
      weight: 1,
      active: true,
      status: 'active',
    };
    expect(upsertParams(row)).toEqual(['blood', 'compact', '# compact blood', 1, true, 'active']);
  });
});

// ─── real prompt files on disk (design constraints) ──────────────────────────

const PROMPTS_DIR = path.resolve(__dirname, '../../n8n-workflows/prompts');
const readReal = (name: string) => fs.readFileSync(path.join(PROMPTS_DIR, name), 'utf8');

describe('real compact prompt files (Design §v1.1.11)', () => {
  it('builds all 8 rows from the actual files on disk', () => {
    const rows = buildPromptVersionRows((p) => readReal(p));
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      expect(r.prompt_md.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(AGENTS)('compact variant for %s is shorter than full (cut verbosity)', (agent) => {
    const full = readReal(promptFileName(agent, 'full'));
    const compact = readReal(promptFileName(agent, 'compact'));
    expect(compact.length).toBeLessThan(full.length);
  });

  it('compact complaint prompt preserves the four tool names', () => {
    const compact = readReal('complaint.compact.md');
    for (const tool of ['ValidateBlock', 'CheckDuplicate', 'RegisterComplaint', 'SaveSessionState']) {
      expect(compact).toContain(tool);
    }
  });

  it('compact blood prompt preserves its four tool names', () => {
    const compact = readReal('blood.compact.md');
    for (const tool of ['CreateBloodRequest', 'DonorRespond', 'SeekerConfirm', 'SaveSessionState']) {
      expect(compact).toContain(tool);
    }
  });

  it('compact donor prompt preserves its six tool names', () => {
    const compact = readReal('donor.compact.md');
    for (const tool of [
      'RegisterDonor',
      'UpdateDonorStatus',
      'CheckDuplicate',
      'RecordDonation',
      'DeferDonor',
      'SaveSessionState',
    ]) {
      expect(compact).toContain(tool);
    }
  });

  it('compact variants drop the verbose Cross-Domain Redirect block (Design §v1.1.11)', () => {
    for (const agent of ['complaint', 'blood', 'donor'] as const) {
      const compact = readReal(promptFileName(agent, 'compact'));
      expect(compact).not.toContain('## Cross-Domain Redirect');
    }
  });
});
