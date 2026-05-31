/**
 * v1.1.10 Circuit Breakers (Req 29) — `src/lib/breaker/breaker.ts`.
 *
 * Three named breakers — `gemini`, `whatsapp`, `embeddings` — wrap their
 * respective outbound calls. State is shared between the n8n Code Nodes and the
 * Vercel route handlers through a small Postgres `circuit_state` table so both
 * runtimes read the same view (migration `20260201_005`).
 *
 * State machine (Design §v1.1.10):
 *
 *     [*] --> closed
 *     closed    --> open:       `failuresBeforeOpen` failures within `windowSeconds` reached
 *     open      --> half_open:  `halfOpenAfterMs` elapsed since `opened_at`
 *     half_open --> closed:     probe succeeds
 *     half_open --> open:       probe fails
 *
 * Behaviour of {@link withBreaker}:
 *   - `closed`    → run `fn`. Success resets the failure counter; failure
 *                   increments `consecutive_failures` and opens the breaker once
 *                   the threshold is reached inside the rolling window.
 *   - `open`      → if the cooldown (`halfOpenAfterMs`) has NOT elapsed,
 *                   short-circuit with a typed {@link BreakerOpenError} carrying a
 *                   `retryAfterMs` hint. Once the cooldown elapses, the next call
 *                   is promoted to a half-open probe.
 *   - `half_open` → run `fn` as a single probe. Success closes the breaker;
 *                   failure re-opens it and restarts the cooldown.
 *
 * Heartbeat propagation: state reads go through a tiny in-process cache that
 * refreshes every ~1 second (well below the 30 s half-open probe interval), so
 * other runtimes observe state changes within the next refresh tick while we
 * avoid a DB round-trip on every call. Failures and probe results are written
 * through to `circuit_state` immediately.
 *
 * Fail-soft: any error reading or writing `circuit_state` is swallowed and the
 * breaker is treated as `closed` (calls allowed). An operational problem with
 * the breaker table must never take down citizen-facing flows (NFR Reliability).
 *
 * The DB client is injectable (a `BreakerStore`, typically backed by a Supabase
 * client) so the state machine is fully unit-testable without a live database —
 * mirroring the injectable-client pattern in `src/lib/sessions/prepareContext.ts`
 * and `src/lib/router/cache.ts`. The three named breakers are wired onto their
 * outbound calls in task 27.2; this module only builds the breaker.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.10 Circuit Breakers
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirement 29.1
 */

// ─── Public types (Design §v1.1.10 signatures) ───────────────────────────────

/** The three named breakers. Matches `circuit_state.name` CHECK enum. */
export type BreakerName = 'gemini' | 'whatsapp' | 'embeddings';

/** Persisted breaker states. Matches `circuit_state.state` CHECK enum. */
export type BreakerState = 'closed' | 'open' | 'half_open';

/** Tunable breaker thresholds (Design §v1.1.10 defaults shown inline). */
export type BreakerConfig = {
  /** Consecutive failures within the window that trip the breaker open. Default 5. */
  failuresBeforeOpen: number;
  /** Rolling window (seconds) over which consecutive failures are counted. Default 60. */
  windowSeconds: number;
  /** Cooldown (ms) after opening before a half-open probe is allowed. Default 30 000. */
  halfOpenAfterMs: number;
};

/** Default thresholds per Design §v1.1.10 / Req 29.1. */
export const DEFAULT_BREAKER_CONFIG: BreakerConfig = {
  failuresBeforeOpen: 5,
  windowSeconds: 60,
  halfOpenAfterMs: 30_000,
};

/** A `circuit_state` row (column names mirror the SQL table exactly). */
export interface CircuitStateRow {
  name: BreakerName;
  state: BreakerState;
  consecutive_failures: number;
  /** ISO timestamp — anchor of the current failure-counting window. */
  window_start: string;
  /** ISO timestamp the breaker last opened, or null while closed. */
  opened_at: string | null;
  /** ISO timestamp of the last half-open probe attempt, or null. */
  last_probe_at: string | null;
  /** ISO timestamp of the last write. */
  updated_at: string;
}

/**
 * Injectable persistence boundary for `circuit_state`.
 *
 * Provide an implementation backed by Supabase / pg (see {@link supabaseBreakerStore})
 * in production, or an in-memory fake in tests. Both methods map to a single SQL
 * statement against `circuit_state`.
 */
