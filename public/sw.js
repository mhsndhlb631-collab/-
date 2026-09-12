/* Minhaj application shell service worker. Domain API responses are never cached here. */
const RELEASE = "minhaj-shell-v1";
const SHELL_CACHE = `${RELEASE}-shell`;
const STATIC_CACHE = `${RELEASE}-static`;
const SHELL_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/brand/minhaj-logo.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("minhaj-shell-") ||
                key.startsWith("minhaj-static-"),
            )
            .filter((key) => ![SHELL_CACHE, STATIC_CACHE].includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isSensitiveOrDynamic(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname === "/health" ||
    url.pathname === "/ready"
  );
}

function isStaticAsset(request, url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname.startsWith("/icons/") ||
    ["font", "image", "style", "script"].includes(request.destination)
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic")
    await cache.put(request, response.clone());
  return response;
}

async function navigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match("/")) ||
      (await cache.match("/offline.html"))
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isSensitiveOrDynamic(url)) return;
  if (request.mode === "navigate") {
    event.respondWith(navigation(request));
    return;
  }
  if (isStaticAsset(request, url)) event.respondWith(cacheFirst(request));
});

self.addEventListener("message", (event) => {
  if (
    event.data?.type !== "WARM_STATIC_CACHE" ||
    !Array.isArray(event.data.urls)
  )
    return;
  const safeUrls = event.data.urls.filter((value) => {
    if (typeof value !== "string") return false;
    const url = new URL(value, self.location.origin);
    return (
      url.origin === self.location.origin &&
      (url.pathname.startsWith("/_next/static/") ||
        url.pathname.startsWith("/brand/") ||
        url.pathname.startsWith("/icons/"))
    );
  });
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      for (const url of safeUrls) {
        try {
          const response = await fetch(url);
          if (response.ok && response.type === "basic")
            await cache.put(url, response);
        } catch {
          // A later successful visit can warm this immutable asset.
        }
      }
    }),
  );
});
