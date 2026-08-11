export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest, getComplaintScopeFilter } from '@/lib/jwt';
import type { JWTPayload } from '@/lib/jwt';
import { createClient } from '@supabase/supabase-js';
import { prettyBlock } from '@/lib/block-name';
import { slaLevel } from '@/lib/sla';
import { dbTime } from '@/lib/db-time';

/**
 * /api/complaints/rollup — where to send someone today.
 *
 * This used to return counts and nothing else: block → gram panchayat → village,
 * each row "n open of m". Six columns were fetched, none of them time, ownership
 * or category, so the screen could not say anything beyond how many. Every place
 * looked alike, and since most of a well-run seat is quiet, most of the screen
 * was grey rows reading "0 / 8".
 *
 * An MLA does not need to be told a village has nothing wrong with it. They need
 * the four places that do, ranked by whether the state's own deadline has passed,
 * whether anyone is actually on it, and how long someone has been waiting.
 *
 * So the response now leads with `pressure` — one entry per village with anything
 * open, carrying its actual tickets — and folds everything settled into `quiet`.
 * The full tree is still returned, because the geography is the point of this
 * screen and a PA must be able to find any place by name; it is just no longer
 * the first thing anyone reads.
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

/** Villages shown as pressure, and tickets shown inside one. Caps, not truncation
 *  in disguise — the UI is told what it is not showing. */
const MAX_PRESSURE = 12;
const MAX_TICKETS = 4;

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
  /** Added so a directory row can say something other than a ratio. */
  unowned: number;
  oldestOpenDays: number | null;
}
interface VillageNode extends Node { villageCode: string | null; booths: number }
interface GpNode extends Node { villages: VillageNode[] }
interface BlockNode extends Node { gps: GpNode[] }

const blank = (name: string): Node =>
  ({ name, total: 0, open: 0, resolved: 0, critical: 0, unowned: 0, oldestOpenDays: null });

/** Age in days, or 0 for a timestamp we cannot read — never NaN, which would
 *  poison every max() and sort it touches. */
const ageDays = (createdAt: unknown): number => {
  const t = dbTime(createdAt as string | Date);
  return Number.isNaN(t) ? 0 : (Date.now() - t) / 86_400_000;
};

