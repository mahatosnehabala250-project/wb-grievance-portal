# What the frontier is actually doing, and what it means here

Researched 19 Aug 2026 across two multi-agent sweeps — one on agent
infrastructure, models, voice, civic tech and disruption; one on what OpenAI,
Anthropic, Microsoft, NVIDIA, Google DeepMind and xAI say and ship. Claims about
this system were measured against the live database and the live n8n instance.

---

## The verdict, in one line

**You are in a stronger position, not a weaker one — and the reason is
unglamorous.** The entire industry independently concluded that the binding
constraint on agents is *workflow integration and proprietary data*, not model
quality. Those are the two things you have and a competitor cannot buy.

---

## 1. Strip out the podcasts and read the shipped record

Intelligence got cheap. The plumbing got standardised. **Nobody delivered
autonomy.**

| Claim | What shipped |
|---|---|
| Altman: automated AI research intern by Sept 2026 | Deadline is next month; no such product |
| Amodei: "country of geniuses in a datacenter" | Predicted 90% of code AI-written by end 2025; outside Anthropic it is 25–40% |
| Musk: 10% odds Grok 5 is AGI | Promised Q1 2026, unshipped in August. Timeline error factor a consistent 3–5x |
| Hassabis: ~2030, and scaling alone will not get there | The only one whose date is commercially inconvenient to say |

The evidence backs Hassabis, and it is not close:

- OpenAI's own computer-use agent scores **~32.6% on OSWorld** — it fails two of
  every three real tasks
- IBM's HR agent handled **94%** of requests and broke on the **6%** needing
  judgement. The 6% forced the reversal
- **MIT NANDA: 95% of enterprise AI pilots delivered no P&L impact**, and blamed
  workflow integration, not model quality
- **Deloitte: only ~11% of organisations had agents in production** by early 2026
- Gartner expects **half** the firms that cut service staff for AI to rehire by
  2027

Altman said "we are now, like, in the singularity" in late July 2026 and told
another podcast days later: *"We paused training. We have to figure out how to
secure our sandboxing."*

---

## 2. What all five camps built together: MCP

Anthropic **gave MCP away** — donated to the Linux Foundation's Agentic AI
Foundation on 9 Dec 2025, co-founded with OpenAI and Block. Microsoft ships it
inside Windows 11. Google, NVIDIA and xAI adopted it. 10,000+ public servers,
~97M monthly SDK downloads.

*A vendor giving away the asset it could most easily have used for lock-in is
the strongest single signal in the whole record.*

`SKILL.md` standardised the same way — published open at agentskills.io, ~40
adopters including OpenAI Codex, VS Code, Gemini CLI, Cursor. xAI shipped Grok
Skills **compatible with Anthropic's format** rather than inventing its own.

**But the layer above the API churns violently.** Dead or dying in 12 months:
OpenAI Agent Builder (announced Oct 2025, dead Nov 2026), OpenAI Evals,
Operator, custom GPTs; Google Gemini 2.0 Flash, Project Mariner.

**Depend on the API and the protocol. Never on the console.**

One caution before building on the MCP ecosystem: of 18,849 registered servers,
**17.2% of remote endpoints are dead and 55.8% require no authentication at
all.** The registry is a phone book, not a supply chain.

And the adjacent hype does not hold up. **A2A** reached v1.0 stable with 150+
organisations — and there is not one named example of different vendors' agents
collaborating in production. **Agent discovery** is worse: 104,000+ agents across
17 registries, 11 competing protocols, *zero* interoperability.

---

## 3. The models layer is finished, and it finished in your favour

- **Your model bill is zero and stays zero.** ~530 model calls in your entire
  history against a free tier of 1,500 requests *per day*.
- **Token prices fell ~80% in twelve months.** But agentic tasks burn 5–30x more
  tokens per task, so cost *per complaint* roughly holds while capability rises.
- **Small models tool-call at frontier reliability.** Parameter count no longer
  predicts tool quality.

Three findings that change what you should build:

### a) The 13-tool cliff

Tool-calling accuracy is 85–91% at 5 tools, 65–78% at 20+, and degradation
starts around **10–15**. JS-01 has **13**.

This is measured production behaviour, not theory. You are losing accuracy you
cannot see, because you have no eval.

### b) "Indian models for Indian languages" is a comprehension myth

On the only benchmark that tests romanised code-mixed Indic input (Indi-RomCoM,
Jun 2026), at 75% code-mixing:

| Model | Accuracy |
|---|---|
| Claude Opus 4.6 (frontier) | **61.2%** |
| Sarvam-30B (Indic-specialised) | 56.1% |

