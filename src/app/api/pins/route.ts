import { NextResponse } from "next/server";
import { supabaseRoute, supabaseAdmin } from "@/lib/supabase/server";
import { isFiniteCoord } from "@/lib/geo";
import { safe } from "@/lib/safeRoute";
import { rateAllow, LIMITS } from "@/lib/rateLimit";

export const runtime = "nodejs";

// GET /api/pins?minLat=&minLng=&maxLat=&maxLng=
export const GET = safe(async (req: Request) => {
  const url = new URL(req.url);
  const minLat = Number(url.searchParams.get("minLat"));
  const minLng = Number(url.searchParams.get("minLng"));
  const maxLat = Number(url.searchParams.get("maxLat"));
  const maxLng = Number(url.searchParams.get("maxLng"));

  if (!isFiniteCoord(minLat, minLng) || !isFiniteCoord(maxLat, maxLng)) {
    return NextResponse.json({ error: "bad bbox" }, { status: 400 });
  }
  if (maxLat - minLat > 5 || Math.abs(maxLng - minLng) > 5) {
    return NextResponse.json({ error: "bbox too large" }, { status: 400 });
  }

  const sb = await supabaseRoute();
  const { data, error } = await sb.rpc("pins_in_bbox", {
    min_lat: minLat,
    min_lng: minLng,
    max_lat: maxLat,
    max_lng: maxLng,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pins: data ?? [] });
});

// POST /api/pins  body: { lat, lng, durationMs, audioBase64, mime, title? }
export const POST = safe(async (req: Request) => {
  const sb = await supabaseRoute();
  const { data: userRes } = await sb.auth.getUser();
  const user = userRes.user;
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  if (!(await rateAllow(req, "pin.create", LIMITS.PIN_CREATE))) {
    return NextResponse.json(
      { error: "too many drops — try again later" },
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
  const durationMs = Number(b.durationMs);
  const audioBase64 = typeof b.audioBase64 === "string" ? b.audioBase64 : "";
  const mime = typeof b.mime === "string" ? b.mime : "audio/webm";
  const title =
    typeof b.title === "string" && b.title.trim().length > 0
      ? b.title.trim().slice(0, 40)
      : null;

  if (!isFiniteCoord(lat, lng)) {
    return NextResponse.json({ error: "bad coords" }, { status: 400 });
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 65_000) {
    return NextResponse.json({ error: "bad duration" }, { status: 400 });
  }
  if (!audioBase64 || audioBase64.length < 100) {
    return NextResponse.json({ error: "missing audio" }, { status: 400 });
  }
  // Reject anything > ~5MB raw to keep storage costs sane.
  if (audioBase64.length > 7_000_000) {
    return NextResponse.json({ error: "audio too large" }, { status: 413 });
  }
  if (!/^audio\/(webm|mp4|mpeg|ogg|wav)/.test(mime)) {
    return NextResponse.json({ error: "bad mime" }, { status: 400 });
  }

  const ext =
    mime.includes("mp4") ? "m4a" :
    mime.includes("mpeg") ? "mp3" :
    mime.includes("ogg") ? "ogg" :
    mime.includes("wav") ? "wav" : "webm";

  const audio = Buffer.from(audioBase64, "base64");
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

  const admin = supabaseAdmin();
  const up = await admin.storage.from("audio").upload(path, audio, {
    contentType: mime,
    cacheControl: "3600",
    upsert: false,
  });
  if (up.error) {
    return NextResponse.json({ error: up.error.message }, { status: 500 });
  }

  // Insert pin via admin (we already authenticated the user above).
  const ins = await admin
    .from("pins")
    .insert({
      creator_id: user.id,
      lat,
      lng,
      geog: `SRID=4326;POINT(${lng} ${lat})`,
      audio_path: path,
      duration_ms: Math.round(durationMs),
      title,
    })
    .select("id, lat, lng, created_at, title, duration_ms")
    .single();

  if (ins.error) {
    await admin.storage.from("audio").remove([path]);
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  return NextResponse.json({ pin: ins.data });
});
