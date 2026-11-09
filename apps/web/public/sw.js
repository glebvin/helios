const cacheName = "helios-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(["/", "/manifest.webmanifest"])));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api")) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
