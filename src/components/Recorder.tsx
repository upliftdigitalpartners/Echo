"use client";

import { useEffect, useRef, useState } from "react";
import type { Theme } from "@/lib/api";
import { fetchPlace } from "@/lib/api";
import type { Pos } from "@/lib/geolocation";
import { blobToPeaks } from "@/lib/peaks";
import Waveform from "@/components/Waveform";

const MAX_MS = 60_000;

type State =
  | { kind: "idle" }
  | { kind: "recording"; startedAt: number }
  | { kind: "done"; blob: Blob; durationMs: number; url: string };

export type RecordResult = { blob: Blob; durationMs: number };

export type DropOptions = {
  title?: string;
  theme?: Theme | null;
  audibleFrom?: string | null;
  expiresInHours?: number | null;
  peaks?: number[] | null;
  photoBlob?: Blob | null;
};

const THEMES: { id: Theme; label: string; color: string }[] = [
  { id: "love", label: "Love", color: "bg-rose-400" },
  { id: "secret", label: "Secret", color: "bg-violet-400" },
  { id: "story", label: "Story", color: "bg-amber-400" },
  { id: "art", label: "Art", color: "bg-emerald-400" },
  { id: "advice", label: "Advice", color: "bg-sky-400" },
  { id: "warning", label: "Warning", color: "bg-orange-500" },
];

const EXPIRY_OPTIONS: { id: number | null; label: string }[] = [
  { id: null, label: "Forever" },
  { id: 24, label: "24h" },
  { id: 24 * 7, label: "7d" },
  { id: 24 * 365, label: "1y" },
];

