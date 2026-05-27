'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DonationCertificate } from '@/components/donor/DonationCertificate';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Printer, Loader2 } from 'lucide-react';

interface CertificateData {
  donorName: string;
  bloodGroup: string;
  donatedDate: string;
  hospital: string;
  units: number;
  donationType: string;
  certificateId: string;
  verifyUrl: string;
}

/**
 * Donor Certificate Page — private, requires donor JWT from localStorage.
 *
 * Fetches certificate data from GET /api/blood/verify/[id] and renders
 * the DonationCertificate component. Includes a Print button and a
 * back link to /donor/profile.
 *
 * @see Requirements 10.4, 17.3 — Design §Frontend Page Tree
 */
export default function DonorCertificatePage() {
  const params = useParams();
  const router = useRouter();
  const certificateId = params.id as string;

  const [certificate, setCertificate] = useState<CertificateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCertificate = async () => {
      // Check for donor JWT
      const token = localStorage.getItem('donor_token');
      if (!token) {
        router.replace('/donor/login');
        return;
      }

      try {
        const res = await fetch(`/api/blood/verify/${certificateId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (res.status === 401) {
          // Token expired or invalid — redirect to login
          localStorage.removeItem('donor_token');
          router.replace('/donor/login');
          return;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || 'Certificate not found');
          return;
        }

        const data = await res.json();

        if (!data.ok || !data.data) {
          setError(data.error || 'Certificate data unavailable');
          return;
        }

        const cert = data.data;
        setCertificate({
          donorName: cert.donor_name || cert.donorName || 'Unknown Donor',
          bloodGroup: cert.blood_group || cert.bloodGroup || '',
          donatedDate: cert.donated_date || cert.donatedDate || '',
          hospital: cert.hospital || '',
          units: cert.units || 1,
          donationType: cert.donation_type || cert.donationType || 'whole_blood',
          certificateId: cert.certificate_id || cert.certificateId || certificateId,
          verifyUrl: cert.verify_url || cert.verifyUrl || `${window.location.origin}/verify/${certificateId}`,
        });
      } catch {
        setError('Server से connection नहीं हो पा रहा। कृपया दोबारा प्रयास करें।');
      } finally {
        setLoading(false);
      }
    };

    if (certificateId) {
      fetchCertificate();
    }
  }, [certificateId, router]);

  const handlePrint = () => {
    window.print();
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-red-50 to-white px-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-red-500" />
          <p className="text-sm text-muted-foreground">Loading certificate...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-red-50 to-white px-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-semibold text-gray-900">Certificate Not Found</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => router.push('/donor/profile')} className="gap-2">
            <ArrowLeft className="size-4" />
            Back to Profile
          </Button>
        </div>
      </div>
    );
  }

  // Certificate view
  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 to-white px-4 py-8 print:bg-white print:p-0">
      {/* Navigation — hidden on print */}
      <div className="max-w-lg mx-auto mb-6 flex items-center justify-between print:hidden">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/donor/profile')}
          className="gap-2"
        >
          <ArrowLeft className="size-4" />
          Back to Profile
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handlePrint}
          className="gap-2"
        >
          <Printer className="size-4" />
          Print
        </Button>
      </div>

      {/* Certificate */}
      {certificate && (
        <DonationCertificate
          donorName={certificate.donorName}
          bloodGroup={certificate.bloodGroup}
          donatedDate={certificate.donatedDate}
          hospital={certificate.hospital}
          units={certificate.units}
          donationType={certificate.donationType}
          certificateId={certificate.certificateId}
          verifyUrl={certificate.verifyUrl}
        />
      )}
    </div>
  );
}
