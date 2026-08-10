#!/usr/bin/env node
/**
 * Sync AI context files (PROJECT_CONTEXT.md, AGENTS.md, .ai-context/*.md)
 * to the Supabase ai_project_context table.
 *
 * Run: node scripts/sync-context-to-supabase.js
 *
 * Env vars required:
 *   SUPABASE_URL          (e.g. https://sxdtipaspfolrpqrwadt.supabase.co)
 *   SUPABASE_SERVICE_KEY  (service role key — never anon)
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://sxdtipaspfolrpqrwadt.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_KEY env var.');
  process.exit(1);
}

// Files to sync — (category, key, file path)
const FILES = [
  ['bootstrap', 'project-context', 'PROJECT_CONTEXT.md'],
  ['bootstrap', 'agents-md', 'AGENTS.md'],
  ['bootstrap', 'claude-md', 'CLAUDE.md'],
  ['bootstrap', 'cursorrules', '.cursorrules'],
  ['bootstrap', 'copilot-instructions', '.github/copilot-instructions.md'],
  ['overview', 'project-overview', '.ai-context/PROJECT_OVERVIEW.md'],
  ['architecture', 'system-architecture', '.ai-context/ARCHITECTURE.md'],
  ['schema', 'database-schema', '.ai-context/DATABASE_SCHEMA.md'],
  ['workflow', 'n8n-workflows', '.ai-context/N8N_WORKFLOWS.md'],
  ['api', 'endpoints', '.ai-context/API_ENDPOINTS.md'],
  ['state', 'current', '.ai-context/CURRENT_STATE.md'],
  ['decision', 'adrs', '.ai-context/DECISIONS.md'],
  ['compliance', 'medical-rules', '.ai-context/MEDICAL_RULES.md'],
];

const ROOT = path.resolve(__dirname, '..');

async function upsert(category, key, filePath) {
  const fullPath = path.join(ROOT, filePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`  ⚠️  Skipping ${filePath} (not found)`);
    return;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const title = (content.match(/^#\s+(.+)$/m) || [, key])[1];

  const body = {
    category,
    key,
    title,
    content,
    metadata: {
      source_file: filePath,
      char_count: content.length,
      synced_at: new Date().toISOString(),
    },
    is_active: true,
    updated_at: new Date().toISOString(),
    updated_by: 'sync-script',
  };

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_project_context?on_conflict=category,key`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error(`  ❌ ${filePath} → ${res.status}: ${err}`);
    return;
  }
  console.log(`  ✅ ${filePath} → ${category}/${key}`);
}

(async () => {
  console.log('Syncing AI context to Supabase...');
  for (const [cat, key, file] of FILES) {
    await upsert(cat, key, file);
  }
  console.log('Done.');
})();
