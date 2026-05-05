import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { safe } from "@/lib/safeRoute";
import { groqEnabled, translate } from "@/lib/groq";

export const runtime = "nodejs";

// POST /api/pins/[id]/translate  body: { lang: "Spanish" | "fr" | ... }
// Returns the pin's transcript translated into `lang`. Pulls live from Groq;
// no caching yet — that can be a v2 optimization.
export const POST = safe(async (
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) => {
  if (!groqEnabled()) {
    return NextResponse.json(
      { error: "translation isn't available — Groq key not configured" },
      { status: 503 }
    );
  }

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const lang = typeof (body as { lang?: unknown })?.lang === "string"
    ? (body as { lang: string }).lang.trim().slice(0, 32)
    : "";
  if (!lang) {
    return NextResponse.json({ error: "lang required" }, { status: 400 });
  }

  const sb = await supabaseRoute();
  const { data: pin, error } = await sb
    .from("pins")
    .select("transcript, transcript_language")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pin) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!pin.transcript) {
    return NextResponse.json({ error: "no transcript yet" }, { status: 404 });
  }

  const translated = await translate(pin.transcript, lang);
  if (!translated) {
    return NextResponse.json({ error: "translation failed" }, { status: 502 });
  }
  return NextResponse.json({
    text: translated,
    sourceLanguage: pin.transcript_language ?? "unknown",
    targetLanguage: lang,
  });
});
