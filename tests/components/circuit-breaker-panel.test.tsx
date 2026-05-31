// @vitest-environment jsdom
//
// Feature: sahayak-multi-agent-router, Task 27.7
// Unit tests for CircuitBreakerPanel — the focused circuit-breaker reading /
// display widget for /dashboard/system-health (Req 29.7, 32.3).
//
// The panel fetches GET /api/system-health (admin, task 30.5) and renders the
// `data.breakers` slice (circuit_state rows): name, state badge,
// consecutive_failures, and opened_at. circuit_state is the canonical source of
// truth for breaker state (Design §v1.1.10).
//
// fetch / network is fully mocked so these tests are deterministic and DB-free.
//
// _Requirements: 29.7, 32.3 — Design §v1.1.10, §v1.1.13_

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import {
  CircuitBreakerPanel,
  type CircuitBreakerRow,
} from '@/components/admin/v1_1/CircuitBreakerPanel';

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

const sampleBreakers: CircuitBreakerRow[] = [
  {
    name: 'gemini',
    state: 'closed',
    consecutive_failures: 0,
    window_start: null,
    opened_at: null,
    last_probe_at: null,
    updated_at: '2026-02-01T10:00:00.000Z',
  },
  {
    name: 'whatsapp',
    state: 'open',
    consecutive_failures: 5,
    window_start: '2026-02-01T09:59:00.000Z',
    opened_at: '2026-02-01T09:59:30.000Z',
    last_probe_at: '2026-02-01T10:00:00.000Z',
    updated_at: '2026-02-01T10:00:00.000Z',
  },
  {
    name: 'embeddings',
    state: 'half_open',
    consecutive_failures: 2,
    window_start: '2026-02-01T09:58:00.000Z',
    opened_at: '2026-02-01T09:58:30.000Z',
    last_probe_at: '2026-02-01T10:00:00.000Z',
    updated_at: '2026-02-01T10:00:00.000Z',
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CircuitBreakerPanel', () => {
  it('fetches GET /api/system-health and renders a row per breaker (Req 29.7)', async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse({ ok: true, data: { breakers: sampleBreakers, generated_at: '2026-02-01T10:00:00.000Z' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<CircuitBreakerPanel pollIntervalMs={0} />);

    await waitFor(() => {
      expect(screen.getByText('Gemini (LLM)')).toBeInTheDocument();
    });

    // It hit the canonical admin endpoint.
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/system-health');

    // All three breakers rendered with friendly labels.
    expect(screen.getByText('WhatsApp Cloud API')).toBeInTheDocument();
    expect(screen.getByText('Embeddings')).toBeInTheDocument();
  });

  it('renders the current state badge for each breaker', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, data: { breakers: sampleBreakers } })
    ));

    render(<CircuitBreakerPanel pollIntervalMs={0} />);

    await waitFor(() => {
      expect(screen.getByText('Closed')).toBeInTheDocument();
    });
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Half-open')).toBeInTheDocument();
  });

  it('shows consecutive_failures and opened_at for an open breaker', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, data: { breakers: [sampleBreakers[1]] } })
    ));

    render(<CircuitBreakerPanel pollIntervalMs={0} />);

    await waitFor(() => {
      // "5 consecutive failures · opened <time>"
      expect(screen.getByText(/5 consecutive failures/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/opened/i)).toBeInTheDocument();
  });

  it('flags how many breakers are degraded (not closed)', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, data: { breakers: sampleBreakers } })
    ));

    render(<CircuitBreakerPanel pollIntervalMs={0} />);

    // whatsapp (open) + embeddings (half_open) = 2 degraded.
    await waitFor(() => {
      expect(screen.getByText('2 degraded')).toBeInTheDocument();
    });
  });

  it('renders an admin-access message on 403 (Req 32.5 — admin only)', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: false, error: 'Admin access required' }, { ok: false, status: 403 })
    ));

    render(<CircuitBreakerPanel pollIntervalMs={0} />);

    await waitFor(() => {
      expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
    });
  });

  it('renders the empty state when no breakers are configured', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, data: { breakers: [] } })
    ));

    render(<CircuitBreakerPanel pollIntervalMs={0} />);

    await waitFor(() => {
      expect(screen.getByText(/No circuit breakers configured/i)).toBeInTheDocument();
    });
  });

  it('surfaces a network error gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))));

    render(<CircuitBreakerPanel pollIntervalMs={0} />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });
  });
});
