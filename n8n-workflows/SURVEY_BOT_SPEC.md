# Karyakarta survey bot — n8n flow spec
Status: API side LIVE (2026-08-22). Table needs the owner's one-paste migration.
n8n side NOT yet built — this file is the exact recipe. Owner or Claude: build
per below, note it in the worklog, delete nothing.

## The design (one chat, five taps, thirty seconds per family)

The karyakarta walks Majura, opens the bot, and answers five questions about
each house he visits. The data lands in `household_surveys`, keyed exactly the
way `/api/households` keys families — so the ledger's next refresh carries
voters, leaning and a confirmed booth per household. This is our MiniVAN:
the American canvass app, except it lives inside Telegram, where the worker
already is.

## Prerequisites (owner, 30 seconds each)

1. Apply `supabase/migrations/20260822_household_surveys.sql` in the Supabase
   SQL editor (creates the table + indexes; RLS on, no policies — service-role
   only, like polling_stations).
2. A Telegram bot token for the survey bot (can be the SAME bot as field
   updates — the callback prefixes don't collide).

## The API it lands on (already deployed)

`POST /api/survey` — header `X-N8N-SECRET: <N8N_WEBHOOK_SECRET>`

```json
{
  "telegramChatId": "123456789",
  "village": "Majura",
  "familyName": "Ramesh Soren",
  "phone": "9000051310",
  "votersCount": 4,
  "boothNo": "45",
  "problem": "পানি আসে না",
  "leaning": "POSITIVE"
}
```
- Only `telegramChatId`, `village`, `familyName` are required; the rest may be
  null. `leaning` ∈ POSITIVE | NEUTRAL | NEGATIVE.
- The worker is resolved from the chat id server-side (same as field-update);
  the village must sit in the worker's own jurisdiction.
- Response `{ ok: true, data: { householdKey, village, by } }`.
- `503` with a plain message means the table migration hasn't been applied.

## The n8n flow (one workflow, "WB-SURVEY")

Telegram Trigger (message) → Switch on conversation state (store state per
chat id in workflow static data) →

**Q1** bot: `কোন গ্রামে? (गाँव का नाम लिखो)` → wait text → save `village`
**Q2** bot: `পরিবারের প্রধানের নাম? (बिरादरी के मुखिया का नाम?)` → text → `familyName`
**Q3** bot: `বাড়িতে কত ভোটার?` → reply keyboard: `1 2 3 4 5 6+` → `votersCount`
**Q4** booth shortlist buttons (lookup polling_stations by the Q1 village —
reuse the same exact/containment logic notes from BOOTH_CAPTURE_SPEC):
`callback_data: svb:<n>` (n = index into this chat's saved shortlist), plus a
`📍 অন্য / other` fallback → `boothNo` (or null)
**Q5** bot: `সমস্যা কী? (एक लाइन में समस्या लिखो, या - लिखो अगर कुछ नहीं)` → text → `problem`
**Q6** bot: `MLA-র কাজ নিয়ে কী বলছেন?` → buttons: `😀 ভালো | 😐 এমনই | 😠 অসন্তুষ্ট`
→ `leaning` (POSITIVE / NEUTRAL / NEGATIVE)

→ HTTP POST `/api/survey` with everything above
→ bot: `✅ সংরক্ষিত — ধন্যবাদ! পরের বাড়ি?` → reset state to Q1.

### Wiring details that bite

- **State per chat:** workflow static data keyed by chat id; expire after
  10 minutes of silence (a half-finished survey from last night must not
  attach to today's house).
- **Callback budget:** `svb:0` … `svb:3` — 4 bytes, nowhere near the 64-byte
  cap. The shortlist itself rides in static data, not the callback.
- **Phone (optional bonus):** if the family's WhatsApp number is known, add
  Q0 or a `/tel` command — with a phone the survey keys onto the family's
  existing complaint history (P:<phone>); without it, a clean N:name|village
  record starts fresh.
- **Do not** create complaints from survey problems. A problem noted in the
  survey stays survey data; the office files a complaint when it acts on it.

## Verification after wiring

1. Linked karyakarta runs one full survey on a real visit.
2. `GET /api/households` (MLA token) → that family shows `votersCount`,
   `leaning`, `lastSurveyAt`, and `confirmedBooth` (from Q4 if tapped).
3. Summary counters `surveyed` / `leaningPositive` move.
