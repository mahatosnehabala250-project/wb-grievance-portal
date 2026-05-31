// @vitest-environment jsdom
//
// Feature: sahayak-multi-agent-router, Task 12.5
// Component tests for the section-12 blood operations dashboard components:
//   - CascadeVisualizer  (Req 16.1, 16.3 — tier-by-tier cascade progression,
//                          response breakdown, fulfillment ratio)
//   - DonorPoolTable     (Req 16.1, 16.5 — donor pool table, response-status
//                          filter behaviour, sort, phone masking)
//
// Infra notes (mirrors tests/components/admin-routing.test.tsx — task 11.6):
//   * The committed vitest.config.ts keeps `environment: 'node'` as the global
//     default. This file opts into a DOM *per file* via the
//     `// @vitest-environment jsdom` docblock on line 1.
//   * jest-dom matchers are imported locally (not via shared setupFiles) so the
//     shared config stays untouched.
//   * CascadeVisualizer is purely props-driven (no fetch / no supabase), so it
//     needs no network mock. DonorPoolTable is likewise props-driven; the only
//     external dependency that misbehaves under jsdom is the Radix Select.
//   * DonorPoolTable renders `<SelectItem value="">` ("All Statuses"). The
//     installed @radix-ui/react-select build throws a hard invariant
//     ("must have a value prop that is not an empty string") under jsdom, which
//     crashes the component before the table mounts. The Radix primitive is not
//     the subject of task 12.5, and the committed component must not be modified
//     by a test-only task — so we substitute the Select primitives with minimal
//     stand-ins. Unlike the static mock in admin-routing.test.tsx, this mock is
//     interactive (SelectItem buttons invoke `onValueChange` via context) so the
//     filter-behaviour requirement (Req 16.5) can be exercised for real.
//
// _Requirements: 16.1, 16.5_

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// ───────────────────────────────────────────────────────────────────────────
// Interactive mock for the shadcn/Radix Select wrapper.
//
// `Select` exposes its `onValueChange` callback through context; each
// `SelectItem` renders a real <button> that invokes it on click. This keeps the
// component-under-test isolated from the heavy Radix primitive while still
// letting us drive the response-status filter the way a user would.
// ───────────────────────────────────────────────────────────────────────────
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  type AnyProps = Record<string, unknown> & { children?: React.ReactNode };
  const SelectCtx = React.createContext<(value: string) => void>(() => {});

  return {
    Select: ({
      children,
      onValueChange,
    }: AnyProps & { value?: string; onValueChange?: (v: string) => void }) =>
      React.createElement(
        SelectCtx.Provider,
        { value: onValueChange ?? (() => {}) },
        React.createElement('div', { 'data-slot': 'select' }, children as React.ReactNode)
      ),
    SelectTrigger: ({ children }: AnyProps) =>
      React.createElement('div', { 'data-slot': 'select-trigger' }, children as React.ReactNode),
    SelectContent: ({ children }: AnyProps) =>
      React.createElement('div', { 'data-slot': 'select-content' }, children as React.ReactNode),
    SelectItem: ({ children, value }: AnyProps) => {
      const onValueChange = React.useContext(SelectCtx);
      return React.createElement(
        'button',
        {
          type: 'button',
          'data-slot': 'select-item',
          'data-value': String(value ?? ''),
          onClick: () => onValueChange(String(value ?? '')),
        },
        children as React.ReactNode
      );
    },
    SelectValue: ({ placeholder }: AnyProps) =>
      React.createElement('span', { 'data-slot': 'select-value' }, placeholder as React.ReactNode),
  };
});

import {
  CascadeVisualizer,
  type CascadeNotificationEntry,
} from '@/components/admin/CascadeVisualizer';
import { DonorPoolTable, type DonorPoolEntry } from '@/components/admin/DonorPoolTable';

