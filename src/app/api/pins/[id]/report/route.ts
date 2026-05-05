import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { safe } from "@/lib/safeRoute";

export const runtime = "nodejs";

export const POST = safe(async (
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const sb = await supabaseRoute();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes.user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const { error } = await sb
    .from("reports")
    .insert({ pin_id: id, reporter_id: userRes.user.id });

  // Duplicate (same user reports twice) is fine — treat as success.
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
