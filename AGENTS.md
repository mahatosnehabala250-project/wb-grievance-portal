# AGENTS.md — Instructions for AI Agents Working on This Repo

> Universal entry point for AI coding agents (Cursor, Claude Code, Codex, etc.)
> See [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) for full project context.

## Quick Start for AI

1. **Read** [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) first
2. **Check** the active spec at `.kiro/specs/sahayak-multi-agent-router/`
3. **Review** `.ai-context/CURRENT_STATE.md` for what's in progress
4. **Follow** the conventions in [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)

## Project at a Glance

- **Name:** JanSeva (West Bengal AI Public Support System)
- **Stack:** Next.js 16 + Supabase + n8n + Gemini AI
- **Purpose:** Citizen grievance portal + Blood donor matching (Rakta Sahayak)

## What You Can Do

- ✅ Read any code in `src/`
- ✅ Add new API routes under `src/app/api/`
- ✅ Add new pages under `src/app/`
- ✅ Update specs in `.kiro/specs/`
- ✅ Add/update docs in `.ai-context/`
- ✅ Run `npm run dev`, `npm run build`, `npm run lint`
- ✅ Query Supabase via the REST API (read-only with anon key)
- ✅ Read n8n workflows via API (with API key from env)

## What You MUST NOT Do

- ❌ Hard-code API keys or secrets — use `.env` and `process.env.X`
- ❌ Delete rows from `donation_history` (immutable audit trail)
- ❌ Broadcast to all matching blood donors directly — always use cascade engine (JS-15B)
- ❌ Manually edit production n8n workflows in the UI — use `deploy-workflows-v2.js`
- ❌ Skip pre-donation health screening before marking a donor as accepted
- ❌ Ignore session state — `conversation_sessions.last_intent` is the source of truth for routing

## Required Reading Before Big Changes

| Type of change | Read this first |
|---|---|
| Database schema | `.ai-context/DATABASE_SCHEMA.md` + `supabase-migration.sql` |
| n8n workflow | `.ai-context/N8N_WORKFLOWS.md` |
| Multi-agent / routing | `.kiro/specs/sahayak-multi-agent-router/requirements.md` |
| Medical / blood logic | `.ai-context/MEDICAL_RULES.md` |
| API endpoint changes | `.ai-context/API_ENDPOINTS.md` |

## Build / Test Commands

```bash
# Install
bun install            # primary
npm install            # fallback

# Dev
npm run dev            # http://localhost:3000

# Build
npm run build

# Lint
npm run lint

# Deploy n8n workflows
node deploy-workflows-v2.js

# Validate workflows
node validate-workflows.js
```

## Code Style

- TypeScript strict mode — no `any` unless absolutely necessary
- React Server Components by default; Client Components only when needed
- Tailwind CSS — use existing utility classes; avoid custom CSS
- shadcn/ui components in `src/components/ui/`
- Imports: alphabetical, grouped (external → internal → types)
- Error handling: try/catch with structured logging, never silent fail

## When Unsure

1. Check if there's an existing pattern in `src/` doing something similar — match that pattern
2. Check `.ai-context/DECISIONS.md` for past architecture decisions
3. Check the active spec at `.kiro/specs/sahayak-multi-agent-router/`
4. If still unsure, leave a `TODO(ai):` comment explaining the assumption and continue

---

> Last updated: 2026-05-26
