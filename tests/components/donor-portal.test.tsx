// @vitest-environment jsdom
//
// Feature: sahayak-multi-agent-router, Task 13.6
// Component tests for the section-13 donor-portal components:
//   - DonationCertificate   (Req 17.3, 10.4 — printable certificate card with QR
//                             verify link + download/print affordances from props)
//   - HealthSelfReportForm  (Req 17.5 — self-deferral form → POST
//                             /api/blood-donors/self-defer with the deferral payload)
//
// Infra notes (kept deliberately non-disruptive, mirroring task 11.6's
// tests/components/admin-routing.test.tsx):
//   * The committed vitest.config.ts keeps `environment: 'node'` as the global
//     default so the existing property/api/integration tests are unaffected.
//     This file opts into a DOM *per file* via the `// @vitest-environment jsdom`
//     docblock on line 1.
//   * jest-dom matchers are imported locally (not via shared setupFiles) so no
//     global config is touched.
//   * fetch + localStorage are mocked so the tests are deterministic and DB-free.
//   * Neither component renders a Radix Select with an empty-string value, so the
//     `@/components/ui/select` mock used by admin-routing.test.tsx is NOT needed
//     here. HealthSelfReportForm does use a Radix RadioGroup, so the same jsdom
//     pointer/observer polyfills are installed below.
//
// _Requirements: 17.3, 17.5_

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// jest-dom's `/vitest` entry extends Vitest's own `expect` (the bare entry
// assumes a Jest-style global `expect`, which Vitest does not expose unless
// `globals: true` is set — and we deliberately avoid touching the shared config).
import '@testing-library/jest-dom/vitest';

import { DonationCertificate, type DonationCertificateProps } from '@/components/donor/DonationCertificate';
import HealthSelfReportForm from '@/components/donor/HealthSelfReportForm';

