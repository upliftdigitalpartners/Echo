"use client";

export type Theme = "love" | "secret" | "story" | "art" | "advice" | "warning";
export type Vibe = "joy" | "grief" | "awe" | "anger" | "calm" | "playful" | "mundane";

export type PinSummary = {
  id: string;
  lat: number;
  lng: number;
  created_at: string;
  title: string | null;
  duration_ms: number;
  theme: Theme | null;
  vibe: Vibe | null;
  audible_from: string | null;
};

export type MyPin = PinSummary & { hidden: boolean };

export type PlaceContext = {
  placeName: string | null;
  prompt: string | null;
  context: string | null;
};

export type PinStats = { plays: number; lastHeard: string | null };

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
  theme?: Theme | null;
  audibleFrom?: string | null;
  expiresInHours?: number | null;
  peaks?: number[] | null;
  photoBlob?: Blob | null;
}): Promise<{ pin: PinSummary; warning?: string }> {
  const audioBase64 = await blobToBase64(input.audioBlob);
  const photoBase64 = input.photoBlob ? await blobToBase64(input.photoBlob) : null;
  const r = await fetch("/api/pins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lat: input.lat,
      lng: input.lng,
      durationMs: input.durationMs,
      mime: input.audioBlob.type || "audio/webm",
      title: input.title ?? null,
      theme: input.theme ?? null,
      audibleFrom: input.audibleFrom ?? null,
      expiresInHours: input.expiresInHours ?? null,
      peaks: input.peaks ?? null,
      audioBase64,
      photoBase64,
      photoMime: input.photoBlob?.type ?? null,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "create failed");
  return { pin: j.pin as PinSummary, warning: j.warning };
}

export async function requestListen(
  pinId: string,
  pos: { lat: number; lng: number }
): Promise<{ url: string; distanceM: number; photoUrl: string | null }> {
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
  return j as { url: string; distanceM: number; photoUrl: string | null };
}

export async function reportPin(pinId: string): Promise<void> {
  const r = await fetch(`/api/pins/${pinId}/report`, { method: "POST" });
  if (!r.ok) throw new Error((await r.json()).error ?? "report failed");
}

export type SearchHit = PinSummary & { rank: number };

export async function searchPins(q: string): Promise<SearchHit[]> {
  const u = new URL("/api/search", location.origin);
  u.searchParams.set("q", q);
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) throw new Error((await r.json()).error ?? "search failed");
  return ((await r.json()).pins ?? []) as SearchHit[];
}

export async function fetchMyPins(): Promise<MyPin[]> {
  const r = await fetch("/api/pins/me", { cache: "no-store" });
  if (!r.ok) throw new Error((await r.json()).error ?? "fetch failed");
  return (await r.json()).pins as MyPin[];
}

export async function deletePin(id: string): Promise<void> {
  const r = await fetch(`/api/pins/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error((await r.json()).error ?? "delete failed");
}

export async function fetchPin(id: string): Promise<PinSummary | null> {
  const r = await fetch(`/api/pins/${id}`, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error((await r.json()).error ?? "fetch failed");
  return (await r.json()).pin as PinSummary;
}

export type PinDetail = PinSummary & {
  transcript: string | null;
  transcript_language: string | null;
  peaks: number[] | null;
  has_photo: boolean;
};

export async function fetchPinDetail(id: string): Promise<PinDetail | null> {
  const r = await fetch(`/api/pins/${id}`, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error((await r.json()).error ?? "fetch failed");
  return (await r.json()).pin as PinDetail;
}

export async function fetchPinStats(id: string): Promise<PinStats> {
  const r = await fetch(`/api/pins/${id}/stats`, { cache: "no-store" });
  if (!r.ok) throw new Error((await r.json()).error ?? "stats failed");
  return (await r.json()) as PinStats;
}

export async function translatePin(
  id: string,
  lang: string
): Promise<{ text: string; sourceLanguage: string; targetLanguage: string }> {
  const r = await fetch(`/api/pins/${id}/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lang }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "translation failed");
  return j;
}

export type TourStop = {
  pinId: string;
  order: number;
  why: string;
  lat: number;
  lng: number;
  title: string | null;
  theme: Theme | null;
  vibe: Vibe | null;
};
export type TourResult = {
  title: string;
  intro: string;
  stops: TourStop[];
  placeName: string | null;
  radiusM: number;
};

export async function generateTour(input: {
  lat: number;
  lng: number;
  prompt?: string;
  radiusM?: number;
}): Promise<TourResult> {
  const r = await fetch("/api/tour", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "tour failed");
  return j as TourResult;
}

export async function fetchPlace(
  lat: number,
  lng: number
): Promise<PlaceContext> {
  const u = new URL("/api/place", location.origin);
  u.searchParams.set("lat", String(lat));
  u.searchParams.set("lng", String(lng));
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) return { placeName: null, prompt: null, context: null };
  return (await r.json()) as PlaceContext;
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
