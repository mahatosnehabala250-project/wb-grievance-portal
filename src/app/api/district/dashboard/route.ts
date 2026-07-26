import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/jwt";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/district/dashboard — District (zila) command centre, SCOPED to the
// caller's own district server-side. Only ADMIN may inspect another district
// via ?district=; a DISTRICT_ADMIN is always pinned to their own, so a district
// president can never read a neighbouring district's organisational data.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = user.role === "ADMIN" || user.role === "STATE";
  const isDistrict = user.role_level === "DISTRICT_ADMIN" || user.role === "DISTRICT";
  if (!isAdmin && !isDistrict) {
    return NextResponse.json(
      { error: "Forbidden — district access required" },
      { status: 403 }
    );
  }

  // Legacy rows stored the district name in `block` for the DISTRICT base role.
  let district = user.district || user.block || "";
  if (isAdmin) district = request.nextUrl.searchParams.get("district") || district;

  if (!district) {
    return NextResponse.json(
      { error: "No district set on your account" },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await supabase.rpc("get_district_command_center", {
      p_district: district,
    });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err: unknown) {
    console.error("District dashboard error:", err);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
