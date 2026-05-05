import { NextResponse } from "next/server";
import { supabaseRoute, supabaseAdmin } from "@/lib/supabase/server";
import { safe } from "@/lib/safeRoute";

export const runtime = "nodejs";

// GET /api/pins/[id] — fetch one pin (RLS hides reported pins unless you own it).
export const GET = safe(async (
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const sb = await supabaseRoute();
  const { data, error } = await sb
    .from("pins")
    .select(
      "id, lat, lng, created_at, title, duration_ms, theme, vibe, audible_from, transcript, transcript_language"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ pin: data });
});

export const DELETE = safe(async (
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const sb = await supabaseRoute();
  const { data: userRes } = await sb.auth.getUser();
  const user = userRes.user;
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: pin, error } = await sb
    .from("pins")
    .select("id, audio_path, creator_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pin) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (pin.creator_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  await admin.storage.from("audio").remove([pin.audio_path]);
  const del = await admin.from("pins").delete().eq("id", id);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
