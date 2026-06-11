import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/jwt";
import { assembliesForLokSabha, assembliesForDistrict } from "@/lib/rbac";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/mp/leaderboard — constituency rankings, scoped to the MP's seat.
// ADMIN sees all constituencies (or a specific seat via ?lok_sabha=).
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

    let rows = (data || []) as Array<{ constituency: string }>;

    // Scope: MP only sees ACs under their own parliamentary seat;
    // DISTRICT_ADMIN only sees ACs inside their own district
    if (user.role !== 'ADMIN') {
      let acs: string[] | null = null;
      if (user.role_level === 'MP' && user.lok_sabha_constituency) {
        acs = await assembliesForLokSabha(user.lok_sabha_constituency);
      } else if (user.role_level === 'DISTRICT_ADMIN') {
        acs = await assembliesForDistrict(user.district || user.block || '');
      }
      if (acs) {
        const acSet = new Set(acs.map(a => a.toLowerCase()));
        rows = rows.filter(r => acSet.has((r.constituency || '').toLowerCase()));
      }
    }

    return NextResponse.json({ data: rows });
  } catch (err: unknown) {
    console.error("MP leaderboard error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
