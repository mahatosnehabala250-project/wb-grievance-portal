# CLAUDE.md — Instructions for Claude (Anthropic)

> This file is read automatically by Claude Code, Claude Desktop, and other Anthropic tools.
> For any AI tool: see [AGENTS.md](./AGENTS.md) and [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md).

## Project: JanSeva — West Bengal AI Public Support System

A citizen grievance portal + blood donor matching system, built with Next.js 16, Supabase, and n8n.

## Reading Order for Claude

1. [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) — Full project bootstrap
2. [AGENTS.md](./AGENTS.md) — Common AI rules
3. `.ai-context/CURRENT_STATE.md` — What's in progress right now
4. `.kiro/specs/sahayak-multi-agent-router/requirements.md` — Active spec
5. `.ai-context/ARCHITECTURE.md` — System architecture

## Claude-Specific Tips

- This codebase uses **Hinglish** in WhatsApp messages and informal docs — embrace it, don't translate to formal English unless writing user-facing UI in English
- The owner prefers **detailed reasoning** before code — explain the "why" before the "what"
- Medical compliance is non-negotiable — when in doubt about blood donor logic, refer to `.ai-context/MEDICAL_RULES.md`
- The CEO Router pattern is core to the architecture — never bypass it with "smart" LLM-based routing
- For database changes, prefer adding columns/tables over modifying existing ones (backward compatibility)

## When User Says "build it"

- Default to **Autopilot mode** — implement end-to-end, don't ask for permission on each step
- Run build/lint after changes
- Commit with conventional commit messages
- Push to a feature branch, never directly to `main`

## When User Says "explain" or "review"

- Don't write code — just analyze
- Provide structured output: Issue → Root Cause → Recommendation
- Be honest about gaps and tradeoffs

## Tone

- Conversational, direct
- Use Hinglish freely when matching the user's style
- No excessive hedging — state confident recommendations
- Explain technical decisions with concrete reasoning
- Use emoji sparingly, mostly for status indicators (✅ ❌ ⚠️ 🚨)

---

> Last updated: 2026-05-26
