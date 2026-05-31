// @vitest-environment jsdom
//
// Feature: sahayak-multi-agent-router, Task 11.6
// Component tests for the section-11 admin routing dashboard components:
//   - AgentRoutingTable       (Req 13.2 — masked phone, message preview, row click)
//   - SessionStateInspector   (Req 14.1, 14.2 — state display + admin-gated reset)
//   - CEORouterTester         (Req 15.3 — POST /api/agents/test-route + result render)
//
// Infra notes (kept deliberately non-disruptive):
//   * This is the FIRST React/jsdom test in the repo. The committed
//     vitest.config.ts keeps `environment: 'node'` as the global default so the
//     existing property/api/integration tests are unaffected. This file opts
//     into a DOM *per file* via the `// @vitest-environment jsdom` docblock on
//     line 1 — that is the key technique.
//   * jest-dom matchers are imported locally below (not via a shared
//     setupFiles) so no global config is touched.
//   * fetch / network is fully mocked so the tests are deterministic and DB-free.
//
// _Requirements: 13.2, 14.1, 14.2, 15.3, NFR Usability_

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// jest-dom's `/vitest` entry extends Vitest's own `expect` (the bare entry
// assumes a Jest-style global `expect`, which Vitest does not expose unless
// `globals: true` is set — and we deliberately avoid touching the shared config).
import '@testing-library/jest-dom/vitest';

// ───────────────────────────────────────────────────────────────────────────
// Mock the shadcn/Radix Select wrapper.
//
// AgentRoutingTable renders `<SelectItem value="">` for its "All Agents" /
// "All Intents" options. The installed @radix-ui/react-select build throws a
// hard invariant ("must have a value prop that is not an empty string") while
// rendering that item under jsdom, which crashes the whole component before
// the table mounts. That Radix primitive is NOT the subject of task 11.6 (we
// test data fetching, phone masking, message truncation, row-click, and the
// empty/error states), and the committed component must not be modified by a
// test-only task. So we substitute the Select primitives with minimal,
// invariant-free stand-ins. This is a standard practice for isolating a
// component-under-test from a heavy third-party UI dependency.
// ───────────────────────────────────────────────────────────────────────────
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  type AnyProps = Record<string, unknown> & { children?: React.ReactNode };
  return {
    Select: ({ children }: AnyProps) =>
      React.createElement('div', { 'data-slot': 'select' }, children as React.ReactNode),
    SelectTrigger: ({ children }: AnyProps) =>
      React.createElement('div', { 'data-slot': 'select-trigger' }, children as React.ReactNode),
    SelectContent: ({ children }: AnyProps) =>
      React.createElement('div', { 'data-slot': 'select-content' }, children as React.ReactNode),
    SelectItem: ({ children, value }: AnyProps) =>
      React.createElement(
        'div',
        { 'data-slot': 'select-item', 'data-value': String(value ?? '') },
        children as React.ReactNode
      ),
    SelectValue: ({ placeholder }: AnyProps) =>
      React.createElement('span', { 'data-slot': 'select-value' }, placeholder as React.ReactNode),
  };
});

import { AgentRoutingTable, type RoutingDecision } from '@/components/admin/AgentRoutingTable';
import { SessionStateInspector, type SessionState } from '@/components/admin/SessionStateInspector';
import { CEORouterTester } from '@/components/admin/CEORouterTester';

