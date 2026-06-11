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
        createdAt, updatedAt, satisfactionRating,
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

    // Monthly trend last 6 months
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const trendMap: Record<string,{filed:number;resolved:number}> = {};
    all.forEach(c => {
      const d = new Date(c.createdAt);
      const key = monthNames[d.getMonth()];
      if (!trendMap[key]) trendMap[key] = { filed:0, resolved:0 };
      trendMap[key].filed++;
      if (c.status === "RESOLVED") trendMap[key].resolved++;
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
        trend: Object.entries(trendMap)
          .map(([date, v]) => ({ date, ...v })),
        officers,
        recent_complaints: all.slice(0, 20),
        recently_resolved: recentlyResolved,
        sla_breached_list: slaBreached.slice(0, 5),
      }
    });

  } catch (err: unknown) {
    console.error("MLA stats error:", err);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
