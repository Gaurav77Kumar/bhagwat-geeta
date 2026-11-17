const VERSION = "gita-crossrefs-v19";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./css/style.css",
  "./js/viz.js",
  "./js/threads.js",
  "./js/journeys.js",
  "./js/app.js",
  "./data/gita.js",
  "./data/links.js",
  "./data/phrases.js",
  "./data/translations.js",
  "./data/commentaries.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  const isShell = SHELL.some(
    (path) => url.pathname === new URL(path, self.location.origin).pathname,
  );
  if (isShell) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request)),
    );
    return;
  }
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      try {
        const res = await fetch(event.request);
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      } catch {
        return hit || Response.error();
      }
    }),
  );
});