export interface BreakerStore {
  /** Load the row for `name`. Returns null if the row is missing. */
  read(name: BreakerName): Promise<CircuitStateRow | null>;
  /**
   * Patch the row for `name`. Implementations should `updated_at` themselves if
   * the caller did not supply it (this module always supplies it).
   */
  write(name: BreakerName, patch: Partial<Omit<CircuitStateRow, 'name'>>): Promise<void>;
}

/** Options for {@link withBreaker}: thresholds plus injectable seams. */
export interface WithBreakerOptions extends Partial<BreakerConfig> {
  /** Injectable persistence (defaults to the lazy Supabase-backed store). */
  store?: BreakerStore;
  /** Injectable clock for deterministic tests (defaults to `() => new Date()`). */
  now?: () => Date;
}

// ─── Typed short-circuit error ────────────────────────────────────────────────

/**
 * Thrown by {@link withBreaker} when the breaker is `open` and still inside its
 * cooldown window — the wrapped operation is NOT executed.
 *
 * Callers map this to the `BREAKER_OPEN` envelope (503 + `Retry-After`) per
 * Design §Error Handling, or fall back to a degradation path (templated reply,
 * outbox enqueue, semantic-cache bypass).
 */
export class BreakerOpenError extends Error {
  /** Which breaker short-circuited. */
  readonly breaker: BreakerName;
  /** Suggested delay (ms) before retrying — `opened_at + halfOpenAfterMs - now`. */
  readonly retryAfterMs: number;

  constructor(breaker: BreakerName, retryAfterMs: number) {
    super(`Circuit breaker "${breaker}" is open; retry after ~${retryAfterMs}ms`);
    this.name = 'BreakerOpenError';
    this.breaker = breaker;
    this.retryAfterMs = retryAfterMs;
    // Restore prototype chain for `instanceof` across transpilation targets.
    Object.setPrototypeOf(this, BreakerOpenError.prototype);
  }
}

/** Type guard for {@link BreakerOpenError}. */
export function isBreakerOpenError(err: unknown): err is BreakerOpenError {
  return err instanceof BreakerOpenError;
}

// ─── In-process state cache (~1s TTL) ─────────────────────────────────────────

/** State-read cache TTL in ms (Design §v1.1.10 heartbeat ~1 s). */
export const STATE_CACHE_TTL_MS = 1000;

interface CacheEntry {
  row: CircuitStateRow;
  expiresAt: number;
}

const stateCache = new Map<BreakerName, CacheEntry>();

/** Clear the in-process state cache (test seam / admin force-refresh). */
export function clearBreakerCache(): void {
  stateCache.clear();
}

/** Synthesize a default `closed` row when none exists / a read fails. */
function defaultRow(name: BreakerName, now: Date): CircuitStateRow {
  const iso = now.toISOString();
  return {
    name,
    state: 'closed',
    consecutive_failures: 0,
    window_start: iso,
    opened_at: null,
    last_probe_at: null,
    updated_at: iso,
  };
}

/**
 * Read the current row for `name`, using the ~1 s in-process cache.
 *
 * Fail-soft: on a missing row or any read error, returns a synthetic `closed`
 * row so the breaker never fails closed (calls stay allowed).
 */
async function readRow(name: BreakerName, store: BreakerStore, now: Date): Promise<CircuitStateRow> {
  const cached = stateCache.get(name);
  if (cached && now.getTime() < cached.expiresAt) {
    return cached.row;
  }

  let row: CircuitStateRow | null = null;
  try {
    row = await store.read(name);
  } catch {
    row = null; // fail-soft
  }

  const resolved = row ?? defaultRow(name, now);
  stateCache.set(name, { row: resolved, expiresAt: now.getTime() + STATE_CACHE_TTL_MS });
  return resolved;
}

/**
 * Write a patch through to the store and refresh the local cache so the same
 * runtime immediately observes the new state. Fail-soft on write errors — the
 * cache is updated regardless so local behaviour stays consistent.
 */
