// Service worker do painel: recebe notificações e abre o item certo ao tocar.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Necessário para o app ser instalável; não guarda nada em cache.
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let note = { title: 'AP Nails', body: '', url: '/admin', tag: undefined };
  try { note = { ...note, ...event.data.json() }; } catch { /* payload sem JSON */ }
  event.waitUntil(self.registration.showNotification(note.title, {
    body: note.body,
    tag: note.tag,
    icon: '/brand/icon-192.png',
    badge: '/brand/icon-192.png',
    data: { url: note.url },
    vibrate: [120, 60, 120],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/admin', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (client.url.includes('/admin')) {
        await client.focus();
        return client.navigate(url);
      }
    }
    return self.clients.openWindow(url);
  })());
});
