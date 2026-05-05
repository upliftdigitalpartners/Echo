import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { safe } from "@/lib/safeRoute";
import { isFiniteCoord } from "@/lib/geo";
import { groqEnabled, generateTour } from "@/lib/groq";

export const runtime = "nodejs";

// POST /api/tour  body: { lat, lng, prompt?, radiusM? }
// Returns an AI-curated walking tour: 3-6 ordered Echoes that fit the user's
// request, with a one-line "why" between each stop. Caps radius at 5 km.
export const POST = safe(async (req: Request) => {
  if (!groqEnabled()) {
    return NextResponse.json(
      { error: "AI tours need a Groq key — not configured" },
      { status: 503 }
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
  const prompt = typeof b.prompt === "string" ? b.prompt.trim().slice(0, 200) : "";
  const radiusM = Math.min(
    5000,
    Math.max(100, Number.isFinite(Number(b.radiusM)) ? Number(b.radiusM) : 800)
  );

  if (!isFiniteCoord(lat, lng)) {
    return NextResponse.json({ error: "bad coords" }, { status: 400 });
  }

  // Pull candidate pins inside a bbox roughly the radius wide. ~111 km/deg lat.
  const dLat = radiusM / 111_000;
  const dLng = radiusM / (111_000 * Math.cos((lat * Math.PI) / 180) || 1);

  const admin = supabaseAdmin();
  const { data: pins, error } = await admin
    .from("pins")
    .select("id, title, transcript, theme, vibe, lat, lng, audible_from")
    .eq("hidden", false)
    .eq("moderation_status", "allowed")
    .gte("lat", lat - dLat)
    .lte("lat", lat + dLat)
    .gte("lng", lng - dLng)
    .lte("lng", lng + dLng)
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filter out time-capsules that aren't open yet, plus pins missing transcripts
  // (the LLM has nothing to reason about for those).
  const now = Date.now();
  const candidates = (pins ?? [])
    .filter((p) => !p.audible_from || new Date(p.audible_from).getTime() <= now)
    .filter((p) => p.transcript || p.title);

  if (candidates.length < 3) {
    return NextResponse.json(
      {
        error:
          "Not enough Echoes nearby for a tour yet. Try a larger area or come back when more pins are dropped.",
      },
      { status: 404 }
    );
  }

  // Reverse-geocode for a nice area name (best-effort).
  const placeName = await reverseGeocode(lat, lng).catch(() => null);

  const tour = await generateTour({
    prompt,
    placeName,
    pins: candidates.map((p) => ({
      id: p.id,
      title: p.title,
      transcript: p.transcript,
      theme: p.theme,
      vibe: p.vibe,
      lat: p.lat,
      lng: p.lng,
    })),
  });

  if (!tour) {
    return NextResponse.json({ error: "tour generation failed" }, { status: 502 });
  }

  // Hydrate stops with coordinates so the client can map them.
  const byId = new Map(candidates.map((p) => [p.id, p]));
  const hydrated = tour.stops.map((s) => {
    const p = byId.get(s.pinId)!;
    return {
      ...s,
      lat: p.lat,
      lng: p.lng,
      title: p.title,
      theme: p.theme,
      vibe: p.vibe,
    };
  });

  return NextResponse.json({
    title: tour.title,
    intro: tour.intro,
    stops: hydrated,
    placeName,
    radiusM,
  });
});

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const u = new URL("https://nominatim.openstreetmap.org/reverse");
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("lat", String(lat));
  u.searchParams.set("lon", String(lng));
  u.searchParams.set("zoom", "14");
  const r = await fetch(u, {
    headers: {
      "user-agent": "Echo/1.0 (https://github.com/upliftdigitalpartners/Echo)",
      "accept-language": "en",
    },
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { name?: string; display_name?: string };
  return (
    j.name?.trim() ||
    j.display_name?.split(",").slice(0, 2).join(",").trim() ||
    null
  );
}
