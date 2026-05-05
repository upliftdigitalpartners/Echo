"use client";

import { useEffect, useRef, useState } from "react";
import {
  fetchPinDetail,
  fetchPinStats,
  reportPin,
  requestListen,
  translatePin,
  type PinDetail,
  type PinStats,
  type PinSummary,
  type Vibe,
} from "@/lib/api";
import { distanceMeters } from "@/lib/geo";
import type { Pos } from "@/lib/geolocation";

const VIBE_LABELS: Record<Vibe, { label: string; color: string }> = {
  joy:     { label: "joy",     color: "bg-yellow-400/15 text-yellow-300" },
  grief:   { label: "grief",   color: "bg-slate-400/15 text-slate-300" },
  awe:     { label: "awe",     color: "bg-violet-400/15 text-violet-300" },
  anger:   { label: "anger",   color: "bg-red-400/15 text-red-300" },
  calm:    { label: "calm",    color: "bg-cyan-400/15 text-cyan-300" },
  playful: { label: "playful", color: "bg-pink-400/15 text-pink-300" },
  mundane: { label: "mundane", color: "bg-zinc-400/15 text-zinc-300" },
};

function ShareButton({ pinId, title }: { pinId: string; title: string | null }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = `${location.origin}/p/${pinId}`;
    const text = title ? `Echo: ${title}` : "Echo";
    const data: ShareData = { title: text, url };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch {
        /* user cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  return (
    <button onClick={share} className="text-xs text-zinc-300 hover:text-amber-400">
      {copied ? "Copied" : "Share"}
    </button>
  );
}

/** Initial bearing from a→b in degrees (0=N, 90=E, 180=S, 270=W). */
function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(aLat);
  const φ2 = toRad(bLat);
  const Δλ = toRad(bLng - aLng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function compassPoint(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}
function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; url: string; distanceM: number }
  | { kind: "too_far"; distanceM: number; radiusM: number }
  | { kind: "no_location" }
  | { kind: "time_capsule"; audibleFrom: string }
  | { kind: "expired" }
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
  const [detail, setDetail] = useState<PinDetail | null>(null);
  const [stats, setStats] = useState<PinStats | null>(null);
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch transcript + stats in parallel with the listen request.
  useEffect(() => {
    let cancelled = false;
    fetchPinDetail(pin.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {});
    fetchPinStats(pin.id)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pin.id]);

  // Run the listen request (proximity-gated).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!me) {
        setState({ kind: "no_location" });
        return;
      }
      const clientDist = distanceMeters(me.lat, me.lng, pin.lat, pin.lng);
      if (clientDist > listenRadiusM) {
        setState({
          kind: "too_far",
          distanceM: Math.round(clientDist),
          radiusM: listenRadiusM,
        });
        return;
      }
      try {
        const r = await requestListen(pin.id, { lat: me.lat, lng: me.lng });
        if (cancelled) return;
        setState({ kind: "ready", url: r.url, distanceM: r.distanceM });
        // Refresh play count after we just added one.
        fetchPinStats(pin.id).then((s) => !cancelled && setStats(s)).catch(() => {});
      } catch (e) {
        if (cancelled) return;
        const err = e as Error & {
          status?: number;
          distanceM?: number;
          radiusM?: number;
        };
        if (err.status === 403 && err.distanceM != null && err.radiusM != null) {
          setState({ kind: "too_far", distanceM: err.distanceM, radiusM: err.radiusM });
        } else if (err.status === 410) {
          setState({ kind: "expired" });
        } else if (err.status === 423) {
          setState({
            kind: "time_capsule",
            audibleFrom: pin.audible_from ?? "",
          });
        } else {
          setState({ kind: "error", message: err.message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pin.id, pin.lat, pin.lng, pin.audible_from, me, listenRadiusM]);

  useEffect(() => {
    if (state.kind !== "ready" || !audioRef.current) return;
    audioRef.current.play().catch(() => {});
  }, [state]);

  async function doReport() {
    try {
      await reportPin(pin.id);
    } catch {
      /* swallow */
    } finally {
      setReported(true);
    }
  }

  async function doTranslate() {
    if (!detail?.transcript || translating) return;
    setTranslating(true);
    try {
      const lang = navigator.language?.split("-")[0] || "English";
      const langName = new Intl.DisplayNames([lang], { type: "language" }).of(lang) || "English";
      const r = await translatePin(pin.id, langName);
      setTranslated(r.text);
    } catch (e) {
      setTranslated(`(translation unavailable: ${(e as Error).message})`);
    } finally {
      setTranslating(false);
    }
  }

  const vibe = detail?.vibe ?? pin.vibe;
  const transcript = detail?.transcript ?? null;

  return (
    <div className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto pr-1">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="min-w-0 truncate text-lg font-semibold">{pin.title ?? "Echo"}</h2>
        <span className="shrink-0 text-xs text-zinc-500">
          {new Date(pin.created_at).toLocaleDateString()}
        </span>
      </div>

      {(vibe || stats) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          {vibe && VIBE_LABELS[vibe] && (
            <span className={`rounded-full px-2 py-0.5 ${VIBE_LABELS[vibe].color}`}>
              {VIBE_LABELS[vibe].label}
            </span>
          )}
          {stats && (
            <span className="text-zinc-500">
              {stats.plays} {stats.plays === 1 ? "listen" : "listens"}
              {stats.lastHeard && ` · last ${timeAgo(stats.lastHeard)}`}
            </span>
          )}
        </div>
      )}

      {state.kind === "loading" && (
        <p className="text-sm text-zinc-400">Checking your location…</p>
      )}

      {state.kind === "no_location" && (
        <p className="text-sm text-zinc-300">
          Enable location to listen — you must be within {listenRadiusM}m.
        </p>
      )}

      {state.kind === "expired" && (
        <p className="rounded-lg bg-zinc-900 p-4 text-sm text-zinc-300">
          This Echo has expired and is no longer playable.
        </p>
      )}

      {state.kind === "time_capsule" && (
        <div className="rounded-lg border border-violet-900/50 bg-violet-950/30 p-4 text-sm">
          <p className="font-medium text-violet-200">Time capsule</p>
          <p className="mt-1 text-violet-300/80">
            Audible from{" "}
            {state.audibleFrom
              ? new Date(state.audibleFrom).toLocaleString()
              : "(unknown date)"}
            .
          </p>
        </div>
      )}

      {state.kind === "too_far" && me && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-zinc-200">
                You&apos;re{" "}
                <span className="font-semibold text-amber-400">{state.distanceM}m</span>{" "}
                away.
              </p>
              <p className="mt-1 text-zinc-400">
                Walk {compassPoint(bearingDeg(me.lat, me.lng, pin.lat, pin.lng))} (within{" "}
                {state.radiusM}m).
              </p>
            </div>
            <div
              aria-hidden="true"
              style={{
                transform: `rotate(${bearingDeg(me.lat, me.lng, pin.lat, pin.lng)}deg)`,
              }}
              className="shrink-0 rounded-full border border-amber-400/40 bg-zinc-950 p-3 transition-transform"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="20" x2="12" y2="4" />
                <polyline points="6 10 12 4 18 10" />
              </svg>
            </div>
          </div>
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

      {transcript && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Transcript
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{transcript}</p>
          {translated && (
            <>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-widest text-amber-400/80">
                Translated
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{translated}</p>
            </>
          )}
          {!translated && (
            <button
              onClick={doTranslate}
              disabled={translating}
              className="mt-2 text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50"
            >
              {translating ? "Translating…" : "Translate to my language"}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          onClick={doReport}
          disabled={reported}
          className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-50"
        >
          {reported ? "Reported" : "Report"}
        </button>
        <div className="flex items-center gap-3">
          <ShareButton pinId={pin.id} title={pin.title} />
          <button onClick={onClose} className="text-sm text-zinc-300 hover:text-zinc-100">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