async function writeRow(
  name: BreakerName,
  store: BreakerStore,
  base: CircuitStateRow,
  patch: Partial<Omit<CircuitStateRow, 'name'>>,
  now: Date,
): Promise<void> {
  const fullPatch = { ...patch, updated_at: now.toISOString() };
  // Optimistically refresh the local cache first so subsequent calls in this
  // runtime see the new state even if the DB write fails.
  const merged: CircuitStateRow = { ...base, ...fullPatch, name };
  stateCache.set(name, { row: merged, expiresAt: now.getTime() + STATE_CACHE_TTL_MS });
  try {
    await store.write(name, fullPatch);
  } catch {
    // Fail-soft — a write-through failure must not surface to the caller.
  }
}

// ─── State-machine helpers (pure) ─────────────────────────────────────────────

/**
 * Compute the *effective* state from a stored row and the clock.
 *
 * The open→half_open transition is time-based and lazy: a stored `open` row
 * whose cooldown has elapsed is reported as `half_open` (a probe is allowed)
 * without mutating the DB until the probe actually runs.
 */
export function effectiveState(row: CircuitStateRow, config: BreakerConfig, now: Date): BreakerState {
  if (row.state !== 'open') {
    return row.state; // 'closed' or 'half_open'
  }
  // Defensive: a malformed open row without opened_at is eligible to probe.
  const openedAtMs = row.opened_at ? new Date(row.opened_at).getTime() : Number.NEGATIVE_INFINITY;
  const cooldownElapsed = now.getTime() - openedAtMs >= config.halfOpenAfterMs;
  return cooldownElapsed ? 'half_open' : 'open';
}

