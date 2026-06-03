import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const constituency = searchParams.get("constituency");

  if (!constituency) {
    return NextResponse.json({ error: "constituency required" }, { status: 400 });
  }

  try {
    const { data: complaints, error } = await supabase
      .from("complaints")
      .select("id, status, category, urgency, block, createdAt, updatedAt, satisfactionRating, assignedOfficerName")
      .eq("constituency", constituency);

    if (error) throw error;

    const all = complaints || [];
    const active = all.filter(c => !["RESOLVED","REJECTED","CLOSED"].includes(c.status));
    const resolved = all.filter(c => c.status === "RESOLVED");
    const registered = all.filter(c => c.status === "REGISTERED");
    const inProgress = all.filter(c => c.status === "IN_PROGRESS");
    const critical = all.filter(c => c.urgency === "CRITICAL" && !["RESOLVED","REJECTED","CLOSED"].includes(c.status));

    const now = new Date();
    const last24h = all.filter(c => new Date(c.createdAt) > new Date(now.getTime() - 86400000));
    const last7d = all.filter(c => new Date(c.createdAt) > new Date(now.getTime() - 7*86400000));

    const resolutionRate = all.length > 0 ? (resolved.length / all.length) * 100 : 0;
    const ratings = resolved.filter(c => c.satisfactionRating).map(c => parseFloat(c.satisfactionRating));
    const avgRating = ratings.length > 0 ? ratings.reduce((a,b) => a+b, 0) / ratings.length : null;

    // By category
    const catMap: Record<string, { total: number; resolved: number }> = {};
    all.forEach(c => {
      const cat = c.category || "OTHER";
      if (!catMap[cat]) catMap[cat] = { total: 0, resolved: 0 };
      catMap[cat].total++;
      if (c.status === "RESOLVED") catMap[cat].resolved++;
    });
    const by_category = Object.entries(catMap)
      .map(([category, v]) => ({ category, ...v }))
      .sort((a,b) => b.total - a.total);

    // By block
    const blockMap: Record<string, { total: number; active: number }> = {};
    all.forEach(c => {
      const blk = c.block || "Unknown";
      if (!blockMap[blk]) blockMap[blk] = { total: 0, active: 0 };
      blockMap[blk].total++;
      if (!["RESOLVED","REJECTED","CLOSED"].includes(c.status)) blockMap[blk].active++;
    });
    const by_block = Object.entries(blockMap)
      .map(([block, v]) => ({ block, ...v }))
      .sort((a,b) => b.total - a.total);

    // Monthly trend (last 6 months)
    const monthMap: Record<string, { filed: number; resolved: number }> = {};
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    all.forEach(c => {
      const d = new Date(c.createdAt);
      const key = months[d.getMonth()];
      if (!monthMap[key]) monthMap[key] = { filed: 0, resolved: 0 };
      monthMap[key].filed++;
      if (c.status === "RESOLVED") monthMap[key].resolved++;
    });
    const trend = Object.entries(monthMap).map(([date, v]) => ({ date, ...v }));

    // Officer performance (simple - count by officer name)
    const officerMap: Record<string, { resolved: number; active: number }> = {};
    all.forEach(c => {
      const name = c.assignedOfficerName || "Unassigned";
      if (!officerMap[name]) officerMap[name] = { resolved: 0, active: 0 };
      if (c.status === "RESOLVED") officerMap[name].resolved++;
      else if (!["REJECTED","CLOSED"].includes(c.status)) officerMap[name].active++;
    });
    const top_officers = Object.entries(officerMap)
      .filter(([name]) => name !== "Unassigned")
      .map(([name, v]) => ({
        name,
        score: Math.round((v.resolved / Math.max(v.resolved + v.active, 1)) * 100),
        ...v,
      }))
      .sort((a,b) => b.score - a.score)
      .slice(0, 5);

    return NextResponse.json({
      data: {
        total: all.length,
        active: active.length,
        resolved: resolved.length,
        registered: registered.length,
        in_progress: inProgress.length,
        critical: critical.length,
        resolution_rate: Math.round(resolutionRate * 10) / 10,
        avg_rating: avgRating ? Math.round(avgRating * 10) / 10 : null,
        last_24h: last24h.length,
        last_7d: last7d.length,
        by_category,
        by_block,
        trend,
        top_officers,
      }
    });
  } catch (err: unknown) {
    console.error("MLA stats error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
