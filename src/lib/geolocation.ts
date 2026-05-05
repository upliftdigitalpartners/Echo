"use client";

export type Pos = { lat: number; lng: number; accuracyM: number };

export function getCurrentPosition(opts?: PositionOptions): Promise<Pos> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation not available"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracyM: p.coords.accuracy,
        }),
      (e) => reject(new Error(e.message || "Location denied")),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000, ...opts }
    );
  });
}

export function watchPosition(
  cb: (p: Pos) => void,
  onErr?: (e: Error) => void
): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onErr?.(new Error("Geolocation not available"));
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) =>
      cb({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracyM: p.coords.accuracy,
      }),
    (e) => onErr?.(new Error(e.message || "Location error")),
    { enableHighAccuracy: true, maximumAge: 2_000, timeout: 20_000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}