The Indic edge is **register** — answering in the citizen's own dialect instead
of flipping formal (26% defection vs 99%+) — and **speech** (~19% Bengali WER vs
Whisper's 40%+). Buy Sarvam for ASR/TTS. Do not switch your reasoning model to it.

### c) The tool-call failure moved

"Model writes the tool call as text" is solved upstream. It was replaced by a
quieter failure: turning on JSON-schema constraints *and* tool calling together
makes models return perfect JSON and **silently never call a tool**. Carry that
as a debugging heuristic before it costs you a day.

**Do not fine-tune** — 53 examples is nowhere near enough, and fine-tuning is for
form, not facts. **Do not build RAG** — 42 complaints and 3,354 GPs fit in a
prompt; naive vector search over small corpora is the thing that deserved to die.

Churn risk is real: **Krutrim quit foundation models** (May 2026, now a GPU
landlord) and **Sarvam deprecated its own small model within five months**.

---

## 4. The stack verdict

| Layer | Verdict |
|---|---|
| **Supabase / Postgres** | Safest thing you own. Safe well past three years — portability is in Postgres itself. Keep it the deterministic system of record. **Never move escalation deadlines, eligibility rules or jurisdiction routing into a prompt.** |
| **n8n** | Safe. Self-hostable, model-agnostic. It survived while vendor consoles died. |
| **Gemini** | Commodity. Google made four disruptive changes in eight months and **the price doubles on 1 Jan 2027**. Put the model ID in **one env var**. |
| **Meta WhatsApp Cloud API** | **Your real single point of failure — and not one of the five reports mentioned it.** Every other dependency has an exit: Postgres has pg_dump, n8n self-hosts, Gemini swaps in one variable. WhatsApp has no self-host path, no substitute with the same rural reach, and unilateral pricing changes. |

---

## 5. "SaaS is dead" — what actually happened

Nadella, BG2 podcast, 13 Dec 2024: business apps are *"essentially CRUD databases
with a bunch of business logic"*, and the logic *"is all going to these agents."*

The market believed him — **~$285B erased in 48 hours** in Feb 2026.

Then Dynamics 365 grew **13%** and Salesforce grew **10%**.

**It was multiple compression, not revenue collapse** — the market extrapolating
from a demo. And you were never in the per-seat business it threatened.

What survives, in Nadella's own words: **data and governance.** You have both —
LGD village to GP to block to AC, 2,802 polling stations, booth-level 2021
results, 46 department routes, 20 BDO addresses, a labelled corpus of code-mixed
Bengali, and RBAC scoping.

---

## 6. Order of operations

**This week** — each is hours, not days:

1. Model ID into one env var
2. `agent_id` / `model_version` column on every mutation, plus an append-only
   action log. *This is the one item where waiting compounds — every unlogged
   complaint is permanently unlabelled*
3. Pull the citizen phone list into Supabase (never only in Meta)
4. Instrument tokens-per-complaint

**This month:**

5. **Bengali voice intake** — async transcription, never a realtime API. This is
   the highest-return unbuilt thing available. You have 0 satisfaction ratings on
   35 closures, plausibly because asking a semi-literate villager to *type* a
   rating in Bengali cannot work
6. **The eval set** — 50–100 real romanised-Bengali complaints with expected
   category and GP, in your own git repo, never a vendor console. `evaluation
   v4.8` is already installed and unused. *The highest-value four hours in the
   whole roadmap*
7. **One MCP server** wrapping core operations — `query_complaints`,
   `assign_to_department`, `lookup_village_by_GP`, `close_with_evidence`. Put it
   in front of the 37 workflows; do not migrate them. A weekend, fully additive

**This quarter:**

8. Human escalation queue for the 6% — *before* adding any autonomy
9. Split JS-01 below the 13-tool cliff, but only after the eval proves the
   baseline

---

## 7. What to ignore

- **Every AGI date in this report.** None changes what you build tomorrow.
- **The one-person billion-dollar company.** A 2024 anecdote repeated for two
  years with no audited example. The most expensive idea here for someone in
  your position.
- **The entire agent-platform category** — OpenAI Frontier, Microsoft Agent 365,
  Copilot Studio, managed agents. You would spend a quarter re-platforming onto
  something that replaces orchestration n8n already does.
- **Buying local AI hardware.** DGX Spark went *up* to $4,699. That is one to two
  years of a pilot seat's entire revenue for hardware you do not need.
- **Optimising model choice for price.** At your volume the difference between
  frontier and cheap is a few hundred rupees a month. Choose on reliability.
- **Computer-use agents on government portals.** The obvious dream — e-district
  and PGRS have no APIs — and the trap. 32.6% on OSWorld, prompt injection an
  acknowledged open problem. Prototype in a sandbox; never in the live path.
- **Fine-tuning, and any "AI-first rebuild" of what already works.**

---

## 8. The uncomfortable part

**The thing actually killing this product is not in any of these reports.**

42 complaints in one seat. Zero field workers. Twelve assignments ever, all
self-tests. Nothing closed in fourteen days.

Microsoft's 30 million Copilot seats and NVIDIA's trillion-dollar factories are
irrelevant to whether a Purulia household with a broken tubewell knows the
WhatsApp number exists.

And the clock that matters is political, not technological. WB 2026 came in with
all nine Purulia seats one way; every MLA is ~3.5 months into a five-year term.
**A 10x swing in willingness-to-pay from a political cycle is larger than every
technology shift in this report combined** — and that window closes in 12–18
months, once office habits harden.

**Risks in actual order:** losing the political window; over-automating the 6%
and burning the MLA's credibility in a village; the WhatsApp channel getting
suspended; burnout.

**Obsolescence is not on the list.** Nothing in either sweep makes a competitor
able to skip the verified complaints, the ECI-verified GP-to-AC mapping, the
Form-20 booth data, or the relationship with a sitting legislator.

### What would falsify all of this

- A frontier model shipping reliable Bengali-in-Latin-script intake **with
  correct local administrative grounding** out of the box — that erases the
  intake moat
- The state or centre shipping a free grievance platform **with mandated
  adoption** — a far bigger threat than anything OpenAI ships
