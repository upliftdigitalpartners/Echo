"use client";

import { useEffect, useRef, useState } from "react";

const MAX_MS = 60_000;

type State =
  | { kind: "idle" }
  | { kind: "recording"; startedAt: number }
  | { kind: "done"; blob: Blob; durationMs: number; url: string };

export type RecordResult = { blob: Blob; durationMs: number };

export default function Recorder({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (r: RecordResult, title?: string) => Promise<void>;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

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
    setState({ kind: "idle" });
    setElapsed(0);
  }

  async function submit() {
    if (state.kind !== "done") return;
    setSubmitting(true);
    setErr(null);
    try {
      await onSubmit(
        { blob: state.blob, durationMs: state.durationMs },
        title.trim() || undefined
      );
    } catch (e) {
      setErr((e as Error).message || "Upload failed.");
      setSubmitting(false);
    }
  }

  const seconds = (elapsed / 1000).toFixed(1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Drop an Echo here</h2>
        <span className="text-sm text-zinc-400 tabular-nums">
          {seconds}s / 60s
        </span>
      </div>

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
          <audio src={state.url} controls className="w-full" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={40}
            placeholder="Title (optional, shown on the pin)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm placeholder-zinc-500 outline-none focus:border-amber-400"
          />
          <div className="flex gap-2">
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
