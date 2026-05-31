// @vitest-environment jsdom
//
// Feature: sahayak-multi-agent-router, task 24.6 — `/dashboard/agents` cache-hit-rate widget
//
// Unit tests for CacheHitRateWidget — the Semantic Cache hit-rate panel rendered
// on /dashboard/agents (Req 26.6, Design §v1.1.7). The widget fetches
// GET /api/cache/stats (admin) and renders per-category hit rates over the 24h
// and 7d windows.
//
// fetch / network is fully mocked so these tests are deterministic and DB-free.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import {
  CacheHitRateWidget,
  type WindowStats,
} from '@/components/admin/v1_1/CacheHitRateWidget';

// ───────────────────────────────────────────────────────────────────────────
// fetch mock helper
// ───────────────────────────────────────────────────────────────────────────
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  const ok = init?.ok ?? true;
  const status = init?.status ?? (ok ? 200 : 400);
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

const sampleWindows: WindowStats[] = [
  {
    window: '24h',
    since: '2026-01-31T12:00:00.000Z',
    categories: [
      { category: 'status', hits: 9, misses: 1, total: 10, hit_rate: 0.9 },
      { category: 'scheme', hits: 3, misses: 1, total: 4, hit_rate: 0.75 },
      { category: 'help', hits: 0, misses: 0, total: 0, hit_rate: 0 },
    ],
    overall: { category: 'all', hits: 12, misses: 2, total: 14, hit_rate: 0.857 },
  },
  {
    window: '7d',
    since: '2026-01-25T12:00:00.000Z',
    categories: [
      { category: 'status', hits: 40, misses: 10, total: 50, hit_rate: 0.8 },
      { category: 'scheme', hits: 20, misses: 5, total: 25, hit_rate: 0.8 },
      { category: 'help', hits: 5, misses: 5, total: 10, hit_rate: 0.5 },
    ],
    overall: { category: 'all', hits: 65, misses: 20, total: 85, hit_rate: 0.7647 },
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CacheHitRateWidget', () => {
  it('fetches GET /api/cache/stats and renders the overall hit rate (Req 26.6)', async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse({ ok: true, data: { windows: sampleWindows, generated_at: '2026-02-01T12:00:00.000Z' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<CacheHitRateWidget pollIntervalMs={0} />);

    await waitFor(() => {
      // default tab is the first window (24h): overall 0.857 → 86%
      expect(screen.getByText('86%')).toBeInTheDocument();
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/cache/stats');
  });

  it('renders both window tabs (24h / 7d)', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, data: { windows: sampleWindows } })
    ));

    render(<CacheHitRateWidget pollIntervalMs={0} />);

    await waitFor(() => {
      expect(screen.getByText('Last 24h')).toBeInTheDocument();
    });
    expect(screen.getByText('Last 7d')).toBeInTheDocument();
  });

  it('renders a friendly label and hit rate per category', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, data: { windows: sampleWindows } })
    ));

    render(<CacheHitRateWidget pollIntervalMs={0} />);

    await waitFor(() => {
      expect(screen.getByText('Ticket Status')).toBeInTheDocument();
    });
    expect(screen.getByText('Scheme Info')).toBeInTheDocument();
    expect(screen.getByText('Help / Fallback')).toBeInTheDocument();
  });

  it('renders an admin-access message on 403 (admin only)', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: false, error: 'Admin access required' }, { ok: false, status: 403 })
    ));

    render(<CacheHitRateWidget pollIntervalMs={0} />);

    await waitFor(() => {
      expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
    });
  });

  it('shows a no-activity message when a window has no cache traffic', async () => {
    const emptyWindows: WindowStats[] = [
      {
        window: '24h',
        since: '2026-01-31T12:00:00.000Z',
        categories: [
          { category: 'status', hits: 0, misses: 0, total: 0, hit_rate: 0 },
          { category: 'scheme', hits: 0, misses: 0, total: 0, hit_rate: 0 },
          { category: 'help', hits: 0, misses: 0, total: 0, hit_rate: 0 },
        ],
        overall: { category: 'all', hits: 0, misses: 0, total: 0, hit_rate: 0 },
      },
    ];
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, data: { windows: emptyWindows } })
    ));

    render(<CacheHitRateWidget pollIntervalMs={0} />);

    await waitFor(() => {
      expect(screen.getByText(/No cache activity in this window yet/i)).toBeInTheDocument();
    });
  });

  it('surfaces a network error gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))));

    render(<CacheHitRateWidget pollIntervalMs={0} />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });
  });
});
