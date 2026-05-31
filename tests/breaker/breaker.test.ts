// Feature: sahayak-multi-agent-router, Task 27.1 — Circuit breaker (Req 29.1, Design §v1.1.10)
//
// Unit tests for the circuit-breaker state machine in src/lib/breaker/breaker.ts.
// They drive withBreaker / getState against an in-memory BreakerStore and an
// injectable clock so the closed→open→half_open→closed transitions are
// deterministic and need no live DB.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  withBreaker,
  getState,
  setBreakerState,
  effectiveState,
  BreakerOpenError,
  isBreakerOpenError,
  clearBreakerCache,
  DEFAULT_BREAKER_CONFIG,
  type BreakerStore,
  type BreakerName,
  type CircuitStateRow,
} from '../../src/lib/breaker/breaker';

// ─── In-memory store + controllable clock ─────────────────────────────────────

function makeStore(seed?: Partial<CircuitStateRow>): {
  store: BreakerStore;
  rows: Map<BreakerName, CircuitStateRow>;
  writes: number;
} {
  const rows = new Map<BreakerName, CircuitStateRow>();
  const iso = new Date(0).toISOString();
  const base: CircuitStateRow = {
    name: 'gemini',
    state: 'closed',
    consecutive_failures: 0,
    window_start: iso,
    opened_at: null,
    last_probe_at: null,
    updated_at: iso,
    ...seed,
  };
  rows.set('gemini', base);

  const counter = { writes: 0 };
  const store: BreakerStore = {
    async read(name) {
      return rows.get(name) ?? null;
    },
    async write(name, patch) {
      counter.writes += 1;
      const prev = rows.get(name) ?? base;
      rows.set(name, { ...prev, ...patch, name });
    },
  };
  return {
    store,
    rows,
    get writes() {
      return counter.writes;
    },
  } as { store: BreakerStore; rows: Map<BreakerName, CircuitStateRow>; writes: number };
}

