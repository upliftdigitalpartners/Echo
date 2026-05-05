"use client";

export type PinSummary = {
  id: string;
  lat: number;
  lng: number;
  created_at: string;
  title: string | null;
  duration_ms: number;
};

export async function fetchPinsInBbox(b: {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}): Promise<PinSummary[]> {
  const u = new URL("/api/pins", location.origin);
  u.searchParams.set("minLat", String(b.minLat));
  u.searchParams.set("minLng", String(b.minLng));
  u.searchParams.set("maxLat", String(b.maxLat));
  u.searchParams.set("maxLng", String(b.maxLng));
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) throw new Error((await r.json()).error ?? "fetch failed");
  return (await r.json()).pins as PinSummary[];
}

export async function createPin(input: {
  lat: number;
  lng: number;
  durationMs: number;
  audioBlob: Blob;
  title?: string;
}): Promise<PinSummary> {
  const audioBase64 = await blobToBase64(input.audioBlob);
  const r = await fetch("/api/pins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lat: input.lat,
      lng: input.lng,
      durationMs: input.durationMs,
      mime: input.audioBlob.type || "audio/webm",
      title: input.title ?? null,
      audioBase64,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "create failed");
  return j.pin as PinSummary;
}

export async function requestListen(
  pinId: string,
  pos: { lat: number; lng: number }
): Promise<{ url: string; distanceM: number }> {
  const r = await fetch(`/api/pins/${pinId}/listen`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pos),
  });
  const j = await r.json();
  if (!r.ok) {
    const err = new Error(j.error ?? "listen failed") as Error & {
      status?: number;
      distanceM?: number;
      radiusM?: number;
    };
    err.status = r.status;
    err.distanceM = j.distanceM;
    err.radiusM = j.radiusM;
    throw err;
  }
  return j as { url: string; distanceM: number };
}

export async function reportPin(pinId: string): Promise<void> {
  const r = await fetch(`/api/pins/${pinId}/report`, { method: "POST" });
  if (!r.ok) throw new Error((await r.json()).error ?? "report failed");
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const s = String(fr.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    fr.readAsDataURL(blob);
  });
}
