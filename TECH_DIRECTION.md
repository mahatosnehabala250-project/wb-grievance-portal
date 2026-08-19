# Where the world is going, and where this project should go

Written 19 Aug 2026. Every claim about *this* system was checked against the
live n8n instance and the live database, not recalled. Claims about the wider
industry are cited.

---

## 1. The short answer

**You do not need to leave n8n, and you should not.** Everything you asked
about — orchestrator, sub-agents, an agent per role, graph-style flow — is
already installed on your own n8n instance. I checked. You are not behind; you
are running a modern build and using about a third of it.

What you *are* missing is not a framework. It is a way to **measure** whether a
change to the agent made things better or worse. That is the thing to add first,
and it is also already installed.

---

## 2. What is actually on your instance today (verified)

| Node | Version | What it gives you |
|---|---|---|
| `@n8n/n8n-nodes-langchain.agentTool` | **3** | An AI Agent that attaches to another agent **as a tool**. Its own model, own memory, own tools, own system prompt. This is the sub-agent. |
| `@n8n/n8n-nodes-langchain.mcpClientTool` | 1.2 | An agent can consume any **MCP server** as tools |
| `n8n-nodes-base.evaluation` | **4.8** | Run a test dataset through a workflow and score it |
| `n8n-nodes-base.evaluationTrigger` | 4.7 | Feeds that dataset in |
| `@n8n/n8n-nodes-langchain.agent` | **3.1** | What JS-01 already runs. Supports a **fallback model** (`needsFallback`) |

`agentTool` also exposes `maxIterations` (default 10), `returnIntermediateSteps`
for debugging, `batching` for rate limiting, and `tracingMetadata`.

So the orchestrator → sub-agent architecture is a wiring job on your existing
instance, not a migration.

---

## 3. What the industry settled on in 2026

Two patterns won, and they are not exotic:

**Orchestrator–worker.** One coordinator owns the outcome and delegates to
specialists whose jobs are known at design time. It is described as the dominant
enterprise pattern of 2026, chosen for "clear accountability, debuggable control
flow, and predictable costs."

**Dynamic handoff.** Agents pass control to each other at runtime when you cannot
know in advance which specialist is needed. No central coordinator.

The frameworks have converged on the same shapes: LangGraph (supervisor, fan-out,
pipeline, checkpointers for time-travel debugging), OpenAI Agents SDK
(handoffs — the production successor to Swarm), Claude Agent SDK (subagents one
level deep, parallel dispatch, Skills).

**n8n's `agentTool` is the supervisor/orchestrator-worker pattern.** You have
the winning pattern natively. Migrating to a code SDK would buy you the same
architecture and cost you 37 working workflows and the visual debugging that
lets one person maintain them.

---

## 4. The honest diagnosis of JS-01

JS-01 is **one agent doing five jobs** with **thirteen tools**:

intake · status check · rating · scheme Q&A · consent & erasure

Its 2,170-character system prompt has to carry routing logic as prose:

> `Distinctions: ticket# → CheckComplaintStatus | 1-5 after RESOLVED → SaveRating | scheme → answer directly`

That is a router written in English and executed by an LLM on every single turn.

And it visibly fails. `Send Reply` carries this fallback:

```js
if (/^\s*Calling\s+\w+\s+with\s+input/i.test(out) || out.trim()==='') → "wait, please confirm again"
```

The agent sometimes *writes* the tool call instead of *making* it. The system
prompt has a whole rule shouting about it. Every occurrence burns a WhatsApp
message — which stops being free on **1 October 2026** — and confuses a citizen.

Thirteen tools and five jobs in one prompt is the known cause of that class of
failure. This is the real argument for sub-agents here — not fashion.

---

## 5. What to do, in order

### Step 1 — Evaluation first. Nothing else until this exists.

Add `evaluationTrigger` + `evaluation` with a dataset built from the **53 real
complaints already in the database** — the code-mixed ones especially
("khvar jol thik nai", "Bidhuyyt", "Amar kanshsrer taka dukhe nai").

Score: did it reach RegisterComplaint, did it get the right category, right
block, right GP, how many turns did it take.

**Why first:** you cannot safely refactor the one component that touches real
citizens without a way to prove you did not break it. Right now a change to
JS-01 is tested by hoping. This is a day of work and it makes every later step
safe.

### Step 2 — Turn on the fallback model in JS-01. One checkbox.

`needsFallback` on the agent node. When Gemini emits "Calling X with input"
instead of calling the tool, a second model gets the turn instead of the citizen
getting a confused Bengali apology.

### Step 3 — Split into orchestrator + sub-agents. Only after Step 1 proves the baseline.

```
Router  (cheapest model — classify intent only, no tools)
  ├── Intake Agent    → ValidateBlock, ListGPs, ValidateGP,
  │                     LookupVillageCoords, CheckDuplicate, RegisterComplaint
  ├── Status Agent    → CheckComplaintStatus
  ├── Rating Agent    → GetRecentResolved, SaveRating
  ├── Scheme Agent    → scheme_knowledge (37 rows, embeddings already built)
  └── Privacy Agent   → RecordConsent, EraseMyData
```

Six tools in the biggest sub-agent instead of thirteen in one. Each prompt does
one job. Each can run a **different model** — intake needs quality, a status
lookup does not and can run the cheapest model available.

This is also the answer to "har role ke liye sub-agent": the same wiring later
carries an MLA agent, an MP agent and a district agent, each scoped by the RBAC
rules already in `src/lib/rbac.ts`.

---

## 6. One forward-looking idea worth more than the refactor

You have `mcpClientTool`. The inverse is more interesting: **expose your portal
as an MCP server.**

Then an MLA — or their PA — can point their own Claude or ChatGPT at it and ask
"which villages in Purulia II have open water complaints older than a week"
in plain Bengali, and get a real answer from real data, without your UI.

That is where the industry is going: the data and the actions become the
product, and the interface becomes whatever the user already has open. For a
buyer who will never log into a dashboard daily, that is a stronger pitch than
any screen you can build. Your RBAC scoping already makes it safe — an MLA's
MCP token would see one constituency, exactly as the API does today.

---

## 7. What NOT to do

- **Do not migrate to LangGraph / OpenAI Agents SDK / Claude Agent SDK.** You
  would rebuild 37 workflows to arrive at the pattern you already have.
- **Do not build multi-agent anything before Step 1.** Without evals you cannot
  tell a better system from a worse one, and you will be debugging by anecdote.
- **Do not let this become the next dashboard.** The database still shows zero
  real field workers, twelve assignments ever — all self-tests — and nothing
  closed in fourteen days. A more sophisticated agent does not close a single
  complaint. Do Step 1 and Step 2, they are cheap and they pay for themselves in
  saved messages and fewer confused citizens. Step 3 can wait behind a real
  worker in a real gram panchayat.

---

**Sources:** n8n instance node inventory (read live via the n8n API, 19 Aug
2026); n8n release notes and AI docs; industry pattern surveys at
beam.ai/agentic-insights/multi-agent-orchestration-patterns-production and
levelop.dev/blog/ai-agent-orchestration-frameworks-guide-2026.
