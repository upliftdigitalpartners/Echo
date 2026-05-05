// Minimal service worker — only here so the PWA is installable.
// Network-first for navigations, no audio caching (signed URLs are short-lived).
const CACHE = "echo-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Don't cache APIs, audio, or third-party tiles.
  if (url.pathname.startsWith("/api/")) return;
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => caches.match("/").then((r) => r ?? Response.error()))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((cached) => cached ?? fetch(req))
  );
});
