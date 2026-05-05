import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { safe } from "@/lib/safeRoute";

export const runtime = "nodejs";

// GET /api/pins/me — list pins created by the signed-in user.
export const GET = safe(async () => {
  const sb = await supabaseRoute();
  const { data: userRes } = await sb.auth.getUser();
  const user = userRes.user;
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data, error } = await sb
    .from("pins")
    .select("id, lat, lng, created_at, title, duration_ms, hidden")
    .eq("creator_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pins: data ?? [] });
});
