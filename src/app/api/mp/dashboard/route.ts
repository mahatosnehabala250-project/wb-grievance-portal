import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/jwt";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/mp/dashboard — MP Command Center data, SCOPED to the MP's own
// parliamentary seat (server-side). ADMIN may inspect any seat via ?lok_sabha=.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = ['MP', 'DISTRICT_ADMIN'];
  if (!allowed.includes(user.role_level || '') && user.role !== 'ADMIN') {
    return NextResponse.json({ error: "Forbidden — MP access required" }, { status: 403 });
  }

  // Seat resolution: MP is ALWAYS locked to their own seat. Only ADMIN can
  // request a different seat via query param.
  const { searchParams } = new URL(request.url);
  let lokSabha = user.lok_sabha_constituency || '';
  if (user.role === 'ADMIN') {
    lokSabha = searchParams.get('lok_sabha') || lokSabha || 'Purulia';
  }
  if (!lokSabha) {
    return NextResponse.json(
      { error: "No parliamentary constituency set on your account" },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await supabase.rpc("get_mp_command_center", {
      p_lok_sabha: lokSabha,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err: unknown) {
    console.error("MP dashboard error:", err);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
