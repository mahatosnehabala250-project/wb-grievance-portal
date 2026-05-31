// Feature: sahayak-multi-agent-router, Task 21.6 — Nightly Bandit Trainer
//
// Unit tests for the PURE bandit computation exported from the cron route
// (`src/app/api/cron/bandit-trainer/route.ts`). The route's `GET` handler does
// the Supabase IO; `computeBanditPolicyUpdates` and its helpers are isolated so
// they can be exercised deterministically with an injected RNG.
//
// Covers Design §v1.1.4 "Bandit math" + Req 23.3 (cold-start), 23.4 (reward /
// Thompson sampling), 23.7 (audit prev_value/new_value via the emitted update).

import { describe, it, expect, vi } from 'vitest';

// The cron route builds a module-level Supabase client at import time. These
// tests only exercise the PURE exported compute functions (no IO), so stub
// `createClient` to a no-op — vi.mock is hoisted above the route import below.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}));

import {
  reward,
  median,
  hourBucketOf,
  sampleBeta,
  computeBanditPolicyUpdates,
  type BanditOutcome,
  type ExistingPolicy,
} from '../../src/app/api/cron/bandit-trainer/route';

// ─── A deterministic uniform RNG (LCG) so Thompson sampling is reproducible ───
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // Numerical Recipes LCG
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ─── hourBucketOf ─────────────────────────────────────────────────────────────

describe('hourBucketOf — 4-hour bucket start hour', () => {
  it('maps every hour-of-day to {0,4,8,12,16,20}', () => {
    expect(hourBucketOf(0)).toBe(0);
    expect(hourBucketOf(3)).toBe(0);
    expect(hourBucketOf(4)).toBe(4);
    expect(hourBucketOf(11)).toBe(8);
    expect(hourBucketOf(15)).toBe(12);
    expect(hourBucketOf(19)).toBe(16);
    expect(hourBucketOf(23)).toBe(20);
  });

  it('clamps out-of-range hours into [0,23]', () => {
    expect(hourBucketOf(-5)).toBe(0);
    expect(hourBucketOf(99)).toBe(20);
  });
});

// ─── reward (Design §v1.1.4) ──────────────────────────────────────────────────

describe('reward — clip(60 / ttfa, 0, 1) - λ * total_invited', () => {
  const base: BanditOutcome = {
    urgency: 'urgent',
    district: 'Howrah',
    blood_group: 'O+',
    hour_of_day: 10,
    tier_size: 5,
    wait_minutes: 15,
    time_to_first_accept_minutes: 60,
    total_invited: 0,
  };

  it('saturates the speed term at 1.0 when ttfa <= 60 min', () => {
    expect(reward({ ...base, time_to_first_accept_minutes: 60 }, 0.05)).toBeCloseTo(1.0, 10);
    expect(reward({ ...base, time_to_first_accept_minutes: 30 }, 0.05)).toBeCloseTo(1.0, 10);
    expect(reward({ ...base, time_to_first_accept_minutes: 0 }, 0.05)).toBeCloseTo(1.0, 10);
  });

  it('decays the speed term as ttfa grows beyond 60 min', () => {
    expect(reward({ ...base, time_to_first_accept_minutes: 120 }, 0)).toBeCloseTo(0.5, 10);
    expect(reward({ ...base, time_to_first_accept_minutes: 240 }, 0)).toBeCloseTo(0.25, 10);
  });

  it('treats a null ttfa (no donor accepted) as the worst speed (0)', () => {
    expect(reward({ ...base, time_to_first_accept_minutes: null, total_invited: 0 }, 0.05)).toBe(0);
  });

  it('subtracts the anti-burnout penalty proportional to total_invited', () => {
    // speed = 1.0 (ttfa=60), penalty = 0.05 * 4 = 0.2 → 0.8
    expect(reward({ ...base, time_to_first_accept_minutes: 60, total_invited: 4 }, 0.05)).toBeCloseTo(
      0.8,
      10
    );
  });

  it('λ=0 disables the fairness penalty entirely', () => {
    expect(reward({ ...base, time_to_first_accept_minutes: 60, total_invited: 100 }, 0)).toBeCloseTo(
      1.0,
      10
    );
  });
});

