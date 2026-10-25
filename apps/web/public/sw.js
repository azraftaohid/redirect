const CACHE_NAME = "redirect-app-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(["/app/index.html"])).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. Strictly bypass non-GET, external origins, and sw.js itself (prevents intercepting updates)
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/app/sw.js") return;
  if (!url.pathname.startsWith("/app/")) return;

  // 2. Cache-first with runtime caching for immutable hashed assets
  if (url.pathname.startsWith("/app/assets/")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // 3. Navigation requests: Network-first, direct passthrough for redirects/errors
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          // Never cache redirects, Access login pages, or server errors
          if (res.type === "opaqueredirect" || res.redirected || res.status !== 200) {
            return res;
          }
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put("/app/index.html", clone));
          return res;
        })
        .catch(() => caches.match("/app/index.html"))
    );
  }
});
