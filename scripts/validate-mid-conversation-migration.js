#!/usr/bin/env node
/**
 * validate-mid-conversation-migration.js
 *
 * Validates that mid-conversation sessions won't break during the
 * JS-01 → JS-01v2 migration. Connects to Supabase, finds active
 * (non-idle) sessions, and checks each one for compatibility with
 * the new CEO Router's expected values.
 *
 * Usage:
 *   node scripts/validate-mid-conversation-migration.js
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL   — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Service-role key (bypasses RLS)
 *
 * Exit codes:
 *   0 — all active sessions are valid for migration
 *   1 — one or more sessions have incompatible state
 *
 * Requirements: 19.2 — Design §Migration Strategy
 */

const { createClient } = require('@supabase/supabase-js');

// --- Configuration ---

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    '❌ Missing required env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
  );
  process.exit(1);
}

// Valid last_intent values recognized by JS-01v2's CEO Router (Req 1.2)
const VALID_INTENTS = new Set([
  'idle',
  'welcome',
  'complaint_collecting',
  'complaint_confirming',
  'blood_collecting',
  'blood_confirming',
  'donor_pending_response',
  'seeker_confirming',
  'donor_registration',
  'donor_confirming',
  'status_check',
  'info_query',
]);

// Valid active_agent values for JS-01v2 (Req 1.3)
const VALID_AGENTS = new Set(['ceo', 'complaint', 'blood', 'donor', 'info']);

// --- Main ---

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log('🔍 Querying active (non-idle) conversation sessions...\n');

  const { data: sessions, error } = await supabase
    .from('conversation_sessions')
    .select('session_id, last_intent, active_agent, collected_data, last_activity_at')
    .neq('last_intent', 'idle');

  if (error) {
    console.error('❌ Supabase query failed:', error.message);
    process.exit(1);
  }

  const total = sessions.length;
  const invalid = [];

  console.log(`📊 Found ${total} active session(s) (last_intent != 'idle')\n`);

  for (const session of sessions) {
    const issues = [];

    // Check 1: last_intent is a valid value recognized by JS-01v2
    if (!VALID_INTENTS.has(session.last_intent)) {
      issues.push(
        `last_intent="${session.last_intent}" is not recognized by JS-01v2 CEO Router`
      );
    }

    // Check 2: collected_data is valid JSON (Supabase returns it parsed,
    // but if stored as a string it might be malformed)
    if (session.collected_data !== null && session.collected_data !== undefined) {
      if (typeof session.collected_data === 'string') {
        try {
          JSON.parse(session.collected_data);
        } catch {
          issues.push(
            `collected_data is not valid JSON: "${String(session.collected_data).slice(0, 80)}..."`
          );
        }
      }
      // If it's already an object (parsed by supabase-js), it's valid
    }

    // Check 3: active_agent (if set) is one of the valid agents
    if (
      session.active_agent !== null &&
      session.active_agent !== undefined &&
      session.active_agent !== '' &&
      !VALID_AGENTS.has(session.active_agent)
    ) {
      issues.push(
        `active_agent="${session.active_agent}" is not a valid JS-01v2 agent`
      );
    }

    if (issues.length > 0) {
      invalid.push({ session_id: session.session_id, issues });
    }
  }

  // --- Report ---

  const valid = total - invalid.length;

  console.log('━'.repeat(60));
  console.log(`  Total active sessions:   ${total}`);
  console.log(`  ✅ Valid for migration:   ${valid}`);
  console.log(`  ❌ Invalid (need fix):    ${invalid.length}`);
  console.log('━'.repeat(60));

  if (invalid.length > 0) {
    console.log('\n⚠️  Invalid sessions:\n');
    for (const entry of invalid) {
      console.log(`  Session: ${entry.session_id}`);
      for (const issue of entry.issues) {
        console.log(`    • ${issue}`);
      }
      console.log('');
    }
    console.log(
      '💡 Fix: Reset invalid sessions to idle before switching to JS-01v2,\n' +
      '   or update the session values to match the new schema.\n'
    );
    process.exit(1);
  } else {
    console.log('\n✅ All active sessions are compatible with JS-01v2. Safe to migrate.\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
