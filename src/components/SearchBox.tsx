"use client";

import { useEffect, useRef, useState } from "react";
import { searchPins, type SearchHit } from "@/lib/api";

export default function SearchBox({
  onPick,
}: {
  onPick: (hit: SearchHit) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      searchPins(q.trim())
        .then((r) => !cancelled && setHits(r))
        .catch(() => !cancelled && setHits([]))
        .finally(() => !cancelled && setLoading(false));
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full bg-zinc-800 p-1.5 text-zinc-200 hover:bg-zinc-700"
        aria-label="Search Echoes"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-[600] mt-2 w-72 rounded-xl bg-zinc-950 p-2 ring-1 ring-zinc-800 shadow-xl">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search transcripts and titles…"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm placeholder-zinc-500 outline-none focus:border-amber-400"
          />

          {loading && <p className="px-3 py-2 text-xs text-zinc-500">Searching…</p>}

          {!loading && q && hits.length === 0 && (
            <p className="px-3 py-2 text-xs text-zinc-500">No matches.</p>
          )}

          {hits.length > 0 && (
            <ul className="mt-1 max-h-72 overflow-y-auto">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => {
                      onPick(h);
                      setOpen(false);
                    }}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-900"
                  >
                    <p className="truncate text-zinc-100">{h.title ?? "Untitled Echo"}</p>
                    <p className="text-[10px] tabular-nums text-zinc-500">
                      {h.lat.toFixed(4)}, {h.lng.toFixed(4)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
