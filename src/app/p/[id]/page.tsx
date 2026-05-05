import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/server";
import { LISTEN_RADIUS_M } from "@/lib/env";

type Pin = {
  id: string;
  lat: number;
  lng: number;
  title: string | null;
  duration_ms: number;
  created_at: string;
};

async function fetchPin(id: string): Promise<Pin | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("pins")
    .select("id, lat, lng, title, duration_ms, created_at")
    .eq("id", id)
    .eq("hidden", false)
    .maybeSingle();
  return (data as Pin | null) ?? null;
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params;
  const pin = await fetchPin(id).catch(() => null);
  if (!pin) {
    return { title: "Echo — pin not found", robots: { index: false } };
  }
  const title = pin.title?.trim() || "Listen here";
  const description = `An Echo dropped at ${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}. Walk within ${LISTEN_RADIUS_M}m of this spot to hear it.`;
  const ogUrl = `/api/og/${pin.id}`;
  return {
    title: `${title} — Echo`,
    description,
    openGraph: {
      title: `${title} — Echo`,
      description,
      type: "website",
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} — Echo`,
      description,
      images: [ogUrl],
    },
  };
}

export default async function PinSharePage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pin = await fetchPin(id);
  if (!pin) notFound();

  const seconds = Math.round(pin.duration_ms / 1000);
  const dropped = new Date(pin.created_at).toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric",
  });

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 overflow-hidden">
        <div className="aspect-[1200/630] bg-zinc-950 flex items-center justify-center relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 50% 50%, rgba(251,191,36,0.4), transparent 60%)",
            }}
          />
          <div className="relative text-center px-6">
            <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-amber-400 ring-4 ring-amber-400/20" />
            <p className="text-xs uppercase tracking-widest text-amber-400/80">Echo</p>
            <h1 className="mt-1 text-2xl font-semibold">{pin.title ?? "Listen here"}</h1>
            <p className="mt-1 text-xs text-zinc-400 tabular-nums">
              {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex justify-between text-sm text-zinc-400">
            <span>{seconds}s recording</span>
            <span>{dropped}</span>
          </div>
          <p className="text-sm text-zinc-300">
            This Echo can only be played by someone physically standing within{" "}
            <span className="text-amber-400 font-semibold">{LISTEN_RADIUS_M}m</span> of
            the spot it was dropped.
          </p>
          <Link
            href={`/?p=${pin.id}`}
            className="block w-full rounded-full bg-amber-400 py-3 text-center font-semibold text-black hover:bg-amber-300"
          >
            Open in Echo to listen
          </Link>
          <a
            href={`https://www.openstreetmap.org/?mlat=${pin.lat}&mlon=${pin.lng}#map=18/${pin.lat}/${pin.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-xs text-zinc-500 hover:text-zinc-300"
          >
            View location on OpenStreetMap →
          </a>
        </div>
      </div>
    </main>
  );
}
