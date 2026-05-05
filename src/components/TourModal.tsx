"use client";

import { useState } from "react";
import { generateTour, type TourResult } from "@/lib/api";
import type { Pos } from "@/lib/geolocation";

const PRESET_PROMPTS = [
  "Love stories nearby",
  "Hidden secrets",
  "30-minute scenic walk",
  "Funny moments",
  "What people miss",
  "Surprise me",
];

const RADIUS_OPTIONS = [
  { id: 400, label: "5 min walk" },
  { id: 1200, label: "15 min walk" },
  { id: 3000, label: "30 min walk" },
];

export default function TourModal({
  me,
  onClose,
  onFocus,
}: {
  me: Pos | null;
  onClose: () => void;
  onFocus: (lat: number, lng: number, pinId: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [radiusM, setRadiusM] = useState(1200);
  const [tour, setTour] = useState<TourResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go(presetPrompt?: string) {
    if (!me) {
      setErr("Need your location to build a tour.");
      return;
    }
    const usePrompt = (presetPrompt ?? prompt).trim();
    setLoading(true);
    setErr(null);
    setTour(null);
    try {
      const t = await generateTour({
        lat: me.lat,
        lng: me.lng,
        prompt: usePrompt,
        radiusM,
      });
      setTour(t);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto pr-1">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">AI walking tour</h2>
        <button onClick={onClose} className="text-sm text-zinc-300 hover:text-zinc-100">
          Close
        </button>
      </div>

      {!tour && (
        <>
          <p className="text-sm text-zinc-400">
            Llama orders nearby Echoes into a curated walk based on what you ask
            for.
          </p>

          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-zinc-500">
              Length
            </p>
            <div className="flex flex-wrap gap-1.5">
              {RADIUS_OPTIONS.map((r) => {
                const active = radiusM === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setRadiusM(r.id)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      active
                        ? "border-zinc-300 bg-zinc-800 text-zinc-100"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={120}
            placeholder="What kind of tour? (or pick one below)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm placeholder-zinc-500 outline-none focus:border-amber-400"
          />

          <div className="flex flex-wrap gap-1.5">
            {PRESET_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPrompt(p);
                  go(p);
                }}
                disabled={loading}
                className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-300 hover:border-amber-500/60 hover:text-amber-300 disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>

          <button
            onClick={() => go()}
            disabled={loading}
            className="rounded-full bg-amber-400 py-3 font-semibold text-black hover:bg-amber-300 disabled:opacity-50"
          >
            {loading ? "Curating…" : "Build my tour"}
          </button>

          {err && <p className="text-sm text-red-400">{err}</p>}
        </>
      )}

      {tour && (
        <>
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/80">
              {tour.placeName ?? "Your area"}
            </p>
            <h3 className="mt-1 text-base font-semibold text-zinc-100">{tour.title}</h3>
            <p className="mt-1 text-sm text-zinc-300">{tour.intro}</p>
          </div>

          <ol className="flex flex-col gap-2">
            {tour.stops.map((s) => (
              <li
                key={s.pinId}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-3"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-black">
                    {s.order}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {s.title ?? "Untitled Echo"}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">{s.why}</p>
                  </div>
                  <button
                    onClick={() => onFocus(s.lat, s.lng, s.pinId)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-amber-400 hover:bg-amber-950/40"
                  >
                    Map
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <button
            onClick={() => {
              setTour(null);
              setPrompt("");
            }}
            className="text-sm text-zinc-400 hover:text-zinc-200"
          >
            ← Build another tour
          </button>
        </>
      )}
    </div>
  );
}
