# Database Schema

> Supabase project: `sxdtipaspfolrpqrwadt` (PostgreSQL 17, region: ap-south-1)
> Source of truth: `supabase-migration.sql` in repo root

## Schema Overview (38 tables)

### Conversation & Routing
- `conversation_sessions` — per-phone session state, intent, collected_data, language
- `n8n_chat_histories` — LangChain memory buffer
- `whatsapp_messages` — message log
- `routing_decisions` *(new — CEO Router observability)*
- `agent_invocations` *(new — per-agent metrics)*

### Citizens & Profiles
- `citizen_profiles` — registered citizens
- `users` / `users_safe` — admin/officer users
- `intake_rate_limits` — anti-spam

### Complaints
- `complaints` — main grievances table
- `complaint_stats` — aggregations
- `comments` — internal officer comments
- `activity_logs` — audit log
- `feedback` — citizen ratings
- `status_notification_log` — WhatsApp status updates sent
- `email_log` — emails sent to officers
- `webhook_fire_log` — outbound webhook audit

### Geography & Routing
- `valid_districts` — WB districts
- `valid_blocks` — WB blocks
- `district_codes` — codes for ticket generation
- `gram_panchayats` — GPs under blocks
- `block_bdo_email` — BDO email mapping
- `department_email_routing` — dept-level email routing
- `institution_contacts` — police, schools, hospitals contacts
- `student_org_contacts` — student grievance routing

### Blood Donation
- `blood_donors` — donor master (extended in new spec with DOB, weight, deferral fields)
- `blood_requests` — active/historical requests (extended with cascade_tier, donors_confirmed_count)
- `blood_donor_responses` — per-request donor responses (extended with response_status)
- `donation_history` *(new — immutable audit trail)*
- `cascade_notifications` *(new — tiered notification log)*
- `screening_log` *(new — pre-donation health screening)*

### Schemes & Knowledge
- `government_schemes` — scheme master
- `scheme_knowledge` — embeddings for RAG
- `knowledge_sync_log` — sync runs

### Intelligence & Analytics
- `intelligence_runs` — D3+D4+D5 intelligence engine runs
- `intelligence_alerts` — generated alerts
- `area_baselines` — district/block baselines
- `seasonal_patterns` — recurring complaint patterns
- `officer_scores` — officer performance
- `officer_score_dashboard` — dashboard view
- `district_score_summary` — district rollups
- `sla_at_risk` — SLA breach predictions

### Operations
- `n8n_webhook_config` — webhook URL config
- `workflow_errors` — error log from JS-08 watchdog

### AI Context (NEW)
- `ai_project_context` — portable context for any AI tool

## Key Tables in Detail

### `conversation_sessions`
```
session_id      text          PRIMARY KEY (phone number)
state           text          NOT NULL
collected_data  jsonb
last_intent     text          (idle | complaint_* | blood_* | donor_* | seeker_confirming | status_check | info_query)
active_agent    text          DEFAULT 'ceo'  *(new column)*
language        text          (en | hi | bn)
last_activity   timestamptz
created_at      timestamptz
updated_at      timestamp
```

### `blood_donors` (extended)
```
id                       uuid          PRIMARY KEY
phone                    text          NOT NULL
name                     text          NOT NULL
gender                   text          (male | female | other)  *required*
date_of_birth            date          *new*
weight_kg                integer       *new*
blood_group              text          NOT NULL
district                 text          NOT NULL
block                    text
last_donated_date        date
last_donation_type       text          *new* (whole_blood | platelets | plasma | double_red)
next_eligible_date       date
deferral_until           date          *new*
deferral_reason          text          *new*
permanently_deferred     boolean       DEFAULT false  *new*
permanent_deferral_reason text         *new* (encrypted at rest)
is_available             boolean       DEFAULT true
is_paused                boolean       DEFAULT false
total_donations          integer       DEFAULT 0
total_accepted           integer       DEFAULT 0
total_declined           integer       DEFAULT 0
total_offers_accepted    integer       DEFAULT 0  *new* (willingness counter)
donations_this_year      integer       DEFAULT 0  *new*
created_at               timestamptz
updated_at               timestamptz
```

