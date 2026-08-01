/* Pi Agent Web service worker.
 * Best-effort offline shell caching. App data always comes from the network
 * (API + event-stream), so only static assets and the offline fallback page
 * are cached. Registration never blocks the UI.
 */
const CACHE = "pi-web-static-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only handle GET; let the browser handle everything else (POST, streams).
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never intercept the app's own API or event-stream traffic.
  if (url.pathname.startsWith("/api/")) return;
  // Only same-origin GETs; let cross-origin fall through to the network.
  if (url.origin !== self.location.origin) return;

  // Navigations (HTML): network-first, fall back to cached offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches
            .open(CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
          return response;
        })
        .catch(() => caches.match(OFFLINE_URL).then((r) => r ?? Response.error())),
    );
    return;
  }

  // Static assets: cache-first (they're content-hashed and immutable).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches
              .open(CACHE)
              .then((cache) => cache.put(request, copy))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
    }),
  );
});
