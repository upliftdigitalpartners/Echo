"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Static waveform that fills in as audio plays. `audio` is the underlying
 * <audio> element ref so we can sync the playhead.
 */
export default function Waveform({
  peaks,
  audio,
  height = 48,
  color = "#fbbf24",
  trailColor = "#3f3f46",
}: {
  peaks: number[];
  audio?: HTMLAudioElement | null;
  height?: number;
  color?: string;
  trailColor?: string;
}) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!audio) return;
    const tick = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) {
        setProgress(audio.currentTime / d);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [audio]);

  if (!peaks || peaks.length === 0) return null;
  const w = peaks.length * 4 + (peaks.length - 1) * 2; // 4px wide bars, 2px gap

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      role="img"
      aria-label="Audio waveform"
    >
      {peaks.map((p, i) => {
        const x = i * 6; // 4 + 2
        const h = Math.max(2, Math.round(p * (height - 2)));
        const y = (height - h) / 2;
        const isPlayed = i / peaks.length <= progress;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={4}
            height={h}
            rx={1.5}
            fill={isPlayed ? color : trailColor}
          />
        );
      })}
    </svg>
  );
}
