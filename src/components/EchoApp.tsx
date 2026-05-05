"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPin, fetchPinsInBbox, type PinSummary } from "@/lib/api";
import { ensureAnonUser } from "@/lib/supabase/browser";
import { getCurrentPosition, watchPosition, type Pos } from "@/lib/geolocation";
import { LISTEN_RADIUS_M } from "@/lib/env";
import Modal from "@/components/Modal";
import Recorder, { type RecordResult } from "@/components/Recorder";
import Listener from "@/components/Listener";

// Leaflet touches `window`, so render the map only on the client.
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

type Bbox = { minLat: number; minLng: number; maxLat: number; maxLng: number };

export default function EchoApp() {
  const [me, setMe] = useState<Pos | null>(null);
  const [locErr, setLocErr] = useState<string | null>(null);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [pins, setPins] = useState<PinSummary[]>([]);
  const pinsRef = useRef(pins);
  pinsRef.current = pins;

  const [recordOpen, setRecordOpen] = useState(false);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const activePin = useMemo(
    () => pins.find((p) => p.id === activePinId) ?? null,
    [pins, activePinId]
  );

  // Anon sign-in on first paint.
  useEffect(() => {
    ensureAnonUser().catch((e) => setAuthErr((e as Error).message));
  }, []);

  // Get one-shot fix to center the map, then watch for movement.
  useEffect(() => {
    let stop: (() => void) | null = null;
    (async () => {
      try {
        const p = await getCurrentPosition();
        setMe(p);
      } catch (e) {
        setLocErr((e as Error).message);
      }
      stop = watchPosition(setMe, (e) => setLocErr(e.message));
    })();
    return () => stop?.();
  }, []);

  const onMoveEnd = useCallback(async (b: Bbox) => {
    try {
      const next = await fetchPinsInBbox(b);
      // Merge with any optimistic pin we just dropped that may not yet be returned.
      const seen = new Set(next.map((p) => p.id));
      const optimistic = pinsRef.current.filter((p) => !seen.has(p.id));
      setPins([...next, ...optimistic]);
    } catch {
      /* ignore — map keeps last set */
    }
  }, []);

  const onSubmitRecording = useCallback(
    async (r: RecordResult, title?: string) => {
      const pos = me ?? (await getCurrentPosition());
      const pin = await createPin({
        lat: pos.lat,
        lng: pos.lng,
        durationMs: r.durationMs,
        audioBlob: r.blob,
        title,
      });
      setPins((prev) => [pin, ...prev.filter((p) => p.id !== pin.id)]);
      setRecordOpen(false);
    },
    [me]
  );

  return (
    <div className="relative h-dvh w-full bg-zinc-950 text-zinc-100">
      <MapView
        initialCenter={me ? { lat: me.lat, lng: me.lng } : null}
        pins={pins}
        me={me}
        listenRadiusM={LISTEN_RADIUS_M}
        onMoveEnd={onMoveEnd}
        onPinClick={setActivePinId}
      />

      {/* Top banner */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex flex-col items-center gap-2 p-3 sm:p-4">
        <div className="pointer-events-auto rounded-full bg-zinc-950/80 px-4 py-1.5 text-sm font-semibold tracking-tight ring-1 ring-zinc-800 backdrop-blur">
          Echo
        </div>
        {(locErr || authErr) && (
          <div className="pointer-events-auto max-w-xs rounded-md bg-red-950/80 px-3 py-2 text-center text-xs text-red-200 ring-1 ring-red-900 backdrop-blur">
            {locErr ?? authErr}
          </div>
        )}
      </div>

      {/* Drop button */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] flex justify-center p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button
          onClick={() => setRecordOpen(true)}
          disabled={!me}
          className="pointer-events-auto rounded-full bg-amber-400 px-6 py-3 font-semibold text-black shadow-xl ring-1 ring-amber-500/50 hover:bg-amber-300 disabled:opacity-50"
        >
          {me ? "+ Drop an Echo" : "Waiting for GPS…"}
        </button>
      </div>

      <Modal open={recordOpen} onClose={() => setRecordOpen(false)}>
        <Recorder
          onCancel={() => setRecordOpen(false)}
          onSubmit={onSubmitRecording}
        />
      </Modal>

      <Modal open={!!activePin} onClose={() => setActivePinId(null)}>
        {activePin && (
          <Listener
            pin={activePin}
            me={me}
            listenRadiusM={LISTEN_RADIUS_M}
            onClose={() => setActivePinId(null)}
          />
        )}
      </Modal>
    </div>
  );
}
