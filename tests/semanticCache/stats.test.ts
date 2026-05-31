// Feature: sahayak-multi-agent-router, task 24.6 — `/dashboard/agents` cache-hit-rate widget
//
// Unit tests for src/lib/semanticCache/stats.ts — the pure, DB-free aggregation
// that turns query_cache rows into per-category hit-rate stats over time windows
// (Req 26.6, Design §v1.1.7). The metric definition under test:
//   hits   = Σ hit_count, misses = row count, hit_rate = hits / (hits + misses).

import { describe, it, expect } from 'vitest';

import {
  aggregateCacheStats,
  aggregateWindow,
  CACHE_CATEGORIES,
  DEFAULT_WINDOWS,
  MAX_DEFAULT_WINDOW_MS,
  type CacheStatsRow,
} from '../../src/lib/semanticCache/stats';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Fixed reference clock so windows are deterministic. */
const NOW = Date.parse('2026-02-01T12:00:00.000Z');

/** Build a row written `agoMs` before NOW. */
function row(
  category: string,
  hit_count: number | string | null,
  agoMs: number,
): CacheStatsRow {
  return { category, hit_count, created_at: new Date(NOW - agoMs).toISOString() };
}

// ─── Defaults ──────────────────────────────────────────────────────────────────

describe('DEFAULT_WINDOWS — 24h and 7d (Req 26.6)', () => {
  it('declares the two reported windows', () => {
    expect(DEFAULT_WINDOWS.map((w) => w.label)).toEqual(['24h', '7d']);
    expect(DEFAULT_WINDOWS[0].ms).toBe(24 * HOUR);
    expect(DEFAULT_WINDOWS[1].ms).toBe(7 * DAY);
  });

  it('MAX_DEFAULT_WINDOW_MS is the widest window (7d)', () => {
    expect(MAX_DEFAULT_WINDOW_MS).toBe(7 * DAY);
  });
});

// ─── Core metric ─────────────────────────────────────────────────────────────

describe('aggregateWindow — hits=Σhit_count, misses=row count', () => {
  it('computes hits, misses, total and hit_rate per category', () => {
    const rows: CacheStatsRow[] = [
      row('status', 9, 1 * HOUR), // 1 entry, 9 hits
      row('status', 1, 2 * HOUR), // 1 entry, 1 hit
      row('scheme', 3, 3 * HOUR), // 1 entry, 3 hits
    ];

    const w = aggregateWindow(rows, { label: '24h', ms: 24 * HOUR }, NOW);

    const status = w.categories.find((c) => c.category === 'status')!;
    expect(status.hits).toBe(10);
    expect(status.misses).toBe(2);
    expect(status.total).toBe(12);
    expect(status.hit_rate).toBeCloseTo(10 / 12, 4);

    const scheme = w.categories.find((c) => c.category === 'scheme')!;
    expect(scheme.hits).toBe(3);
    expect(scheme.misses).toBe(1);
    expect(scheme.hit_rate).toBe(0.75);

    // overall rollup = all rows
    expect(w.overall.category).toBe('all');
    expect(w.overall.hits).toBe(13);
    expect(w.overall.misses).toBe(3);
    expect(w.overall.total).toBe(16);
  });

  it('always emits every known category, zero-filled', () => {
    const w = aggregateWindow([row('status', 5, 1 * HOUR)], { label: '24h', ms: 24 * HOUR }, NOW);
    expect(w.categories.map((c) => c.category)).toEqual([...CACHE_CATEGORIES]);

    const help = w.categories.find((c) => c.category === 'help')!;
    expect(help).toEqual({ category: 'help', hits: 0, misses: 0, total: 0, hit_rate: 0 });
  });

  it('hit_rate is 0 (not NaN) when there is no activity', () => {
    const w = aggregateWindow([], { label: '24h', ms: 24 * HOUR }, NOW);
    expect(w.overall.hit_rate).toBe(0);
    expect(w.overall.total).toBe(0);
    for (const c of w.categories) expect(c.hit_rate).toBe(0);
  });
});

// ─── Windowing by write timestamp ───────────────────────────────────────────────

describe('aggregateWindow — windows by created_at', () => {
  it('excludes rows written before the window lower bound', () => {
    const rows: CacheStatsRow[] = [
      row('status', 4, 2 * HOUR),   // inside 24h
      row('status', 8, 30 * HOUR),  // outside 24h, inside 7d
    ];

    const day = aggregateWindow(rows, { label: '24h', ms: 24 * HOUR }, NOW);
    expect(day.overall.hits).toBe(4);
    expect(day.overall.misses).toBe(1);

    const week = aggregateWindow(rows, { label: '7d', ms: 7 * DAY }, NOW);
    expect(week.overall.hits).toBe(12);
    expect(week.overall.misses).toBe(2);
  });

  it('reports the window label and inclusive since bound', () => {
    const w = aggregateWindow([], { label: '7d', ms: 7 * DAY }, NOW);
    expect(w.window).toBe('7d');
    expect(w.since).toBe(new Date(NOW - 7 * DAY).toISOString());
  });
});

// ─── Robustness ────────────────────────────────────────────────────────────────

describe('aggregateWindow — robust to messy data', () => {
  it('coerces stringified pg integers and ignores negatives/non-finite', () => {
    const rows: CacheStatsRow[] = [
      row('status', '7', 1 * HOUR), // pg integer as string
      row('status', null, 1 * HOUR), // null hit_count → 0 hits, still an entry
      row('status', -5, 1 * HOUR),  // negative → clamped to 0
    ];
    const w = aggregateWindow(rows, { label: '24h', ms: 24 * HOUR }, NOW);
    const status = w.categories.find((c) => c.category === 'status')!;
    expect(status.hits).toBe(7);
    expect(status.misses).toBe(3);
  });

  it('folds unknown categories into overall but not into per-category buckets', () => {
    const rows: CacheStatsRow[] = [
      row('status', 2, 1 * HOUR),
      row('mystery', 10, 1 * HOUR), // not in CACHE_CATEGORIES
    ];
    const w = aggregateWindow(rows, { label: '24h', ms: 24 * HOUR }, NOW);

    // overall sees both
    expect(w.overall.hits).toBe(12);
    expect(w.overall.misses).toBe(2);

    // per-category only the known one
    const status = w.categories.find((c) => c.category === 'status')!;
    expect(status.hits).toBe(2);
    expect(w.categories.some((c) => c.category === 'mystery')).toBe(false);
  });

  it('skips rows with an unparseable created_at', () => {
    const rows: CacheStatsRow[] = [
      { category: 'status', hit_count: 5, created_at: 'not-a-date' },
      row('status', 1, 1 * HOUR),
    ];
    const w = aggregateWindow(rows, { label: '24h', ms: 24 * HOUR }, NOW);
    const status = w.categories.find((c) => c.category === 'status')!;
    expect(status.hits).toBe(1);
    expect(status.misses).toBe(1);
  });
});

// ─── Multi-window orchestration ──────────────────────────────────────────────────

describe('aggregateCacheStats — produces one entry per window', () => {
  it('returns 24h and 7d windows by default', () => {
    const out = aggregateCacheStats([row('status', 3, 1 * HOUR)], NOW);
    expect(out.map((w) => w.window)).toEqual(['24h', '7d']);
  });

  it('honors custom windows', () => {
    const out = aggregateCacheStats([], NOW, [{ label: '1h', ms: HOUR }]);
    expect(out).toHaveLength(1);
    expect(out[0].window).toBe('1h');
  });
});
