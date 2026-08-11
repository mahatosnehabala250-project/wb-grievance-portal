-- Repair the categories of complaints filed before register_complaint could
-- carry one. Twenty-two rows, every one a real citizen's complaint that had
-- been sitting under OTHER or under free text since it arrived.
--
-- The mapping is not computed here. Each value was produced by
-- src/lib/categorise.ts read against the complaint's own words, then checked by
-- hand. The three rows the classifier could not place — a mobile network
-- complaint and two OBC certificate requests, for which this product has no
-- category — are deliberately left as OTHER rather than forced into an
-- approximate bucket. An honest unknown a PA can correct beats a confident
-- wrong label nobody re-checks.
--
-- Two triggers are held off for the duration:
--
--   trg_js12_email fires on UPDATE whenever OLD.category <> NEW.category and the
--   new category is not OTHER, and POSTs to the live js-bdo-email webhook. That
--   is exactly the shape of this statement, so running it as-is would have
--   mailed Block Development Officers about twenty-two complaints, most of them
--   months old, as though they had just come in.
--
--   complaints_updated_at would stamp updatedAt to now on all of them, telling
--   every ageing and staleness figure in the app that these complaints were
--   touched today. Nobody touched them; a column was corrected.
--
-- To reverse: every row below was 'OTHER' except WB-01008 ('Ration/Food') and
-- WB-01010 ('Flood Control').

BEGIN;

ALTER TABLE complaints DISABLE TRIGGER trg_js12_email;
ALTER TABLE complaints DISABLE TRIGGER complaints_updated_at;

UPDATE complaints c SET category = v.cat
FROM (VALUES
  ('WB-01008',          'RATION'),       -- was 'Ration/Food'   · PDS shop not distributing grain
  ('WB-01010',          'WATER'),        -- was 'Flood Control' · flood water entering the village
  ('WB-26-PUR-001004',  'ELECTRICITY'),  -- "no electricity connection due to heavy rain"
  ('WB-26-PUR-001007',  'YUVASATHI'),    -- "Yuvasathi payment dhuke ni"
  ('WB-26-PUR-001008',  'ROAD'),         -- "গ্রামে রাস্তা খারাপ"
  ('WB-26-PUR-001014',  'KANYASHREE'),   -- "Amar kanshsrer taka dukhe nai"
  ('WB-26-PUR-001015',  'RUPASHREE'),    -- "Rupashree টাকা না পাওয়া"
  ('WB-26-PUR-001016',  'YUVASHREE'),    -- "যুবশ্রী টাকা না পাওয়া"
  ('WB-26-PUR-001018',  'WATER'),        -- community irrigation well
  ('WB-26-PUR-001019',  'HOUSING'),      -- "পাকা বাড়ি পাই নি"
  ('WB-26-PUR-001020',  'SANITATION'),   -- rubbish dumped in the well
  ('WB-26-PUR-001022',  'YUVASATHI'),    -- "যুব সাথীর টাকা ঢুকে নাই"
  ('WB-26-PUR-001025',  'ELECTRICITY'),  -- "Current gale amader 12 ghta current thake na"
  ('WB-26-PUR-001026',  'ELECTRICITY'),
  ('WB-26-PUR-001027',  'SCHOLARSHIP'),  -- "Scholarship dhuke nai"
  ('WB-26-PUR-001029',  'ELECTRICITY'),  -- "Bidyut"
  ('WB-26-PUR-001032',  'WATER'),        -- "Water Issue / No water at all"
  ('WB-26-PUR-001033',  'RATION'),       -- Annapurna Bhandar
  ('WB-26-PUR-001039',  'ROAD'),         -- "রাস্তা খারাপ হয়ে গেছে"
  ('WB-26-PUR-001040',  'WATER'),        -- "জল আসছে না"
  ('WB-26-PUR-001041',  'PENSION'),      -- old age pension status
  ('WB-26-PUR-001044',  'WATER')         -- "drinking water / khvar jol thik nai"
) AS v(tkt, cat)
WHERE c."ticketNo" = v.tkt
  -- Never overwrite a category a person chose. Only the broken ones.
  AND (c.category = 'OTHER' OR c.category NOT IN (
    'WATER','ELECTRICITY','ROAD','SANITATION','HEALTH','RATION','PENSION','HOUSING',
    'EDUCATION','SCHOLARSHIP','KANYASHREE','LAKSHMIR_BHANDAR','YUVASATHI','KRISHAK_BANDHU',
    'SWASTHYA_SATHI','RUPASHREE','STUDENT_CREDIT_CARD','SABOOJ_SATHI','SHRAMSHREE','YUVASHREE',
    'LAND','LAW_ORDER','OTHER'));

ALTER TABLE complaints ENABLE TRIGGER trg_js12_email;
ALTER TABLE complaints ENABLE TRIGGER complaints_updated_at;

COMMIT;
