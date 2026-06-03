import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/jwt";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = ['MP', 'DISTRICT_ADMIN'];
  if (!allowed.includes(user.role_level || '') && user.role !== 'ADMIN') {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { data, error } = await supabase.rpc("get_constituency_leaderboard");
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err: unknown) {
    console.error("MP leaderboard error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
