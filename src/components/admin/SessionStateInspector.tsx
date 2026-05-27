'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, RotateCcw, Globe, Bot, Brain, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ─── Types ───

/** Session state shape returned by GET /api/sessions/state?phone=X */
export interface SessionState {
  session_id: string;
  last_intent: string;
  active_agent: string;
  collected_data: Record<string, unknown>;
  language: string | null;
  last_activity_at: string | null;
  state: string | null;
  created_at: string | null;
}

export interface SessionStateInspectorProps {
  phone: string;
  sessionData?: SessionState;
  isAdmin?: boolean;
  onReset?: () => void;
}

// ─── Intent badge color mapping ───

const INTENT_COLORS: Record<string, string> = {
  idle: 'bg-gray-100 text-gray-700 border-gray-200',
  welcome: 'bg-blue-100 text-blue-700 border-blue-200',
  complaint_collecting: 'bg-orange-100 text-orange-700 border-orange-200',
  complaint_confirming: 'bg-orange-100 text-orange-700 border-orange-200',
  blood_collecting: 'bg-red-100 text-red-700 border-red-200',
  blood_confirming: 'bg-red-100 text-red-700 border-red-200',
  donor_pending_response: 'bg-rose-100 text-rose-700 border-rose-200',
  seeker_confirming: 'bg-rose-100 text-rose-700 border-rose-200',
  donor_registration: 'bg-purple-100 text-purple-700 border-purple-200',
  donor_confirming: 'bg-purple-100 text-purple-700 border-purple-200',
  status_check: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  info_query: 'bg-teal-100 text-teal-700 border-teal-200',
};

const AGENT_COLORS: Record<string, string> = {
  ceo: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  complaint: 'bg-orange-100 text-orange-700 border-orange-200',
  blood: 'bg-red-100 text-red-700 border-red-200',
  donor: 'bg-purple-100 text-purple-700 border-purple-200',
  info: 'bg-teal-100 text-teal-700 border-teal-200',
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: '🇬🇧 English',
  hi: '🇮🇳 Hindi',
  bn: '🇮🇳 Bengali',
};

// ─── Next expected action logic ───

function getNextExpectedAction(intent: string): string {
  switch (intent) {
    case 'idle':
      return 'Waiting for citizen message — will route via CEO Router';
    case 'welcome':
      return 'Greeting sent — waiting for citizen to state their need';
    case 'complaint_collecting':
      return 'Complaint Agent collecting missing fields (naam, gaon, jela, block, etc.)';
    case 'complaint_confirming':
      return 'Complaint Agent awaiting citizen confirmation (Haan/Nahi)';
    case 'blood_collecting':
      return 'Blood Agent collecting request details (blood_group, units, hospital, etc.)';
    case 'blood_confirming':
      return 'Blood Agent awaiting seeker confirmation of request details';
    case 'donor_pending_response':
      return 'Waiting for donor HAAN/NAHI response to blood request notification';
    case 'seeker_confirming':
      return 'Seeker has 15 minutes to confirm matched donor — awaiting response';
    case 'donor_registration':
      return 'Donor Agent collecting registration fields (naam, blood_group, gender, etc.)';
    case 'donor_confirming':
      return 'Donor Agent awaiting registration confirmation';
    case 'status_check':
      return 'Status Code looking up ticket in complaints table';
    case 'info_query':
      return 'Info Code answering scheme question via Gemini';
    default:
      return 'Unknown state — may need manual inspection';
  }
}

/**
 * SessionStateInspector — displays a citizen's current session state (Req 14).
 *
 * Shows: last_intent (colored badge), active_agent (badge), collected_data (JSON),
 * language indicator, "Reset Session" button (admin-only), and next expected action.
 *
 * Can receive session data via props (skip fetch) or fetch from /api/sessions/state.
 *
 * @see Requirement 14 — Frontend Session State Inspector
 */
