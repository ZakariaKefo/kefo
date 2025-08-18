const CACHE = "kefo-static-v27";
const ASSET_PATHS = [
  ".", "index.html", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const urls = ASSET_PATHS.map(p => new URL(p, self.registration.scope));
    await cache.addAll(urls);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try { return await fetch(req, { cache: "no-store" }); }
      catch { return caches.match(new URL("index.html", self.registration.scope)); }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try { return await fetch(req); }
    catch { return new Response("", { status: 504, statusText: "Offline" }); }
  })());
});
