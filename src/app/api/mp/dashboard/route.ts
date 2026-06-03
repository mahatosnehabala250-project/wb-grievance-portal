import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase.rpc("get_mp_dashboard_stats");
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err: unknown) {
    console.error("MP dashboard error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
