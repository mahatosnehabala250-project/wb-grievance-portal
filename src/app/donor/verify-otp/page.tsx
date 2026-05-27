'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

const RESEND_COOLDOWN_SECONDS = 60;

function maskPhone(phone: string): string {
  if (!phone || phone.length < 6) return phone;
  // Show first 4 and last 2 characters, mask the rest
  return phone.slice(0, 4) + '••••••' + phone.slice(-2);
}

export default function DonorVerifyOtpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get('phone') || '';

  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Start cooldown on mount (OTP was just sent)
  useEffect(() => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Redirect if no phone param
  useEffect(() => {
    if (!phone) {
      router.replace('/donor/login');
    }
  }, [phone, router]);

  const handleVerify = useCallback(async (otpValue?: string) => {
    const otpToVerify = otpValue || otp;
    if (otpToVerify.length !== 6) return;

    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/donor/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp: otpToVerify }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        if (res.status === 401) {
          setError('गलत या expired OTP। कृपया दोबारा प्रयास करें।');
        } else {
          setError(data.error || 'Verification में समस्या हुई। कृपया दोबारा प्रयास करें।');
        }
        setOtp('');
        return;
      }

      // Success — store JWT and redirect to profile
      if (data.data?.token) {
        localStorage.setItem('donor_token', data.data.token);
      }
      router.push('/donor/profile');
    } catch {
      setError('Server से connection नहीं हो पा रहा। कृपया दोबारा प्रयास करें।');
    } finally {
      setLoading(false);
    }
  }, [otp, phone, router]);

  const handleResendOtp = async () => {
    if (cooldown > 0 || resending) return;

    setError(null);
    setResending(true);

    try {
      const res = await fetch('/api/donor/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error || 'OTP दोबारा भेजने में समस्या हुई।');
        return;
      }

      setCooldown(RESEND_COOLDOWN_SECONDS);
      setOtp('');
    } catch {
      setError('Server से connection नहीं हो पा रहा।');
    } finally {
      setResending(false);
    }
  };

  const handleOtpChange = (value: string) => {
    setOtp(value);
    setError(null);
    // Auto-submit when all 6 digits are entered
    if (value.length === 6) {
      handleVerify(value);
    }
  };

  if (!phone) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-red-50 to-white px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="text-4xl mb-2">🩸</div>
          <CardTitle className="text-xl">OTP Verify करें</CardTitle>
          <CardDescription>
            OTP भेजा गया: <span className="font-mono font-medium">{maskPhone(phone)}</span>
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="space-y-6">
            {/* OTP Input */}
            <div className="flex flex-col items-center space-y-2">
              <InputOTP
                maxLength={6}
                value={otp}
                onChange={handleOtpChange}
                disabled={loading}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
              <p className="text-xs text-muted-foreground">
                6-digit OTP दर्ज करें
              </p>
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3 text-center">
                {error}
              </div>
            )}

            {/* Verify Button */}
            <Button
              onClick={() => handleVerify()}
              className="w-full"
              size="lg"
              disabled={loading || otp.length !== 6}
            >
              {loading ? 'Verifying...' : 'Verify'}
            </Button>

            {/* Resend OTP */}
            <div className="text-center">
              {cooldown > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Resend OTP in <span className="font-mono font-medium">{cooldown}s</span>
                </p>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResendOtp}
                  disabled={resending}
                >
                  {resending ? 'भेज रहे हैं...' : 'Resend OTP'}
                </Button>
              )}
            </div>

            {/* Back to login */}
            <div className="text-center pt-2 border-t">
              <Button
                variant="link"
                size="sm"
                onClick={() => router.push('/donor/login')}
                disabled={loading}
              >
                ← दूसरा नंबर use करें
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