/** ms remaining before an open breaker is eligible to probe (>= 0). */
function retryAfterMs(row: CircuitStateRow, config: BreakerConfig, now: Date): number {
  if (!row.opened_at) return 0;
  const readyAt = new Date(row.opened_at).getTime() + config.halfOpenAfterMs;
  return Math.max(0, readyAt - now.getTime());
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Wrap an async operation with the named circuit breaker.
 *
 * - Short-circuits with {@link BreakerOpenError} when the breaker is open and
 *   still cooling down (the operation does not run).
 * - On success: resets the failure counter (and closes the breaker if it was
 *   probing in half-open).
 * - On failure: increments `consecutive_failures`; opens the breaker once
 *   `failuresBeforeOpen` is reached within `windowSeconds`; a failed half-open
 *   probe re-opens immediately.
 *
 * The original operation error is re-thrown unchanged so callers can branch on
 * their own error types; only the short-circuit path throws {@link BreakerOpenError}.
 */
export async function withBreaker<T>(
  name: BreakerName,
  fn: () => Promise<T>,
  options?: WithBreakerOptions,
): Promise<T> {
  const config: BreakerConfig = {
    failuresBeforeOpen: options?.failuresBeforeOpen ?? DEFAULT_BREAKER_CONFIG.failuresBeforeOpen,
    windowSeconds: options?.windowSeconds ?? DEFAULT_BREAKER_CONFIG.windowSeconds,
    halfOpenAfterMs: options?.halfOpenAfterMs ?? DEFAULT_BREAKER_CONFIG.halfOpenAfterMs,
  };
  const store = options?.store ?? getDefaultStore();
  const clock = options?.now ?? (() => new Date());

  const now = clock();
  const row = await readRow(name, store, now);
  const eff = effectiveState(row, config, now);

  if (eff === 'open') {
    // Still cooling down — short-circuit without running the operation.
    throw new BreakerOpenError(name, retryAfterMs(row, config, now));
  }

  // `eff` is 'closed' or 'half_open'. If we are promoting a stored `open` row to
  // a half-open probe, persist that so other runtimes see `half_open` during the
  // probe window.
  const isProbe = eff === 'half_open';
  if (isProbe && row.state === 'open') {
    await writeRow(name, store, row, { state: 'half_open', last_probe_at: now.toISOString() }, now);
  }

  let result: T;
  try {
    result = await fn();
  } catch (err) {
    await recordFailure(name, store, row, isProbe, config, clock());
    throw err;
  }

  await recordSuccess(name, store, row, isProbe, clock());
  return result;
}

/** Apply a successful call: close/reset as appropriate. */
async function recordSuccess(
  name: BreakerName,
  store: BreakerStore,
  row: CircuitStateRow,
  isProbe: boolean,
  now: Date,
): Promise<void> {
  if (isProbe || row.state !== 'closed') {
    // half_open probe succeeded → close the breaker.
    await writeRow(
      name,
      store,
      row,
      {
        state: 'closed',
        consecutive_failures: 0,
        opened_at: null,
        window_start: now.toISOString(),
        last_probe_at: now.toISOString(),
      },
      now,
    );
    return;
  }

  // Already closed: only write through if there is a failure streak to clear.
  if (row.consecutive_failures !== 0) {
    await writeRow(name, store, row, { consecutive_failures: 0, window_start: now.toISOString() }, now);
  }
}

/** Apply a failed call: increment / open as appropriate. */
async function recordFailure(
  name: BreakerName,
  store: BreakerStore,
  row: CircuitStateRow,
  isProbe: boolean,
  config: BreakerConfig,
  now: Date,
): Promise<void> {
  if (isProbe || row.state === 'half_open') {
    // half_open probe failed → re-open and restart the cooldown.
    await writeRow(
      name,
      store,
      row,
      {
        state: 'open',
        opened_at: now.toISOString(),
        last_probe_at: now.toISOString(),
        consecutive_failures: config.failuresBeforeOpen,
        window_start: now.toISOString(),
      },
      now,
    );
    return;
  }

  // Closed state: count consecutive failures within the rolling window.
  const windowMs = config.windowSeconds * 1000;
  const windowAnchorMs = row.window_start ? new Date(row.window_start).getTime() : Number.NEGATIVE_INFINITY;
  const windowExpired = now.getTime() - windowAnchorMs > windowMs;

  let count: number;
  let windowStart: string;
  if (row.consecutive_failures === 0 || windowExpired) {
    // Start a fresh window anchored at this failure.
    count = 1;
    windowStart = now.toISOString();
  } else {
    count = row.consecutive_failures + 1;
    windowStart = row.window_start;
  }

  if (count >= config.failuresBeforeOpen) {
    await writeRow(
      name,
      store,
      row,
      {
        state: 'open',
        opened_at: now.toISOString(),
        consecutive_failures: count,
        window_start: windowStart,
      },
      now,
    );
    return;
  }

  await writeRow(name, store, row, { consecutive_failures: count, window_start: windowStart }, now);
}

/**
 * Read the current effective state of a breaker (Design §v1.1.10 signature).
 *
 * Returns the *effective* state: a stored `open` row whose cooldown has elapsed
 * is reported as `half_open` (the next {@link withBreaker} call would probe).
 * This is a read-only view — it does not mutate `circuit_state`.
 */
export async function getState(name: BreakerName, options?: WithBreakerOptions): Promise<BreakerState> {
  const config: BreakerConfig = {
    failuresBeforeOpen: options?.failuresBeforeOpen ?? DEFAULT_BREAKER_CONFIG.failuresBeforeOpen,
    windowSeconds: options?.windowSeconds ?? DEFAULT_BREAKER_CONFIG.windowSeconds,
    halfOpenAfterMs: options?.halfOpenAfterMs ?? DEFAULT_BREAKER_CONFIG.halfOpenAfterMs,
  };
  const store = options?.store ?? getDefaultStore();
  const clock = options?.now ?? (() => new Date());
  const now = clock();
  const row = await readRow(name, store, now);
  return effectiveState(row, config, now);
}

/**
 * Read the raw `circuit_state` row for a breaker (helper, bypasses the effective
 * recomputation). Returns null when the row is missing. Fail-soft on read error.
 */
export async function getBreakerRow(
  name: BreakerName,
  store: BreakerStore = getDefaultStore(),
): Promise<CircuitStateRow | null> {
  try {
    return await store.read(name);
  } catch {
    return null;
  }
}

/**
 * Force a breaker into an explicit state and persist it (helper).
 *
 * Used by the admin "force-close circuit breaker" action on
 * `/dashboard/system-health` (task 30.4) and by tests. Resets the failure
 * counter and cooldown anchors to keep the row internally consistent.
 */
export async function setBreakerState(
  name: BreakerName,
  state: BreakerState,
  options?: { store?: BreakerStore; now?: () => Date },
): Promise<void> {
  const store = options?.store ?? getDefaultStore();
  const now = (options?.now ?? (() => new Date()))();
  const base = await readRow(name, store, now);
  const patch: Partial<Omit<CircuitStateRow, 'name'>> = {
    state,
    consecutive_failures: state === 'open' ? DEFAULT_BREAKER_CONFIG.failuresBeforeOpen : 0,
    opened_at: state === 'open' ? now.toISOString() : null,
    window_start: now.toISOString(),
  };
  await writeRow(name, store, base, patch, now);
}

// ─── Default Supabase-backed store ────────────────────────────────────────────

/**
 * Minimal structural subset of the Supabase client this module relies on.
 *
 * Declared structurally (rather than importing `SupabaseClient`) so callers can
 * inject the real `@supabase/supabase-js` client OR a lightweight mock in tests
 * without a type mismatch — same approach as `src/lib/router/cache.ts`.
 */
export interface SupabaseLike {
  from(table: string): {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => Promise<{ data: unknown; error: unknown }>;
    };
  };
}

