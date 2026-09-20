/* බෝඩිම / Bodime — service worker: caches the app shell so it opens offline
   even when fully closed. Firebase and other cross-origin calls always go to
   the network.

   Bump VERSION to ship an update. A new worker installs alongside the running
   one and then waits; the page notices it, offers "update now", and posts
   SKIP_WAITING when the user accepts. Nothing swaps under someone mid-edit. */
const VERSION = '4';
const CACHE = 'bodime-v' + VERSION;
const SHELL = ['./', './index.html', './manifest.json',
               './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', e => {
  // No skipWaiting here: the new worker waits until the page asks for it.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'VERSION') {
    if (e.source) e.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== location.origin) return;          // let Firebase/CDN hit the network
  if (req.mode === 'navigate') {                        // app shell: network first, cache fallback
    e.respondWith(
      fetch(req)
        .then(res => {
          // Keep the offline copy current, so a cold start after going offline
          // opens the version the user last actually loaded.
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => new Response('', { status: 504, statusText: 'Offline' })))
  );
});
