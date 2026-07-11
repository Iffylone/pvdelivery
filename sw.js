// ============================================================
// IFFYWARE SYSTEMS — sw.js
// Service Worker: solo maneja push notifications. No cachea nada
// (a propósito — este sistema necesita datos siempre frescos vía WS,
// un cache agresivo causaría más problemas de los que resuelve).
// ============================================================

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = { title: 'PVDelivery', body: 'Tenés una novedad', url: '/' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch(e) {}

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'pvdelivery',
    renotify: true,
    data: { url: data.url || '/' },
    vibrate: [120, 60, 120]
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
