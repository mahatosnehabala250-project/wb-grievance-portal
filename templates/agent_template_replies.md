# `agent_template_replies.md` — Deterministic Specialist-Agent Fallback Replies

> **Purpose.** When the `gemini` circuit breaker is **open** (`circuit_state.gemini = 'open'`),
> the specialist agent LLM node is replaced by a deterministic Code Node
> (Gemini-substitute, task 27.4). That Code Node looks up a reply from this file
> so the bot can still advance a flow without any LLM call.
> **No LLM-generated content ever reaches the citizen while `gemini` is open** — see Design
> §v1.1.10 and Property 30 ("Circuit breaker degradation reach").
>
> **Requirements:** 29.2 — **Design:** §v1.1.10

---

## Lookup contract

Replies are keyed by the triple **`(agent, intent, missing_field)`** and then localized by
**`session.language`** (`hi` Hinglish / `bn` Bengali / `en` English). The Gemini-substitute
Code Node resolves a reply like this:

```ts
// agent           ∈ { complaint, blood, donor }
// session.last_intent (intent) ∈ the LAST_INTENT enum, e.g. 'complaint_collecting'
// slot            = nextMissingField(session.collected_data, session.last_intent)
// session.language ∈ { hi, bn, en }, default 'hi'

const intentBlock = templateReplies[agent][session.last_intent];
const slotBlock    = intentBlock[slot] ?? intentBlock.default;   // per-intent fallback
const reply        = slotBlock[session.language] ?? slotBlock.hi; // per-language fallback

return { reply, advanced_flow: false };  // never claims progress; user can still respond
```

Resolution always succeeds because every intent block defines a `default` slot, and every
slot defines an `hi` value as the last-resort language.

### Intent naming note

The task brief uses the generic `*_collecting` / `*_confirming` shorthand. The **canonical
intent strings** used as keys below match the `LAST_INTENT` enum that the rest of the codebase
uses (see `src/app/api/sessions/save/route.ts`). In particular, the donor agent's collecting
state is **`donor_registration`** (not `donor_collecting`) and its confirm state is
**`donor_confirming`**.

| Agent | Collecting intent | Confirming intent |
|---|---|---|
| complaint | `complaint_collecting` | `complaint_confirming` |
| blood (seeker flow) | `blood_collecting` | `blood_confirming` |
| donor | `donor_registration` | `donor_confirming` |

### Placeholders

- `${summary}` — the Code Node injects a plain-text read-back of `session.collected_data`
  before sending the confirming reply. It is the only interpolation token used in this file.

---

## Canonical replies (machine-readable)

The block below is the **single source of truth** the Code Node parses. Keep it valid YAML;
the surrounding prose is documentation only.

