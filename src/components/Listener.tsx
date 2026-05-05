"use client";

import { useEffect, useRef, useState } from "react";
import { requestListen, reportPin, type PinSummary } from "@/lib/api";
import { distanceMeters } from "@/lib/geo";
import type { Pos } from "@/lib/geolocation";

type State =
  | { kind: "loading" }
  | { kind: "ready"; url: string; distanceM: number }
  | { kind: "too_far"; distanceM: number; radiusM: number }
  | { kind: "no_location" }
  | { kind: "error"; message: string };

export default function Listener({
  pin,
  me,
  listenRadiusM,
  onClose,
}: {
  pin: PinSummary;
  me: Pos | null;
  listenRadiusM: number;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reported, setReported] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!me) {
        setState({ kind: "no_location" });
        return;
      }
      // Cheap client-side check first to give a fast "you're far" UI.
      const clientDist = distanceMeters(me.lat, me.lng, pin.lat, pin.lng);
      if (clientDist > listenRadiusM) {
        setState({ kind: "too_far", distanceM: Math.round(clientDist), radiusM: listenRadiusM });
        return;
      }
      try {
        const r = await requestListen(pin.id, { lat: me.lat, lng: me.lng });
        if (cancelled) return;
        setState({ kind: "ready", url: r.url, distanceM: r.distanceM });
      } catch (e) {
        if (cancelled) return;
        const err = e as Error & { status?: number; distanceM?: number; radiusM?: number };
        if (err.status === 403 && err.distanceM != null && err.radiusM != null) {
          setState({ kind: "too_far", distanceM: err.distanceM, radiusM: err.radiusM });
        } else {
          setState({ kind: "error", message: err.message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pin.id, pin.lat, pin.lng, me, listenRadiusM]);

  // Auto-play once ready (most browsers allow it after a user-initiated click on the pin).
  useEffect(() => {
    if (state.kind !== "ready" || !audioRef.current) return;
    audioRef.current.play().catch(() => {
      /* user can press play */
    });
  }, [state]);

  async function doReport() {
    try {
      await reportPin(pin.id);
      setReported(true);
    } catch {
      setReported(true); // Avoid leaking failure / counts.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          {pin.title ?? "Echo"}
        </h2>
        <span className="text-xs text-zinc-500">
          {new Date(pin.created_at).toLocaleDateString()}
        </span>
      </div>

      {state.kind === "loading" && (
        <p className="text-sm text-zinc-400">Checking your location…</p>
      )}

      {state.kind === "no_location" && (
        <p className="text-sm text-zinc-300">
          Enable location to listen — you must be within {listenRadiusM}m of this pin.
        </p>
      )}

      {state.kind === "too_far" && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm">
          <p className="text-zinc-200">
            You&apos;re <span className="font-semibold text-amber-400">{state.distanceM}m</span> away.
          </p>
          <p className="mt-1 text-zinc-400">
            Walk within {state.radiusM}m of this spot to listen.
          </p>
        </div>
      )}

      {state.kind === "ready" && (
        <>
          <audio ref={audioRef} src={state.url} controls autoPlay className="w-full" />
          <p className="text-xs text-zinc-500">
            You&apos;re {state.distanceM}m away. Link expires in 60s.
          </p>
        </>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-red-400">{state.message}</p>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          onClick={doReport}
          disabled={reported}
          className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-50"
        >
          {reported ? "Reported" : "Report"}
        </button>
        <button
          onClick={onClose}
          className="text-sm text-zinc-300 hover:text-zinc-100"
        >
          Close
        </button>
      </div>
    </div>
  );
}
