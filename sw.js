const CACHE_VERSION = "investment-lab-v55";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=20261010-05",
  "./app.js?v=20261010-05",
  "./data.js",
  "./backtest.js",
  "./simulation.js","./strategy-engine.js",
  "./rsi-diagnostic.js",
  "./ai-strategy.js",
  "./dynamic-ai.js?v=20261010-03",
  "./manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (
    url.pathname.endsWith("/sw.js") ||
    url.pathname.includes("/api/") ||
    url.hostname.includes("yahoo.com")
  ) return;

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match("./index.html")))
  );
});