# GitHub Copilot Instructions for JanSeva

This is the **JanSeva (West Bengal AI Public Support System)** — a citizen grievance portal with integrated blood donor matching (Rakta Sahayak).

## Project Bootstrap

**Read these files in order before suggesting code:**
1. `PROJECT_CONTEXT.md` (root)
2. `AGENTS.md` (root)
3. `.ai-context/CURRENT_STATE.md`
4. `.kiro/specs/sahayak-multi-agent-router/requirements.md`

## Stack
- **Frontend:** Next.js 16, React, TypeScript (strict), Tailwind, shadcn/ui
- **Backend:** Supabase (PostgreSQL 17), Prisma ORM
- **Automation:** n8n (workflows prefixed `JS-`)
- **AI:** Google Gemini
- **Hosting:** Vercel + Hostinger

## Code Generation Rules

- TypeScript strict mode — never use `any`
- React Server Components by default
- Tailwind classes only — no inline styles or custom CSS
- Use shadcn/ui components from `@/components/ui/`
- Imports order: external → `@/*` → types
- Error handling: structured try/catch, never silent fail
- Async/await only — no raw promises

## Forbidden Patterns

- Hardcoded API keys, tokens, URLs (use env vars)
- Deleting from `donation_history` (immutable)
- Direct broadcast to all blood donors (use cascade engine JS-15B)
- Bypassing pre-donation health screening
- Trusting LLM-detected intent over `conversation_sessions.last_intent`
- Exposing donor phone numbers in non-admin views

## Required Patterns

- All Supabase calls go through `src/lib/supabase.ts`
- All n8n triggers go through dedicated webhook endpoints in `src/app/api/n8n/`
- Donor phones masked: `98XXX XX234` in non-admin views
- Conventional Commits in commit messages
- Feature branches: `feat/<name>`, `fix/<name>`, `chore/<name>`

## Naming Conventions

- DB tables: `snake_case` plural — `blood_donors`, `conversation_sessions`
- Components: `PascalCase` — `ComplaintCard.tsx`
- API routes: `/api/<resource>/<action>`
- Ticket IDs: `WB-YYYY-XXXXX`
- n8n workflows: `JS-NN: Name`

## When Suggesting

- Match existing code patterns in `src/`
- Reuse hooks from `src/hooks/`
- Use Prisma for type-safe DB access where possible
- Use Supabase Realtime for live updates
- WhatsApp messages: Hinglish + Bengali support, conversational tone
