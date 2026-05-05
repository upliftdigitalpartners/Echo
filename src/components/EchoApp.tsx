"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPin,
  fetchPin,
  fetchPinsInBbox,
  type PinSummary,
} from "@/lib/api";
import { ensureAnonUser } from "@/lib/supabase/browser";
import { getCurrentPosition, watchPosition, type Pos } from "@/lib/geolocation";
import { LISTEN_RADIUS_M } from "@/lib/env";
import Modal from "@/components/Modal";
import Recorder, { type RecordResult } from "@/components/Recorder";
import Listener from "@/components/Listener";
import MyEchoes from "@/components/MyEchoes";

// Leaflet touches `window`, so render the map only on the client.
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

type Bbox = { minLat: number; minLng: number; maxLat: number; maxLng: number };

const MAX_DROP_ACCURACY_M = 50;

export default function EchoApp() {
  const [me, setMe] = useState<Pos | null>(null);
  const [locErr, setLocErr] = useState<string | null>(null);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [pins, setPins] = useState<PinSummary[]>([]);
  const pinsRef = useRef(pins);
  pinsRef.current = pins;

  const [recordOpen, setRecordOpen] = useState(false);
  const [myEchoesOpen, setMyEchoesOpen] = useState(false);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [focusTo, setFocusTo] = useState<{ lat: number; lng: number; key: number } | null>(null);
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

  // Auto-open the listener if the URL has ?p=PIN_ID (shared link).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const focusId = params.get("p");
    if (!focusId) return;
    fetchPin(focusId)
      .then((pin) => {
        if (!pin) return;
        setPins((prev) =>
          prev.some((p) => p.id === pin.id) ? prev : [pin, ...prev]
        );
        setFocusTo({ lat: pin.lat, lng: pin.lng, key: Date.now() });
        setActivePinId(pin.id);
      })
      .catch(() => {
        /* not found / hidden — silently ignore */
      });
    // Strip the param so back/forward doesn't reopen.
    const url = new URL(window.location.href);
    url.searchParams.delete("p");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const onMoveEnd = useCallback(async (b: Bbox) => {
    try {
      const next = await fetchPinsInBbox(b);
      const seen = new Set(next.map((p) => p.id));
      const optimistic = pinsRef.current.filter((p) => !seen.has(p.id));
      setPins([...next, ...optimistic]);
    } catch {
      /* ignore — map keeps last set */
    }
  }, []);

  const onSubmitRecording = useCallback(
    async (r: RecordResult, title?: string) => {
      // Always re-read GPS at drop time so the pin lands at the *current* spot,
      // not a stale fix. Reject if accuracy is too poor to trust.
      const pos = await getCurrentPosition().catch(() => me);
      if (!pos) throw new Error("Couldn't get your location.");
      if (pos.accuracyM > MAX_DROP_ACCURACY_M) {
        throw new Error(
          `GPS accuracy is ${Math.round(pos.accuracyM)}m — too imprecise to drop a pin (need <${MAX_DROP_ACCURACY_M}m). Move outside or wait a moment.`
        );
      }
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
        focusTo={focusTo}
      />

      {/* Top banner */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex flex-col items-center gap-2 p-3 sm:p-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-zinc-950/80 px-2 py-1 text-sm font-semibold tracking-tight ring-1 ring-zinc-800 backdrop-blur">
          <span className="px-2">Echo</span>
          <button
            onClick={() => setMyEchoesOpen(true)}
            className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
          >
            Mine
          </button>
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

      <Modal open={myEchoesOpen} onClose={() => setMyEchoesOpen(false)}>
        <MyEchoes
          onClose={() => setMyEchoesOpen(false)}
          onFocus={(lat, lng, id) => {
            setFocusTo({ lat, lng, key: Date.now() });
            setActivePinId(id);
            setMyEchoesOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}