### `blood_requests` (extended)
```
id                      uuid          PRIMARY KEY
seeker_phone            text
seeker_name             text
patient_name            text
blood_group             text
units_needed            integer
hospital                text
district                text
block                   text
urgency                 text          (critical | urgent | routine)  *new*
status                  text          (pending | donor_found | confirmed | fulfilled | expired)
cascade_tier            integer       DEFAULT 0  *new*
donors_confirmed_count  integer       DEFAULT 0  *new*
donors_standby_count    integer       DEFAULT 0  *new*
created_at              timestamptz
expires_at              timestamptz
```

### `donation_history` *(new, immutable)*
```
id                  uuid         PRIMARY KEY
donor_id            uuid         REFERENCES blood_donors(id)
blood_request_id    uuid         REFERENCES blood_requests(id) NULL
donated_date        date         NOT NULL
donation_type       text         NOT NULL (whole_blood | platelets | plasma | double_red)
units               integer      DEFAULT 1
hospital            text
hemoglobin_level    numeric
notes               text
created_at          timestamptz  DEFAULT NOW()

-- Trigger: trg_update_donor_after_donation (AFTER INSERT)
-- Updates: blood_donors.last_donated_date, next_eligible_date,
--          last_donation_type, total_donations, donations_this_year
```

### `cascade_notifications` *(new)*
```
id                  uuid         PRIMARY KEY
blood_request_id    uuid         REFERENCES blood_requests(id)
donor_id            uuid         REFERENCES blood_donors(id)
tier                integer      (1 | 2 | 3 | 4)
notified_at         timestamptz
responded_at        timestamptz
response            text         (haan | nahi | timeout)
```

### `routing_decisions` *(new)*
```
id                  uuid         PRIMARY KEY
session_id          text
message_text        text         (truncated to 200 chars for PII)
last_intent_before  text
agent_dispatched    text         (complaint | blood | donor | info | welcome)
reason              text
created_at          timestamptz  DEFAULT NOW()
```

### `ai_project_context` *(new)*
```
id           uuid         PRIMARY KEY
category     text         NOT NULL  (overview | architecture | workflow | decision | api | spec)
key          text         NOT NULL
title        text
content      text         NOT NULL  (markdown)
metadata     jsonb        DEFAULT '{}'
version      integer      DEFAULT 1
is_active    boolean      DEFAULT true
created_at   timestamptz
updated_at   timestamptz
updated_by   text
UNIQUE(category, key)
```

## Key Functions

### `find_matching_donors(p_blood_group, p_district, p_units, p_block)`
Returns ranked, eligible donors filtered by:
- Compatible blood group (`get_compatible_donors(p_blood_group)`)
- Same district
- `is_available = true` AND `is_paused = false`
- `next_eligible_date <= CURRENT_DATE`
- *(new filters)* `permanently_deferred = false`, `deferral_until <= CURRENT_DATE`, age 18-65, weight ≥ 45kg

Ranked by:
1. Same block (priority 1) before other blocks
2. `total_donations DESC`
3. `created_at ASC`

Limit: `p_units * 5` (notify only top candidates per cascade tier)

### `calculate_next_eligible_date(donor_id, donation_type, donated_date)` *(new)*
Returns DATE based on gender + donation_type:
- whole_blood + male → +90 days
- whole_blood + female → +120 days
- platelets → +14 days
- plasma → +14 days
- double_red → +168 days

### `get_compatible_donors(blood_group)` *(existing)*
Returns array of compatible blood groups for the requested type.

## RLS Policies

All sensitive tables have RLS enabled. Common patterns:
- `service_role` (n8n) → full read/write
- `authenticated` admin role → read all, limited write
- `anon` → no access except `ai_project_context` (public read for AI tools)
- Donor self-access → can read/update own row via OTP-authenticated session

See `prisma/schema.prisma` for the full model definitions and `supabase-migration.sql` for the SQL.
