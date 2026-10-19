# Architecture Decision Records (ADRs)

> Append-only log of major architectural decisions and their reasoning.

---

## ADR-001: Multi-Agent CEO Router Pattern

**Date:** 2026-05-26
**Status:** Accepted

### Context
Single AI agent (JS-01) handles all citizen interactions: complaints, blood requests, donor registration, status checks, scheme info. Context window mixes domains. Ambiguous responses ("Yess", "Ok", "Hmm") are misrouted because the agent guesses intent across all flows. System prompt has bloated to handle all tools — model misses important rules.

### Decision
Re-architect into a **CEO Router** (rule-based Code Node, no AI) that reads `conversation_sessions.last_intent` and dispatches messages to one of 4 specialist agents (Complaint, Blood, Donor, Status/Info). Each specialist has a focused prompt and only the tools its domain needs.

### Alternatives Considered

**Option A — Multiple workflows, n8n Execute Workflow node**
- Each agent in its own workflow
- ✅ Clean separation
- ⚠️ Two workflow hops add ~500ms latency
- ⚠️ Session state coordination harder

**Option B — Separate webhook endpoints**
- WhatsApp webhook routes directly to agent webhook
- ✅ Fastest
- ⚠️ Routing logic on the WhatsApp side is harder to maintain

**Option C — Single workflow, Switch Node** *(chosen)*
- One workflow with multiple AI Agent nodes, Switch Node routes
- ✅ Shared session state
- ✅ Atomic deployment
- ✅ No inter-workflow latency
- ✅ Simplest to debug

### Consequences
- One workflow grows large (10+ nodes including agents)
- Mitigated by clear naming and separating prompts into versioned files in `n8n-workflows/prompts/`
- Each agent's invocations logged to `agent_invocations` for observability

---

## ADR-002: Rule-Based Routing (No AI in CEO)

**Date:** 2026-05-26
**Status:** Accepted

### Context
Should the CEO Router use an LLM to classify intent, or be deterministic JavaScript?

### Decision
**Pure JavaScript Code Node.** No LLM in routing path.

### Reasoning
- Routing rules are clear: `last_intent` already tells us which flow is active
- LLMs add 1-3 seconds latency and per-call cost
- LLMs are non-deterministic — "Yess" routes correctly 95% of the time, fails 5%
- Code Node = 100% reliable, < 50ms, free

### Where AI is still used
- Specialist agents (Complaint/Blood/Donor) for natural language understanding within their domain
- Welcome message for unclear new conversations

---

## ADR-003: Tiered Donor Cascade (No Mass Broadcast)

**Date:** 2026-05-26
**Status:** Accepted

### Context
Existing JS-15 limits donor notifications to top `units_needed * 5` donors. But it sends them all at once. With 100+ matching donors in a busy district, this causes:
- Donor fatigue (constant pings)
- Race conditions (5 donors say HAAN for 1 unit)
- WhatsApp rate limit pressure
- Per-message cost

### Decision
Implement **tiered cascade** in new workflow `JS-15B`:
- **Routine urgency:** 3 → 5 → 10 → adjacent districts (30min, 2hr, 6hr gaps)
- **Urgent (24hr):** 5 → 10 → 20 (15min, 1hr gaps)
- **Critical (2hr SOS):** all in district immediately, adjacent districts after 30min

Cascade stops as soon as `donors_confirmed_count >= units_needed`.

### Consequences
- Slower for routine requests (acceptable — 3+ days available)
- Critical requests still get SOS speed
- Need new tables: `cascade_notifications`, columns on `blood_requests`
- Cascade engine must be idempotent for safe retries

---

## ADR-004: Postgres Advisory Locks for Donor Acceptance

**Date:** 2026-05-26
**Status:** Accepted

### Context
With cascade and parallel donor responses, multiple donors can press HAAN simultaneously for a 1-unit request. Without atomic check, 3 donors might all be marked accepted.

### Decision
Use Postgres advisory locks (`pg_advisory_xact_lock`) keyed on `blood_request_id` inside the `DonorRespond` API endpoint. Inside the lock:
1. Read current `donors_confirmed_count`
2. Compare to `units_needed`
3. If under: increment counter, mark donor `accepted`
4. If at/over: mark donor `standby`
5. Release lock

### Alternative
`SELECT ... FOR UPDATE` on `blood_requests` row — also works, slightly more contention.

### Why advisory locks
- Postgres-native, no extra service
- Released automatically on transaction end
- Lock key can be derived from request UUID hash
- Doesn't block reads from other queries

---

## ADR-005: Immutable Donation History

**Date:** 2026-05-26
**Status:** Accepted

### Context
Medical record retention norms in India require 5-year audit trail. Donor donation history must not be silently editable.

### Decision
`donation_history` table is **append-only**. No `UPDATE` or `DELETE` allowed by application code (enforced via RLS policy). Corrections require inserting a supersede entry that references the original.

### Consequences
- Slightly more rows over time — acceptable
- Mistakes need correction entries, not edits
- Trigger updates `blood_donors` aggregates atomically on each insert

---

## ADR-006: Gender-Based Cooldown Function in Database

**Date:** 2026-05-26
**Status:** Accepted

### Context
Where to compute `next_eligible_date` — application code, n8n, or database?

### Decision
**Database function** `calculate_next_eligible_date(donor_id, donation_type, donated_date)`, called by trigger on `donation_history` insert.

### Why
- Single source of truth — no drift between n8n and frontend
- Atomic with the donation insert
- Future analytics/reports use the same logic
- Easy to audit and update centrally

### Cooldowns (per Indian NACO/NBTC + WHO)
- Whole blood + male: 90 days
- Whole blood + female: 120 days
- Platelets: 14 days
- Plasma: 14 days
- Double red cell: 168 days

---

## ADR-007: AI Project Context Portability

**Date:** 2026-05-26
**Status:** Accepted

### Context
The user wants to work with multiple AI tools (Cursor, Claude, Copilot, Lovable, Bolt, Kiro, etc.) on this project. Each tool has its own convention for context files (`.cursorrules`, `CLAUDE.md`, `AGENTS.md`, etc.). Kiro-specific specs in `.kiro/` are not visible to other tools.

### Decision
Three-layer context system:
1. **GitHub root:** Standard convention files (`PROJECT_CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`) — readable by every AI tool.
2. **`.ai-context/` folder:** Detailed reference (`ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `N8N_WORKFLOWS.md`, `API_ENDPOINTS.md`, `CURRENT_STATE.md`, `DECISIONS.md`).
3. **Supabase `ai_project_context` table:** Same content mirrored for AIs without GitHub access (REST API).

Plus an MCP server pointed at the GitHub repo via `gitmcp.io` for auto-discovery.

### Consequences
- Single source of truth in git, multiple read paths
- Manual sync to Supabase initially; can automate later via GitHub Action
- Specs in `.kiro/` remain Kiro-specific but linked from `PROJECT_CONTEXT.md`
