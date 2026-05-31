'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { TraceTimeline } from '@/components/admin/v1_1/TraceTimeline';

/**
 * /dashboard/agent-routing/[traceId] — dedicated trace inspector (Req 32.4).
 *
 * Reads the `traceId` route param and renders the chronological end-to-end
 * timeline for that single inbound message via `<TraceTimeline>`, which fetches
 * `GET /api/trace/[id]` (admin-gated, task 25.5). The v1 Agent Routing dashboard
 * deep-links here when a routing decision row carrying a `trace_id` is clicked.
 *
 * Auth and phone masking are enforced by the API route; this page is a thin
 * shell that handles the route param and back-navigation.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md — §v1.1.13 Frontend Additions, §v1.1.8
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md — Requirements 32.4, 32.5
 */
export default function TraceTimelinePage() {
  const params = useParams();
  const raw = params.traceId;
  const traceId = (Array.isArray(raw) ? raw[0] : raw) ?? '';

  return (
    <div className="space-y-6 p-4 lg:p-6 max-w-[1100px] mx-auto">
      {/* Back link */}
      <Link
        href="/dashboard/agent-routing"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" />
        Back to Agent Routing
      </Link>

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Trace Inspector</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every event tagged with this <span className="font-mono">trace_id</span> — router
          decision through agent invocation, screening, guardrails, cache hits, and outbound send —
          in chronological order.
        </p>
      </div>

      <TraceTimeline traceId={traceId} />
    </div>
  );
}
