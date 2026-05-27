'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Printer, Download, QrCode } from 'lucide-react';

export interface DonationCertificateProps {
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
 * DonationCertificate — renders a formal donation certificate card.
 *
 * Shows donor name, blood group badge, donation date, hospital, units,
 * certificate ID, a QR code placeholder linking to the verify URL,
 * and a Download/Print button.
 *
 * Mobile-first, styled like a formal certificate with border and layout.
 *
 * @see Requirements 10.4, 17.3 — Design §Frontend Components
 */
export function DonationCertificate({
  donorName,
  bloodGroup,
  donatedDate,
  hospital,
  units,
  donationType,
  certificateId,
  verifyUrl,
}: DonationCertificateProps) {
  const formattedDate = new Date(donatedDate).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <Card className="w-full max-w-lg mx-auto border-2 border-red-200 shadow-lg print:shadow-none print:border print:border-gray-300">
      <CardContent className="p-6 sm:p-8">
        {/* Header */}
        <div className="text-center space-y-2 mb-6">
          <div className="text-3xl">🩸</div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
            Certificate of Blood Donation
          </h2>
          <p className="text-sm text-muted-foreground">
            JanSeva Rakta Sahayak — West Bengal
          </p>
          <div className="w-16 h-0.5 bg-red-400 mx-auto mt-2" />
        </div>

        {/* Certificate Body */}
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            This is to certify that
          </p>

          <h3 className="text-lg sm:text-xl font-semibold text-gray-900">
            {donorName}
          </h3>

          <div className="flex items-center justify-center gap-2">
            <Badge variant="destructive" className="text-sm px-3 py-1">
              {bloodGroup}
            </Badge>
          </div>

          <p className="text-sm text-muted-foreground">
            has voluntarily donated blood on
          </p>

          <p className="text-base font-medium text-gray-800">
            {formattedDate}
          </p>

          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left bg-gray-50 rounded-lg p-4 mt-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Hospital</p>
              <p className="text-sm font-medium text-gray-800">{hospital}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Donation Type</p>
              <p className="text-sm font-medium text-gray-800 capitalize">{donationType.replace('_', ' ')}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Units</p>
              <p className="text-sm font-medium text-gray-800">{units}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Certificate ID</p>
              <p className="text-sm font-mono font-medium text-gray-800">{certificateId}</p>
            </div>
          </div>
        </div>

        {/* QR Code Placeholder */}
        <div className="flex flex-col items-center mt-6 space-y-2">
          <div className="w-24 h-24 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-white">
            <a
              href={verifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
              title="Verify certificate"
            >
              <QrCode className="size-10" />
              <span className="text-[10px]">Scan to verify</span>
            </a>
          </div>
          <p className="text-xs text-muted-foreground text-center max-w-[200px]">
            Scan QR or visit the verification link to confirm authenticity
          </p>
        </div>

        {/* Footer / Actions */}
        <div className="mt-6 pt-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-center gap-3 print:hidden">
          <Button onClick={handlePrint} className="gap-2 w-full sm:w-auto">
            <Printer className="size-4" />
            Download / Print
          </Button>
          {verifyUrl && (
            <Button variant="outline" asChild className="gap-2 w-full sm:w-auto">
              <a href={verifyUrl} target="_blank" rel="noopener noreferrer">
                <Download className="size-4" />
                Verify Online
              </a>
            </Button>
          )}
        </div>

        {/* Certificate Footer */}
        <div className="mt-6 text-center print:mt-8">
          <p className="text-xs text-muted-foreground">
            Issued by JanSeva Rakta Sahayak • Verified by West Bengal Health Department
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
