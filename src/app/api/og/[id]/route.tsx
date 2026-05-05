import { ImageResponse } from "next/og";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const revalidate = 3600;

const W = 1200;
const H = 630;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response("bad id", { status: 400 });
  }

  let title = "Listen here";
  let lat = 0;
  let lng = 0;
  try {
    const { data } = await supabaseAdmin()
      .from("pins")
      .select("title, lat, lng")
      .eq("id", id)
      .eq("hidden", false)
      .maybeSingle();
    if (data) {
      title = data.title?.trim() || "Listen here";
      lat = data.lat;
      lng = data.lng;
    }
  } catch {
    /* render fallback */
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(circle at 50% 45%, rgba(251,191,36,0.25), transparent 55%), #0a0a0a",
          color: "#ededed",
          fontFamily: "system-ui",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 9999,
            background: "#fbbf24",
            boxShadow: "0 0 0 18px rgba(251,191,36,0.15)",
            marginBottom: 28,
          }}
        />
        <div
          style={{
            fontSize: 22,
            letterSpacing: 6,
            color: "#fbbf24",
            textTransform: "uppercase",
          }}
        >
          Echo
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            marginTop: 12,
            maxWidth: 980,
            textAlign: "center",
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 26, color: "#a1a1aa", marginTop: 22 }}>
          {`${lat.toFixed(5)}, ${lng.toFixed(5)}`}
        </div>
        <div style={{ fontSize: 22, color: "#71717a", marginTop: 36 }}>
          Walk to this spot to listen.
        </div>
      </div>
    ),
    { width: W, height: H }
  );
}