```yaml
# templates/agent_template_replies.md — canonical fallback replies
# Key path: <agent>.<intent>.<missing_field>.<language>

complaint:
  # State: complaint_collecting — ask for ONE missing field at a time.
  # Field order matches prompts/complaint.md:
  #   naam, gaon, jela, block, gram_panchayat, samasya, category, (college_name if category=student)
  complaint_collecting:
    naam:
      hi: "Namaste! Aap ki complaint register karne mein madad karunga. Pehle aap ka pura naam batayein?"
      bn: "নমস্কার! আপনার অভিযোগ নথিভুক্ত করতে সাহায্য করব। প্রথমে আপনার পুরো নাম বলুন।"
      en: "Hello! I'll help register your complaint. First, please tell me your full name."
    gaon:
      hi: "Aap ka gaon ya mohalla kaun sa hai?"
      bn: "আপনার গ্রাম বা এলাকার নাম কী?"
      en: "Which village or locality are you from?"
    jela:
      hi: "Aap kis jela (district) se hain?"
      bn: "আপনি কোন জেলা থেকে?"
      en: "Which district are you from?"
    block:
      hi: "Aap ka block kaun sa hai?"
      bn: "আপনার ব্লকের নাম কী?"
      en: "Which block do you belong to?"
    gram_panchayat:
      hi: "Aap ki gram panchayat kaun si hai?"
      bn: "আপনার গ্রাম পঞ্চায়েতের নাম কী?"
      en: "Which gram panchayat is yours?"
    samasya:
      hi: "Aap ki samasya kya hai? Thoda detail mein batayein."
      bn: "আপনার সমস্যাটি কী? একটু বিস্তারিত করে বলুন।"
      en: "What is your problem? Please describe it in a little detail."
    category:
      hi: "Ye samasya kis vibhag ki hai? (road, water, electricity, pension, school, health, ration, housing, student, other)"
      bn: "এই সমস্যাটি কোন বিভাগের? (road, water, electricity, pension, school, health, ration, housing, student, other)"
      en: "Which category is this complaint? (road, water, electricity, pension, school, health, ration, housing, student, other)"
    college_name:
      hi: "Aap ke college ka naam kya hai?"
      bn: "আপনার কলেজের নাম কী?"
      en: "What is the name of your college?"
    default:
      hi: "Aap ki complaint aage badhane ke liye kripya agli jaankari batayein."
      bn: "আপনার অভিযোগ এগিয়ে নিতে অনুগ্রহ করে পরবর্তী তথ্যটি দিন।"
      en: "To continue your complaint, please provide the next detail."
  # State: complaint_confirming — read back data and ask Haan/Nahi.
  complaint_confirming:
    default:
      hi: "Aap ki complaint ke details:\n${summary}\nKya ye sab sahi hai? Haan ya Nahi batayein."
      bn: "আপনার অভিযোগের তথ্য:\n${summary}\nসব ঠিক আছে? হ্যাঁ বা না বলুন।"
      en: "Your complaint details:\n${summary}\nIs everything correct? Please reply Yes or No."

blood:
  # State: blood_collecting (seeker flow) — ask for ONE missing field at a time.
  # Field order matches prompts/blood.md:
  #   blood_group, units, hospital, urgency, contact_phone, district, block
  blood_collecting:
    blood_group:
      hi: "Kis blood group ki zaroorat hai? (A+, A-, B+, B-, AB+, AB-, O+, O-)"
      bn: "কোন ব্লাড গ্রুপ দরকার? (A+, A-, B+, B-, AB+, AB-, O+, O-)"
      en: "Which blood group is needed? (A+, A-, B+, B-, AB+, AB-, O+, O-)"
    units:
      hi: "Kitne units khoon chahiye? (1-10)"
      bn: "কত ইউনিট রক্ত দরকার? (1-10)"
      en: "How many units of blood are needed? (1-10)"
    hospital:
      hi: "Kis hospital mein khoon chahiye?"
      bn: "কোন হাসপাতালে রক্ত দরকার?"
      en: "At which hospital is the blood needed?"
    urgency:
      hi: "Kitni jaldi chahiye? critical (2 ghante), urgent (24 ghante), ya routine (3+ din)?"
      bn: "কত দ্রুত দরকার? critical (২ ঘণ্টা), urgent (২৪ ঘণ্টা), নাকি routine (৩+ দিন)?"
      en: "How urgent is it? critical (2 hours), urgent (24 hours), or routine (3+ days)?"
    contact_phone:
      hi: "Sampark ke liye ek phone number batayein."
      bn: "যোগাযোগের জন্য একটি ফোন নম্বর দিন।"
      en: "Please share a contact phone number."
    district:
      hi: "Hospital kis jela (district) mein hai?"
      bn: "হাসপাতালটি কোন জেলায়?"
      en: "Which district is the hospital in?"
    block:
      hi: "Hospital kis block mein hai?"
      bn: "হাসপাতালটি কোন ব্লকে?"
      en: "Which block is the hospital in?"
    default:
      hi: "Blood request aage badhane ke liye kripya agli jaankari batayein."
      bn: "ব্লাড রিকোয়েস্ট এগিয়ে নিতে অনুগ্রহ করে পরবর্তী তথ্যটি দিন।"
      en: "To continue the blood request, please provide the next detail."
  # State: blood_confirming — read back request and ask to confirm.
  blood_confirming:
    default:
      hi: "Aap ke blood request ke details:\n${summary}\nKya ye sahi hai? Confirm karein — Haan ya Nahi."
      bn: "আপনার ব্লাড রিকোয়েস্টের তথ্য:\n${summary}\nঠিক আছে? নিশ্চিত করুন — হ্যাঁ বা না।"
      en: "Your blood request details:\n${summary}\nIs this correct? Please confirm — Yes or No."

donor:
  # State: donor_registration — ask for ONE missing field at a time.
  # Field order matches prompts/donor.md:
  #   naam, blood_group, gender, date_of_birth, weight_kg, district, block,
  #   last_donated_date (optional), last_donation_type (optional)
  donor_registration:
    naam:
      hi: "Donor banne ke liye dhanyavaad! Aap ka pura naam batayein?"
      bn: "ডোনার হওয়ার জন্য ধন্যবাদ! আপনার পুরো নাম বলুন।"
      en: "Thank you for becoming a donor! Please tell me your full name."
    blood_group:
      hi: "Aap ka blood group kya hai? (A+, A-, B+, B-, AB+, AB-, O+, O-)"
      bn: "আপনার ব্লাড গ্রুপ কী? (A+, A-, B+, B-, AB+, AB-, O+, O-)"
      en: "What is your blood group? (A+, A-, B+, B-, AB+, AB-, O+, O-)"
    gender:
      hi: "Aap ka gender batayein (male/female/other)?"
      bn: "আপনার লিঙ্গ বলুন (male/female/other)?"
      en: "Please tell me your gender (male/female/other)."
    date_of_birth:
      hi: "Aap ki janm tithi batayein (DD/MM/YYYY)?"
      bn: "আপনার জন্ম তারিখ বলুন (DD/MM/YYYY)?"
      en: "Please share your date of birth (DD/MM/YYYY)."
    weight_kg:
      hi: "Aap ka weight kitna hai (kg mein)?"
      bn: "আপনার ওজন কত (কেজিতে)?"
      en: "What is your weight (in kg)?"
    district:
      hi: "Aap kis jela (district) se hain?"
      bn: "আপনি কোন জেলা থেকে?"
      en: "Which district are you from?"
    block:
      hi: "Aap ka block kaun sa hai?"
      bn: "আপনার ব্লকের নাম কী?"
      en: "Which block do you belong to?"
    last_donated_date:
      hi: "Aap ne aakhri baar kab khoon diya tha? (DD/MM/YYYY ya 'pata nahi')"
      bn: "আপনি শেষবার কবে রক্ত দিয়েছিলেন? (DD/MM/YYYY বা 'জানি না')"
      en: "When did you last donate blood? (DD/MM/YYYY or 'don't know')"
    last_donation_type:
      hi: "Aakhri donation kis type ka tha? (whole_blood/platelets/plasma/double_red)"
      bn: "শেষ দানটি কোন ধরনের ছিল? (whole_blood/platelets/plasma/double_red)"
      en: "What type was your last donation? (whole_blood/platelets/plasma/double_red)"
    default:
      hi: "Donor registration aage badhane ke liye kripya agli jaankari batayein."
      bn: "ডোনার রেজিস্ট্রেশন এগিয়ে নিতে অনুগ্রহ করে পরবর্তী তথ্যটি দিন।"
      en: "To continue donor registration, please provide the next detail."
  # State: donor_confirming — read back data and ask Haan/Nahi.
  donor_confirming:
    default:
      hi: "Aap ke details:\n${summary}\nKya ye sab sahi hai? Haan ya Nahi?"
      bn: "আপনার তথ্য:\n${summary}\nসব ঠিক আছে? হ্যাঁ বা না?"
      en: "Your details:\n${summary}\nIs everything correct? Yes or No?"
```

---

## Notes for the Gemini-substitute Code Node (task 27.4)

1. Parse the fenced `yaml` block above once at module load; cache it.
2. Compute `slot = nextMissingField(collected_data, last_intent)`. For `*_confirming` intents
   there is no missing field, so `slot` is irrelevant and the `default` reply is used.
3. Select language via `session.language`, falling back to `hi`.
4. Return `advanced_flow: false` — the deterministic reply re-asks for the next field and never
   asserts that the flow progressed, because no tool calls (ValidateBlock, RegisterComplaint,
   etc.) run while `gemini` is open.
5. Because the reply text is taken verbatim from this file, it is byte-equal to a known string
   for the matching `(agent, intent, missing_field)` key — satisfying Property 30.
