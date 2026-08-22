# Telegram AI Agent — "Karyakarta ka Assistant"
Status: App-side LIVE (2026-08-22): field-list is new; field-update, field-rate,
survey, households all deployed. n8n AI Agent workflow NOT built yet — this is
the exact recipe. Owner or Claude: build, log, verify.

## The idea (owner's design, kept verbatim in spirit)

The karyakarta never opens the portal. He talks to Telegram in Bengali/Hinglish
and an AI agent behind the chat does the thinking:

> "মোর কত পেন্ডিং কেস আছে?" → agent counts his cases and replies
> "এই কেস আপডেট দিতে চাই" → agent walks him through it
> resolved → agent asks rating ("কাজ হয়েছে? খুশি?") + family voters
> → complaint updated, activity logged, ledger enriched — all from chat.

Portal stays available (web login works today) but is OPTIONAL. This is the
platform's first real AI Agent — the n8n AI Agent node with tools, exactly the
shape FUTURE_STACK_REPORT.md Phase 1 called for.

## The agent's tools (all exist, all X-N8N-SECRET)

| Tool (agent calls) | Hits | Returns |
|---|---|---|
| `my_pending(chatId)` | POST /api/complaints/field-list | his cases: ticket, status, urgency, age, village, one-liner |
| `complaint_detail(chatId, ticketNo)` | same + ticketNo | one case in full |
| `update_status(chatId, ticketNo, status, note?)` | POST /api/complaints/field-update | status changed, activity logged |
| `rate(chatId→phone?, ticketNo, rating 1-5, stillBroken?)` | POST /api/complaints/field-rate | satisfaction recorded (Sarvam path) |
| `survey(chatId, village, familyName, votersCount, boothNo?, problem?, leaning?)` | POST /api/survey | household ledger row |

Identity rule (non-negotiable): the agent passes only the chat id; the API
resolves the worker server-side. The LLM is never told a name it can assert.

## The conversation script (Bengali-first; agent improvises phrasing, not rules)

```
Karyakarta: মোর কত পেন্ডিং কেস?
Agent:      আপনার ৪টি কেস বাকি আছে 👇
            1️⃣ WB-26-PUR-001081 — স্বাস্থ্য, মাজুড়া, ১২ দিন
            2️⃣ WB-26-PUR-001080 — রাস্তা, অন্ধুলি, ১২ দিন ...
            কোনটা আপডেট করবেন?

Karyakarta: ১০৮১
Agent:      WB-26-PUR-001081 — স্বাস্থ্য, মাজুড়া। এখন কী অবস্থা?
            [▶️ শুরু করেছি] [✅ হয়ে গেছে] [❌ বাতিল]

Karyakarta: ✅ হয়ে গেছে
Agent:      (updates status → activity log লেখা গেল)
            কাজের প্রমাণ কী হল? এক লাইনে (যেমন: "নল লাগিয়ে দিয়েছে")
Karyakarta: নল লাগিয়ে দিয়েছে
Agent:      পরিবার কি খুশি? [😀 ৫] [🙂 ৪] [😐 ৩] [🙁 ২] [😞 ১]   ← SIRF resolve ke BAAD
Karyakarta: 😀 ৫
Agent:      ওই বাড়িতে কত ভোটার? [1][2][3][4][5][6+]
Karyakarta: 4
Agent:      ✅ সব সেভ — WB-26-PUR-001081 resolve, ৫★, ৪ ভোটার।
            পরের কেস?
```

### Conditional rules the agent MUST hold (prompt-level, not code)

1. **Rating/voters questions unlock ONLY after status=RESOLVED** — same
   timing principle as leaning in SURVEY_BOT_SPEC: mid-case, "khush ho?"
   has no honest answer yet. On IN_PROGRESS, ask only the proof line.
2. **Never invent ticket numbers or statuses** — no tool answer, no reply.
   "দেখাই যাচ্ছে না, একটু পরে চেষ্টা করুন" beats a confident lie.
3. **One confirmation before any write**: status change repeats the ticket
   number back ("WB-26-PUR-001081 কে ✅ করছি — ঠিক?") — a wrong tap must
   never close the wrong case.
4. **Jhukav question: only via the survey flow** (cold/resolved, per
   SURVEY_BOT_SPEC), never bundled into a status update.

## n8n build (one workflow, "WB-AGENT")

- Telegram Trigger → AI Agent node (system prompt carries the rules above +
  a Bengali example few-shot) → 5 HTTP Request tools bound to the endpoints
  (all X-N8N-SECRET from $env).
- Model: DeepSeek-chat (key in the owner's .env) is enough for this scope;
  upgrade later if Bengali phrasing feels stiff. Sarvam is not needed here —
  this is text, not voice.
- Memory: n8n's windowed memory keyed by chat id (7 days) so "১০৮১" resolves
  against the list he was just shown.
- Escalation: any tool error twice → agent replies with the office phone
  number and stops; it never retries silently.

## Portal side (already works; one tweak pending)

Karyakarta can log in and do all of this on the web today. The one gap the
owner flagged: **rating/voters form fields should activate only when status =
RESOLVED** — same rule as the bot. Small ComplaintsView tweak, queued after
the bot ships.

## Verification after wiring

1. Linked worker asks "মোর কত পেন্ডিং?" — count matches the portal list.
2. Resolve one case through chat → portal shows RESOLVED + activity row +
   rating 5★ + survey row (voters) on the household.
3. Try mid-case rating ("শুরু করেছি" ke baad) — agent must NOT ask khushi.
4. Wrong-ticket confirmation flow: agent repeats number before writing.