// ───────────────────────────────────────────────────────────────────────────
// jsdom polyfills for Radix UI primitives (Select, etc.) which expect APIs
// jsdom does not implement. We only render closed Selects, but these guards
// keep rendering robust across components.
// ───────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!('matchMedia' in window)) {
    (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// fetch mock helpers
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ═══════════════════════════════════════════════════════════════════════════
// AgentRoutingTable — Req 13.2
// ═══════════════════════════════════════════════════════════════════════════
describe('AgentRoutingTable', () => {
  const longMessage = 'A'.repeat(250);

  const sampleDecisions: RoutingDecision[] = [
    {
      id: 'rd-1',
      session_id: '919876543210',
      message_text: longMessage,
      last_intent_before: 'idle',
      agent_dispatched: 'blood',
      reason: 'idle_keyword_blood',
      trace_id: 'trace-1',
      created_at: '2026-01-02T10:30:00.000Z',
    },
    {
      id: 'rd-2',
      session_id: '918001234567',
      message_text: 'Namaskar',
      last_intent_before: 'welcome',
      agent_dispatched: null,
      reason: 'session_stale_reset',
      trace_id: 'trace-2',
      created_at: '2026-01-02T10:31:00.000Z',
    },
  ];

  it('fetches /api/routing/decisions and renders a row per decision', async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse({ ok: true, data: sampleDecisions, total: 2 })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentRoutingTable />);

    // The table appears once the fetch resolves.
    await waitFor(() => {
      expect(screen.getByText(/Showing 2 of 2 routing decisions/i)).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalled();
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/routing/decisions');
    expect(calledUrl).toContain('limit=100');

    // Two data rows rendered.
    expect(screen.getByText('idle')).toBeInTheDocument();
    expect(screen.getByText('welcome')).toBeInTheDocument();
  });

  it('applies the maskPhone helper to the session_id (NFR Security)', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, data: sampleDecisions, total: 2 })
    ));

    render(<AgentRoutingTable />);

    await waitFor(() => {
      expect(screen.getByText('919*****3210')).toBeInTheDocument();
    });

    // The raw, unmasked phone number must never reach the DOM.
    expect(screen.queryByText('919876543210')).not.toBeInTheDocument();
    // Second row also masked.
    expect(screen.getByText('918*****4567')).toBeInTheDocument();
  });

  it('truncates the message preview to 200 chars + ellipsis', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, data: sampleDecisions, total: 2 })
    ));

    render(<AgentRoutingTable />);

    const expectedTruncated = 'A'.repeat(200) + '…';
    await waitFor(() => {
      expect(screen.getByText(expectedTruncated)).toBeInTheDocument();
    });
    // Full 250-char message must not be rendered verbatim.
    expect(screen.queryByText(longMessage)).not.toBeInTheDocument();
  });

  it('invokes onRowClick with the decision when a row is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, data: sampleDecisions, total: 2 })
    ));

    const onRowClick = vi.fn();
    render(<AgentRoutingTable onRowClick={onRowClick} />);

    const maskedCell = await screen.findByText('919*****3210');
    const row = maskedCell.closest('tr');
    expect(row).not.toBeNull();

    fireEvent.click(row!);

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rd-1', session_id: '919876543210' })
    );
  });

  it('renders the empty state when no decisions are returned', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: true, data: [], total: 0 })
    ));

    render(<AgentRoutingTable />);

    await waitFor(() => {
      expect(
        screen.getByText(/No routing decisions found/i)
      ).toBeInTheDocument();
    });
  });

  it('surfaces an error envelope from the API', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ ok: false, error: 'boom' }, { ok: false, status: 500 })
    ));

    render(<AgentRoutingTable />);

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SessionStateInspector — Req 14.1, 14.2
// ═══════════════════════════════════════════════════════════════════════════
describe('SessionStateInspector', () => {
  const baseSession: SessionState = {
    session_id: '919876543210',
    last_intent: 'blood_collecting',
    active_agent: 'blood',
    collected_data: { naam: 'Ramesh', blood_group: 'A+' },
    language: 'hi',
    last_activity_at: null,
    state: null,
    created_at: null,
  };

  it('renders last_intent, active_agent, language, and collected_data from props (Req 14.1)', () => {
    render(<SessionStateInspector phone="919876543210" sessionData={baseSession} />);

    // last_intent + active_agent badges
    expect(screen.getByText('blood_collecting')).toBeInTheDocument();
    expect(screen.getByText('blood')).toBeInTheDocument();
    // language label mapping
    expect(screen.getByText(/Hindi/)).toBeInTheDocument();
    // collected_data pretty-printed JSON
    expect(screen.getByText(/"naam": "Ramesh"/)).toBeInTheDocument();
    expect(screen.getByText(/"blood_group": "A\+"/)).toBeInTheDocument();
    // next expected action derived from the intent
    expect(screen.getByText(/Blood Agent collecting request details/i)).toBeInTheDocument();
  });

  it('hides the Reset Session action for non-admins (Req 14.2 — admin-only gating)', () => {
    render(
      <SessionStateInspector phone="919876543210" sessionData={baseSession} isAdmin={false} />
    );
    expect(screen.queryByRole('button', { name: /reset session/i })).not.toBeInTheDocument();
  });

  it('shows the Reset Session action for admins and POSTs to /api/sessions/save on click', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/api/sessions/save')) {
        return jsonResponse({ ok: true });
      }
      // refetch after reset → GET /api/sessions/state
      return jsonResponse({
        ok: true,
        data: { ...baseSession, last_intent: 'idle', collected_data: {} },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const onReset = vi.fn();
    render(
      <SessionStateInspector
        phone="919876543210"
        sessionData={baseSession}
        isAdmin
        onReset={onReset}
      />
    );

    const resetBtn = screen.getByRole('button', { name: /reset session/i });
    expect(resetBtn).toBeEnabled();

    await userEvent.click(resetBtn);

    await waitFor(() => {
      expect(onReset).toHaveBeenCalledTimes(1);
    });

    // The reset POST carried the flow_complete flag for this session.
    const saveCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/api/sessions/save')
    );
    expect(saveCall).toBeTruthy();
    const init = saveCall![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({
      session_id: '919876543210',
      flow_complete: true,
    });
  });

  it('disables the Reset action when the session is already idle', () => {
    render(
      <SessionStateInspector
        phone="919876543210"
        sessionData={{ ...baseSession, last_intent: 'idle' }}
        isAdmin
      />
    );
    const resetBtn = screen.getByRole('button', { name: /reset session/i });
    expect(resetBtn).toBeDisabled();
    expect(screen.getByText(/Session is already idle/i)).toBeInTheDocument();
  });

  it('matches the rendered snapshot for a known session', () => {
    const { container } = render(
      <SessionStateInspector phone="919876543210" sessionData={baseSession} />
    );
    expect(container).toMatchSnapshot();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CEORouterTester — Req 15.3
// ═══════════════════════════════════════════════════════════════════════════
describe('CEORouterTester', () => {
  it('renders the test runner with quick presets', () => {
    render(<CEORouterTester />);
    expect(screen.getByText('CEO Router Test Runner')).toBeInTheDocument();
    // The "Yess" donor-pending preset is one of the required samples.
    expect(screen.getByRole('button', { name: /"Yess" \(donor pending\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ticket number/i })).toBeInTheDocument();
  });

  it('POSTs to /api/agents/test-route and renders the routing decision', async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse({
        agent: 'donor',
        reason: 'state_lock_donor_pending',
        rules_evaluated: ['stale_belt', 'state_lock'],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<CEORouterTester />);

    const textarea = screen.getByLabelText(/Message text/i);
    await userEvent.type(textarea, 'Yess');

    const testBtn = screen.getByRole('button', { name: /Test Route/i });
    await userEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText('Routing Decision')).toBeInTheDocument();
    });

    // Verify the request shape.
    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toBe('/api/agents/test-route');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({ message: 'Yess' });

    // Result fields rendered.
    expect(screen.getByText('donor')).toBeInTheDocument();
    expect(screen.getByText('state_lock_donor_pending')).toBeInTheDocument();
    expect(screen.getByText('state_lock')).toBeInTheDocument();
  });

  it('applies a preset to the message textarea', async () => {
    render(<CEORouterTester />);

    await userEvent.click(
      screen.getByRole('button', { name: /Ticket number/i })
    );

    const textarea = screen.getByLabelText(/Message text/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Check WB-2026-00123');
  });

  it('renders an error when the API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      jsonResponse({ error: 'Unauthorized' }, { ok: false, status: 401 })
    ));

    render(<CEORouterTester />);

    await userEvent.type(screen.getByLabelText(/Message text/i), 'hello');
    await userEvent.click(screen.getByRole('button', { name: /Test Route/i }));

    await waitFor(() => {
      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });
  });
});
