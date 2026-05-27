'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export default function DonorLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Normalize phone: add +91 prefix if not present
    let normalizedPhone = phone.trim();
    if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = '+91' + normalizedPhone.replace(/^0+/, '');
    }

    // Validate E.164 format
    const phoneRegex = /^\+[1-9]\d{6,14}$/;
    if (!phoneRegex.test(normalizedPhone)) {
      setError('कृपया सही फ़ोन नंबर दर्ज करें (e.g., 9876543210)');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/donor/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizedPhone }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        if (res.status === 404) {
          setError('यह फ़ोन नंबर donor के रूप में registered नहीं है। कृपया पहले WhatsApp पर register करें।');
        } else if (res.status === 400) {
          setError('Invalid phone number format. कृपया सही नंबर दर्ज करें।');
        } else {
          setError(data.error || 'OTP भेजने में समस्या हुई। कृपया दोबारा प्रयास करें।');
        }
        return;
      }

      // Success — redirect to verify-otp page
      router.push(`/donor/verify-otp?phone=${encodeURIComponent(normalizedPhone)}`);
    } catch {
      setError('Server से connection नहीं हो पा रहा। कृपया दोबारा प्रयास करें।');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-red-50 to-white px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="text-4xl mb-2">🩸</div>
          <CardTitle className="text-xl">JanSeva Rakta Sahayak</CardTitle>
          <CardDescription>Donor Portal — Login</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <div className="flex gap-2">
                <div className="flex items-center px-3 border rounded-md bg-muted text-muted-foreground text-sm">
                  +91
                </div>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="9876543210"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setError(null);
                  }}
                  maxLength={10}
                  className="flex-1"
                  disabled={loading}
                  autoComplete="tel"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                अपना registered mobile number दर्ज करें
              </p>
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" disabled={loading || !phone.trim()}>
              {loading ? 'OTP भेज रहे हैं...' : 'Send OTP'}
            </Button>
          </form>

          <div className="mt-6 pt-4 border-t text-center">
            <p className="text-sm text-muted-foreground">
              Not registered?{' '}
              <span className="text-primary font-medium">
                Register via WhatsApp by typing &quot;donor banna hai&quot;
              </span>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
