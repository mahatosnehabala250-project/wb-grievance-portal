import { createClient } from '@supabase/supabase-js';

/**
 * One ticket number generator for every intake path.
 *
 * Three routes each rolled their own as `WB-${1000 + count + 1}`, which is wrong
 * in two ways that only show under load or after a deletion:
 *
 *   - COUNT is not a reservation. Two complaints arriving in the same instant
 *     read the same count, build the same ticket, and the unique index rejects
 *     one of them — a citizen's complaint fails to register, and it fails
 *     hardest exactly when the office is busiest.
 *   - Deleting a complaint lowers the count, so the next ticket reuses a number
 *     that has already been read out to somebody.
 *
 * It also produced the wrong shape. generate_ticket_no yields
 * WB-26-PUR-001044; the hand-rolled version yields WB-01234. JS-12 parses only
 * the former, so a complaint filed through the app's own New Complaint button
 * got a ticket the Telegram bot cannot resolve.
 *
 * The database function is the answer to all three: it draws from a sequence,
 * so it is concurrency-safe and never reuses, and it stamps the district code
 * and the IST year.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function generateTicketNo(district: string): Promise<string> {
  const { data, error } = await supabase.rpc('generate_ticket_no', { p_district: district });
  if (error || !data) {
    throw new Error(`Could not generate a ticket number: ${error?.message ?? 'empty result'}`);
  }
  return String(data);
}
