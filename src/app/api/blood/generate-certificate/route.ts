import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * POST /api/blood/generate-certificate
 *
 * Generates an HTML donation certificate, uploads it to Supabase Storage,
 * and returns a signed URL (7-day expiry) plus a public verify URL.
 *
 * Called internally by the record-donation endpoint (fire-and-forget).
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET env var.
 *
 * Request body:
 * {
 *   donor_id: uuid (required),
 *   donation_id: uuid (required)
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   data: {
 *     certificate_id: string,
 *     certificate_url: string (signed URL, 7-day expiry),
 *     verify_url: string (public verify page)
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // ─── Auth: verify n8n webhook secret ───
    const secret = request.headers.get('x-n8n-secret');
    const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // ─── Parse body ───
    const body = await request.json();
    const { donor_id, donation_id } = body;

    // ─── Validation ───
    if (!donor_id || typeof donor_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'donor_id is required' },
        { status: 400 }
      );
    }

    if (!donation_id || typeof donation_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'donation_id is required' },
        { status: 400 }
      );
    }

    // ─── Initialize Supabase client ───
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // ─── Look up donor info ───
    const { data: donor, error: donorError } = await supabase
      .from('blood_donors')
      .select('id, name, blood_group, phone')
      .eq('id', donor_id)
      .single();

    if (donorError || !donor) {
      console.error('[blood/generate-certificate] Donor lookup error:', donorError);
      return NextResponse.json(
        { ok: false, error: 'CERT_GEN_FAILED', details: 'Donor not found' },
        { status: 404 }
      );
    }

    // ─── Look up donation info ───
    const { data: donation, error: donationError } = await supabase
      .from('donation_history')
      .select('id, donated_date, donation_type, units, hospital')
      .eq('id', donation_id)
      .eq('donor_id', donor_id)
      .single();

    if (donationError || !donation) {
      console.error('[blood/generate-certificate] Donation lookup error:', donationError);
      return NextResponse.json(
        { ok: false, error: 'CERT_GEN_FAILED', details: 'Donation record not found' },
        { status: 404 }
      );
    }

    // ─── Generate certificate ID ───
    const certificateId = uuidv4();

    // ─── Build verify URL ───
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const verifyUrl = `${appUrl}/verify/${certificateId}`;

    // ─── Generate HTML certificate ───
    const htmlCertificate = generateCertificateHtml({
      certificateId,
      donorName: donor.name,
      bloodGroup: donor.blood_group,
      donatedDate: donation.donated_date,
      hospital: donation.hospital,
      units: donation.units,
      donationType: donation.donation_type,
      verifyUrl,
    });

    // ─── Upload to Supabase Storage ───
    const storagePath = `certificates/${donor_id}/${donation_id}.html`;
    const fileBuffer = Buffer.from(htmlCertificate, 'utf-8');

    const { error: uploadError } = await supabase.storage
      .from('certificates')
      .upload(storagePath, fileBuffer, {
        contentType: 'text/html',
        upsert: true,
      });

    if (uploadError) {
      console.error('[blood/generate-certificate] Upload error:', uploadError);
      return NextResponse.json(
        { ok: false, error: 'CERT_GEN_FAILED', details: 'Failed to upload certificate' },
        { status: 500 }
      );
    }

    // ─── Get signed URL (7-day expiry = 604800 seconds) ───
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('certificates')
      .createSignedUrl(storagePath, 604800);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error('[blood/generate-certificate] Signed URL error:', signedUrlError);
      return NextResponse.json(
        { ok: false, error: 'CERT_GEN_FAILED', details: 'Failed to generate signed URL' },
        { status: 500 }
      );
    }

    // ─── Update donation_history with certificate_id ───
    await supabase
      .from('donation_history')
      .update({ certificate_id: certificateId })
      .eq('id', donation_id);

    // ─── Return response ───
    return NextResponse.json({
      ok: true,
      data: {
        certificate_id: certificateId,
        certificate_url: signedUrlData.signedUrl,
        verify_url: verifyUrl,
      },
    });
  } catch (error) {
    console.error('[blood/generate-certificate] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'CERT_GEN_FAILED', details: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── HTML Certificate Generator ───

interface CertificateData {
  certificateId: string;
  donorName: string;
  bloodGroup: string;
  donatedDate: string;
  hospital: string;
  units: number;
  donationType: string;
  verifyUrl: string;
}

function generateCertificateHtml(data: CertificateData): string {
  const {
    certificateId,
    donorName,
    bloodGroup,
    donatedDate,
    hospital,
    units,
    donationType,
    verifyUrl,
  } = data;

  const formattedDate = new Date(donatedDate).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const donationTypeLabel = donationType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // QR code placeholder using a public QR API (Google Charts)
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(verifyUrl)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blood Donation Certificate - ${certificateId}</title>
  <style>
    @media print {
      body { margin: 0; }
      .no-print { display: none; }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      background: #f8f9fa;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }
    .certificate {
      background: white;
      border: 3px solid #dc2626;
      border-radius: 12px;
      padding: 48px;
      max-width: 700px;
      width: 100%;
      position: relative;
      box-shadow: 0 4px 24px rgba(0,0,0,0.1);
    }
    .certificate::before {
      content: '';
      position: absolute;
      top: 8px;
      left: 8px;
      right: 8px;
      bottom: 8px;
      border: 1px solid #fca5a5;
      border-radius: 8px;
      pointer-events: none;
    }
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    .header .icon {
      font-size: 48px;
      margin-bottom: 8px;
    }
    .header h1 {
      font-size: 28px;
      color: #dc2626;
      margin-bottom: 4px;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .header h2 {
      font-size: 16px;
      color: #6b7280;
      font-weight: normal;
      font-style: italic;
    }
    .header .org {
      font-size: 14px;
      color: #374151;
      margin-top: 8px;
      font-weight: bold;
    }
    .body {
      text-align: center;
      margin-bottom: 32px;
    }
    .body .presented-to {
      font-size: 14px;
      color: #6b7280;
      margin-bottom: 8px;
    }
    .body .donor-name {
      font-size: 32px;
      color: #1f2937;
      font-weight: bold;
      border-bottom: 2px solid #dc2626;
      display: inline-block;
      padding-bottom: 4px;
      margin-bottom: 16px;
    }
    .body .message {
      font-size: 15px;
      color: #374151;
      line-height: 1.6;
      max-width: 500px;
      margin: 0 auto;
    }
    .details {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin: 24px 0;
      padding: 20px;
      background: #fef2f2;
      border-radius: 8px;
    }
    .details .item {
      text-align: center;
    }
    .details .item .label {
      font-size: 11px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }
    .details .item .value {
      font-size: 16px;
      color: #1f2937;
      font-weight: bold;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
    }
    .footer .cert-info {
      font-size: 11px;
      color: #9ca3af;
    }
    .footer .cert-info .cert-id {
      font-family: monospace;
      font-size: 10px;
    }
    .footer .qr {
      text-align: center;
    }
    .footer .qr img {
      width: 100px;
      height: 100px;
    }
    .footer .qr .scan-text {
      font-size: 10px;
      color: #6b7280;
      margin-top: 4px;
    }
    .print-btn {
      display: block;
      margin: 24px auto 0;
      padding: 12px 32px;
      background: #dc2626;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
    }
    .print-btn:hover { background: #b91c1c; }
  </style>
</head>
<body>
  <div class="certificate">
    <div class="header">
      <div class="icon">🩸</div>
      <h1>Certificate of Donation</h1>
      <h2>Blood Donation Appreciation</h2>
      <div class="org">JanSeva — Rakta Sahayak</div>
    </div>

    <div class="body">
      <div class="presented-to">This certificate is proudly presented to</div>
      <div class="donor-name">${escapeHtml(donorName)}</div>
      <div class="message">
        In recognition of your selfless act of donating blood and helping save lives.
        Your generosity makes a difference in our community. Thank you for being a hero.
      </div>
    </div>

    <div class="details">
      <div class="item">
        <div class="label">Blood Group</div>
        <div class="value">${escapeHtml(bloodGroup)}</div>
      </div>
      <div class="item">
        <div class="label">Donation Date</div>
        <div class="value">${formattedDate}</div>
      </div>
      <div class="item">
        <div class="label">Hospital</div>
        <div class="value">${escapeHtml(hospital)}</div>
      </div>
      <div class="item">
        <div class="label">Units Donated</div>
        <div class="value">${units} (${donationTypeLabel})</div>
      </div>
    </div>

    <div class="footer">
      <div class="cert-info">
        <div>Issued by JanSeva Rakta Sahayak</div>
        <div>West Bengal AI Public Support System</div>
        <div class="cert-id">Certificate ID: ${certificateId}</div>
        <div class="cert-id">Verify: <a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a></div>
      </div>
      <div class="qr">
        <img src="${qrCodeUrl}" alt="QR Code - Scan to verify" />
        <div class="scan-text">Scan to verify</div>
      </div>
    </div>
  </div>

  <button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
</body>
</html>`;
}

/** Escape HTML special characters to prevent XSS in generated certificate. */
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
