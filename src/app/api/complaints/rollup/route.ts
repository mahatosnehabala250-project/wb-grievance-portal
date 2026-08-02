export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import type { JWTPayload } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';
import { prettyBlock } from '@/lib/block-name';

/**
 * /api/complaints/rollup — where the pressure is, block by block.
 *
 * An MLA reads their seat as a nesting of places, not as a list of tickets:
 * which block, which gram panchayat inside it, which village inside that. This
 * returns that nesting already counted.
 *
 * On booths, deliberately: a complaint arrives from a village, never from a
 * booth. The only bridge is village_code → polling_stations, and of 561
 * complaints carrying a village code, 323 land in a village that has any booth
 * record and only 212 in a village with exactly one. Splitting the rest across
 * booths would put numbers on screen that measure nothing. So booths are
 * reported as coverage — "these four booths serve this village" — which is what
 * the seat is actually organised by, and never as a complaint count.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AnyRecord = Record<string, unknown>;

const OPEN_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'REGISTERED', 'ASSIGNED']);

interface Filterable {
  eq(column: string, value: unknown): Filterable;
  in(column: string, values: unknown[]): Filterable;
}
function applyScope<T>(query: T, payload: JWTPayload): T {
  const where = getComplaintScopeFilter(payload) as AnyRecord;
  let q = query as unknown as Filterable;
  for (const [key, value] of Object.entries(where)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && 'in' in (value as AnyRecord)) {
      q = q.in(key, (value as { in: unknown[] }).in);
    } else {
      q = q.eq(key, value);
    }
  }
  return q as unknown as T;
}

interface Node {
  name: string;
  total: number;
  open: number;
  resolved: number;
  critical: number;
}
interface VillageNode extends Node { villageCode: string | null; booths: number }
interface GpNode extends Node { villages: VillageNode[] }
interface BlockNode extends Node { gps: GpNode[] }

const blank = (name: string): Node =>
  ({ name, total: 0, open: 0, resolved: 0, critical: 0 });

function tally(n: Node, c: AnyRecord) {
  n.total++;
  const status = String(c.status || '');
  if (OPEN_STATUSES.has(status)) n.open++;
  if (status === 'RESOLVED') n.resolved++;
  if (String(c.urgency) === 'CRITICAL' && OPEN_STATUSES.has(status)) n.critical++;
}

export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  try {
    let q = supabase
      .from('complaints')
      .select('block, gp_name, village, village_code, status, urgency');
    q = applyScope(q, payload) as typeof q;
    const { data, error } = await q.limit(20000);
    if (error) throw error;
    const rows = (data || []) as AnyRecord[];

    // Booth coverage per village, one query rather than one per village.
    const codes = Array.from(
      new Set(rows.map((r) => r.village_code).filter(Boolean) as string[])
    );
    const boothsByVillage = new Map<string, number>();
    if (codes.length) {
      const { data: ps } = await supabase
        .from('polling_stations')
        .select('village_code')
        .in('village_code', codes);
      for (const p of ps || []) {
        const k = String(p.village_code);
        boothsByVillage.set(k, (boothsByVillage.get(k) || 0) + 1);
      }
    }

    const blocks = new Map<string, BlockNode>();
    for (const c of rows) {
      const bKey = String(c.block || 'Unknown');
      let b = blocks.get(bKey);
      if (!b) { b = { ...blank(prettyBlock(bKey) || bKey), gps: [] }; blocks.set(bKey, b); }
      tally(b, c);

      const gKey = String(c.gp_name || 'Not recorded');
      let g = b.gps.find((x) => x.name === gKey);
      if (!g) { g = { ...blank(gKey), villages: [] }; b.gps.push(g); }
      tally(g, c);

      const vKey = String(c.village || 'Not recorded');
      let v = g.villages.find((x) => x.name === vKey);
      if (!v) {
        const code = c.village_code ? String(c.village_code) : null;
        v = { ...blank(vKey), villageCode: code, booths: code ? (boothsByVillage.get(code) || 0) : 0 };
        g.villages.push(v);
      }
      tally(v, c);
    }

    // Heaviest first at every level — the screen should open on the problem.
    const byOpen = (a: Node, b: Node) => b.open - a.open || b.total - a.total;
    const tree = [...blocks.values()].sort(byOpen);
    for (const b of tree) {
      b.gps.sort(byOpen);
      for (const g of b.gps) g.villages.sort(byOpen);
    }

    return NextResponse.json({
      tree,
      totals: {
        complaints: rows.length,
        blocks: tree.length,
        gps: tree.reduce((s, b) => s + b.gps.length, 0),
        villages: tree.reduce((s, b) => s + b.gps.reduce((t, g) => t + g.villages.length, 0), 0),
      },
      // Said out loud so a reader never mistakes booth coverage for a count of
      // complaints per booth.
      boothNote: 'Booth numbers are how many polling stations serve a village, not complaints per booth — a complaint is recorded at a village, never at a booth.',
    });
  } catch (error) {
    console.error('[complaints/rollup] error:', error);
    return NextResponse.json({ error: 'Failed to build the area rollup' }, { status: 500 });
  }
}
