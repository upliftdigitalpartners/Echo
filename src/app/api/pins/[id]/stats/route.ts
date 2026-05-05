import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { safe } from "@/lib/safeRoute";

export const runtime = "nodejs";

// GET /api/pins/[id]/stats — anonymous play count + last-heard timestamp.
export const GET = safe(async (
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const sb = await supabaseRoute();
  const { data, error } = await sb.rpc("pin_play_stats", { p_pin_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = Array.isArray(data) && data[0] ? data[0] : { plays: 0, last_heard: null };
  return NextResponse.json({
    plays: Number(row.plays ?? 0),
    lastHeard: row.last_heard ?? null,
  });
});
