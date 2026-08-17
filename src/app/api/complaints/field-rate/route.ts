export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { n8nSecretOk } from '@/lib/n8nAuth';

/**
 * POST /api/complaints/field-rate — a voice agent recording a citizen's
 * satisfaction rating after their complaint was closed.
 *
 * The existing PATCH /api/complaints/[id]/rate requires a staff JWT, which the
 * Sarvam AI voice agent does not carry. This endpoint authenticates the machine
 * the same way field-update does: X-N8N-SECRET header matched against the shared
 * webhook secret. Identity is resolved server-side from the ticket number, never
 * asserted by the caller.
 *
 * Accepts { ticketNo, rating, note?, stillBroken? }.
 *   - ticketNo: the human-readable complaint number (e.g. "WB-0025")
 *   - rating: 1–5 integer
 *   - note: optional free-text from the citizen
 *   - stillBroken: optional boolean, true means the citizen says the problem persists
 *
 * Writes satisfactionRating and an activity-log row. Does not change status — if
 * stillBroken is true the office will decide what to do after reading the note.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  if (!n8nSecretOk(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const ticketNo = String(body.ticketNo || '').trim().toUpperCase();
    const rating = Number(body.rating);
    const note = body.note ? String(body.note).slice(0, 2000) : null;
    const stillBroken = body.stillBroken === true;

    if (!ticketNo) {
      return NextResponse.json(
        { ok: false, error: 'ticketNo is required' }, { status: 400 });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { ok: false, error: 'rating must be an integer between 1 and 5' }, { status: 400 });
    }

    // Look up by ticketNo — the human-readable number the voice agent has.
    const { data: complaint, error: fetchErr } = await supabase
      .from('complaints')
      .select('id, "ticketNo", status, "satisfactionRating"')
      .eq('ticketNo', ticketNo)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!complaint) {
      return NextResponse.json(
        { ok: false, error: 'No such ticket' }, { status: 404 });
    }

    // Only resolved complaints can be rated — a citizen cannot rate something
    // the office has not finished yet.
    if (complaint.status !== 'RESOLVED') {
      return NextResponse.json(
        { ok: false, error: 'Can only rate resolved complaints' },
        { status: 400 });
    }

    // If already rated, overwrite — the voice agent may re-attempt if the first
    // call was garbled. The activity log will show both attempts.
    const { error: updErr } = await supabase
      .from('complaints')
      .update({
        satisfactionRating: rating,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', complaint.id);
    if (updErr) throw updErr;

    const previousRating = complaint.satisfactionRating ?? null;

    await supabase.from('activity_logs').insert({
      complaintId: complaint.id,
      action: 'RATED',
      description:
        `Citizen rated ${rating}/5` +
        (previousRating ? ` (overwrote ${previousRating})` : '') +
        (stillBroken ? ' — reports problem persists' : '') +
        (note ? ` — ${note}` : '') +
        ' (voice agent, via Sarvam)',
      actorId: null,
      actorName: 'Sarvam Voice Agent',
      metadata: JSON.stringify({
        rating,
        stillBroken,
        note: note || null,
        previousRating,
        channel: 'voice',
      }),
    });

    return NextResponse.json({
      ok: true,
      data: {
        ticketNo,
        rating,
        previousRating,
        stillBroken,
      },
    });
  } catch (error) {
    console.error('[complaints/field-rate] error:', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to record rating' }, { status: 500 });
  }
}