function tally(n: Node, c: AnyRecord) {
  n.total++;
  const status = String(c.status || '');
  const isOpen = OPEN_STATUSES.has(status);
  if (isOpen) {
    n.open++;
    if (c.assignedToId == null) n.unowned++;
    const age = ageDays(c.createdAt);
    if (n.oldestOpenDays === null || age > n.oldestOpenDays) n.oldestOpenDays = age;
  }
  if (status === 'RESOLVED') n.resolved++;
  if (String(c.urgency) === 'CRITICAL' && isOpen) n.critical++;
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  try {
    let q = supabase
      .from('complaints')
      // The widened select is the whole unlock. createdAt gives ageing and SLA,
      // assignedToId gives "is anyone actually on this", category and issue let a
      // card say what the problem is rather than only that there is one.
      .select('id, "ticketNo", issue, block, gp_name, gp_code, village, village_code, status, urgency, category, "createdAt", "assignedToId"');
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

    /**
     * The pressure list — the part of the seat that needs a person.
     *
     * Grouped by village rather than by GP because a village is where someone
     * physically goes, and because assigning is a per-complaint action; the GP and
     * block ride along in the breadcrumb so no context is lost.
     */
    const openRows = rows.filter((r) => OPEN_STATUSES.has(String(r.status)));

    interface Ticket {
      id: string; ticketNo: string; issue: string; category: string;
      urgency: string; ageDays: number; level: string; unowned: boolean;
    }
    interface Pressure {
      village: string; gp: string; block: string; villageCode: string | null;
      open: number; unowned: number; oldestDays: number; worstLevel: string;
      categories: { category: string; n: number }[];
      tickets: Ticket[]; moreTickets: number;
    }

    const RANK: Record<string, number> = { breached: 2, warning: 1, ok: 0 };
    const byVillage = new Map<string, Pressure & { _cats: Map<string, number> }>();

    for (const c of openRows) {
      const key = `${String(c.block)}|${String(c.gp_name || 'Not recorded')}|${String(c.village || 'Not recorded')}`;
      let p = byVillage.get(key);
      if (!p) {
        p = {
          village: String(c.village || 'Not recorded'),
          gp: String(c.gp_name || 'Not recorded'),
          block: prettyBlock(String(c.block || '')) || String(c.block || 'Unknown'),
          villageCode: c.village_code ? String(c.village_code) : null,
          open: 0, unowned: 0, oldestDays: 0, worstLevel: 'ok',
          categories: [], tickets: [], moreTickets: 0, _cats: new Map(),
        };
        byVillage.set(key, p);
      }

      // The SLA verdict comes from src/lib/sla.ts, the single source that the
      // dashboard, hotspots and this screen all read, so a case cannot be late
      // here and on time there.
      const level = slaLevel(c.createdAt as string | Date, String(c.urgency), String(c.status));
      const age = ageDays(c.createdAt);
      const unowned = c.assignedToId == null;

      p.open++;
      if (unowned) p.unowned++;
      if (age > p.oldestDays) p.oldestDays = age;
      if ((RANK[level] ?? 0) > (RANK[p.worstLevel] ?? 0)) p.worstLevel = level;
      const cat = String(c.category || 'OTHER');
      p._cats.set(cat, (p._cats.get(cat) || 0) + 1);

      p.tickets.push({
        id: String(c.id),
        ticketNo: String(c.ticketNo || ''),
        issue: String(c.issue || ''),
        category: cat,
        urgency: String(c.urgency || 'MEDIUM'),
        ageDays: Math.round(age * 10) / 10,
        level,
        unowned,
      });
    }

    const pressureAll: Pressure[] = [...byVillage.values()].map((p) => {
      // Unowned and oldest first inside a village too, so the ticket a reader
      // acts on is the one at the top.
      p.tickets.sort((a, b) =>
        Number(b.unowned) - Number(a.unowned) ||
        (RANK[b.level] ?? 0) - (RANK[a.level] ?? 0) ||
        b.ageDays - a.ageDays);
      const kept = p.tickets.slice(0, MAX_TICKETS);
      return {
        village: p.village, gp: p.gp, block: p.block, villageCode: p.villageCode,
        open: p.open, unowned: p.unowned,
        oldestDays: Math.round(p.oldestDays * 10) / 10,
        worstLevel: p.worstLevel,
        categories: [...p._cats.entries()]
          .map(([category, n]) => ({ category, n }))
          .sort((a, b) => b.n - a.n),
        tickets: kept,
        moreTickets: p.tickets.length - kept.length,
      };
    });

    // The ranking rule is printed on the screen verbatim, so it has to be simple
    // enough to say in one sentence: past deadline, then nobody on it, then
    // longest waiting.
    pressureAll.sort((a, b) =>
      (RANK[b.worstLevel] ?? 0) - (RANK[a.worstLevel] ?? 0) ||
      b.unowned - a.unowned ||
      b.oldestDays - a.oldestDays);
    const pressure = pressureAll.slice(0, MAX_PRESSURE);

    const sla = { breached: 0, warning: 0, ok: 0 };
    for (const c of openRows) {
      const l = slaLevel(c.createdAt as string | Date, String(c.urgency), String(c.status));
      if (l === 'breached') sla.breached++;
      else if (l === 'warning') sla.warning++;
      else sla.ok++;
    }

    // Heaviest first at every level, by the same rule as the pressure list rather
    // than by raw totals — sorting a dozen fully-resolved rows by how many
    // complaints they once had ordered most of the screen by an irrelevance.
    const byPressure = (a: Node, b: Node) =>
      b.unowned - a.unowned ||
      (b.oldestOpenDays ?? -1) - (a.oldestOpenDays ?? -1) ||
      b.open - a.open ||
      b.total - a.total;
    const tree = [...blocks.values()].sort(byPressure);
    for (const b of tree) {
      b.gps.sort(byPressure);
      for (const g of b.gps) g.villages.sort(byPressure);
      b.oldestOpenDays = round1(b.oldestOpenDays);
      for (const g of b.gps) {
        g.oldestOpenDays = round1(g.oldestOpenDays);
        for (const v of g.villages) v.oldestOpenDays = round1(v.oldestOpenDays);
      }
    }

    // Everything settled, named. Collapsed to one line on screen, but the names
    // are all here: a PA searching for a village must find it even when that
    // village is fine, or they conclude the screen is broken.
    const quietVillages: string[] = [];
    let quietResolved = 0;
    const quietGps = new Set<string>();
    for (const b of tree) {
      for (const g of b.gps) {
        if (g.open === 0) quietGps.add(`${b.name}/${g.name}`);
        for (const v of g.villages) {
          if (v.open === 0) { quietVillages.push(v.name); quietResolved += v.resolved; }
        }
      }
    }
    quietVillages.sort((a, b) => a.localeCompare(b));

    const totalVillages = tree.reduce((s, b) => s + b.gps.reduce((t, g) => t + g.villages.length, 0), 0);
    const oldest = openRows.reduce<{ days: number; place: string } | null>((acc, c) => {
      const age = ageDays(c.createdAt);
      return !acc || age > acc.days ? { days: age, place: String(c.village || 'Not recorded') } : acc;
    }, null);

    /**
     * The part of the seat that has never called at all, and the part with nobody
     * to send.
     *
     * Both are only meaningful against one constituency's own denominator, so
     * they are computed for an MLA and returned null for district, block and MP
     * scopes rather than quietly mixing constituencies. lgd_villages is keyed by
     * gp_code — lgd_gram_panchayats carries no assembly_constituency at all — so
     * the GP set is derived through the village table.
     */
    let coverage: {
      acVillages: number; filedVillages: number;
      acGps: number; filedGps: number; silentGps: number;
      gpsWithWorker: number;
    } | null = null;

    if (payload.constituency) {
      const [{ data: lgd }, { data: staff }] = await Promise.all([
        supabase.from('lgd_villages').select('village_code, gp_code')
          .eq('assembly_constituency', payload.constituency).limit(20000),
        supabase.from('users').select('gp_code')
          .eq('constituency', payload.constituency)
          .in('role_level', ['KARYAKARTA', 'GP_COORD'])
          .not('gp_code', 'is', null),
      ]);

      if (lgd && lgd.length) {
        const acGpSet = new Set(lgd.map((r) => String(r.gp_code)).filter(Boolean));
        const filedVillageCodes = new Set(
          rows.map((r) => r.village_code).filter(Boolean).map(String));
        const filedGpCodes = new Set(
          rows.map((r) => r.gp_code).filter(Boolean).map(String));
        const workerGps = new Set((staff || []).map((u) => String(u.gp_code)).filter(Boolean));

        coverage = {
          acVillages: lgd.length,
          filedVillages: filedVillageCodes.size,
          acGps: acGpSet.size,
          filedGps: filedGpCodes.size,
          silentGps: [...acGpSet].filter((g) => !filedGpCodes.has(g)).length,
          gpsWithWorker: [...acGpSet].filter((g) => workerGps.has(g)).length,
        };
      }
    }

    return NextResponse.json({
      pressure,
      pressureTruncated: Math.max(0, pressureAll.length - pressure.length),
      sla,
      quiet: { villages: quietVillages, gps: quietGps.size, resolved: quietResolved },
      coverage,
      tree,
      totals: {
        complaints: rows.length,
        blocks: tree.length,
        gps: tree.reduce((s, b) => s + b.gps.length, 0),
        villages: totalVillages,
        open: openRows.length,
        openVillages: byVillage.size,
        unowned: openRows.filter((c) => c.assignedToId == null).length,
        oldestOpenDays: oldest ? Math.round(oldest.days * 10) / 10 : null,
        oldestOpenPlace: oldest ? oldest.place : null,
      },
      unmatchedGp: rows.filter((r) => !r.gp_name).length,
      // Said out loud so a reader never mistakes booth coverage for a count of
      // complaints per booth.
      boothNote: 'Booth numbers are how many polling stations serve a village, not complaints per booth — a complaint is recorded at a village, never at a booth.',
    });
  } catch (error) {
    console.error('[complaints/rollup] error:', error);
    return NextResponse.json({ error: 'Failed to build the area rollup' }, { status: 500 });
  }
}
