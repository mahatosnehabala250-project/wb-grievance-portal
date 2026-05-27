/**
 * Cascade Tier Schedule — Smart Donor Cascade (Requirement 5).
 *
 * Pure module defining the tiered notification schedule for blood requests.
 * No I/O, no DB, no side effects. Used by both the JS-15B n8n workflow
 * (via Code Node build step) and the admin escalation API.
 *
 * Tier schedules by urgency:
 *   routine (3+ days): 4 tiers — 0/30/120/360 min
 *   urgent  (within 24h): 3 tiers — 0/15/60 min
 *   critical (within 2h / SOS): 2 tiers — 0/30 min (fan-out)
 *
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirement 5
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §Property 4
 */

export type Urgency = 'routine' | 'urgent' | 'critical';

export type TierConfig = {
  tier: number;
  count: number;
  scope: 'block' | 'district' | 'adjacent';
  waitMinutes: number;
};

/**
 * Tier schedules keyed by urgency level.
 *
 * routine (3+ days available):
 *   Tier 1: top 3 same-block donors, immediate (wait 0)
 *   Tier 2: next 5 same-block, wait 30 min
 *   Tier 3: next 10 district-wide, wait 120 min (2 hours)
 *   Tier 4: adjacent districts, wait 360 min (6 hours)
 *
 * urgent (within 24 hours):
 *   Tier 1: top 5, immediate
 *   Tier 2: next 10, wait 15 min
 *   Tier 3: next 20 district-wide, wait 60 min (1 hour)
 *
 * critical (within 2 hours / SOS):
 *   Tier 1: ALL matching donors in district, immediate (fan-out)
 *   Tier 2: adjacent districts, wait 30 min
 */
const SCHEDULES: Record<Urgency, TierConfig[]> = {
  routine: [
    { tier: 1, count: 3, scope: 'block', waitMinutes: 0 },
    { tier: 2, count: 5, scope: 'block', waitMinutes: 30 },
    { tier: 3, count: 10, scope: 'district', waitMinutes: 120 },
    { tier: 4, count: 0, scope: 'adjacent', waitMinutes: 360 },
  ],
  urgent: [
    { tier: 1, count: 5, scope: 'block', waitMinutes: 0 },
    { tier: 2, count: 10, scope: 'block', waitMinutes: 15 },
    { tier: 3, count: 20, scope: 'district', waitMinutes: 60 },
  ],
  critical: [
    { tier: 1, count: 0, scope: 'district', waitMinutes: 0 },
    { tier: 2, count: 0, scope: 'adjacent', waitMinutes: 30 },
  ],
};

/**
 * Returns the full tier schedule for a given urgency level.
 *
 * @param urgency - The urgency classification of the blood request.
 * @returns Array of TierConfig objects ordered by tier number.
 */
export function getTierSchedule(urgency: Urgency): TierConfig[] {
  return SCHEDULES[urgency];
}

/**
 * Returns the next tier config after the current tier, or null if the
 * cascade is exhausted (no more tiers to escalate to).
 *
 * @param urgency - The urgency classification of the blood request.
 * @param currentTier - The tier number that was just completed (1-based).
 * @returns The next TierConfig, or null if cascade is exhausted.
 */
export function getNextTier(urgency: Urgency, currentTier: number): TierConfig | null {
  const schedule = SCHEDULES[urgency];
  const nextIndex = currentTier; // currentTier is 1-based, so index for next = currentTier
  if (nextIndex >= schedule.length) {
    return null;
  }
  return schedule[nextIndex];
}

/**
 * Returns true if the cascade has no more tiers to escalate to.
 *
 * @param urgency - The urgency classification of the blood request.
 * @param currentTier - The tier number that was just completed (1-based).
 * @returns true if no further tiers exist.
 */
export function isCascadeExhausted(urgency: Urgency, currentTier: number): boolean {
  return getNextTier(urgency, currentTier) === null;
}

/**
 * Given an urgency and elapsed minutes since the cascade started, returns
 * the tier number that should currently be active.
 *
 * The active tier is the highest tier whose cumulative wait time has elapsed.
 * Cumulative wait for tier N = sum of waitMinutes for tiers 1..N.
 *
 * @param urgency - The urgency classification.
 * @param elapsedMinutes - Minutes elapsed since cascade start.
 * @returns The 1-based tier number that should be active.
 */
export function expectedTier(urgency: Urgency, elapsedMinutes: number): number {
  const schedule = SCHEDULES[urgency];
  let activeTier = 1;

  for (let i = 1; i < schedule.length; i++) {
    if (elapsedMinutes >= schedule[i].waitMinutes) {
      activeTier = schedule[i].tier;
    } else {
      break;
    }
  }

  return activeTier;
}

/**
 * Returns the wait time (in minutes) before the next tier fires, or null
 * if the cascade is exhausted at the current tier.
 *
 * This is used by the n8n Wait Node to configure the delay between tiers.
 *
 * @param urgency - The urgency classification.
 * @param currentTier - The tier that just completed (1-based).
 * @returns Minutes to wait before next tier, or null if exhausted.
 */
export function nextWaitMinutes(urgency: Urgency, currentTier: number): number | null {
  const next = getNextTier(urgency, currentTier);
  if (!next) return null;
  return next.waitMinutes;
}
