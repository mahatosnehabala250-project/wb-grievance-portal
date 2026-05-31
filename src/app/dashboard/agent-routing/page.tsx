'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Bot, Activity, TrendingUp, Clock, GitBranch } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AgentRoutingTable, RoutingDecision } from '@/components/admin/AgentRoutingTable';
import { authHeaders, fmtDateTime } from '@/lib/helpers';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentDistribution {
  agent: string;
  count: number;
  color: string;
}

interface RoutingMetrics {
  totalToday: number;
  distribution: AgentDistribution[];
  topIntents: { intent: string; count: number }[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  complaint: 'bg-orange-500',
  blood: 'bg-red-500',
  donor: 'bg-emerald-500',
  info: 'bg-blue-500',
  welcome: 'bg-purple-500',
};

const AGENT_BADGE_STYLES: Record<string, string> = {
  complaint: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  blood: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
  donor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  welcome: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
};

// ─── Page Component ──────────────────────────────────────────────────────────

export default function AgentRoutingPage() {
  const [metrics, setMetrics] = useState<RoutingMetrics>({
    totalToday: 0,
    distribution: [],
    topIntents: [],
  });
  const [selectedDecision, setSelectedDecision] = useState<RoutingDecision | null>(null);
  const [conversationContext, setConversationContext] = useState<
    { id: string; text: string; direction: string; created_at: string }[]
  >([]);
  const [loadingContext, setLoadingContext] = useState(false);

  // ─── Fetch metrics ───
  const fetchMetrics = useCallback(async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const params = new URLSearchParams({
        from: today.toISOString(),
        limit: '200',
      });

      const res = await fetch(`/api/routing/decisions?${params.toString()}`, {
        headers: authHeaders(),
      });

      if (!res.ok) return;

      const json = await res.json();
      if (!json.ok) return;

      const decisions: RoutingDecision[] = json.data;
      const totalToday = decisions.length;

      // Calculate agent distribution
      const agentCounts: Record<string, number> = {};
      decisions.forEach((d) => {
        const agent = d.agent_dispatched || 'unknown';
        agentCounts[agent] = (agentCounts[agent] || 0) + 1;
      });

      const distribution: AgentDistribution[] = Object.entries(agentCounts)
        .map(([agent, count]) => ({
          agent,
          count,
          color: AGENT_COLORS[agent] || 'bg-gray-500',
        }))
        .sort((a, b) => b.count - a.count);

      // Calculate top intents
      const intentCounts: Record<string, number> = {};
      decisions.forEach((d) => {
        const intent = d.last_intent_before || 'unknown';
        intentCounts[intent] = (intentCounts[intent] || 0) + 1;
      });

      const topIntents = Object.entries(intentCounts)
        .map(([intent, count]) => ({ intent, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      setMetrics({ totalToday, distribution, topIntents });
    } catch {
      // Silent fail — metrics are non-critical
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30_000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // ─── Fetch conversation context for selected decision ───
  const fetchConversationContext = useCallback(async (sessionId: string) => {
    setLoadingContext(true);
    try {
      const res = await fetch(
        `/api/chat/messages?phone=${encodeURIComponent(sessionId)}&limit=10`,
        { headers: authHeaders() }
      );

      if (res.ok) {
        const json = await res.json();
        setConversationContext(json.data || json.messages || []);
      } else {
        setConversationContext([]);
      }
    } catch {
      setConversationContext([]);
    } finally {
      setLoadingContext(false);
    }
  }, []);

  // ─── Handle row click ───
  const handleRowClick = useCallback(
    (decision: RoutingDecision) => {
      setSelectedDecision(decision);
      fetchConversationContext(decision.session_id);
    },
    [fetchConversationContext]
  );

  // ─── Compute total bar width for distribution ───
  const maxCount = Math.max(...metrics.distribution.map((d) => d.count), 1);

  return (
    <div className="space-y-6 p-4 lg:p-6 max-w-[1400px] mx-auto">
      {/* ─── Page Header ─── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agent Routing Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor how the CEO Router dispatches messages to specialist agents
        </p>
      </div>

      {/* ─── Metrics Section ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Messages Today */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Messages Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{metrics.totalToday}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Routing decisions since midnight
            </p>
          </CardContent>
        </Card>

        {/* Agent Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Bot className="h-4 w-4" />
              Agent Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.distribution.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data yet</p>
            ) : (
              <div className="space-y-2">
                {metrics.distribution.map((item) => (
                  <div key={item.agent} className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-semibold min-w-[70px] justify-center ${
                        AGENT_BADGE_STYLES[item.agent] || 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {item.agent.charAt(0).toUpperCase() + item.agent.slice(1)}
                    </Badge>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${item.color}`}
                        style={{ width: `${(item.count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground w-8 text-right">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Intents */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Top Intents
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.topIntents.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data yet</p>
            ) : (
              <div className="space-y-1.5">
                {metrics.topIntents.map((item) => (
                  <div key={item.intent} className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px] font-medium">
                      {item.intent}
                    </Badge>
                    <span className="text-xs font-mono text-muted-foreground">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Routing Table ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Routing Decisions</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentRoutingTable onRowClick={handleRowClick} />
        </CardContent>
      </Card>

      {/* ─── Detail Panel (shown when a row is clicked) ─── */}
      {selectedDecision && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-500" />
              Routing Decision Detail
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Decision metadata */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Timestamp</p>
                <p className="text-sm font-medium">{fmtDateTime(selectedDecision.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Session</p>
                <p className="text-sm font-mono">{selectedDecision.session_id}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Agent Dispatched</p>
                <Badge
                  variant="outline"
                  className={`text-xs font-semibold ${
                    AGENT_BADGE_STYLES[selectedDecision.agent_dispatched || ''] ||
                    'bg-gray-100 text-gray-600'
                  }`}
                >
                  {selectedDecision.agent_dispatched
                    ? selectedDecision.agent_dispatched.charAt(0).toUpperCase() +
                      selectedDecision.agent_dispatched.slice(1)
                    : 'None'}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Intent Before</p>
                <Badge variant="outline" className="text-xs">
                  {selectedDecision.last_intent_before || 'unknown'}
                </Badge>
              </div>
            </div>

            {/* Reason */}
            <div>
              <p className="text-xs text-muted-foreground mb-1">Routing Reason</p>
              <p className="text-sm bg-muted/50 rounded-md p-2 font-mono">
                {selectedDecision.reason || '—'}
              </p>
            </div>

            {/* Message text */}
            {selectedDecision.message_text && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Message</p>
                <p className="text-sm bg-muted/50 rounded-md p-2">
                  {selectedDecision.message_text}
                </p>
              </div>
            )}

            {/* Trace ID */}
            {selectedDecision.trace_id && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Trace ID</p>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-mono text-muted-foreground">
                    {selectedDecision.trace_id}
                  </p>
                  <Link
                    href={`/dashboard/agent-routing/${encodeURIComponent(selectedDecision.trace_id)}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                    View trace timeline
                  </Link>
                </div>
              </div>
            )}

            <Separator />

            {/* Conversation Context */}
            <div>
              <p className="text-sm font-medium mb-2">
                Conversation Context (last 10 messages)
              </p>
              {loadingContext ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-8 bg-muted animate-pulse rounded-md" />
                  ))}
                </div>
              ) : conversationContext.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No conversation messages found for this session.
                </p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {conversationContext.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${
                        msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                          msg.direction === 'outgoing'
                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-900 dark:text-blue-100'
                            : 'bg-muted text-foreground'
                        }`}
                      >
                        <p>{msg.text}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {fmtDateTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
