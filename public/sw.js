const VERSION = "v4";
const STATIC_CACHE = `abr-static-${VERSION}`;
const PAGE_CACHE = `abr-pages-${VERSION}`;
const OWN_CACHES = [STATIC_CACHE, PAGE_CACHE];
const PRECACHE = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/abr-192.png",
  "/icons/abr-512.png",
  "/icons/abr-maskable-512.png",
  "/icons/abr-apple-180.png",
  "/abr-logo.jpg",
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

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { return; }
  if (!payload || typeof payload.title !== "string" || typeof payload.href !== "string") return;
  const destination = new URL(payload.href, self.location.origin);
  if (destination.origin !== self.location.origin) return;
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: typeof payload.body === "string" ? payload.body : "Open AB Ramadan to review this task.",
    icon: "/icons/abr-192.png",
    badge: "/icons/abr-192.png",
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
    data: { href: destination.pathname + destination.search },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.href || "/notifications", self.location.origin);
  if (destination.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(destination.href);
      return existing.focus();
    }
    return self.clients.openWindow(destination.href);
  }));
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
    url.pathname === "/abr-app-icon.png" ||
    url.pathname === "/abr-logo.jpg" ||
    url.pathname === "/warehouse-icon.svg"
  ) event.respondWith(staleWhileRevalidate(event.request));
});
