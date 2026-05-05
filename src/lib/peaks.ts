"use client";

const N_BUCKETS = 32;

/** Decode the audio blob and reduce it to N_BUCKETS amplitude values 0..1. */
export async function blobToPeaks(blob: Blob): Promise<number[] | null> {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    (window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  try {
    const buf = await blob.arrayBuffer();
    const audio = await ctx.decodeAudioData(buf.slice(0));
    const ch = audio.getChannelData(0);
    const bucketSize = Math.max(1, Math.floor(ch.length / N_BUCKETS));
    const peaks: number[] = new Array(N_BUCKETS).fill(0);
    for (let i = 0; i < N_BUCKETS; i++) {
      const start = i * bucketSize;
      const end = i === N_BUCKETS - 1 ? ch.length : start + bucketSize;
      let max = 0;
      for (let j = start; j < end; j++) {
        const v = Math.abs(ch[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    // Normalize so the loudest bucket is 1.
    const loudest = Math.max(...peaks, 0.0001);
    return peaks.map((p) => Math.min(1, p / loudest));
  } catch {
    return null;
  } finally {
    void ctx.close().catch(() => {});
  }
}
