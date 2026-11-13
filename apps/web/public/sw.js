const cacheName = "helios-shell-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(["/", "/manifest.webmanifest"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("helios-shell-") && key !== cacheName).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api")) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(cacheName);
        await cache.put(event.request, response.clone());
        return response;
      }
    } catch { /* Offline falls through to the shell. */ }
    const cached = await caches.match(event.request, { ignoreVary: true }) || (event.request.mode === "navigate" ? await caches.match("/", { ignoreVary: true }) : undefined);
    return cached || Response.error();
  })());
});
