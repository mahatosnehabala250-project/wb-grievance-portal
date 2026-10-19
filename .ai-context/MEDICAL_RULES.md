# Medical Rules & Compliance

> **Source:** Indian NACO (National AIDS Control Organisation) + NBTC (National Blood Transfusion Council) guidelines, WHO global recommendations.
> **Disclaimer:** This system is a donor matching tool. Final medical eligibility is decided by the hospital blood bank, not by this system.

## Inter-Donation Cooldown (must be enforced)

| Donation Type | Male | Female | Implementation |
|---|---|---|---|
| Whole Blood | **90 days (3 months)** | **120 days (4 months)** | `calculate_next_eligible_date()` |
| Plateletpheresis | 14 days | 14 days | Max 24 / year |
| Plasmapheresis | 14 days | 14 days | — |
| Double Red Cell | 168 days (6 months) | 168 days | — |

**Why female longer:** Iron recovery is slower due to menstrual blood loss; preventing donor anemia is mandatory.

## Yearly Donation Caps

| Type | Male | Female |
|---|---|---|
| Whole blood | max 4 / year | max 3 / year |
| Platelets | max 24 / year | max 24 / year |

When cap reached → donor marked ineligible until next calendar year (`donations_this_year` resets on Jan 1 via cron job).

## Eligibility Criteria

| Criterion | Rule |
|---|---|
| Age | 18-65 years (first-time donor: max 60) |
| Weight | ≥ 45 kg (some hospitals require 50 kg) |
| Hemoglobin | Male ≥ 12.5 g/dL, Female ≥ 12.0 g/dL (checked at hospital) |
| Pulse | 50-100 bpm (hospital) |
| BP | 100-180 / 50-100 mmHg (hospital) |
| Temperature | Normal, no fever |

System enforces age, weight, gender. Vitals checked at hospital.

## Temporary Deferrals

| Reason | Wait Period | Deferral Source |
|---|---|---|
| Tattoo / piercing | 6 months | Self-report or screening |
| Vaccination (most) | 14 days | Self-report or screening |
| Major surgery | 12 months | Self-report or admin |
| Dental work | 24 hours | Screening |
| Cold / flu / fever | 14 days post-recovery | Screening |
| Pregnancy | 12 months post-delivery | Self-report |
| Breastfeeding | Until weaning | Self-report |
| Malaria | 3 months post-recovery | Admin |
| Recent travel to malarial area | 3 months | Admin |
| Antibiotics | 7 days post-course | Self-report |
| Aspirin / NSAIDs | 48 hours (for platelets) | Screening |

Implementation: `blood_donors.deferral_until` (DATE) + `blood_donors.deferral_reason` (TEXT)

## Permanent Deferrals (encrypted at rest)

- HIV positive
- Hepatitis B / C positive
- Syphilis positive
- IV drug use history
- High-risk sexual exposure (per NACO)
- Certain cancers (per oncologist)
- Organ transplant recipient

Implementation:
- `blood_donors.permanently_deferred = true`
- `blood_donors.permanent_deferral_reason` (Supabase column-level encryption)
- Cannot be auto-lifted — admin review required

## Pre-Donation Screening (in-flow before HAAN confirmation)

Required questions before marking donor `accepted`:
1. Pichhle 14 din mein bukhar / khansi / cold? (recent illness)
2. Pichhle 6 mahine mein tattoo / piercing / surgery?
3. Pichhle 14 din mein koi vaccination?
4. Aaj subah se kuch khaaya pyaa hai? (food check)
5. Aap ne aaj / kal koi medication li hai?

Yes to (1) → defer 14 days
Yes to (2) → defer 6 months
Yes to (3) → defer 14 days
No to (4) → reschedule (donor must eat first)
Yes to (5) → ask which med, defer if applicable (aspirin = no platelets for 48h)

All responses logged in `screening_log` (5-year retention).

## Hemoglobin Tracking

Optional field `donation_history.hemoglobin_level` for donors who donated through partner hospitals that report back. Used to flag declining trends and proactively defer.

## Compatibility Matrix (`get_compatible_donors`)

For a recipient blood group, eligible donors:

| Recipient | Compatible Donors |
|---|---|
| O- | O- |
| O+ | O-, O+ |
| A- | O-, A- |
| A+ | O-, O+, A-, A+ |
| B- | O-, B- |
| B+ | O-, O+, B-, B+ |
| AB- | O-, A-, B-, AB- |
| AB+ | All groups |

Note: For platelets, compatibility is more flexible (mostly any compatible group works); for whole blood and red cells, the above is strict.

## Audit Trail

- `donation_history` is **immutable** (no UPDATE / DELETE allowed)
- Corrections require supersede entries with `notes` linking to original
- 5-year retention minimum
- `screening_log` retained 5 years

## Disclaimer Shown to Donors

At registration and each acceptance, the bot explicitly states:

> "Yeh sirf donor matching system hai. Final medical eligibility hospital pe blood bank decide karta hai. Aap ka health hospital staff check karega before donation."

## Anniversary Reminder

When `next_eligible_date` arrives, donor receives:
> "Aap ab dobara blood donate kar sakte ho! 🩸 Thank you for being a hero. Aap ne pehle [N] times donate kiya hai."

## Permanent Deferral Lift Workflow

1. Admin reviews medical proof submitted by donor
2. Admin marks `permanently_deferred = false`, clears `permanent_deferral_reason`
3. Action audit-logged in `activity_logs` with admin user ID and timestamp
4. Donor notified via WhatsApp

Never automate this lift — always require human medical review.
