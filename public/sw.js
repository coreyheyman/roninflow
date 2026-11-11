// RoninFlow service worker: makes the journal installable as an app.
// It never caches your data — everything still comes live from your PC. If the PC can't be reached,
// it shows a small "can't reach your journal" page instead of the browser's error screen.
const CACHE = 'tj-offline-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // assets and API calls go straight to the network
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
