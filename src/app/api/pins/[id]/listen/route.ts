import { NextResponse } from "next/server";
import { supabaseRoute, supabaseAdmin } from "@/lib/supabase/server";
import { isFiniteCoord, distanceMeters } from "@/lib/geo";
import { LISTEN_RADIUS_M } from "@/lib/env";
import { safe } from "@/lib/safeRoute";
import { rateAllow, LIMITS } from "@/lib/rateLimit";

export const runtime = "nodejs";

// POST /api/pins/[id]/listen  body: { lat, lng }
// Returns short-lived signed URL only if the requester is within LISTEN_RADIUS_M.
export const POST = safe(async (
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  if (!(await rateAllow(req, "pin.listen", LIMITS.PIN_LISTEN))) {
    return NextResponse.json(
      { error: "too many requests" },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  if (!isFiniteCoord(lat, lng)) {
    return NextResponse.json({ error: "bad coords" }, { status: 400 });
  }

  const sb = await supabaseRoute();
  // Hidden pins are filtered by the RLS select policy.
  const { data: pin, error } = await sb
    .from("pins")
    .select("id, lat, lng, audio_path")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pin) return NextResponse.json({ error: "not found" }, { status: 404 });

  const dist = distanceMeters(lat, lng, pin.lat, pin.lng);
  if (dist > LISTEN_RADIUS_M) {
    return NextResponse.json(
      { error: "too far", distanceM: Math.round(dist), radiusM: LISTEN_RADIUS_M },
      { status: 403 }
    );
  }

  const admin = supabaseAdmin();
  const signed = await admin.storage
    .from("audio")
    .createSignedUrl(pin.audio_path, 60); // 60 seconds — listen now or come back

  if (signed.error || !signed.data) {
    return NextResponse.json(
      { error: signed.error?.message ?? "sign failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    url: signed.data.signedUrl,
    distanceM: Math.round(dist),
  });
});
