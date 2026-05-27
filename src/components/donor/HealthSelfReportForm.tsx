'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HealthSelfReportFormProps {
  onSuccess?: (data: { deferral_until: string; deferral_reason: string }) => void;
  onCancel?: () => void;
}

type DeferralReason =
  | 'illness'
  | 'surgery'
  | 'pregnancy'
  | 'tattoo'
  | 'vaccination'
  | 'medication'
  | 'travel'
  | 'other';

// ─── Constants ───────────────────────────────────────────────────────────────

const REASON_OPTIONS: { value: DeferralReason; label: string }[] = [
  { value: 'illness', label: 'Illness (Bimari)' },
  { value: 'surgery', label: 'Surgery (Operation)' },
  { value: 'pregnancy', label: 'Pregnancy (Garbhavastha)' },
  { value: 'tattoo', label: 'Tattoo' },
  { value: 'vaccination', label: 'Vaccination (Tikakaran)' },
  { value: 'medication', label: 'Medication (Dawa)' },
  { value: 'travel', label: 'Travel (Yatra)' },
  { value: 'other', label: 'Other (Anya)' },
];

const DEFAULT_DURATIONS: Record<DeferralReason, number> = {
  illness: 14,
  surgery: 180,
  pregnancy: 365,
  tattoo: 180,
  vaccination: 14,
  medication: 7,
  travel: 28,
  other: 30,
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function HealthSelfReportForm({ onSuccess, onCancel }: HealthSelfReportFormProps) {
  const [reason, setReason] = useState<DeferralReason | ''>('');
  const [durationDays, setDurationDays] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{ deferral_until: string; deferral_reason: string } | null>(null);

  // Auto-fill duration when reason changes
  const handleReasonChange = (value: string) => {
    const selected = value as DeferralReason;
    setReason(selected);
    setDurationDays(DEFAULT_DURATIONS[selected]);
    setError(null);
  };

  // Calculate the deferral_until date for preview
  const deferralUntilDate = useMemo(() => {
    if (!reason || !durationDays || typeof durationDays !== 'number' || durationDays <= 0) {
      return null;
    }
    const date = new Date();
    date.setDate(date.getDate() + durationDays);
    return date.toISOString().split('T')[0];
  }, [reason, durationDays]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!reason) {
      setError('Please select a deferral reason.');
      return;
    }

    if (!durationDays || typeof durationDays !== 'number' || durationDays <= 0) {
      setError('Duration must be a positive number.');
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem('donor_token');
      if (!token) {
        setError('Not authenticated. Please log in again.');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/blood-donors/self-defer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reason,
          duration_days: durationDays,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        setError(json.message || json.error || 'Deferral request failed.');
        setLoading(false);
        return;
      }

      const result = {
        deferral_until: json.data.deferral_until,
        deferral_reason: json.data.deferral_reason,
      };

      setSuccessData(result);
      onSuccess?.(result);
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Success State ───
  if (successData) {
    return (
      <Card className="max-w-lg mx-auto">
        <CardContent className="pt-6 text-center space-y-4">
          <div className="text-green-600 text-4xl">✓</div>
          <p className="text-lg font-medium text-green-700">
            Aap ka profile {successData.deferral_until} tak deferred hai
          </p>
          <p className="text-sm text-muted-foreground">
            Reason: {successData.deferral_reason}
          </p>
          {onCancel && (
            <Button variant="outline" onClick={onCancel} className="mt-4">
              Close
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // ─── Form State ───
  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle>Self-Report Health Deferral</CardTitle>
        <CardDescription>
          Temporarily defer yourself from the donor pool. Select a reason and duration below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Reason Selector */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Reason for Deferral</Label>
            <RadioGroup value={reason} onValueChange={handleReasonChange} className="grid gap-2">
              {REASON_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={opt.value} id={`reason-${opt.value}`} />
                  <Label htmlFor={`reason-${opt.value}`} className="cursor-pointer font-normal">
                    {opt.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Duration Input */}
          <div className="space-y-2">
            <Label htmlFor="duration-days" className="text-sm font-medium">
              Duration (days)
            </Label>
            <Input
              id="duration-days"
              type="number"
              min={1}
              max={730}
              value={durationDays}
              onChange={(e) => {
                const val = e.target.value;
                setDurationDays(val === '' ? '' : parseInt(val, 10));
                setError(null);
              }}
              placeholder="Enter number of days"
              disabled={!reason}
            />
            {reason && (
              <p className="text-xs text-muted-foreground">
                Default for {reason}: {DEFAULT_DURATIONS[reason]} days
              </p>
            )}
          </div>

          {/* Deferral Until Preview */}
          {deferralUntilDate && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <span className="font-medium">Deferral until:</span>{' '}
              <span className="text-primary">{deferralUntilDate}</span>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes" className="text-sm font-medium">
              Notes (optional)
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional details..."
              rows={3}
              maxLength={500}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={loading || !reason}>
              {loading ? 'Submitting...' : 'Submit Deferral'}
            </Button>
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
