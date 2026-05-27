'use client';

import { useState } from 'react';
import { Play, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

/** All valid last_intent values from Requirement 1.2 */
const VALID_INTENTS = [
  'idle',
  'welcome',
  'complaint_collecting',
  'complaint_confirming',
  'blood_collecting',
  'blood_confirming',
  'donor_pending_response',
  'seeker_confirming',
  'donor_registration',
  'donor_confirming',
  'status_check',
  'info_query',
] as const;

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'bn', label: 'Bengali' },
] as const;

/** Preset test messages for quick testing */
const PRESETS = [
  { label: '"Yess" (donor pending)', message: 'Yess', intent: 'donor_pending_response', language: 'en' },
  { label: 'Ticket number', message: 'Check WB-2026-00123', intent: 'idle', language: 'en' },
  { label: 'Blood request (Hindi)', message: 'A+ blood chahiye urgent', intent: 'idle', language: 'hi' },
  { label: 'Greeting', message: 'Namaskar', intent: 'idle', language: 'hi' },
  { label: 'Complaint (Bengali)', message: 'রাস্তা খারাপ', intent: 'idle', language: 'bn' },
  { label: 'Donor registration', message: 'donor banna hai', intent: 'idle', language: 'hi' },
] as const;

/** Agent badge color mapping */
const AGENT_COLORS: Record<string, string> = {
  complaint: 'bg-orange-100 text-orange-800 border-orange-200',
  blood: 'bg-red-100 text-red-800 border-red-200',
  donor: 'bg-green-100 text-green-800 border-green-200',
  info: 'bg-blue-100 text-blue-800 border-blue-200',
  welcome: 'bg-purple-100 text-purple-800 border-purple-200',
};

interface TestResult {
  agent: string;
  reason: string;
  rules_evaluated: string[];
}

interface TestError {
  message: string;
}

/**
 * CEORouterTester — interactive test runner for the CEO Router.
 *
 * Self-contained component that POSTs to `/api/agents/test-route` and
 * displays the routing decision (agent, reason, rules evaluated).
 *
 * @see Requirements 15.3 — test runner for CEO Router
 */
export function CEORouterTester() {
  const [message, setMessage] = useState('');
  const [lastIntent, setLastIntent] = useState<string>('idle');
  const [language, setLanguage] = useState<string>('en');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<TestError | null>(null);

  async function handleTest() {
    if (!message.trim()) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch('/api/agents/test-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          last_intent: lastIntent,
          language,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || errorData.message || `Request failed (${response.status})`
        );
      }

      const data = await response.json();
      setResult({
        agent: data.agent || data.data?.agent,
        reason: data.reason || data.data?.reason,
        rules_evaluated: data.rules_evaluated || data.data?.rules_evaluated || [],
      });
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : 'An unexpected error occurred',
      });
    } finally {
      setLoading(false);
    }
  }

  function applyPreset(preset: typeof PRESETS[number]) {
    setMessage(preset.message);
    setLastIntent(preset.intent);
    setLanguage(preset.language);
    setResult(null);
    setError(null);
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-lg">CEO Router Test Runner</CardTitle>
        <CardDescription>
          Test which agent the CEO Router would dispatch to for a given message and session state.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Preset buttons */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Quick presets</Label>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Message input */}
        <div className="space-y-2">
          <Label htmlFor="test-message">Message text</Label>
          <Textarea
            id="test-message"
            placeholder="Type a message to test routing (e.g., 'Yess', 'blood chahiye', 'WB-2026-00123')"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="resize-none"
          />
        </div>

        {/* Intent and language selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="test-intent">Last Intent</Label>
            <Select value={lastIntent} onValueChange={setLastIntent}>
              <SelectTrigger id="test-intent" className="w-full">
                <SelectValue placeholder="Select intent" />
              </SelectTrigger>
              <SelectContent>
                {VALID_INTENTS.map((intent) => (
                  <SelectItem key={intent} value={intent}>
                    {intent}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="test-language">Language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="test-language" className="w-full">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Test button */}
        <Button
          onClick={handleTest}
          disabled={loading || !message.trim()}
          className="w-full sm:w-auto gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Testing…
            </>
          ) : (
            <>
              <Play className="size-4" />
              Test Route
            </>
          )}
        </Button>

        {/* Error display */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
            <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error.message}</p>
          </div>
        )}

        {/* Result display */}
        {result && (
          <div className="rounded-md border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-green-600 shrink-0" />
              <span className="text-sm font-medium">Routing Decision</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Agent badge */}
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Agent</span>
                <div>
                  <Badge
                    variant="outline"
                    className={`text-sm font-semibold ${AGENT_COLORS[result.agent] || ''}`}
                  >
                    {result.agent}
                  </Badge>
                </div>
              </div>

              {/* Reason */}
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Reason</span>
                <p className="text-sm font-mono">{result.reason}</p>
              </div>
            </div>

            {/* Rules evaluated */}
            {result.rules_evaluated && result.rules_evaluated.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Rules Evaluated</span>
                <ol className="list-decimal list-inside space-y-0.5">
                  {result.rules_evaluated.map((rule, idx) => (
                    <li
                      key={idx}
                      className={`text-xs font-mono ${
                        idx === result.rules_evaluated.length - 1
                          ? 'text-foreground font-semibold'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {rule}
                      {idx === result.rules_evaluated.length - 1 && (
                        <span className="ml-1.5 text-green-600">← matched</span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
