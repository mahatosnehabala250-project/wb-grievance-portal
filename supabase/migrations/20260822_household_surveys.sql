-- 20260822_household_surveys.sql
-- One row per household visit by a karyakarta carrying the survey bot.
--
-- The survey is the ledger's other hand: complaints say what the office did,
-- surveys say who the family is and how they lean. Stored by household_key in
-- the same shape src/lib/household.ts computes (P:<last-10-digits> when a phone
-- exists, N:<name>|<village> otherwise), so /api/households joins surveys to
-- complaint-history without a fuzzy re-match.
--
-- Apply once via the Supabase SQL editor (or MCP). Until it is applied the
-- survey endpoint and the households merge both degrade to "no surveys yet".

CREATE TABLE IF NOT EXISTS household_surveys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_key   TEXT NOT NULL,              -- P:<phone10> | N:<name>|<village>
  village         TEXT,
  family_name     TEXT,
  phone           TEXT,
  voters_count    INT,                        -- how many vote in this house
  booth_no        TEXT,                       -- exact booth if confirmed
  problem         TEXT,                       -- what they said is broken
  leaning         TEXT,                       -- POSITIVE | NEUTRAL | NEGATIVE
  karyakarta_id   TEXT,                       -- users.id of the surveyor
  karyakarta_name TEXT,
  assembly_constituency TEXT,
  block           TEXT,
  gp_name         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest-first reads (the ledger takes the latest survey per household).
CREATE INDEX IF NOT EXISTS idx_household_surveys_key_time
  ON household_surveys (household_key, created_at DESC);

-- The ledger is seat-scoped; give it a cheap filter.
CREATE INDEX IF NOT EXISTS idx_household_surveys_ac
  ON household_surveys (assembly_constituency);

ALTER TABLE household_surveys ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: the table is read and written only by the app's
-- service-role paths (/api/survey with the automation secret, /api/households
-- with a staff JWT) — the same trust boundary as polling_stations.
