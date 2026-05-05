"use client";

import { useEffect, useState } from "react";
import { fetchMyPins, deletePin, type MyPin } from "@/lib/api";

export default function MyEchoes({
  onClose,
  onFocus,
}: {
  onClose: () => void;
  onFocus: (lat: number, lng: number, id: string) => void;
}) {
  const [pins, setPins] = useState<MyPin[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    fetchMyPins()
      .then(setPins)
      .catch((e) => setErr((e as Error).message));
  }, []);

  async function remove(id: string) {
    if (!confirm("Delete this Echo? This can't be undone.")) return;
    setBusyId(id);
    try {
      await deletePin(id);
      setPins((prev) => prev?.filter((p) => p.id !== id) ?? prev);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function copyShare(id: string) {
    const url = `${location.origin}/p/${id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex flex-col gap-4 max-h-[70dvh]">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">My Echoes</h2>
        <button onClick={onClose} className="text-sm text-zinc-300 hover:text-zinc-100">
          Close
        </button>
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}

      {pins === null && <p className="text-sm text-zinc-400">Loading…</p>}

      {pins && pins.length === 0 && (
        <p className="text-sm text-zinc-400">
          You haven&apos;t dropped any Echoes yet.
        </p>
      )}

      {pins && pins.length > 0 && (
        <ul className="flex flex-col gap-2 overflow-y-auto pr-1">
          {pins.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-zinc-800 bg-zinc-900 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {p.title ?? "Untitled Echo"}
                  </p>
                  <p className="text-xs text-zinc-500 tabular-nums">
                    {new Date(p.created_at).toLocaleDateString()} · {Math.round(p.duration_ms / 1000)}s
                    {p.hidden && (
                      <span className="ml-2 rounded-full bg-red-950 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-300">
                        hidden
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => onFocus(p.lat, p.lng, p.id)}
                    className="rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                    title="Show on map"
                  >
                    Map
                  </button>
                  <button
                    onClick={() => copyShare(p.id)}
                    className="rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                    title="Copy share link"
                  >
                    Share
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    disabled={busyId === p.id}
                    className="rounded-md px-2 py-1 text-xs text-red-400 hover:bg-red-950 disabled:opacity-50"
                  >
                    {busyId === p.id ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