export default function Recorder({
  onCancel,
  onSubmit,
  me,
}: {
  onCancel: () => void;
  onSubmit: (r: RecordResult, opts?: DropOptions) => Promise<void>;
  me: Pos | null;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [title, setTitle] = useState("");
  const [theme, setTheme] = useState<Theme | null>(null);
  const [expiresInHours, setExpiresInHours] = useState<number | null>(null);
  const [audibleFrom, setAudibleFrom] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [aiPrompt, setAiPrompt] = useState<string | null>(null);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  // Fetch contextual prompt + place name once when modal opens.
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    fetchPlace(me.lat, me.lng).then((p) => {
      if (cancelled) return;
      setAiPrompt(p.prompt);
      setPlaceName(p.placeName);
    });
    return () => {
      cancelled = true;
    };
  }, [me]);

  useEffect(() => {
    return () => cleanupStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanupStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    stopTimerRef.current = null;
    tickRef.current = null;
  }

  function pickMime(): string | undefined {
    if (typeof MediaRecorder === "undefined") return undefined;
    const opts = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    return opts.find((m) => MediaRecorder.isTypeSupported(m));
  }

  async function start() {
    setErr(null);
    if (typeof MediaRecorder === "undefined") {
      setErr("Recording isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRef.current = rec;
      chunksRef.current = [];

      const startedAt = performance.now();

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const durationMs = Math.max(
          1,
          Math.min(MAX_MS, Math.round(performance.now() - startedAt))
        );
        cleanupStream();
        setElapsed(durationMs);
        setState({ kind: "done", blob, durationMs, url: URL.createObjectURL(blob) });
        // Compute waveform peaks (best-effort; fine if it fails on a codec
        // the browser can't decode like Safari + opus webm).
        blobToPeaks(blob).then((p) => p && setPeaks(p));
      };

      rec.start();
      setState({ kind: "recording", startedAt });
      setElapsed(0);
      tickRef.current = window.setInterval(() => {
        setElapsed(Math.min(MAX_MS, Math.round(performance.now() - startedAt)));
      }, 100);
      stopTimerRef.current = window.setTimeout(() => stop(), MAX_MS);
    } catch (e) {
      setErr((e as Error).message || "Microphone access denied.");
    }
  }

  function stop() {
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
    }
  }

  function reset() {
    if (state.kind === "done") URL.revokeObjectURL(state.url);
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setPeaks(null);
    setState({ kind: "idle" });
    setElapsed(0);
  }

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!f) return;
    if (f.size > 5_000_000) {
      setErr("Photo too large (5 MB max).");
      return;
    }
    if (!/^image\//.test(f.type)) {
      setErr("Pick an image file.");
      return;
    }
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto({ blob: f, url: URL.createObjectURL(f) });
  }

  function clearPhoto() {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
  }

  async function submit() {
    if (state.kind !== "done") return;
    setSubmitting(true);
    setErr(null);
    try {
      await onSubmit(
        { blob: state.blob, durationMs: state.durationMs },
        {
          title: title.trim() || undefined,
          theme,
          audibleFrom: audibleFrom ? new Date(audibleFrom).toISOString() : null,
          expiresInHours,
          peaks,
          photoBlob: photo?.blob ?? null,
        }
      );
    } catch (e) {
      setErr((e as Error).message || "Upload failed.");
      setSubmitting(false);
    }
  }

  const seconds = (elapsed / 1000).toFixed(1);

  return (
    <div className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto pr-1">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Drop an Echo here</h2>
        <span className="text-sm text-zinc-400 tabular-nums">
          {seconds}s / 60s
        </span>
      </div>

      {placeName && (
        <p className="text-xs text-zinc-500">
          Near <span className="text-zinc-300">{placeName}</span>
        </p>
      )}

      {state.kind === "idle" && aiPrompt && (
        <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/80">
            Prompt
          </p>
          <p className="mt-1 text-sm text-zinc-200">{aiPrompt}</p>
        </div>
      )}

      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full bg-amber-400 transition-[width] duration-100"
          style={{ width: `${(elapsed / MAX_MS) * 100}%` }}
        />
      </div>

      {state.kind === "idle" && (
        <button
          onClick={start}
          className="rounded-full bg-amber-400 py-3 font-semibold text-black hover:bg-amber-300"
        >
          Start recording
        </button>
      )}

      {state.kind === "recording" && (
        <button
          onClick={stop}
          className="rounded-full bg-red-500 py-3 font-semibold text-white hover:bg-red-400"
        >
          Stop
        </button>
      )}

      {state.kind === "done" && (
        <div className="flex flex-col gap-3">
          <audio
            ref={audioElRef}
            src={state.url}
            controls
            className="w-full"
          />
          {peaks && (
            <Waveform peaks={peaks} audio={audioElRef.current} height={36} />
          )}

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={40}
            placeholder="Title (optional — AI will write one if blank)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm placeholder-zinc-500 outline-none focus:border-amber-400"
          />

          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-zinc-500">Theme</p>
            <div className="flex flex-wrap gap-1.5">
              {THEMES.map((t) => {
                const active = theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(active ? null : t.id)}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                      active
                        ? "border-zinc-300 bg-zinc-800 text-zinc-100"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${t.color}`} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-zinc-500">
              Available for
            </p>
            <div className="flex flex-wrap gap-1.5">
              {EXPIRY_OPTIONS.map((opt) => {
                const active = expiresInHours === opt.id;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setExpiresInHours(opt.id)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      active
                        ? "border-zinc-300 bg-zinc-800 text-zinc-100"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-zinc-500">
              Photo (optional, also locked to GPS)
            </p>
            {photo ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt="attached"
                  className="max-h-48 w-full rounded-lg object-cover"
                />
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-1 text-xs text-zinc-200 hover:bg-black"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-900 px-3 py-3 text-xs text-zinc-400 hover:border-amber-500/60 hover:text-amber-300">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={onPickPhoto}
                  className="hidden"
                />
                + Attach a photo
              </label>
            )}
          </div>

          <details className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
            <summary className="cursor-pointer text-xs uppercase tracking-wide text-zinc-400">
              Time capsule (optional)
            </summary>
            <div className="mt-2 space-y-1.5">
              <p className="text-xs text-zinc-500">
                Hide this Echo from others until a date you choose. You can still
                listen anytime.
              </p>
              <input
                type="datetime-local"
                value={audibleFrom}
                onChange={(e) => setAudibleFrom(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-amber-400"
              />
            </div>
          </details>

          <div className="flex gap-2 pt-1">
            <button
              onClick={reset}
              disabled={submitting}
              className="flex-1 rounded-full border border-zinc-700 py-3 font-semibold hover:bg-zinc-800 disabled:opacity-50"
            >
              Re-record
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="flex-[2] rounded-full bg-amber-400 py-3 font-semibold text-black hover:bg-amber-300 disabled:opacity-50"
            >
              {submitting ? "Dropping…" : "Drop here"}
            </button>
          </div>
        </div>
      )}

      {err && <p className="text-sm text-red-400">{err}</p>}

      <button
        onClick={onCancel}
        className="text-sm text-zinc-400 hover:text-zinc-200"
      >
        Cancel
      </button>
    </div>
  );
}