// ───────────────────────────────────────────────────────────────────────────
// jsdom polyfills for Radix UI primitives (RadioGroup, etc.) which expect APIs
// jsdom does not implement.
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  try {
    window.localStorage.clear();
  } catch {
    /* localStorage may be unavailable in some envs */
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DonationCertificate — Req 17.3 / 10.4
// ═══════════════════════════════════════════════════════════════════════════
describe('DonationCertificate', () => {
  const certProps: DonationCertificateProps = {
    donorName: 'Ramesh Kumar',
    bloodGroup: 'A+',
    donatedDate: '2026-01-15',
    hospital: 'SSKM Hospital, Kolkata',
    units: 2,
    donationType: 'whole_blood',
    certificateId: 'CERT-WB-00042',
    verifyUrl: 'https://janseva.wb.gov.in/verify/CERT-WB-00042',
  };

  it('renders the donor name, blood group, hospital, units and certificate id from props', () => {
    render(<DonationCertificate {...certProps} />);

    expect(screen.getByText('Ramesh Kumar')).toBeInTheDocument();
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('SSKM Hospital, Kolkata')).toBeInTheDocument();
    expect(screen.getByText('CERT-WB-00042')).toBeInTheDocument();
    // units value (chosen so it does not collide with any other text node)
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('humanises the donation type by replacing the underscore', () => {
    render(<DonationCertificate {...certProps} />);
    // `whole_blood` → `whole blood` (the component does .replace('_', ' '))
    expect(screen.getByText('whole blood')).toBeInTheDocument();
  });

  it('exposes the QR verify link pointing at the verifyUrl', () => {
    render(<DonationCertificate {...certProps} />);

    expect(screen.getByText(/scan to verify/i)).toBeInTheDocument();

    const qrLink = screen.getByTitle('Verify certificate');
    expect(qrLink).toHaveAttribute('href', certProps.verifyUrl);
    expect(qrLink).toHaveAttribute('target', '_blank');
  });

  it('renders the "Verify Online" affordance linking to the verifyUrl', () => {
    render(<DonationCertificate {...certProps} />);

    const verifyOnline = screen.getByRole('link', { name: /verify online/i });
    expect(verifyOnline).toHaveAttribute('href', certProps.verifyUrl);
  });

  it('omits the "Verify Online" link when no verifyUrl is supplied', () => {
    render(<DonationCertificate {...certProps} verifyUrl="" />);
    expect(screen.queryByRole('link', { name: /verify online/i })).not.toBeInTheDocument();
  });

  it('triggers window.print when the Download / Print button is clicked', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    render(<DonationCertificate {...certProps} />);

    const printBtn = screen.getByRole('button', { name: /download \/ print/i });
    await userEvent.click(printBtn);

    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('matches the rendered snapshot for a known certificate', () => {
    const { container } = render(<DonationCertificate {...certProps} />);
    expect(container).toMatchSnapshot();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HealthSelfReportForm — Req 17.5
// ═══════════════════════════════════════════════════════════════════════════
describe('HealthSelfReportForm', () => {
  it('renders the reason options with the submit + duration disabled until a reason is chosen', () => {
    render(<HealthSelfReportForm />);

    expect(screen.getByText('Self-Report Health Deferral')).toBeInTheDocument();
    // A few of the required deferral reasons are present.
    expect(screen.getByText('Illness (Bimari)')).toBeInTheDocument();
    expect(screen.getByText('Surgery (Operation)')).toBeInTheDocument();
    expect(screen.getByText('Pregnancy (Garbhavastha)')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /submit deferral/i })).toBeDisabled();
    expect(screen.getByLabelText(/duration \(days\)/i)).toBeDisabled();
  });

  it('auto-fills the default duration and enables submit when a reason is selected', async () => {
    render(<HealthSelfReportForm />);

    await userEvent.click(screen.getByRole('radio', { name: 'Illness (Bimari)' }));

    const durationInput = screen.getByLabelText(/duration \(days\)/i);
    await waitFor(() => {
      // DEFAULT_DURATIONS.illness === 14
      expect(durationInput).toHaveValue(14);
    });
    expect(durationInput).toBeEnabled();
    expect(screen.getByText(/default for illness: 14 days/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit deferral/i })).toBeEnabled();
  });

  it('POSTs the deferral payload to /api/blood-donors/self-defer and calls onSuccess', async () => {
    window.localStorage.setItem('donor_token', 'tok-123');

    const fetchMock = vi.fn(() =>
      jsonResponse({
        ok: true,
        data: { deferral_until: '2026-02-01', deferral_reason: 'illness' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const onSuccess = vi.fn();
    render(<HealthSelfReportForm onSuccess={onSuccess} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Illness (Bimari)' }));
    await userEvent.type(screen.getByLabelText(/notes \(optional\)/i), 'Fever for a week');
    await userEvent.click(screen.getByRole('button', { name: /submit deferral/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        deferral_until: '2026-02-01',
        deferral_reason: 'illness',
      });
    });

    // Verify the request shape.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe('/api/blood-donors/self-defer');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(JSON.parse(String(init.body))).toMatchObject({
      reason: 'illness',
      duration_days: 14,
      notes: 'Fever for a week',
    });

    // Success state rendered.
    expect(screen.getByText(/2026-02-01 tak deferred hai/i)).toBeInTheDocument();
    expect(screen.getByText(/reason: illness/i)).toBeInTheDocument();
  });

  it('shows an auth error and skips the network call when no donor token is present', async () => {
    window.localStorage.removeItem('donor_token');

    const fetchMock = vi.fn(() => jsonResponse({ ok: true, data: {} }));
    vi.stubGlobal('fetch', fetchMock);

    render(<HealthSelfReportForm />);

    await userEvent.click(screen.getByRole('radio', { name: 'Surgery (Operation)' }));
    await userEvent.click(screen.getByRole('button', { name: /submit deferral/i }));

    await waitFor(() => {
      expect(screen.getByText(/not authenticated\. please log in again\./i)).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the API error message when the self-defer request is rejected', async () => {
    window.localStorage.setItem('donor_token', 'tok-123');

    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ ok: false, message: 'Already deferred' }, { ok: false, status: 400 }))
    );

    render(<HealthSelfReportForm />);

    await userEvent.click(screen.getByRole('radio', { name: 'Illness (Bimari)' }));
    await userEvent.click(screen.getByRole('button', { name: /submit deferral/i }));

    await waitFor(() => {
      expect(screen.getByText('Already deferred')).toBeInTheDocument();
    });
  });

  it('invokes onCancel when the Cancel button is clicked', async () => {
    const onCancel = vi.fn();
    render(<HealthSelfReportForm onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
