export const runtime = 'nodejs';
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { enrichOne, nlpEnabled } from '@/lib/nlp/enrich';

/**
 * GET /api/cron/nlp-enrich — batch NLP enrichment (Level 4 NLP Brain).
 *
 * Machine-to-machine (x-cron-secret). Finds complaints not yet enriched,
 * runs Claude on each, writes to complaint_nlp. Bounded batch per run
 * (default 25) to cap cost/latency — n8n JS-22 calls this on a schedule
 * so the backlog drains steadily.
 *
 * Query: ?limit=N (max 50). Returns counts.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!nlpEnabled()) {
    return NextResponse.json({ error: 'NLP not configured — set GEMINI_API_KEY (or ANTHROPIC_API_KEY)', enriched: 0 }, { status: 200 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 50);

  try {
    // Already-enriched ids
    const { data: doneRows } = await supabase.from('complaint_nlp').select('complaint_id').limit(5000);
    const doneSet = new Set((doneRows || []).map((r: Record<string, unknown>) => r.complaint_id as string));

    // Candidate complaints (most recent first) with usable text
    const { data: complaints, error } = await supabase
      .from('complaints')
      .select('id, issue, description, category, village, block')
      .order('createdAt', { ascending: false })
      .limit(500);
    if (error) throw error;

    const pending = (complaints || [])
      .filter((c: Record<string, unknown>) => !doneSet.has(c.id as string) && typeof c.issue === 'string' && (c.issue as string).trim())
      .slice(0, limit);

    let enriched = 0;
    const failures: string[] = [];

    for (const c of pending as Array<Record<string, unknown>>) {
      const result = await enrichOne({
        issue: c.issue as string,
        description: (c.description as string) || null,
        category: (c.category as string) || null,
        village: (c.village as string) || null,
        block: (c.block as string) || null,
      });
      if (!result) { failures.push(c.id as string); continue; }

      const { error: upErr } = await supabase.from('complaint_nlp').upsert({
        complaint_id: c.id,
        anger_score: result.anger_score,
        emotion: result.emotion,
        root_cause: result.root_cause,
        root_cause_key: result.root_cause_key,
        entities: result.entities,
        summary_en: result.summary_en,
        severity_flags: result.severity_flags,
        model: result.model,
        enriched_at: new Date().toISOString(),
      }, { onConflict: 'complaint_id' });
      if (upErr) { failures.push(c.id as string); continue; }
      enriched++;
    }

    return NextResponse.json({
      enriched,
      remaining: Math.max(0, (complaints || []).length - doneSet.size - enriched),
      attempted: pending.length,
      failures: failures.length,
    });
  } catch (err) {
    console.error('NLP enrich cron error:', err);
    return NextResponse.json({ error: 'Failed to enrich' }, { status: 500 });
  }
}

// POST /api/cron/nlp-enrich — enrich a single complaint by id (also cron-secret gated;
// useful to wire into JS-01/JS-02 right after a complaint is registered).
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!nlpEnabled()) {
    return NextResponse.json({ error: 'NLP not configured' }, { status: 200 });
  }
  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const { data: c } = await supabase
      .from('complaints')
      .select('id, issue, description, category, village, block')
      .eq('id', id)
      .single();
    if (!c) return NextResponse.json({ error: 'Complaint not found' }, { status: 404 });

    const result = await enrichOne({
      issue: c.issue, description: c.description, category: c.category, village: c.village, block: c.block,
    });
    if (!result) return NextResponse.json({ error: 'Enrichment failed' }, { status: 502 });

    await supabase.from('complaint_nlp').upsert({
      complaint_id: c.id, ...result, enriched_at: new Date().toISOString(),
    }, { onConflict: 'complaint_id' });

    return NextResponse.json({ success: true, nlp: result });
  } catch (err) {
    console.error('NLP enrich single error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
