// Minimal service worker. It's here so Chrome-based browsers reliably fire
// `beforeinstallprompt`, which powers the app's one-tap Install button
// (src/lib/install.ts): Chrome has long required a service worker with a fetch
// handler that isn't empty before offering to install a site (newer versions
// are more lenient; older ones still check). It caches nothing — page loads go
// straight to the network — so a new deploy is never hidden behind an old copy.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request));
});
