// "roast-dev" is a placeholder: the deploy workflow rewrites it to
// "roast-<commit sha>" so every deploy changes this file's bytes, which is
// what makes browsers install the new worker and fetch fresh files. Don't
// edit the line below — the workflow's sed matches it exactly.
// The "roast-" prefix matters: this origin is shared with the cocktail app.
const CACHE = "roast-dev";

// Every file the app needs offline. Add new modules here;
// scripts/check-shell.js (run on deploy) fails if this list drifts from web/.
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./app.js",
  "./router.js",
  "./ui.js",
  "./units.js",
  "./derive.js",
  "./roast-session.js",
  "./wakelock.js",
  "./image.js",
  "./store/index.js",
  "./store/local.js",
  "./store/settings.js",
  "./store/photos.js",
  "./store/ids.js",
  "./store/active.js",
  "./screens/roasts.js",
  "./screens/roast.js",
  "./screens/roast-setup.js",
  "./screens/live-roast.js",
  "./screens/roast-finish.js",
  "./screens/roast-detail.js",
  "./screens/roast-editor.js",
  "./screens/beans.js",
  "./screens/bean-detail.js",
  "./screens/bean-form.js",
  "./screens/purchase-form.js",
  "./screens/tastings.js",
  "./screens/stats.js",
  "./screens/settings.js",
];

// `cache: "reload"` bypasses the HTTP cache (Pages serves max-age=600) so a
// fresh cache version never gets filled with stale files.
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(APP_SHELL.map(url => new Request(url, { cache: "reload" }))))
  );
  self.skipWaiting();
});

// Delete only this app's old caches. The cocktail app shares this origin's
// CacheStorage; touching its "cocktails-" caches would break its offline mode.
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith("roast-") && k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Cache-first for same-origin GETs. Cross-origin requests pass through.
self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
        return response;
      });
    })
  );
});
