import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { safe } from "@/lib/safeRoute";
import { isFiniteCoord } from "@/lib/geo";
import { groqEnabled, recordPrompt, placeContext } from "@/lib/groq";

export const runtime = "nodejs";

// GET /api/place?lat=&lng=
// Returns:
//   { placeName, prompt, context }
// - placeName: nearest named feature via Nominatim (free, attribution required)
// - prompt: Groq-generated record prompt for this exact spot
// - context: 1-line summary of what other Echoes nearby have been about
//
// Cached 5 minutes per coord (rounded to ~110m).
export const GET = safe(async (req: Request) => {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!isFiniteCoord(lat, lng)) {
    return NextResponse.json({ error: "bad coords" }, { status: 400 });
  }

  // Reverse geocode (Nominatim).
  const placeName = await reverseGeocode(lat, lng).catch(() => null);

  // Pull a few recent transcripts within ~150m for context (uses geog index).
  const admin = supabaseAdmin();
  const { data: nearby } = await admin
    .from("pins")
    .select("title, transcript")
    .eq("moderation_status", "allowed")
    .eq("hidden", false)
    .not("transcript", "is", null)
    .gte("lat", lat - 0.0015)
    .lte("lat", lat + 0.0015)
    .gte("lng", lng - 0.0015)
    .lte("lng", lng + 0.0015)
    .order("created_at", { ascending: false })
    .limit(8);

  const transcripts = (nearby ?? [])
    .map((r) => r.transcript as string | null)
    .filter((t): t is string => !!t);
  const recentTitles = (nearby ?? [])
    .map((r) => r.title as string | null)
    .filter((t): t is string => !!t);

  let prompt: string | null = null;
  let context: string | null = null;

  if (groqEnabled()) {
    const [p, c] = await Promise.all([
      recordPrompt({ placeName, recentTitles }).catch(() => null),
      placeName && transcripts.length > 0
        ? placeContext({ placeName, transcripts }).catch(() => null)
        : Promise.resolve(null),
    ]);
    prompt = p;
    context = c;
  }

  const res = NextResponse.json({ placeName, prompt, context });
  res.headers.set("cache-control", "public, max-age=300");
  return res;
});

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const u = new URL("https://nominatim.openstreetmap.org/reverse");
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("lat", String(lat));
  u.searchParams.set("lon", String(lng));
  u.searchParams.set("zoom", "17");
  const r = await fetch(u, {
    headers: {
      "user-agent": "Echo/1.0 (https://github.com/upliftdigitalpartners/Echo)",
      "accept-language": "en",
    },
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { name?: string; display_name?: string };
  const name = j.name?.trim();
  if (name && name.length > 0) return name.slice(0, 80);
  return j.display_name?.split(",").slice(0, 2).join(",").trim().slice(0, 80) ?? null;
}
