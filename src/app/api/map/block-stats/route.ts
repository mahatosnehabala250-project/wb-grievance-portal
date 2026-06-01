import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("complaints")
      .select("district, block, constituency, status, category")
      .not("district", "is", null)
      .not("block", "is", null);

    if (error) throw error;

    // Aggregate counts
    const agg: Record<string, { district: string; block: string; constituency: string | null; status: string; category: string; count: number }> = {};

    (data || []).forEach((row) => {
      const key = `${row.district}||${row.block}||${row.status}||${row.category}`;
      if (!agg[key]) {
        agg[key] = {
          district: row.district,
          block: row.block,
          constituency: row.constituency || null,
          status: row.status,
          category: row.category || "OTHER",
          count: 0,
        };
      }
      agg[key].count++;
    });

    return NextResponse.json({ data: Object.values(agg) });
  } catch (err: unknown) {
    console.error("Map stats error:", err);
    return NextResponse.json({ error: "Failed to fetch map data" }, { status: 500 });
  }
}
