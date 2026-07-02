/* =========================================================
   Wohnprotokoll – Service Worker
   Offline-Fähigkeit via Cache (stale-while-revalidate).
   Nur eigene Assets werden gecacht; Daten liegen ohnehin im localStorage.
   ========================================================= */
const CACHE = "wohnprotokoll-v2";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/storage.js",
  "/manifest.json",
  "/icon.svg",
  "/icon-maskable.svg",
  "/404.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // externe Requests nicht anfassen

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === "basic") cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached || cache.match("/index.html"));
        return cached || network;
      })
    )
  );
});
