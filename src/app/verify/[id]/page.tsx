'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface CertificateData {
  certificate_id: string;
  donor_name: string;
  blood_group: string;
  donated_date: string;
  hospital: string;
  units: number;
  donation_type: string;
  verified_at: string;
}

type VerifyState =
  | { status: 'loading' }
  | { status: 'verified'; data: CertificateData }
  | { status: 'not_found'; error: string };

export default function CertificateVerifyPage() {
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<VerifyState>({ status: 'loading' });

  useEffect(() => {
    if (!params.id) {
      setState({ status: 'not_found', error: 'Certificate ID is missing' });
      return;
    }

    const fetchCertificate = async () => {
      try {
        const res = await fetch(`/api/blood/verify/${params.id}`);
        const json = await res.json();

        if (res.ok && json.ok && json.verified) {
          setState({ status: 'verified', data: json.data });
        } else {
          setState({
            status: 'not_found',
            error: json.error || 'Certificate not found or invalid',
          });
        }
      } catch {
        setState({
          status: 'not_found',
          error: 'Unable to verify certificate. Please try again later.',
        });
      }
    };

    fetchCertificate();
  }, [params.id]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-red-50 to-white px-4 py-8">
      {/* Branding */}
      <div className="text-center mb-6">
        <p className="text-3xl sm:text-4xl font-bold text-gray-800">
          🩸 JanSeva Rakta Sahayak
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Certificate Verification
        </p>
      </div>

      {/* Loading state */}
      {state.status === 'loading' && (
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-red-200 border-t-red-600 mb-4" />
            <p className="text-muted-foreground text-sm">Verifying certificate…</p>
          </CardContent>
        </Card>
      )}

      {/* Verified state */}
      {state.status === 'verified' && (
        <Card className="w-full max-w-md border-green-200 shadow-lg">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-3">
              <svg
                className="w-9 h-9 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <Badge className="mx-auto bg-green-600 text-white hover:bg-green-700 text-sm px-3 py-1">
              Verified ✓
            </Badge>
            <CardTitle className="mt-3 text-lg">Donation Certificate</CardTitle>
          </CardHeader>

          <CardContent className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <DetailRow label="Donor Name" value={state.data.donor_name} />
              <DetailRow label="Blood Group" value={state.data.blood_group} />
              <DetailRow
                label="Donation Date"
                value={formatDate(state.data.donated_date)}
              />
              <DetailRow label="Hospital" value={state.data.hospital} />
              <DetailRow
                label="Units Donated"
                value={String(state.data.units)}
              />
              <DetailRow
                label="Donation Type"
                value={formatDonationType(state.data.donation_type)}
              />
            </div>

            <div className="border-t pt-3 mt-4">
              <p className="text-xs text-muted-foreground text-center">
                Verified on {formatDateTime(state.data.verified_at)}
              </p>
              <p className="text-xs text-muted-foreground text-center mt-1">
                Certificate ID: {state.data.certificate_id.slice(0, 8)}…
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Not found state */}
      {state.status === 'not_found' && (
        <Card className="w-full max-w-md border-red-200 shadow-lg">
          <CardContent className="flex flex-col items-center py-10">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-4">
              <svg
                className="w-9 h-9 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <Badge variant="destructive" className="text-sm px-3 py-1 mb-3">
              Not Verified
            </Badge>
            <p className="text-center text-sm text-muted-foreground">
              {state.error}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Footer */}
      <p className="text-xs text-muted-foreground mt-8 text-center max-w-sm">
        This page verifies the authenticity of blood donation certificates issued
        by JanSeva Rakta Sahayak, West Bengal.
      </p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-medium text-gray-900">{value || '—'}</p>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function formatDonationType(type: string): string {
  const map: Record<string, string> = {
    whole_blood: 'Whole Blood',
    platelets: 'Platelets',
    plasma: 'Plasma',
    double_red: 'Double Red Cells',
  };
  return map[type] || type;
}