/** A clock you can advance manually. */
function clockAt(startMs: number) {
  let t = startMs;
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

const fail = () => Promise.reject(new Error('boom'));
const ok = () => Promise.resolve('ok');

beforeEach(() => {
  clearBreakerCache();
});

// ─── effectiveState (pure) ─────────────────────────────────────────────────────

describe('effectiveState', () => {
  const cfg = DEFAULT_BREAKER_CONFIG;

  it('returns closed/half_open verbatim', () => {
    const row = (state: CircuitStateRow['state']): CircuitStateRow => ({
      name: 'gemini',
      state,
      consecutive_failures: 0,
      window_start: new Date(0).toISOString(),
      opened_at: null,
      last_probe_at: null,
      updated_at: new Date(0).toISOString(),
    });
    expect(effectiveState(row('closed'), cfg, new Date(0))).toBe('closed');
    expect(effectiveState(row('half_open'), cfg, new Date(0))).toBe('half_open');
  });

  it('reports open as open before cooldown and half_open after', () => {
    const openedAt = 1_000_000;
    const row: CircuitStateRow = {
      name: 'gemini',
      state: 'open',
      consecutive_failures: 5,
      window_start: new Date(openedAt).toISOString(),
      opened_at: new Date(openedAt).toISOString(),
      last_probe_at: null,
      updated_at: new Date(openedAt).toISOString(),
    };
    // 1ms before cooldown elapses -> still open
    expect(effectiveState(row, cfg, new Date(openedAt + cfg.halfOpenAfterMs - 1))).toBe('open');
    // exactly at cooldown -> half_open
    expect(effectiveState(row, cfg, new Date(openedAt + cfg.halfOpenAfterMs))).toBe('half_open');
  });
});

// ─── closed → success / failure counting ───────────────────────────────────────

describe('withBreaker — closed state', () => {
  it('runs fn and returns its result when closed', async () => {
    const { store } = makeStore();
    const clk = clockAt(1000);
    const result = await withBreaker('gemini', ok, { store, now: clk.now });
    expect(result).toBe('ok');
  });

  it('does NOT open before the failure threshold is reached', async () => {
    const { store, rows } = makeStore();
    const clk = clockAt(1000);
    // 4 failures (threshold is 5) — should stay closed.
    for (let i = 0; i < 4; i++) {
      await expect(withBreaker('gemini', fail, { store, now: clk.now })).rejects.toThrow('boom');
      clk.advance(10); // within the 60s window
      clearBreakerCache(); // force re-read so the running count is observed
    }
    expect(rows.get('gemini')!.state).toBe('closed');
    expect(rows.get('gemini')!.consecutive_failures).toBe(4);
  });

  it('opens exactly when consecutive failures reach the threshold within the window', async () => {
    const { store, rows } = makeStore();
    const clk = clockAt(1000);
    for (let i = 0; i < DEFAULT_BREAKER_CONFIG.failuresBeforeOpen; i++) {
      await expect(withBreaker('gemini', fail, { store, now: clk.now })).rejects.toThrow('boom');
      clk.advance(10);
      clearBreakerCache();
    }
    const row = rows.get('gemini')!;
    expect(row.state).toBe('open');
    expect(row.opened_at).not.toBeNull();
    expect(row.consecutive_failures).toBe(5);
  });

  it('re-throws the original operation error (not BreakerOpenError) while closed', async () => {
    const { store } = makeStore();
    const clk = clockAt(1000);
    await withBreaker('gemini', ok, { store, now: clk.now }).catch(() => {});
    const err = await withBreaker('gemini', fail, { store, now: clk.now }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isBreakerOpenError(err)).toBe(false);
    expect((err as Error).message).toBe('boom');
  });

  it('resets the failure counter on a success', async () => {
    const { store, rows } = makeStore();
    const clk = clockAt(1000);
    for (let i = 0; i < 3; i++) {
      await withBreaker('gemini', fail, { store, now: clk.now }).catch(() => {});
      clk.advance(10);
      clearBreakerCache();
    }
    expect(rows.get('gemini')!.consecutive_failures).toBe(3);
    await withBreaker('gemini', ok, { store, now: clk.now });
    expect(rows.get('gemini')!.consecutive_failures).toBe(0);
    expect(rows.get('gemini')!.state).toBe('closed');
  });

  it('does not open when failures are spread beyond the rolling window', async () => {
    const { store, rows } = makeStore();
    const clk = clockAt(1000);
    const windowMs = DEFAULT_BREAKER_CONFIG.windowSeconds * 1000;
    // 5 failures, but each separated by more than the window -> never accumulates.
    for (let i = 0; i < DEFAULT_BREAKER_CONFIG.failuresBeforeOpen; i++) {
      await withBreaker('gemini', fail, { store, now: clk.now }).catch(() => {});
      clk.advance(windowMs + 1);
      clearBreakerCache();
    }
    const row = rows.get('gemini')!;
    expect(row.state).toBe('closed');
    expect(row.consecutive_failures).toBe(1); // window kept resetting to 1
  });
});

// ─── open → short-circuit ──────────────────────────────────────────────────────

describe('withBreaker — open state short-circuits', () => {
  it('throws BreakerOpenError without running fn during cooldown', async () => {
    const openedAt = 1_000_000;
    const { store } = makeStore({
      state: 'open',
      consecutive_failures: 5,
      opened_at: new Date(openedAt).toISOString(),
      window_start: new Date(openedAt).toISOString(),
    });
    const clk = clockAt(openedAt + 1000); // 1s into a 30s cooldown
    let ran = false;
    const err = await withBreaker(
      'gemini',
      async () => {
        ran = true;
        return 'should-not-run';
      },
      { store, now: clk.now },
    ).catch((e) => e);

    expect(ran).toBe(false);
    expect(err).toBeInstanceOf(BreakerOpenError);
    expect(isBreakerOpenError(err)).toBe(true);
    expect((err as BreakerOpenError).breaker).toBe('gemini');
    // ~29s remaining
    expect((err as BreakerOpenError).retryAfterMs).toBe(DEFAULT_BREAKER_CONFIG.halfOpenAfterMs - 1000);
  });
});

// ─── half_open probe ────────────────────────────────────────────────────────────

describe('withBreaker — half_open probe', () => {
  const openedAt = 1_000_000;

  function openStore() {
    return makeStore({
      state: 'open',
      consecutive_failures: 5,
      opened_at: new Date(openedAt).toISOString(),
      window_start: new Date(openedAt).toISOString(),
    });
  }

  it('allows a single probe once cooldown elapses and CLOSES on probe success', async () => {
    const { store, rows } = openStore();
    const clk = clockAt(openedAt + DEFAULT_BREAKER_CONFIG.halfOpenAfterMs); // cooldown elapsed
    const result = await withBreaker('gemini', ok, { store, now: clk.now });
    expect(result).toBe('ok');
    const row = rows.get('gemini')!;
    expect(row.state).toBe('closed');
    expect(row.consecutive_failures).toBe(0);
    expect(row.opened_at).toBeNull();
  });

  it('RE-OPENS on probe failure and restarts the cooldown', async () => {
    const { store, rows } = openStore();
    const clk = clockAt(openedAt + DEFAULT_BREAKER_CONFIG.halfOpenAfterMs + 5);
    const err = await withBreaker('gemini', fail, { store, now: clk.now }).catch((e) => e);
    expect((err as Error).message).toBe('boom'); // original error propagates
    const row = rows.get('gemini')!;
    expect(row.state).toBe('open');
    expect(new Date(row.opened_at!).getTime()).toBe(openedAt + DEFAULT_BREAKER_CONFIG.halfOpenAfterMs + 5);
  });

  it('after a failed probe, the breaker short-circuits again during the new cooldown', async () => {
    const { store } = openStore();
    const clk = clockAt(openedAt + DEFAULT_BREAKER_CONFIG.halfOpenAfterMs);
    await withBreaker('gemini', fail, { store, now: clk.now }).catch(() => {});
    clearBreakerCache();
    clk.advance(100); // still inside the fresh cooldown
    const err = await withBreaker('gemini', ok, { store, now: clk.now }).catch((e) => e);
    expect(err).toBeInstanceOf(BreakerOpenError);
  });
});

// ─── getState ───────────────────────────────────────────────────────────────────

describe('getState', () => {
  it('reports closed by default', async () => {
    const { store } = makeStore();
    expect(await getState('gemini', { store, now: () => new Date(1000) })).toBe('closed');
  });

  it('reports half_open for an open row past its cooldown (read-only, no mutation)', async () => {
    const openedAt = 1_000_000;
    const { store, rows } = makeStore({
      state: 'open',
      consecutive_failures: 5,
      opened_at: new Date(openedAt).toISOString(),
    });
    const clk = clockAt(openedAt + DEFAULT_BREAKER_CONFIG.halfOpenAfterMs + 1);
    expect(await getState('gemini', { store, now: clk.now })).toBe('half_open');
    // getState must not mutate the stored state
    expect(rows.get('gemini')!.state).toBe('open');
  });

  it('reports open during cooldown', async () => {
    const openedAt = 1_000_000;
    const { store } = makeStore({
      state: 'open',
      consecutive_failures: 5,
      opened_at: new Date(openedAt).toISOString(),
    });
    const clk = clockAt(openedAt + 1000);
    expect(await getState('gemini', { store, now: clk.now })).toBe('open');
  });
});

// ─── setBreakerState helper ──────────────────────────────────────────────────────

describe('setBreakerState', () => {
  it('force-closes a breaker (admin action) and clears the failure streak', async () => {
    const openedAt = 1_000_000;
    const { store, rows } = makeStore({
      state: 'open',
      consecutive_failures: 5,
      opened_at: new Date(openedAt).toISOString(),
    });
    const clk = clockAt(openedAt + 5000);
    await setBreakerState('gemini', 'closed', { store, now: clk.now });
    const row = rows.get('gemini')!;
    expect(row.state).toBe('closed');
    expect(row.consecutive_failures).toBe(0);
    expect(row.opened_at).toBeNull();
  });

  it('force-opens a breaker', async () => {
    const { store, rows } = makeStore();
    const clk = clockAt(2000);
    await setBreakerState('gemini', 'open', { store, now: clk.now });
    const row = rows.get('gemini')!;
    expect(row.state).toBe('open');
    expect(row.opened_at).not.toBeNull();
  });
});

// ─── fail-soft: store errors never fail closed ───────────────────────────────────

describe('withBreaker — fail-soft on store errors', () => {
  it('treats the breaker as closed and still runs fn when reads throw', async () => {
    const throwingStore: BreakerStore = {
      async read() {
        throw new Error('db down');
      },
      async write() {
        throw new Error('db down');
      },
    };
    const result = await withBreaker('whatsapp', ok, { store: throwingStore, now: () => new Date(1000) });
    expect(result).toBe('ok');
  });
});
