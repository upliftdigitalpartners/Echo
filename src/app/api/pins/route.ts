import { NextResponse } from "next/server";
import { supabaseRoute, supabaseAdmin } from "@/lib/supabase/server";
import { isFiniteCoord } from "@/lib/geo";
import { safe } from "@/lib/safeRoute";
import { rateAllow, LIMITS } from "@/lib/rateLimit";
import {
  groqEnabled,
  transcribe,
  moderate,
  autoTitle,
  classifyVibe,
} from "@/lib/groq";

export const runtime = "nodejs";

const ALLOWED_THEMES = new Set(["love", "secret", "story", "art", "advice", "warning"]);

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

// POST /api/pins
// body: { lat, lng, durationMs, audioBase64, mime, title?, theme?, audibleFrom?, expiresInHours? }
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
  const userTitle =
    typeof b.title === "string" && b.title.trim().length > 0
      ? b.title.trim().slice(0, 40)
      : null;
  const theme =
    typeof b.theme === "string" && ALLOWED_THEMES.has(b.theme) ? b.theme : null;
  const audibleFrom = parseFutureDate(b.audibleFrom);
  const expiresAt = parseExpiry(b.expiresInHours);

  if (!isFiniteCoord(lat, lng)) {
    return NextResponse.json({ error: "bad coords" }, { status: 400 });
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 65_000) {
    return NextResponse.json({ error: "bad duration" }, { status: 400 });
  }
  if (!audioBase64 || audioBase64.length < 100) {
    return NextResponse.json({ error: "missing audio" }, { status: 400 });
  }
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

  // ===== AI pipeline (no-ops gracefully if GROQ_API_KEY is unset) =====
  let transcript: string | null = null;
  let transcriptLang: string | null = null;
  let aiTitle: string | null = null;
  let vibe: string | null = null;
  let moderationStatus: "allowed" | "blocked" = "allowed";
  let moderationReason: string | null = null;

  if (groqEnabled()) {
    const t = await transcribe(audio, mime).catch(() => null);
    if (t) {
      transcript = t.text;
      transcriptLang = t.language;

      // Run moderate + (maybe) auto-title + vibe in parallel.
      const [mod, gen, vib] = await Promise.all([
        moderate(transcript).catch(() => null),
        userTitle ? Promise.resolve<string | null>(null) : autoTitle(transcript).catch(() => null),
        classifyVibe(transcript).catch(() => null),
      ]);

      if (mod && !mod.ok) {
        moderationStatus = "blocked";
        moderationReason = mod.reason ?? "unsafe";
      }
      if (gen) aiTitle = gen;
      if (vib) vibe = vib;
    }
  }

  const finalTitle = userTitle ?? aiTitle ?? null;

  const ins = await admin
    .from("pins")
    .insert({
      creator_id: user.id,
      lat,
      lng,
      geog: `SRID=4326;POINT(${lng} ${lat})`,
      audio_path: path,
      duration_ms: Math.round(durationMs),
      title: finalTitle,
      title_auto: !userTitle && aiTitle !== null,
      theme,
      vibe,
      transcript,
      transcript_language: transcriptLang,
      audible_from: audibleFrom,
      expires_at: expiresAt,
      moderation_status: moderationStatus,
      moderation_reason: moderationReason,
    })
    .select("id, lat, lng, created_at, title, duration_ms, theme, vibe, audible_from, moderation_status, moderation_reason")
    .single();

  if (ins.error) {
    await admin.storage.from("audio").remove([path]);
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  // If moderation blocked, the pin is still saved (creator can see it in
  // My Echoes) but is invisible to others. Tell the client.
  if (moderationStatus === "blocked") {
    return NextResponse.json(
      {
        pin: ins.data,
        warning: `Your Echo was blocked by automated moderation (${moderationReason ?? "unsafe"}). Only you can see it.`,
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ pin: ins.data });
});

function parseFutureDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= Date.now()) return null; // past dates are nonsense
  // Cap at 50 years in the future so we don't store garbage.
  if (d.getTime() - Date.now() > 50 * 365 * 86400 * 1000) return null;
  return d.toISOString();
}

function parseExpiry(v: unknown): string | null {
  if (v == null) return null;
  const hours = Number(v);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  // Sane cap: 10 years.
  const cap = 10 * 365 * 24;
  const h = Math.min(hours, cap);
  return new Date(Date.now() + h * 3600_000).toISOString();
}
