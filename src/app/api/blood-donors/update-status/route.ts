import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Valid commands for the update-status endpoint */
const VALID_COMMANDS = ['PAUSE', 'RESUME', 'DONATED', 'DEFER'] as const;
type Command = (typeof VALID_COMMANDS)[number];

/**
 * POST /api/blood-donors/update-status
 *
 * Called by the Donor Agent (n8n) via the UpdateDonorStatus tool to handle
 * PAUSE, RESUME, DONATED, and DEFER commands for a blood donor.
 *
 * - PAUSE:   Sets `is_paused = true` on the donor row.
 * - RESUME:  Sets `is_paused = false` on the donor row.
 * - DONATED: Forwards to POST /api/blood-donors/record-donation internally.
 * - DEFER:   Forwards to POST /api/blood-donors/defer internally.
 *
 * Auth: X-N8N-SECRET header must match N8N_WEBHOOK_SECRET env var.
 *
 * Request body:
 * {
 *   donor_id: string (uuid, required),
 *   command: "PAUSE" | "RESUME" | "DONATED" | "DEFER" (required),
 *   data?: { ... } (required for DONATED and DEFER commands)
 * }
 *
 * Response: { ok: true, data: { donor_id, command, result } }
 *
 * @see Requirements 7.5 — Design §Components
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
    let body: {
      donor_id?: string;
      command?: string;
      data?: Record<string, unknown>;
    };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { donor_id, command, data } = body;

    // ─── Validation ───
    if (!donor_id || typeof donor_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'donor_id is required and must be a string (uuid)' },
        { status: 400 }
      );
    }

    if (!command || !VALID_COMMANDS.includes(command.toUpperCase() as Command)) {
      return NextResponse.json(
        { ok: false, error: `command is required and must be one of: ${VALID_COMMANDS.join(', ')}` },
        { status: 400 }
      );
    }

    const normalizedCommand = command.toUpperCase() as Command;

    // ─── Route by command ───
    switch (normalizedCommand) {
      case 'PAUSE': {
        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

        const { data: donor, error } = await supabase
          .from('blood_donors')
          .update({ is_paused: true })
          .eq('id', donor_id)
          .select('id, is_paused')
          .single();

        if (error) {
          console.error('[blood-donors/update-status] PAUSE error:', error);
          if (error.code === 'PGRST116') {
            return NextResponse.json(
              { ok: false, error: 'Donor not found' },
              { status: 404 }
            );
          }
          return NextResponse.json(
            { ok: false, error: 'Failed to pause donor', details: error.message },
            { status: 500 }
          );
        }

        return NextResponse.json({
          ok: true,
          data: { donor_id: donor.id, command: 'PAUSE', result: { is_paused: true } },
        });
      }

      case 'RESUME': {
        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

        const { data: donor, error } = await supabase
          .from('blood_donors')
          .update({ is_paused: false })
          .eq('id', donor_id)
          .select('id, is_paused')
          .single();

        if (error) {
          console.error('[blood-donors/update-status] RESUME error:', error);
          if (error.code === 'PGRST116') {
            return NextResponse.json(
              { ok: false, error: 'Donor not found' },
              { status: 404 }
            );
          }
          return NextResponse.json(
            { ok: false, error: 'Failed to resume donor', details: error.message },
            { status: 500 }
          );
        }

        return NextResponse.json({
          ok: true,
          data: { donor_id: donor.id, command: 'RESUME', result: { is_paused: false } },
        });
      }

      case 'DONATED': {
        // Validate that data is provided for DONATED
        if (!data || typeof data !== 'object') {
          return NextResponse.json(
            { ok: false, error: 'data is required for DONATED command (donated_date, donation_type, hospital)' },
            { status: 400 }
          );
        }

        // Forward to /api/blood-donors/record-donation internally
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`;

        const response = await fetch(`${baseUrl}/api/blood-donors/record-donation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-N8N-SECRET': secret!,
          },
          body: JSON.stringify({ donor_id, ...data }),
        });

        const result = await response.json();

        if (!response.ok) {
          return NextResponse.json(
            { ok: false, error: result.error || 'Failed to record donation', details: result.details },
            { status: response.status }
          );
        }

        return NextResponse.json({
          ok: true,
          data: { donor_id, command: 'DONATED', result: result.data },
        });
      }

      case 'DEFER': {
        // Validate that data is provided for DEFER
        if (!data || typeof data !== 'object') {
          return NextResponse.json(
            { ok: false, error: 'data is required for DEFER command (type, reason, duration_days)' },
            { status: 400 }
          );
        }

        // Forward to /api/blood-donors/defer internally
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`;

        const response = await fetch(`${baseUrl}/api/blood-donors/defer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-N8N-SECRET': secret!,
          },
          body: JSON.stringify({ donor_id, ...data }),
        });

        const result = await response.json();

        if (!response.ok) {
          return NextResponse.json(
            { ok: false, error: result.error || 'Failed to defer donor', details: result.details },
            { status: response.status }
          );
        }

        return NextResponse.json({
          ok: true,
          data: { donor_id, command: 'DEFER', result: result.data },
        });
      }

      default: {
        // This should never be reached due to validation above
        return NextResponse.json(
          { ok: false, error: `Unknown command: ${command}` },
          { status: 400 }
        );
      }
    }
  } catch (error) {
    console.error('[blood-donors/update-status] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
