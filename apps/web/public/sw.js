// Build replaces these placeholders with this release's complete shell.
const cacheName = "helios-shell-__HELIOS_BUILD__";
const shell = ["/", "/manifest.webmanifest", ...__HELIOS_SHELL_ASSETS__];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try { await cache.addAll(shell); }
    catch (error) { await caches.delete(cacheName); throw error; }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Keep the previous shell for tabs already running its hashed assets.
    const old = (await caches.keys()).filter(key => key.startsWith("helios-shell-") && key !== cacheName);
    await Promise.all(old.slice(0, -1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api")) return;
  if (event.request.mode !== "navigate" && !shell.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    // A shell switches only after every file of the next build has been cached.
    const cached = await cache.match(event.request.mode === "navigate" ? "/" : url.pathname);
    return cached || await caches.match(event.request) || fetch(event.request);
  })());
});