// ─── median ───────────────────────────────────────────────────────────────────

describe('median — success/failure threshold', () => {
  it('returns null for an empty set', () => {
    expect(median([])).toBeNull();
  });
  it('returns the middle value for odd-length sets', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('averages the two middle values for even-length sets', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

// ─── sampleBeta ─────────────────────────────────────────────────────────────

describe('sampleBeta — Beta(α,β) sampler', () => {
  it('always returns a value in [0,1]', () => {
    const rng = lcg(42);
    for (let i = 0; i < 200; i++) {
      const v = sampleBeta(1 + Math.floor(rng() * 10), 1 + Math.floor(rng() * 10), rng);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for a fixed RNG stream', () => {
    const a = sampleBeta(3, 2, lcg(7));
    const b = sampleBeta(3, 2, lcg(7));
    expect(a).toBe(b);
  });

  it('skews high when α >> β (mostly successes)', () => {
    const rng = lcg(123);
    let sum = 0;
    const N = 500;
    for (let i = 0; i < N; i++) sum += sampleBeta(50, 2, rng);
    expect(sum / N).toBeGreaterThan(0.8); // mean ≈ 50/52
  });
});

// ─── computeBanditPolicyUpdates — cold-start gate (Req 23.3) ──────────────────

describe('computeBanditPolicyUpdates — cold-start safety', () => {
  function makeOutcome(overrides: Partial<BanditOutcome> = {}): BanditOutcome {
    return {
      urgency: 'urgent',
      district: 'Howrah',
      blood_group: 'O+',
      hour_of_day: 10,
      tier_size: 5,
      wait_minutes: 15,
      time_to_first_accept_minutes: 30,
      total_invited: 2,
      ...overrides,
    };
  }

  it('does NOT write a bandit policy for an arm with < 50 outcomes', () => {
    const outcomes = Array.from({ length: 49 }, () => makeOutcome());
    const report = computeBanditPolicyUpdates(outcomes, [], {
      lambda: 0.05,
      rng: lcg(1),
      now: new Date('2026-03-01T00:00:00Z'),
    });
    expect(report.arms_observed).toBe(1);
    expect(report.arms_updated).toBe(0);
    expect(report.arms_cold_start).toBe(1);
    expect(report.updates).toHaveLength(0);
  });

  it('writes a bandit policy once an arm reaches exactly 50 outcomes', () => {
    const outcomes = Array.from({ length: 50 }, () => makeOutcome());
    const report = computeBanditPolicyUpdates(outcomes, [], {
      lambda: 0.05,
      rng: lcg(1),
      now: new Date('2026-03-01T00:00:00Z'),
    });
    expect(report.arms_updated).toBe(1);
    expect(report.updates).toHaveLength(1);
    expect(report.updates[0].action).toBe('created'); // no prior row
    expect(report.updates[0].district).toBe('Howrah');
    expect(report.updates[0].blood_group).toBe('O+');
    expect(report.updates[0].hour_bucket).toBe(8); // hour 10 → bucket 8
  });

  it('ignores outcomes missing a concrete (district, blood_group, hour_of_day)', () => {
    const outcomes = Array.from({ length: 60 }, () => makeOutcome({ district: null }));
    const report = computeBanditPolicyUpdates(outcomes, [], {
      lambda: 0.05,
      rng: lcg(1),
      now: new Date('2026-03-01T00:00:00Z'),
    });
    expect(report.arms_observed).toBe(0);
    expect(report.arms_updated).toBe(0);
  });
});

// ─── computeBanditPolicyUpdates — winner selection + carry-forward + audit ────

describe('computeBanditPolicyUpdates — Thompson winner + policy shape', () => {
  // Two candidate actions in one warm arm: a FAST one (ttfa small, low invites)
  // and a SLOW one (ttfa large, many invites). The fast action should dominate.
  function makeArm(): BanditOutcome[] {
    const fast: BanditOutcome[] = Array.from({ length: 40 }, () => ({
      urgency: 'urgent',
      district: 'Howrah',
      blood_group: 'O+',
      hour_of_day: 10,
      tier_size: 5,
      wait_minutes: 10,
      time_to_first_accept_minutes: 10, // speed term saturates at 1.0
      total_invited: 1,
    }));
    const slow: BanditOutcome[] = Array.from({ length: 40 }, () => ({
      urgency: 'urgent',
      district: 'Howrah',
      blood_group: 'O+',
      hour_of_day: 10,
      tier_size: 12,
      wait_minutes: 60,
      time_to_first_accept_minutes: 600, // speed term ≈ 0.1
      total_invited: 12,
    }));
    return [...fast, ...slow];
  }

  it('picks the higher-reward candidate action as tier_1/wait_1', () => {
    const report = computeBanditPolicyUpdates(makeArm(), [], {
      lambda: 0.05,
      rng: lcg(99),
      now: new Date('2026-03-01T00:00:00Z'),
    });
    expect(report.updates).toHaveLength(1);
    const u = report.updates[0];
    // The fast action (tier_size=5, wait=10) is strictly better on reward and
    // should win the Thompson draw given its much higher α/β ratio.
    expect(u.tier_1_count).toBe(5);
    expect(u.wait_1_minutes).toBe(10);
    expect(u.candidate_count).toBe(2);
    expect(u.alpha).toBeGreaterThanOrEqual(1);
    expect(u.beta).toBeGreaterThanOrEqual(1);
  });

  it('carries tier_2/3 + wait_2/3 forward from the existing default row', () => {
    const existing: ExistingPolicy[] = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        urgency: 'urgent',
        hour_bucket: 8,
        district: null,
        blood_group: null,
        tier_1_count: 5,
        tier_2_count: 10,
        tier_3_count: 20,
        wait_1_minutes: 15,
        wait_2_minutes: 60,
        wait_3_minutes: 120,
        alpha: 1,
        beta: 1,
        source: 'default',
      },
    ];
    const report = computeBanditPolicyUpdates(makeArm(), existing, {
      lambda: 0.05,
      rng: lcg(99),
      now: new Date('2026-03-01T00:00:00Z'),
    });
    const u = report.updates[0];
    expect(u.tier_2_count).toBe(10);
    expect(u.tier_3_count).toBe(20);
    expect(u.wait_2_minutes).toBe(60);
    expect(u.wait_3_minutes).toBe(120);
    // The carry-forward default is universal-scope, so this exact arm has no
    // prior scoped row → it is a 'created' write with no prev_value.
    expect(u.action).toBe('created');
    expect(u.prev_value).toBeNull();
  });

  it('emits prev_value + action=updated when a scoped bandit row already exists', () => {
    const existing: ExistingPolicy[] = [
      {
        id: '00000000-0000-0000-0000-000000000002',
        urgency: 'urgent',
        hour_bucket: 8,
        district: 'Howrah',
        blood_group: 'O+',
        tier_1_count: 3,
        tier_2_count: 6,
        tier_3_count: 12,
        wait_1_minutes: 20,
        wait_2_minutes: 40,
        wait_3_minutes: 90,
        alpha: 4,
        beta: 2,
        source: 'bandit',
      },
    ];
    const report = computeBanditPolicyUpdates(makeArm(), existing, {
      lambda: 0.05,
      rng: lcg(99),
      now: new Date('2026-03-01T00:00:00Z'),
    });
    const u = report.updates[0];
    expect(u.action).toBe('updated');
    expect(u.prev_value).toMatchObject({
      tier_1_count: 3,
      wait_1_minutes: 20,
      source: 'bandit',
    });
    // tier_2/3 carry forward from the scoped row (not the default).
    expect(u.tier_2_count).toBe(6);
    expect(u.tier_3_count).toBe(12);
  });

  it('reports the median reward threshold and scored-outcome count', () => {
    const report = computeBanditPolicyUpdates(makeArm(), [], {
      lambda: 0.05,
      rng: lcg(99),
      now: new Date('2026-03-01T00:00:00Z'),
    });
    expect(report.scored_outcomes).toBe(80);
    expect(report.median_reward).not.toBeNull();
  });
});
