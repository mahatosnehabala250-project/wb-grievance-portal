# Booth capture at complaint time — n8n wiring spec
Status: API side LIVE (2026-08-22). n8n side NOT yet wired — this file is the
exact change. Owner or Claude: import/patch per below, then confirm in the log.

## The design (one tap, at the moment the worker is already looking)

Every complaint-alert sent to a karyakarta's Telegram already carries status
buttons. The same message now also carries the family's village booth
shortlist (from `polling_stations`, via `/api/households` logic). The worker
who knows his patch taps the right booth once — done forever; the households
ledger (`GET /api/households`) reads the confirmation back as `confirmedBooth`.

## What already exists (no n8n change needed to test)

`POST /api/complaints/field-update` now accepts an optional `boothNo`:

```json
{ "telegramChatId": "…", "ticketNo": "WB-26-PUR-001081", "boothNo": "46" }
```
- `boothNo` alone → writes one `BOOTH_CONFIRMED` activity row, changes nothing else.
- `boothNo` + `status` → status change AND the booth row, in one visit.
- Auth unchanged: `X-N8N-SECRET` header.

Response: `{ ok: true, data: { ticketNo, boothNo, by: "<worker>" } }`

## The n8n changes (2 workflows)

### 1. Complaint assignment alert (the JS-0x flow that sends status buttons)

After the status buttons are built, append a booth row when the village
resolves to ≤4 booths. Suggested inline-code node:

```js
// inputs: $json.village, $json.block, existing keyboard rows
const V = ($json.village || '').trim().toLowerCase();
const booths = items('booth-lookup')   // Supabase node polling_stations
  .filter(b => String(b.village_name || b.village_raw || '').trim().toLowerCase() === V)
  .slice(0, 4);                         // dedupe by ps_no, cap 4 (64-byte limit)
const row = booths.map(b => ({
  text: `📍 Booth ${b.ps_no}`,
  callback_data: `bth:${$json.ticketNo}:${b.ps_no}`   // ≤64 bytes: verify!
}));
return [{ json: { ...$json, boothRow: row } }];
```

Keep `callback_data` under 64 bytes — `bth:WB-26-PUR-001081:46` is 24, safe.

### 2. Telegram callback router (the flow that handles `upd:<ticket>:<STATUS>`)

Add one branch before the default:

```
IF callback_data starts with "bth:" →
   Split: ticketNo = parts[1], boothNo = parts[2]
   HTTP POST → <site>/api/complaints/field-update
     Headers: X-N8N-SECRET: {{$env.N8N_WEBHOOK_SECRET}}
     Body: { telegramChatId: <chat id>, ticketNo, boothNo }
   Answer callback: "Booth ✓ — धন্যবাদ"
```

## Verification after wiring

1. Send a test complaint in a known 1-booth village; worker taps the button.
2. `GET /api/households` (MLA token) → that household shows `confirmedBooth`.
3. Activity trail on the complaint shows `BOOTH_CONFIRMED` with the worker's name.
