/**
 * Sticky A/B selection — deterministic, weighted, session-level version pick.
 *
 * Pure module: no I/O, no DB, no shared state, no side effects. Given a stable
 * key (e.g. `session_id` or phone) and a set of weighted versions, it always
 * maps the same key to the same version (sticky) while the distribution across
 * many distinct keys respects the supplied weights.
 *
 * Selection algorithm (Design §v1.1.14):
 *   1. Keep only `active && weight > 0` entries (the eligible pool).
 *   2. `total = sum(weight)` over the pool.
 *   3. `slot  = mod(hashU32(sessionId), total)` — a stable bucket in [0, total).
 *   4. Cumulative-weight bucket walk: return the first entry whose running
 *      cumulative weight strictly exceeds `slot`.
 *
 * `pickVersion` is **referentially transparent** for a fixed
 * `(sessionId, versions)` pair — Property 33 (verified by task 31.8) depends
 * on this. The same key always lands in the same slot because `hashU32` is a
 * pure FNV-1a hash and the bucket walk is order-stable over the pool.
 *
 * Reused by:
 *   - the prompt loader (task 31.2) to pick a specialist-agent prompt version, and
 *   - the cascade policy harness (task 31.6) to stick a session to one policy.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.14 A/B Prompt and Policy Harness
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §Property 33: A/B sticky selection
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirement 33.2
 */

/**
 * A weighted, registerable version of some payload `T` (a prompt string, a
 * cascade-policy row, etc.). Mirrors a row from `agent_prompt_versions` /
 * `cascade_policies`.
 */
export type Versioned<T> = {
  /** Stable unique row id. */
  id: string;
  /** Human-facing version label (the field Property 33 compares on). */
  version: string;
  /** Relative selection weight. Must be > 0 to be eligible. */
  weight: number;
  /** Whether this version is eligible for selection. */
  active: boolean;
  /** The version-specific payload (prompt markdown, policy config, ...). */
  payload: T;
};

/**
 * 32-bit FNV-1a hash of a string, returned as an unsigned 32-bit integer.
 *
 * Pure and deterministic: identical inputs always yield the identical output,
 * with no dependency on platform, locale, or shared state. Uses `Math.imul`
 * for correct 32-bit multiplication wrap-around and `>>> 0` to coerce the
 * result back into the unsigned 32-bit range.
 *
 * Iterates UTF-16 code units (`charCodeAt`), which is fully deterministic for
 * any JavaScript string and ample for hashing session identifiers.
 *
 * @param s - The string to hash (e.g. a session id or phone number).
 * @returns An unsigned 32-bit integer in [0, 2^32).
 */
export function hashU32(s: string): number {
  // FNV-1a 32-bit: offset basis 0x811c9dc5, prime 0x01000193.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Non-negative modulo. Standard `%` can return a negative remainder for
 * negative `a`; this always returns a value in [0, m). `hashU32` never returns
 * a negative value, but `mod` is kept robust so the bucketing stays correct
 * regardless of the hash implementation.
 *
 * @param a - Dividend.
 * @param m - Modulus (must be > 0).
 * @returns A value in [0, m).
 */
export function mod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

/**
 * Deterministically and stably assign a key to one weighted version.
 *
 * Same `(sessionId, versions)` → same returned entry (sticky). Across many
 * distinct keys the chosen versions are distributed in proportion to their
 * weights. Pure: no side effects, no randomness, no shared state.
 *
 * @typeParam T - The payload type carried by each version.
 * @param sessionId - The stable key to bucket (e.g. session id or phone).
 * @param versions  - The candidate version set. Only entries with
 *                     `active === true && weight > 0` are eligible.
 * @returns The selected eligible `Versioned<T>`.
 * @throws {Error} If no entry is active with a positive weight.
 */
export function pickVersion<T>(sessionId: string, versions: Versioned<T>[]): Versioned<T> {
  const active = versions.filter((v) => v.active && v.weight > 0);
  if (active.length === 0) {
    throw new Error('no active version registered');
  }

  const total = active.reduce((sum, v) => sum + v.weight, 0);
  const slot = mod(hashU32(sessionId), total);

  let cum = 0;
  for (const v of active) {
    cum += v.weight;
    if (slot < cum) return v;
  }

  // Numeric safety: fractional weights can leave `slot` just shy of `total`
  // due to floating-point rounding. Fall back to the last eligible entry.
  return active[active.length - 1];
}
