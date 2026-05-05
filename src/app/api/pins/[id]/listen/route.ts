import { NextResponse } from "next/server";
import { supabaseRoute, supabaseAdmin } from "@/lib/supabase/server";
import { isFiniteCoord, distanceMeters } from "@/lib/geo";
import { LISTEN_RADIUS_M } from "@/lib/env";
import { safe } from "@/lib/safeRoute";
import { rateAllow, LIMITS, actorKey } from "@/lib/rateLimit";

export const runtime = "nodejs";

// POST /api/pins/[id]/listen  body: { lat, lng }
// Returns short-lived signed URL only if all of these are true:
//   - the requester is within LISTEN_RADIUS_M of the pin
//   - the pin isn't expired
//   - the pin's audible_from (time capsule) date has passed (or you're the creator)
//   - the pin isn't blocked / hidden
export const POST = safe(async (
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  if (!(await rateAllow(req, "pin.listen", LIMITS.PIN_LISTEN))) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
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
  const { data: userRes } = await sb.auth.getUser();
  const callerId = userRes.user?.id ?? null;

  const { data: pin, error } = await sb
    .from("pins")
    .select(
      "id, lat, lng, audio_path, photo_path, creator_id, audible_from, expires_at, moderation_status"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pin) return NextResponse.json({ error: "not found" }, { status: 404 });

  const isOwner = callerId !== null && pin.creator_id === callerId;

  if (!isOwner && pin.moderation_status === "blocked") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (pin.expires_at && new Date(pin.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "this Echo has expired" }, { status: 410 });
  }

  if (
    !isOwner &&
    pin.audible_from &&
    new Date(pin.audible_from).getTime() > Date.now()
  ) {
    return NextResponse.json(
      {
        error: "time capsule",
        audibleFrom: pin.audible_from,
      },
      { status: 423 }
    );
  }

  const dist = distanceMeters(lat, lng, pin.lat, pin.lng);
  if (dist > LISTEN_RADIUS_M) {
    return NextResponse.json(
      { error: "too far", distanceM: Math.round(dist), radiusM: LISTEN_RADIUS_M },
      { status: 403 }
    );
  }

  const admin = supabaseAdmin();
  const [audioSigned, photoSigned] = await Promise.all([
    admin.storage.from("audio").createSignedUrl(pin.audio_path, 60),
    pin.photo_path
      ? admin.storage.from("photos").createSignedUrl(pin.photo_path, 60)
      : Promise.resolve({ data: null, error: null } as const),
  ]);

  if (audioSigned.error || !audioSigned.data) {
    return NextResponse.json(
      { error: audioSigned.error?.message ?? "sign failed" },
      { status: 500 }
    );
  }

  if (!isOwner) {
    await admin
      .from("pin_plays")
      .upsert(
        { pin_id: pin.id, listener_key: actorKey(req) },
        { onConflict: "pin_id,listener_key", ignoreDuplicates: true }
      );
  }

  return NextResponse.json({
    url: audioSigned.data.signedUrl,
    photoUrl: photoSigned?.data?.signedUrl ?? null,
    distanceM: Math.round(dist),
  });
});
