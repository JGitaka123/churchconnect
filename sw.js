// Church 2.0 - service worker.
//
// Makes the app installable on phones and keeps it usable offline:
//   - API calls are never intercepted (they must always hit the network).
//   - Page navigations: network-first, falling back to the cached app shell.
//   - Static assets: cache-first with a background refresh (stale-while-
//     revalidate). Versioned URLs (?v=...) get fresh cache entries for free.
const CACHE_NAME = 'mmc-console-v5';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(['./', './index.html']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache API traffic

  // Navigation: try the network, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: always try the network first so the browser can never be
  // stuck on a stale app.js/styles.css from an older cache. The cached copy is
  // only a fallback for when the server is unreachable (offline).
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
