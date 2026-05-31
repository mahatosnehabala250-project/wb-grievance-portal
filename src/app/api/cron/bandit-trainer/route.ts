import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/cron/bandit-trainer   (Vercel Cron)
 *
 * Nightly Bandit Trainer for the Adaptive Donor Cascade (task 21.6, Req 23.4 /
 * 23.7, Design §v1.1.4 "Bandit math"). Reads the canonical bandit-training rows
 * from `cascade_outcomes` (district, blood_group, urgency, hour_of_day,
 * day_of_week, tier_size, wait_minutes, time_to_first_accept_minutes,
 * total_accepted, total_invited — migration 20260201_021), runs Thompson
 * sampling over Beta(α, β) posteriors per candidate action within each
 * `(urgency, hour_bucket, district, blood_group)` arm, and writes the winning
 * `(tier_size, wait_minutes)` to the matching `cascade_policies` row with
 * `source='bandit'`. Every write is audited in `cascade_policy_audit`.
 *
 * ─── Bandit math (Design §v1.1.4) ────────────────────────────────────────────
 *   reward(outcome) = clip(60 / time_to_first_accept_minutes, 0, REWARD_CLIP)
 *                   - λ * burnout_proxy(outcome)
 *
 * The fairness penalty in the design is `λ * mean(invitations_last_30d of the
 * invited donors)`. The canonical `cascade_outcomes` columns enumerated by
 * Req 18.5 / 23.4 do NOT carry per-donor `invitations_last_30d`; the closest
 * available burnout signal on the outcome row is `total_invited` (how many
 * donors that policy summoned). We use `total_invited` as the burnout proxy.
 * This is sound because the posterior update **thresholds each reward against
 * the median historical reward to a binary success/failure indicator** (Design
 * §v1.1.4) — so only the *relative ordering* of rewards matters, never their
 * absolute scale. A policy that invites more donors for the same acceptance
 * speed ranks below a leaner one, which is exactly the anti-burnout intent.
 *
 *   success(outcome) = reward(outcome) >= median(all rewards)  ? 1 : 0
 *   per candidate action (tier_size, wait_minutes):
 *     α = 1 + Σ success    β = 1 + Σ failure          (Beta(1,1) uniform prior)
 *     θ ~ Beta(α, β)
 *   winner = argmax_candidate θ      → tier_1_count, wait_1_minutes
 *
 * λ defaults to 0.05 and is tunable at runtime from `/dashboard/system-health`
 * via the `system_config` key `CASCADE_BANDIT_LAMBDA` (admin only).
 *
 * ─── Cold-start safety (Req 23.3) ────────────────────────────────────────────
 * A bandit row is only written once an arm has accumulated >= MIN_OUTCOMES (50)
 * outcomes, matching the Policy Resolver's cold-start guard
 * (migration 20260201_009_resolve_cascade_policy.sql Phase B). Because the gate
 * counts outcomes within the trainer's lookback window — a subset of the
 * resolver's all-time count — any arm the trainer deems "warm" (>= 50 in window)
 * is also warm for the resolver (>= 50 all-time), so a written bandit policy is
 * always consistent with what the resolver will pick up. Only arms with a
 * CONCRETE (non-NULL) district AND blood_group are written: those map to the
 * resolver's most-specific level and avoid the SQL "NULLs are distinct" upsert
 * ambiguity on the `(urgency, hour_bucket, district, blood_group)` unique key.
 *
 * ─── Schedule ────────────────────────────────────────────────────────────────
 * Registered in `vercel.json` `crons` as a nightly run at 03:30 UTC:
 *   { "path": "/api/cron/bandit-trainer", "schedule": "30 3 * * *" }
 * Vercel Cron invokes the route with a GET request.
 *
 * ─── Auth ────────────────────────────────────────────────────────────────────
 * Vercel attaches `Authorization: Bearer ${CRON_SECRET}` to cron invocations.
 * This handler rejects any request whose bearer token does not match
 * `process.env.CRON_SECRET` (fail-closed): if `CRON_SECRET` is unset the route
 * refuses to run. Mirrors `src/app/api/cron/classifier-calibration/route.ts`.
 *
 * Response: { ok: true, data: BanditTrainerReport }
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.4 (Bandit math)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 23.4, 23.7
 * @see supabase/migrations/20260201_021_cascade_outcome_logger.sql — cascade_outcomes canonical columns
 * @see supabase/migrations/20260201_002_adaptive_cascade.sql — cascade_policies + cascade_policy_audit
 * @see supabase/migrations/20260201_009_resolve_cascade_policy.sql — resolver cold-start guard
 */

