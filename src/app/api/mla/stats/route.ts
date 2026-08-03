import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/jwt";
import { canAccessAssembly } from "@/lib/rbac";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  // ── Auth check ──────────────────────────────────────────
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedConstituency = searchParams.get("constituency") || user.constituency || "";

  if (!requestedConstituency) {
    return NextResponse.json({ error: "constituency required" }, { status: 400 });
  }

  // ── Constituency access check (mapping-backed) ───────────
  // MLA → own AC only; MP → only ACs under their parliamentary seat;
  // DISTRICT_ADMIN → ACs in their district; ADMIN/STATE → all.
  if (!(await canAccessAssembly(user, requestedConstituency))) {
    return NextResponse.json(
      { error: "Access denied — constituency is outside your jurisdiction" },
      { status: 403 }
    );
  }

  try {
    // ── Fetch complaints for this constituency ───────────────
    // Input validation
    if (requestedConstituency.length > 100 || !/^[a-zA-Z\s]+$/.test(requestedConstituency)) {
      return NextResponse.json({ error: "Invalid constituency parameter" }, { status: 400 });
    }

    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");
    const limit = Math.min(parseInt(limitParam || "500"), 1000);
    const offset = parseInt(offsetParam || "0");

    // Match BOTH the new assembly_constituency column and the legacy
    // constituency column (older complaints only have the legacy one)
    const { data: complaints, error } = await supabase
      .from("complaints")
      .select(`
        id, status, category, urgency, block, district,
        createdAt, updatedAt, "resolvedAt", satisfactionRating,
        assignedOfficerName, assignedToId, ticketNo,
        citizenName, issue, village, constituency, assembly_constituency
      `)
      .or(`constituency.eq.${requestedConstituency},assembly_constituency.eq.${requestedConstituency}`)
      .order("createdAt", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const all = complaints || [];
    const active = all.filter(c => !["RESOLVED","REJECTED","CLOSED"].includes(c.status));
    const resolved = all.filter(c => c.status === "RESOLVED");
    const registered = all.filter(c => c.status === "REGISTERED");
    const inProgress = all.filter(c => c.status === "IN_PROGRESS");
    const assigned = all.filter(c => c.status === "ASSIGNED");
    const critical = all.filter(c => c.urgency === "CRITICAL" && !["RESOLVED","REJECTED","CLOSED"].includes(c.status));

    const now = new Date();
    const last24h = all.filter(c => new Date(c.createdAt) > new Date(now.getTime() - 86400000));
    const last7d  = all.filter(c => new Date(c.createdAt) > new Date(now.getTime() - 7*86400000));
    const last30d = all.filter(c => new Date(c.createdAt) > new Date(now.getTime() - 30*86400000));

    const resRate = all.length > 0 ? (resolved.length / all.length) * 100 : 0;

    // Ratings
    const ratings = resolved
      .filter(c => c.satisfactionRating)
      .map(c => parseFloat(c.satisfactionRating));
    const avgRating = ratings.length > 0
      ? Math.round((ratings.reduce((a,b) => a+b,0) / ratings.length) * 10) / 10
      : null;

    // By category
    const catMap: Record<string,{total:number;resolved:number;active:number}> = {};
    all.forEach(c => {
      const cat = c.category || "OTHER";
      if (!catMap[cat]) catMap[cat] = { total:0, resolved:0, active:0 };
      catMap[cat].total++;
      if (c.status === "RESOLVED") catMap[cat].resolved++;
      else if (!["REJECTED","CLOSED"].includes(c.status)) catMap[cat].active++;
    });

    // By block
    const blockMap: Record<string,{total:number;active:number;resolved:number}> = {};
    all.forEach(c => {
      const blk = c.block || "Unknown";
      if (!blockMap[blk]) blockMap[blk] = { total:0, active:0, resolved:0 };
      blockMap[blk].total++;
      if (c.status === "RESOLVED") blockMap[blk].resolved++;
      else if (!["REJECTED","CLOSED"].includes(c.status)) blockMap[blk].active++;
    });

    // Monthly trend.
    //
    // Three things this has to get right, each of which it used to get wrong:
    //
    // 1. Order. The rows were emitted in insertion order, and `all` is sorted
    //    newest-first, so the chart plotted Jul, Jun, May, Apr left to right —
    //    time ran backwards and a falling complaint count drew as a rising line.
    // 2. Year. Buckets were keyed on the month name alone, so next April would
    //    have been added straight onto this April's bar.
    // 3. What "resolved" counts. It was counting complaints *filed* in a month
    //    that are resolved today, so a case filed in April and closed in July
    //    scored against April. The two series were therefore never comparable:
    //    you could not see closures lagging behind arrivals, which is the whole
    //    reason to plot them together. It now counts closures in the month they
    //    actually happened.
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const bucketOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const trendMap: Record<string,{filed:number;resolved:number}> = {};
    const touch = (key: string) => (trendMap[key] ||= { filed:0, resolved:0 });

    all.forEach(c => {
      touch(bucketOf(new Date(c.createdAt))).filed++;
      // Fall back to updatedAt only if a resolved row somehow has no resolvedAt,
      // so a closure is never dropped from the chart entirely.
      const closedOn = c.status === "RESOLVED" ? (c.resolvedAt || c.updatedAt) : null;
      if (closedOn) touch(bucketOf(new Date(closedOn))).resolved++;
    });

    // Chronological, and labelled with the year only once the range crosses one,
    // so a single-year seat keeps the short "Apr" label it reads better with.
    const trendKeys = Object.keys(trendMap).sort();
    const spansYears = new Set(trendKeys.map(k => k.slice(0, 4))).size > 1;
    const trend = trendKeys.map(key => {
      const [y, m] = key.split("-");
      const label = monthNames[Number(m) - 1];
      return { date: spansYears ? `${label} ${y.slice(2)}` : label, ...trendMap[key] };
    });

    // Officer performance
    const officerMap: Record<string,{resolved:number;active:number;name:string}> = {};
    all.forEach(c => {
      if (!c.assignedOfficerName) return;
      const key = c.assignedOfficerName;
      if (!officerMap[key]) officerMap[key] = { resolved:0, active:0, name:key };
      if (c.status === "RESOLVED") officerMap[key].resolved++;
      else if (!["REJECTED","CLOSED"].includes(c.status)) officerMap[key].active++;
    });
    const officers = Object.values(officerMap)
      .map(o => ({
        ...o,
        total: o.resolved + o.active,
        score: Math.round((o.resolved / Math.max(o.resolved+o.active,1)) * 100),
      }))
      .sort((a,b) => b.score - a.score);

    // SLA analysis
    const slaBreached = active.filter(c => {
      const slaDays: Record<string,number> = { CRITICAL:0.25, HIGH:1, MEDIUM:3, LOW:7 };
      const days = slaDays[c.urgency] || 3;
      return (now.getTime() - new Date(c.createdAt).getTime()) > days * 86400000;
    });

    // Recent resolved (for achievement display)
    const recentlyResolved = resolved
      .filter(c => new Date(c.updatedAt) > new Date(now.getTime() - 7*86400000))
      .slice(0, 5);

    // ── Analytics ────────────────────────────────────────────
    const DAY = 86400000;
    const ageDays = (from: string) => (now.getTime() - new Date(from).getTime()) / DAY;

    /**
     * Backlog shape.
     *
     * A single "28 open" tells an MLA nothing about whether the office is busy
     * or negligent. Twenty-eight cases all filed this week is a busy week;
     * twenty-eight sitting past a month is a different conversation. The bands
     * are what the backlog is actually made of.
     */
    const AGE_BANDS = [
      { key: "0-3",   label: "Under 3 days", max: 3 },
      { key: "4-7",   label: "3 to 7 days",  max: 7 },
      { key: "8-15",  label: "1 to 2 weeks", max: 15 },
      { key: "16-30", label: "2 to 4 weeks", max: 30 },
      { key: "30+",   label: "Over a month", max: Infinity },
    ];
    const ageing = AGE_BANDS.map(({ key, label }) => ({ key, label, count: 0 }));
    for (const c of active) {
      const d = ageDays(c.createdAt);
      const i = AGE_BANDS.findIndex(b => d <= b.max);
      ageing[i === -1 ? AGE_BANDS.length - 1 : i].count++;
    }

    /**
     * How long closing actually takes, from the cases that did close.
     *
     * Reported as a median rather than a mean: one case that sat for a year
     * drags an average far away from the experience of a typical complainant,
     * and it is the typical experience an MLA is answerable for.
     */
    const closedDurations = resolved
      .map(c => c.resolvedAt ? (new Date(c.resolvedAt).getTime() - new Date(c.createdAt).getTime()) / DAY : null)
      .filter((d): d is number => d !== null && d >= 0)
      .sort((a, b) => a - b);
    const at = (q: number) => closedDurations.length
      ? Math.round(closedDurations[Math.min(closedDurations.length - 1, Math.floor(closedDurations.length * q))] * 10) / 10
      : null;
    const speed = {
      resolvedCount: closedDurations.length,
      medianDays: at(0.5),
      slowestTenthDays: at(0.9),
      oldestOpenDays: active.length ? Math.round(Math.max(...active.map(c => ageDays(c.createdAt)))) : 0,
    };

    /**
     * Is the backlog growing or shrinking?
     *
     * Arrivals and closures over the same recent window, so the two are
     * comparable. Net is what the pile did — the number that says whether the
     * office is keeping up, which no single count on this page could answer.
     */
    const WINDOW_DAYS = 30;
    const since = now.getTime() - WINDOW_DAYS * DAY;
    const arrived = all.filter(c => new Date(c.createdAt).getTime() >= since).length;
    const closed = all.filter(c => c.resolvedAt && new Date(c.resolvedAt).getTime() >= since).length;
    const flow = { windowDays: WINDOW_DAYS, arrived, closed, net: arrived - closed };

    /**
     * Blocks ranked by how long their oldest case has waited, not by volume.
     * A block with three complaints untouched for six weeks needs the MLA more
     * than one with twenty filed yesterday, and sorting by count hides that.
     */
    const blockAge: Record<string, number[]> = {};
    for (const c of active) (blockAge[c.block || "Unknown"] ||= []).push(ageDays(c.createdAt));
    const stuck = Object.entries(blockAge)
      .map(([block, ages]) => ({
        block,
        open: ages.length,
        oldestDays: Math.round(Math.max(...ages)),
        overMonth: ages.filter(a => a > 30).length,
      }))
      .sort((a, b) => b.oldestDays - a.oldestDays || b.open - a.open);

    return NextResponse.json({
      data: {
        constituency: requestedConstituency,
        mla_name: user.name,
        // Core counts
        total:      all.length,
        active:     active.length,
        resolved:   resolved.length,
        registered: registered.length,
        in_progress: inProgress.length,
        assigned:   assigned.length,
        critical:   critical.length,
        sla_breached: slaBreached.length,
        // Time-based
        last_24h: last24h.length,
        last_7d:  last7d.length,
        last_30d: last30d.length,
        // Rates
        resolution_rate: Math.round(resRate * 10) / 10,
        avg_rating: avgRating,
        // Breakdowns
        by_category: Object.entries(catMap)
          .map(([category, v]) => ({ category, ...v }))
          .sort((a,b) => b.total - a.total),
        by_block: Object.entries(blockMap)
          .map(([block, v]) => ({ block, ...v }))
          .sort((a,b) => b.total - a.total),
        trend,
        officers,
        recent_complaints: all.slice(0, 20),
        recently_resolved: recentlyResolved,
        sla_breached_list: slaBreached.slice(0, 5),
        // Analytics
        ageing,
        speed,
        flow,
        stuck,
      }
    });

  } catch (err: unknown) {
    console.error("MLA stats error:", err);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
