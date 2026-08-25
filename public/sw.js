const VERSION = "v2";
const STATIC_CACHE = `abr-static-${VERSION}`;
const PAGE_CACHE = `abr-pages-${VERSION}`;
const OWN_CACHES = [STATIC_CACHE, PAGE_CACHE];
const PRECACHE = [
  "/offline",
  "/manifest.webmanifest",
  "/warehouse-icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith("abr-") && !OWN_CACHES.includes(key))
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function networkFirstNavigation(request) {
  const url = new URL(request.url);
  try {
    const response = await fetch(request);
    if (url.pathname === "/pos" && response.ok) {
      const cache = await caches.open(PAGE_CACHE);
      await cache.put("/pos", response.clone());
    }
    return response;
  } catch {
    if (url.pathname === "/pos") {
      const cachedPos = await caches.match("/pos");
      if (cachedPos) return cachedPos;
    }
    return (await caches.match("/offline")) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response.ok) void cache.put(request, response.clone());
    return response;
  }).catch(() => undefined);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/warehouse-icon.svg"
  ) event.respondWith(staleWhileRevalidate(event.request));
});
