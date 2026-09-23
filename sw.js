// Offline shell: same-origin files are served network-first and fall back to the last cached copy.
// Cross-origin calls (price feeds, map tiles, geocoding) are left to the browser: stale prices are worse than none.
const CACHE = 'essence-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});

// Fuel return alerts (sent by worker/): show the notification; a tap opens the app on the station.
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(d.title || 'Le Bon Plein', {
    body: d.body || '', icon: 'icons/icon-192.png', data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
    const win = wins[0];
    return win ? win.navigate(url).then(w => (w || win).focus()) : self.clients.openWindow(url);
  }));
});