export const runtime = 'nodejs';
// Never serve a cached response for a cron mutation.
export const dynamic = 'force-dynamic';

/**
 * Service-role Supabase client — matches the convention used by the sibling
 * cron route and the v1.1 read/write routes.
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** system_config key for the tunable anti-burnout penalty weight λ. */
const LAMBDA_CONFIG_KEY = 'CASCADE_BANDIT_LAMBDA';
/** Default λ when the config key is absent / unparseable (Design §v1.1.4). */
const DEFAULT_LAMBDA = 0.05;
/** Upper clip on the fulfillment-speed reward term. */
const REWARD_CLIP = 1.0;
/** Reward numerator: reward saturates at 1.0 once first accept is <= 60 min. */
const REWARD_NUMERATOR = 60;
/** Cold-start threshold — arms with fewer outcomes keep the static schedule. */
const MIN_OUTCOMES = 50;
/** How far back to read outcomes for the nightly posterior recompute (days). */
const LOOKBACK_DAYS = 30;

// ─── Types ───────────────────────────────────────────────────────────────────

/** The subset of `cascade_outcomes` columns the trainer consumes. */
export interface BanditOutcome {
  urgency: string | null;
  district: string | null;
  blood_group: string | null;
  hour_of_day: number | null;
  tier_size: number | null;
  wait_minutes: number | null;
  time_to_first_accept_minutes: number | null;
  total_invited: number | null;
}

/** The subset of `cascade_policies` columns needed for carry-forward + audit. */
export interface ExistingPolicy {
  id: string;
  urgency: string;
  hour_bucket: number;
  district: string | null;
  blood_group: string | null;
  tier_1_count: number;
  tier_2_count: number;
  tier_3_count: number;
  wait_1_minutes: number;
  wait_2_minutes: number;
  wait_3_minutes: number;
  alpha: number;
  beta: number;
  source: string;
}

/** A single learned policy the trainer wants to persist. */
export interface PolicyUpdate {
  urgency: string;
  hour_bucket: number;
  district: string;
  blood_group: string;
  /** All-window outcome count for the arm (cold-start gate input). */
  outcome_count: number;
  /** Distinct (tier_size, wait_minutes) candidate actions considered. */
  candidate_count: number;
  /** The chosen winning action + carried-forward tiers. */
  tier_1_count: number;
  tier_2_count: number;
  tier_3_count: number;
  wait_1_minutes: number;
  wait_2_minutes: number;
  wait_3_minutes: number;
  /** Winning candidate's posterior. */
  alpha: number;
  beta: number;
  /** 'created' (no prior bandit/default row) or 'updated'. */
  action: 'created' | 'updated';
  /** Previous policy values for the audit trail, or null when newly created. */
  prev_value: Record<string, unknown> | null;
}

/** The full snapshot returned to the caller. */
export interface BanditTrainerReport {
  generated_at: string;
  lookback_days: number;
  lambda: number;
  reward_clip: number;
  min_outcomes: number;
  /** Total outcomes scanned in the window. */
  total_outcomes: number;
  /** Outcomes with all reward inputs present (contribute to the posterior). */
  scored_outcomes: number;
  /** Median reward across scored outcomes (the success/failure threshold). */
  median_reward: number | null;
  /** Distinct arms observed in the window. */
  arms_observed: number;
  /** Arms that cleared the cold-start gate and were written. */
  arms_updated: number;
  /** Arms still in cold-start (kept the static schedule). */
  arms_cold_start: number;
  /** The policies written this run. */
  updates: PolicyUpdate[];
}

