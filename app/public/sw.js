// Minimal service worker. It's here so Chrome-based browsers reliably fire
// `beforeinstallprompt`, which powers the app's one-tap Install button
// (src/lib/install.ts): Chrome has long required a service worker with a fetch
// handler that isn't empty before offering to install a site (newer versions
// are more lenient; older ones still check). It caches nothing — page loads go
// straight to the network — so a new deploy is never hidden behind an old copy.
//
// It also shows push notifications (src/lib/push.ts turns them on; the
// Edge Functions send {title, body, url, tag}) and opens the app on the
// notification's page when one is tapped.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request));
});

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'Ping Pong', {
      body: message.body || '',
      icon: '/icon-192.png',
      tag: message.tag,
      data: { url: message.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      // Reuse an open window of the app if there is one; otherwise open one.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        // Each step on its own: a browser that won't bring the window to the
        // front should still show the right page.
        await open.focus().catch(() => {});
        if (open.url !== url && 'navigate' in open) await open.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
