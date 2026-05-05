import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { safe } from "@/lib/safeRoute";

export const runtime = "nodejs";

// GET /api/search?q=foo  -> ranked, visibility-filtered text matches
export const GET = safe(async (req: Request) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return NextResponse.json({ pins: [] });

  const sb = await supabaseRoute();
  const { data, error } = await sb.rpc("pins_search", { q, max_results: 30 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pins: data ?? [] });
});