// ─── Pure helpers (deterministic, RNG-injectable for testability) ─────────────

/** Clamp `n` into the inclusive [min, max] range. */
function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/** 4-hour bucket START hour (0,4,8,12,16,20) — matches the seeded policy rows. */
export function hourBucketOf(hourOfDay: number): number {
  return Math.floor(clamp(hourOfDay, 0, 23) / 4) * 4;
}

/**
 * Per-outcome reward (Design §v1.1.4). `total_invited` stands in for the
 * design's `mean(invitations_last_30d)` burnout penalty (see file header).
 *   - A null `time_to_first_accept_minutes` means no donor ever accepted →
 *     worst fulfillment term (0).
 *   - 0 minutes (instant accept) saturates the term at REWARD_CLIP.
 */
export function reward(o: BanditOutcome, lambda: number): number {
  const ttfa = o.time_to_first_accept_minutes;
  let speed: number;
  if (ttfa === null || ttfa === undefined) {
    speed = 0;
  } else if (ttfa <= 0) {
    speed = REWARD_CLIP;
  } else {
    speed = clamp(REWARD_NUMERATOR / ttfa, 0, REWARD_CLIP);
  }
  const burnout = o.total_invited ?? 0;
  return speed - lambda * burnout;
}

/** Median of a numeric array (average of the two middle values when even). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Standard normal sample via Box-Muller, driven by an injectable uniform RNG. */
function normalSample(rng: () => number): number {
  // Guard against log(0).
  let u1 = rng();
  if (u1 <= 0) u1 = Number.EPSILON;
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Gamma(shape, 1) sample via Marsaglia-Tsang (valid for shape >= 1, which holds
 * here since shapes are 1 + non-negative integer counts). Deterministic given a
 * deterministic `rng`.
 */
function gammaSample(shape: number, rng: () => number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Bounded retry loop — converges with very high probability per iteration.
  for (let i = 0; i < 1000; i++) {
    let x: number;
    let v: number;
    do {
      x = normalSample(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    let u = rng();
    if (u <= 0) u = Number.EPSILON;
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  // Fallback: the mean of the distribution.
  return shape;
}

/**
 * Beta(α, β) sample = G(α) / (G(α) + G(β)). Deterministic given `rng`.
 */
export function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const ga = gammaSample(alpha, rng);
  const gb = gammaSample(beta, rng);
  const sum = ga + gb;
  return sum === 0 ? 0.5 : ga / sum;
}

/** Composite key for one bandit arm. */
function armKey(urgency: string, hourBucket: number, district: string, bloodGroup: string): string {
  return `${urgency}|${hourBucket}|${district}|${bloodGroup}`;
}

/** Carry-forward source for a bucket's tier_2/3 + wait_2/3 (existing row else seed). */
function policyKey(urgency: string, hourBucket: number, district: string | null, bloodGroup: string | null): string {
  return `${urgency}|${hourBucket}|${district ?? ''}|${bloodGroup ?? ''}`;
}

/**
 * Pure bandit computation, separated from IO so it is unit-testable and
 * deterministic (the RNG is injected). Groups outcomes into arms, runs Thompson
 * sampling over the distinct candidate actions within each warm arm, and emits
 * the policy updates to persist.
 *
 * @param outcomes        cascade_outcomes rows in the lookback window
 * @param existingPolicies existing cascade_policies rows (carry-forward + prev_value)
 * @param opts.lambda     anti-burnout penalty weight λ
 * @param opts.rng        uniform [0,1) RNG (injected for deterministic tests)
 * @param opts.now        wall clock for the report timestamp
 */
export function computeBanditPolicyUpdates(
  outcomes: BanditOutcome[],
  existingPolicies: ExistingPolicy[],
  opts: { lambda: number; rng: () => number; now: Date }
): BanditTrainerReport {
  const { lambda, rng, now } = opts;

  // Index existing policies for carry-forward + prev_value lookups.
  // Prefer an exact-scope row; fall back to the universal default for the bucket.
  const exactPolicy = new Map<string, ExistingPolicy>();
  const defaultPolicy = new Map<string, ExistingPolicy>(); // key: urgency|hour_bucket
  for (const p of existingPolicies) {
    exactPolicy.set(policyKey(p.urgency, p.hour_bucket, p.district, p.blood_group), p);
    if (p.source === 'default' && p.district === null && p.blood_group === null) {
      defaultPolicy.set(`${p.urgency}|${p.hour_bucket}`, p);
    }
  }

  // ─── 1) Per-arm grouping + global reward collection ───
  interface Arm {
    urgency: string;
    hour_bucket: number;
    district: string;
    blood_group: string;
    count: number;
    // candidate action key `${tier_size}|${wait_minutes}` → its scored outcomes
    candidates: Map<string, { tier_size: number; wait_minutes: number; rewards: number[] }>;
  }
  const arms = new Map<string, Arm>();
  const allRewards: number[] = [];
  let scored = 0;

  for (const o of outcomes) {
    // An arm requires a concrete (urgency, hour_of_day, district, blood_group).
    if (
      o.urgency === null ||
      o.hour_of_day === null ||
      o.district === null ||
      o.blood_group === null
    ) {
      continue;
    }
    const hb = hourBucketOf(o.hour_of_day);
    const key = armKey(o.urgency, hb, o.district, o.blood_group);
    let arm = arms.get(key);
    if (!arm) {
      arm = {
        urgency: o.urgency,
        hour_bucket: hb,
        district: o.district,
        blood_group: o.blood_group,
        count: 0,
        candidates: new Map(),
      };
      arms.set(key, arm);
    }
    // Every outcome counts toward the cold-start gate (matches the resolver's
    // COUNT(*) over the feature combination, which does not require a full row).
    arm.count += 1;

    // Only outcomes with a full action contribute to the posterior.
    if (o.tier_size === null || o.wait_minutes === null) continue;
    const r = reward(o, lambda);
    allRewards.push(r);
    scored += 1;
    const candKey = `${o.tier_size}|${o.wait_minutes}`;
    let cand = arm.candidates.get(candKey);
    if (!cand) {
      cand = { tier_size: o.tier_size, wait_minutes: o.wait_minutes, rewards: [] };
      arm.candidates.set(candKey, cand);
    }
    cand.rewards.push(r);
  }

  const medianReward = median(allRewards);

  // ─── 2) Per-arm Thompson sampling over candidate actions ───
  const updates: PolicyUpdate[] = [];
  let coldStart = 0;

  for (const arm of arms.values()) {
    // Cold-start gate (Req 23.3) — matches the resolver's >= 50 guard.
    if (arm.count < MIN_OUTCOMES) {
      coldStart += 1;
      continue;
    }
    // Need at least one scored candidate and a defined threshold to learn.
    if (arm.candidates.size === 0 || medianReward === null) {
      coldStart += 1;
      continue;
    }

    // Sample θ for each candidate; pick argmax.
    let best: {
      tier_size: number;
      wait_minutes: number;
      alpha: number;
      beta: number;
      theta: number;
    } | null = null;

    for (const cand of arm.candidates.values()) {
      let successes = 0;
      let failures = 0;
      for (const r of cand.rewards) {
        if (r >= medianReward) successes += 1;
        else failures += 1;
      }
      const alpha = 1 + successes;
      const beta = 1 + failures;
      const theta = sampleBeta(alpha, beta, rng);
      if (best === null || theta > best.theta) {
        best = { tier_size: cand.tier_size, wait_minutes: cand.wait_minutes, alpha, beta, theta };
      }
    }

    if (best === null) {
      coldStart += 1;
      continue;
    }

    // Carry forward tier_2/3 + wait_2/3 from the existing scoped row, else the
    // universal default row for the bucket, else conservative fallbacks.
    const existing =
      exactPolicy.get(policyKey(arm.urgency, arm.hour_bucket, arm.district, arm.blood_group)) ?? null;
    const carry =
      existing ?? defaultPolicy.get(`${arm.urgency}|${arm.hour_bucket}`) ?? null;

    const tier_2_count = carry?.tier_2_count ?? 5;
    const tier_3_count = carry?.tier_3_count ?? 10;
    const wait_2_minutes = carry?.wait_2_minutes ?? 60;
    const wait_3_minutes = carry?.wait_3_minutes ?? 360;

    const prev_value: Record<string, unknown> | null = existing
      ? {
          tier_1_count: existing.tier_1_count,
          tier_2_count: existing.tier_2_count,
          tier_3_count: existing.tier_3_count,
          wait_1_minutes: existing.wait_1_minutes,
          wait_2_minutes: existing.wait_2_minutes,
          wait_3_minutes: existing.wait_3_minutes,
          alpha: existing.alpha,
          beta: existing.beta,
          source: existing.source,
        }
      : null;

    updates.push({
      urgency: arm.urgency,
      hour_bucket: arm.hour_bucket,
      district: arm.district,
      blood_group: arm.blood_group,
      outcome_count: arm.count,
      candidate_count: arm.candidates.size,
      tier_1_count: best.tier_size,
      tier_2_count,
      tier_3_count,
      wait_1_minutes: best.wait_minutes,
      wait_2_minutes,
      wait_3_minutes,
      alpha: best.alpha,
      beta: best.beta,
      action: existing ? 'updated' : 'created',
      prev_value,
    });
  }

  return {
    generated_at: now.toISOString(),
    lookback_days: LOOKBACK_DAYS,
    lambda,
    reward_clip: REWARD_CLIP,
    min_outcomes: MIN_OUTCOMES,
    total_outcomes: outcomes.length,
    scored_outcomes: scored,
    median_reward: medianReward,
    arms_observed: arms.size,
    arms_updated: updates.length,
    arms_cold_start: coldStart,
    updates,
  };
}

/** Resolve λ from system_config (admin-tunable), falling back to the default. */
async function resolveLambda(): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', LAMBDA_CONFIG_KEY)
      .maybeSingle();
    if (!error && data?.value !== undefined && data?.value !== null) {
      const parsed = Number(data.value);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_LAMBDA;
}

export async function GET(request: NextRequest) {
  // ─── Auth: Vercel Cron bearer secret (fail-closed) ───
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error('[cron/bandit-trainer] CRON_SECRET is not configured — refusing to run');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not configured' },
      { status: 401 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const windowStartIso = windowStart.toISOString();

    // ─── 1) Read the canonical bandit-training outcomes in the window ───
    const { data: outcomeRows, error: outcomesErr } = await supabase
      .from('cascade_outcomes')
      .select(
        'urgency, district, blood_group, hour_of_day, tier_size, wait_minutes, time_to_first_accept_minutes, total_invited'
      )
      .gte('created_at', windowStartIso);

    if (outcomesErr) {
      console.error('[cron/bandit-trainer] cascade_outcomes query failed:', outcomesErr);
      return NextResponse.json(
        { ok: false, error: 'Failed to read cascade_outcomes', details: outcomesErr.message },
        { status: 500 }
      );
    }

    const outcomes: BanditOutcome[] = (outcomeRows ?? []).map((r) => ({
      urgency: (r as { urgency: string | null }).urgency,
      district: (r as { district: string | null }).district,
      blood_group: (r as { blood_group: string | null }).blood_group,
      hour_of_day: (r as { hour_of_day: number | null }).hour_of_day,
      tier_size: (r as { tier_size: number | null }).tier_size,
      wait_minutes: (r as { wait_minutes: number | null }).wait_minutes,
      time_to_first_accept_minutes: (r as { time_to_first_accept_minutes: number | null })
        .time_to_first_accept_minutes,
      total_invited: (r as { total_invited: number | null }).total_invited,
    }));

    // ─── 2) Existing policies for carry-forward + prev_value ───
    const { data: policyRows, error: policiesErr } = await supabase
      .from('cascade_policies')
      .select(
        'id, urgency, hour_bucket, district, blood_group, tier_1_count, tier_2_count, tier_3_count, wait_1_minutes, wait_2_minutes, wait_3_minutes, alpha, beta, source'
      );

    if (policiesErr) {
      console.error('[cron/bandit-trainer] cascade_policies query failed:', policiesErr);
      return NextResponse.json(
        { ok: false, error: 'Failed to read cascade_policies', details: policiesErr.message },
        { status: 500 }
      );
    }

    const existingPolicies = (policyRows ?? []) as ExistingPolicy[];

    // ─── 3) Resolve λ + compute the policy updates ───
    const lambda = await resolveLambda();
    const report = computeBanditPolicyUpdates(outcomes, existingPolicies, {
      lambda,
      rng: Math.random,
      now,
    });

    // ─── 4) Persist each learned policy + write its audit row ───
    const persisted: PolicyUpdate[] = [];
    for (const u of report.updates) {
      const { data: upserted, error: upsertErr } = await supabase
        .from('cascade_policies')
        .upsert(
          {
            urgency: u.urgency,
            hour_bucket: u.hour_bucket,
            district: u.district,
            blood_group: u.blood_group,
            tier_1_count: u.tier_1_count,
            tier_2_count: u.tier_2_count,
            tier_3_count: u.tier_3_count,
            wait_1_minutes: u.wait_1_minutes,
            wait_2_minutes: u.wait_2_minutes,
            wait_3_minutes: u.wait_3_minutes,
            alpha: u.alpha,
            beta: u.beta,
            source: 'bandit',
            updated_at: now.toISOString(),
          },
          { onConflict: 'urgency,hour_bucket,district,blood_group' }
        )
        .select('id')
        .single();

      if (upsertErr) {
        console.error('[cron/bandit-trainer] cascade_policies upsert failed:', upsertErr);
        // Skip the audit for this arm but keep training the rest.
        continue;
      }

      const new_value: Record<string, unknown> = {
        tier_1_count: u.tier_1_count,
        tier_2_count: u.tier_2_count,
        tier_3_count: u.tier_3_count,
        wait_1_minutes: u.wait_1_minutes,
        wait_2_minutes: u.wait_2_minutes,
        wait_3_minutes: u.wait_3_minutes,
        alpha: u.alpha,
        beta: u.beta,
        source: 'bandit',
      };

      // Req 23.7 — audit prev_value, new_value, source='bandit', created_at.
      const { error: auditErr } = await supabase.from('cascade_policy_audit').insert({
        policy_id: upserted.id,
        action: 'updated',
        old_values: u.prev_value,
        new_values: new_value,
        actor: 'bandit',
      });

      if (auditErr) {
        console.error('[cron/bandit-trainer] cascade_policy_audit insert failed:', auditErr);
      }

      persisted.push(u);
    }

    console.log(
      `[cron/bandit-trainer] Scanned ${report.total_outcomes} outcome(s), ` +
        `${report.arms_observed} arm(s); wrote ${persisted.length}/${report.updates.length} bandit ` +
        `policy row(s), ${report.arms_cold_start} arm(s) in cold-start (λ=${lambda})`
    );

    return NextResponse.json({
      ok: true,
      data: { ...report, arms_persisted: persisted.length },
    });
  } catch (err) {
    console.error('[cron/bandit-trainer] Error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