const CIRCUIT_STATE_TABLE = 'circuit_state';

/** Build a {@link BreakerStore} backed by an injected Supabase-like client. */
export function supabaseBreakerStore(client: SupabaseLike): BreakerStore {
  return {
    async read(name: BreakerName): Promise<CircuitStateRow | null> {
      const { data, error } = await client
        .from(CIRCUIT_STATE_TABLE)
        .select('name, state, consecutive_failures, window_start, opened_at, last_probe_at, updated_at')
        .eq('name', name)
        .maybeSingle();

      if (error || !data) return null;
      const r = data as Record<string, unknown>;
      return {
        name,
        state: (r.state as BreakerState) ?? 'closed',
        consecutive_failures:
          typeof r.consecutive_failures === 'number'
            ? r.consecutive_failures
            : Number(r.consecutive_failures) || 0,
        window_start: (r.window_start as string) ?? new Date().toISOString(),
        opened_at: (r.opened_at as string | null) ?? null,
        last_probe_at: (r.last_probe_at as string | null) ?? null,
        updated_at: (r.updated_at as string) ?? new Date().toISOString(),
      };
    },

    async write(name: BreakerName, patch: Partial<Omit<CircuitStateRow, 'name'>>): Promise<void> {
      await client.from(CIRCUIT_STATE_TABLE).update(patch).eq('name', name);
    },
  };
}

let cachedDefaultStore: BreakerStore | null = null;

/**
 * A fail-soft no-op store used when the Supabase-backed store cannot be
 * constructed (e.g. env vars missing in a unit-test runtime or a
 * misconfigured deployment).
 *
 * `read` returns `null` so {@link readRow} synthesizes a `closed` row, and
 * `write` is a no-op. The net effect is the breaker is treated as permanently
 * `closed` (all calls allowed) — exactly the documented fail-soft behaviour:
 * "an operational problem with the breaker table must never take down
 * citizen-facing flows" (NFR Reliability).
 */
const NOOP_BREAKER_STORE: BreakerStore = {
  async read(): Promise<CircuitStateRow | null> {
    return null;
  },
  async write(): Promise<void> {
    // intentionally empty — fail-soft
  },
};

/**
 * Lazily construct the default Supabase-backed store.
 *
 * The Supabase client is created on first use (not at module load) so importing
 * this module in unit tests — which inject their own store — does not require
 * `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` to be set. Mirrors the
 * lazy-import boundary in `src/lib/tokens/budgetRollup.ts`.
 *
 * Fail-soft: if the Supabase client cannot be constructed (missing env, import
 * failure), fall back to {@link NOOP_BREAKER_STORE} so callers that do not
 * inject a store — e.g. `classify` in a test runtime — still run their wrapped
 * operation instead of surfacing a misleading transport error.
 */
function getDefaultStore(): BreakerStore {
  if (cachedDefaultStore) return cachedDefaultStore;

  try {
    // Require lazily so tests that inject a store never touch @supabase/supabase-js.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      // No credentials configured — fail soft rather than throwing.
      return NOOP_BREAKER_STORE;
    }
    const client = createClient(url, key) as unknown as SupabaseLike;
    cachedDefaultStore = supabaseBreakerStore(client);
    return cachedDefaultStore;
  } catch {
    // Client construction failed — fail soft (breaker treated as closed).
    return NOOP_BREAKER_STORE;
  }
}

/** Override the default store (test seam). Pass `null` to reset to the lazy Supabase store. */
export function setDefaultBreakerStore(store: BreakerStore | null): void {
  cachedDefaultStore = store;
}