// ───────────────────────────────────────────────────────────────────────────
// jsdom polyfills for Radix UI primitives (Progress, Select, etc.) which expect
// browser APIs jsdom does not implement.
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// CascadeVisualizer — Req 16.1, 16.3
// ═══════════════════════════════════════════════════════════════════════════
describe('CascadeVisualizer', () => {
  it('renders the header, urgency badge, and blood-request id', () => {
    render(
      <CascadeVisualizer
        bloodRequestId="req-routine-001"
        urgency="critical"
        currentTier={1}
        notifications={[]}
        donorsConfirmed={0}
        unitsNeeded={2}
      />
    );

    expect(screen.getByText('Cascade Progress')).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.getByText('req-routine-001')).toBeInTheDocument();
    // Confirmed / needed ratio is rendered.
    expect(screen.getByText('0 / 2 units')).toBeInTheDocument();
  });

  it('renders one node per tier in the urgency schedule (routine = 4 tiers)', () => {
    render(
      <CascadeVisualizer
        bloodRequestId="req-routine-002"
        urgency="routine"
        currentTier={1}
        notifications={[]}
        donorsConfirmed={0}
        unitsNeeded={3}
      />
    );

    // routine schedule has tiers 1..4
    expect(screen.getByText('Tier 1')).toBeInTheDocument();
    expect(screen.getByText('Tier 2')).toBeInTheDocument();
    expect(screen.getByText('Tier 3')).toBeInTheDocument();
    expect(screen.getByText('Tier 4')).toBeInTheDocument();
  });

  it('renders fewer tiers for the urgent schedule (3 tiers, no Tier 4)', () => {
    render(
      <CascadeVisualizer
        bloodRequestId="req-urgent-001"
        urgency="urgent"
        currentTier={1}
        notifications={[]}
        donorsConfirmed={0}
        unitsNeeded={3}
      />
    );

    expect(screen.getByText('Tier 1')).toBeInTheDocument();
    expect(screen.getByText('Tier 3')).toBeInTheDocument();
    // urgent has no Tier 4
    expect(screen.queryByText('Tier 4')).not.toBeInTheDocument();
  });

  it('aggregates notifications per tier into accepted / declined / pending counts', () => {
    // critical schedule = 2 tiers. With currentTier=2, Tier 1 is "completed"
    // (its circle shows a check icon, not the number "1"), so the only numbers
    // in the document are the aggregation pills (4/3/6), the active Tier-2
    // circle ("2"), and the units ratio ("0", "7"). 4/3/6 are therefore unique.
    const notifications: CascadeNotificationEntry[] = [
      // accepted (haan) ×4
      { tier: 1, donor_id: 'd1', notified_at: 't', response: 'haan' },
      { tier: 1, donor_id: 'd2', notified_at: 't', response: 'haan' },
      { tier: 1, donor_id: 'd3', notified_at: 't', response: 'haan' },
      { tier: 1, donor_id: 'd4', notified_at: 't', response: 'haan' },
      // declined: nahi ×2 + timeout ×1 = 3
      { tier: 1, donor_id: 'd5', notified_at: 't', response: 'nahi' },
      { tier: 1, donor_id: 'd6', notified_at: 't', response: 'nahi' },
      { tier: 1, donor_id: 'd7', notified_at: 't', response: 'timeout' },
      // pending (null / undefined) ×6
      { tier: 1, donor_id: 'd8', notified_at: 't', response: null },
      { tier: 1, donor_id: 'd9', notified_at: 't', response: null },
      { tier: 1, donor_id: 'd10', notified_at: 't', response: null },
      { tier: 1, donor_id: 'd11', notified_at: 't' },
      { tier: 1, donor_id: 'd12', notified_at: 't' },
      { tier: 1, donor_id: 'd13', notified_at: 't' },
    ];

    render(
      <CascadeVisualizer
        bloodRequestId="req-critical-aggr"
        urgency="critical"
        currentTier={2}
        notifications={notifications}
        donorsConfirmed={0}
        unitsNeeded={7}
      />
    );

    expect(screen.getByText('4')).toBeInTheDocument(); // accepted pill
    expect(screen.getByText('3')).toBeInTheDocument(); // declined pill
    expect(screen.getByText('6')).toBeInTheDocument(); // pending pill
  });

  it('shows the Fulfilled badge once confirmed >= needed', () => {
    render(
      <CascadeVisualizer
        bloodRequestId="req-fulfilled"
        urgency="urgent"
        currentTier={2}
        notifications={[]}
        donorsConfirmed={3}
        unitsNeeded={3}
      />
    );

    expect(screen.getByText('Fulfilled')).toBeInTheDocument();
    expect(screen.getByText('3 / 3 units')).toBeInTheDocument();
  });

  it('omits the Fulfilled badge while the request is unmet', () => {
    render(
      <CascadeVisualizer
        bloodRequestId="req-unmet"
        urgency="urgent"
        currentTier={1}
        notifications={[]}
        donorsConfirmed={1}
        unitsNeeded={4}
      />
    );

    expect(screen.queryByText('Fulfilled')).not.toBeInTheDocument();
  });

  it('matches the rendered snapshot for a known cascade', () => {
    const { container } = render(
      <CascadeVisualizer
        bloodRequestId="req-snap-001"
        urgency="routine"
        currentTier={2}
        notifications={[
          { tier: 1, donor_id: 'a', notified_at: 't', response: 'haan' },
          { tier: 1, donor_id: 'b', notified_at: 't', response: 'nahi' },
        ]}
        donorsConfirmed={1}
        unitsNeeded={3}
      />
    );
    expect(container).toMatchSnapshot();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DonorPoolTable — Req 16.1, 16.5
// ═══════════════════════════════════════════════════════════════════════════
describe('DonorPoolTable', () => {
  const donors: DonorPoolEntry[] = [
    {
      id: 'donor-alice',
      name: 'Alice',
      phone: '919876543210',
      blood_group: 'A+',
      district: 'Kolkata',
      block: 'Ballygunge',
      total_donations: 5,
      next_eligible_date: null,
      response_status: 'accepted',
      tier: 1,
      notified_at: null,
      responded_at: null,
    },
    {
      id: 'donor-bob',
      name: 'Bob',
      phone: '918001234567',
      blood_group: 'O-',
      district: 'Howrah',
      block: 'Bally',
      total_donations: 2,
      next_eligible_date: null,
      response_status: 'pending',
      tier: 2,
      notified_at: null,
      responded_at: null,
    },
    {
      id: 'donor-carol',
      name: 'Carol',
      phone: '917000000000',
      blood_group: 'B+',
      district: 'Kolkata',
      block: 'Salt Lake',
      total_donations: 9,
      next_eligible_date: null,
      response_status: 'declined',
      tier: 1,
      notified_at: null,
      responded_at: null,
    },
    {
      id: 'donor-dave',
      name: 'Dave',
      phone: '916111111111',
      blood_group: 'AB+',
      district: 'Hooghly',
      block: 'Chinsurah',
      total_donations: 0,
      next_eligible_date: null,
      response_status: 'standby',
      tier: 3,
      notified_at: null,
      responded_at: null,
    },
  ];

  /** Read the donor name (first cell) of each body row, in DOM order. */
  function bodyRowNames(): string[] {
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    return rows.map((row) => within(row).getAllByRole('cell')[0].textContent?.trim() ?? '');
  }

  it('renders the empty state when there are no donors', () => {
    render(<DonorPoolTable bloodRequestId="req-1" donors={[]} />);
    expect(
      screen.getByText(/No donors in the pool for this blood request yet/i)
    ).toBeInTheDocument();
  });

  it('renders a row per donor plus the pool summary count', () => {
    render(<DonorPoolTable bloodRequestId="req-1" donors={donors} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
    expect(screen.getByText('Dave')).toBeInTheDocument();

    // Summary line: "4 of 4 donors in pool" (no "matching" until filtered).
    expect(screen.getByText(/of 4 donors in pool/i)).toBeInTheDocument();
    expect(bodyRowNames()).toHaveLength(4);
  });

  it('renders a status-breakdown badge for each response status', () => {
    render(<DonorPoolTable bloodRequestId="req-1" donors={donors} />);

    expect(screen.getByText('Accepted: 1')).toBeInTheDocument();
    expect(screen.getByText('Pending: 1')).toBeInTheDocument();
    expect(screen.getByText('Declined: 1')).toBeInTheDocument();
    expect(screen.getByText('Standby: 1')).toBeInTheDocument();
  });

  it('filters the table by response status when a status option is chosen (Req 16.5)', () => {
    render(<DonorPoolTable bloodRequestId="req-1" donors={donors} />);

    // Choose "Accepted" from the (mocked) status Select.
    fireEvent.click(screen.getByRole('button', { name: 'Accepted' }));

    // Only the accepted donor remains.
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol')).not.toBeInTheDocument();
    expect(screen.queryByText('Dave')).not.toBeInTheDocument();

    // Summary reflects the active filter ("N matching of M donors in pool").
    expect(screen.getByText(/matching of 4 donors in pool/i)).toBeInTheDocument();
    expect(bodyRowNames()).toEqual(['Alice']);
  });

  it('sorts by donations ascending and descending when the header is toggled', () => {
    render(<DonorPoolTable bloodRequestId="req-1" donors={donors} />);

    const donationsHeader = screen.getByRole('button', { name: /Donations/i });

    // First click → ascending by total_donations: Dave(0) < Bob(2) < Alice(5) < Carol(9)
    fireEvent.click(donationsHeader);
    expect(bodyRowNames()).toEqual(['Dave', 'Bob', 'Alice', 'Carol']);

    // Second click → descending.
    fireEvent.click(donationsHeader);
    expect(bodyRowNames()).toEqual(['Carol', 'Alice', 'Bob', 'Dave']);
  });

  it('never renders raw phone numbers and shows the masking note (Req 16.5 — NFR Security)', () => {
    render(<DonorPoolTable bloodRequestId="req-1" donors={donors} />);

    // No raw phone number reaches the DOM.
    for (const d of donors) {
      expect(screen.queryByText(d.phone)).not.toBeInTheDocument();
    }
    // The masking disclosure note is present.
    expect(
      screen.getByText(/Phone numbers are masked \(last 4 digits only\)/i)
    ).toBeInTheDocument();
  });

  it('matches the rendered snapshot for a known donor pool', () => {
    const { container } = render(
      <DonorPoolTable
        bloodRequestId="req-snap"
        donors={[
          {
            id: 'donor-snap',
            name: 'Snapshot Donor',
            phone: '919999999999',
            blood_group: 'A+',
            district: 'Kolkata',
            block: 'Ballygunge',
            total_donations: 3,
            next_eligible_date: null,
            response_status: 'accepted',
            tier: 1,
            notified_at: null,
            responded_at: null,
          },
        ]}
      />
    );
    expect(container).toMatchSnapshot();
  });
});
