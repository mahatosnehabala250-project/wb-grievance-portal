/**
 * Canonical block key for cross-table joins.
 *
 * The same block is spelled three ways depending on where it came from:
 *
 *   constituency_block_mapping : Baghmundi   Bandwan   Joypur   Purulia I
 *   complaints                 : Bagmundi    Bundwan   Jaipur   Purulia I
 *   polling_stations           : Bagmundi    Bundwan   Jaipur   Purulia-I
 *
 * (LGD vs ECI spellings, plus inconsistent separators.) Comparing the raw text
 * silently drops whole blocks — the district block rollup reported zero
 * complaints for Bandwan, Baghmundi, Joypur and Raghunathpur I, four of the
 * busiest, until both sides were normalised.
 *
 * There is a twin of this in SQL, `norm_block(text)`, used by
 * get_district_command_center. Keep the two alias lists in step.
 */

const BLOCK_ALIASES: Record<string, string> = {
  bundwan: 'bandwan',
  bagmundi: 'baghmundi',
  jaipur: 'joypur',
};

/** Lowercase, strip spaces and hyphens, then fold known spelling variants. */
export function normBlock(s: string | null | undefined): string {
  const v = (s || '').toLowerCase().replace(/[\s-]/g, '');
  return BLOCK_ALIASES[v] || v;
}