export function SessionStateInspector({
  phone,
  sessionData: initialSessionData,
  isAdmin = false,
  onReset,
}: SessionStateInspectorProps) {
  const [session, setSession] = useState<SessionState | null>(initialSessionData ?? null);
  const [loading, setLoading] = useState(!initialSessionData);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  // ─── Fetch session state ───
  const fetchSession = useCallback(async () => {
    if (!phone) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/sessions/state?phone=${encodeURIComponent(phone)}`);
      const json = await res.json();

      if (!res.ok || !json.ok) {
        setError(json.error || 'Failed to fetch session state');
        setSession(null);
      } else {
        setSession(json.data);
      }
    } catch (err) {
      setError('Network error fetching session state');
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [phone]);

  // Fetch on mount if no initial data provided
  useEffect(() => {
    if (!initialSessionData) {
      fetchSession();
    }
  }, [initialSessionData, fetchSession]);

  // Update local state when prop changes
  useEffect(() => {
    if (initialSessionData) {
      setSession(initialSessionData);
      setLoading(false);
      setError(null);
    }
  }, [initialSessionData]);

  // ─── Reset session (admin-only) ───
  const handleReset = async () => {
    if (!isAdmin) return;
    setResetting(true);

    try {
      const res = await fetch('/api/sessions/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: phone,
          flow_complete: true,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        setError(json.error || 'Failed to reset session');
      } else {
        // Refresh session data after reset
        await fetchSession();
        onReset?.();
      }
    } catch (err) {
      setError('Network error resetting session');
    } finally {
      setResetting(false);
    }
  };

  // ─── Render ───

  const intentColor = session?.last_intent
    ? INTENT_COLORS[session.last_intent] || 'bg-gray-100 text-gray-700 border-gray-200'
    : '';

  const agentColor = session?.active_agent
    ? AGENT_COLORS[session.active_agent] || 'bg-gray-100 text-gray-700 border-gray-200'
    : '';

  const hasCollectedData =
    session?.collected_data &&
    typeof session.collected_data === 'object' &&
    Object.keys(session.collected_data).length > 0;

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Brain className="size-4" />
            Session State
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={fetchSession}
            disabled={loading}
            title="Refresh session state"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Loading state */}
        {loading && !session && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
            <Loader2 className="size-4 animate-spin" />
            <span>Loading session…</span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* No session found */}
        {!loading && !error && !session && (
          <p className="text-sm text-muted-foreground">No session found for this phone number.</p>
        )}

        {/* Session data */}
        {session && (
          <>
            {/* Last Intent */}
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Last Intent
              </span>
              <div>
                <Badge
                  variant="outline"
                  className={`text-xs ${intentColor}`}
                >
                  {session.last_intent || 'unknown'}
                </Badge>
              </div>
            </div>

            {/* Active Agent */}
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Bot className="size-3" />
                Active Agent
              </span>
              <div>
                <Badge
                  variant="outline"
                  className={`text-xs ${agentColor}`}
                >
                  {session.active_agent || 'none'}
                </Badge>
              </div>
            </div>

            {/* Language */}
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Globe className="size-3" />
                Language
              </span>
              <div className="text-sm">
                {session.language
                  ? LANGUAGE_LABELS[session.language] || session.language
                  : <span className="text-muted-foreground">Not set</span>
                }
              </div>
            </div>

            {/* Collected Data */}
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Collected Data
              </span>
              {hasCollectedData ? (
                <pre className="rounded-md bg-muted/50 border p-2 text-xs font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                  {JSON.stringify(session.collected_data, null, 2)}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground italic">Empty — no data collected yet</p>
              )}
            </div>

            {/* Next Expected Action */}
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Next Expected Action
              </span>
              <p className="text-xs text-foreground/80">
                {getNextExpectedAction(session.last_intent)}
              </p>
            </div>

            {/* Last Activity */}
            {session.last_activity_at && (
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Last Activity
                </span>
                <p className="text-xs text-muted-foreground">
                  {new Date(session.last_activity_at).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </p>
              </div>
            )}

            {/* Reset Session Button (admin-only) */}
            {isAdmin && (
              <div className="pt-2 border-t">
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full gap-2"
                  onClick={handleReset}
                  disabled={resetting || session.last_intent === 'idle'}
                >
                  {resetting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                  {resetting ? 'Resetting…' : 'Reset Session'}
                </Button>
                {session.last_intent === 'idle' && (
                  <p className="text-xs text-muted-foreground mt-1 text-center">
                    Session is already idle
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
