// No fetch handler on purpose — caching a live dashboard would serve stale data.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let p = {}
  try {
    p = event.data ? event.data.json() : {}
  } catch {
    p = {}
  }

  event.waitUntil(
    self.registration.showNotification(p.title || 'Seenr Bridge', {
      body: p.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: p.tag || 'seenr-bridge',
      data: { url: p.url || '/dashboard' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/dashboard'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Reuse an open tab rather than piling up windows, but navigate it so the
      // deep-link query still arrives.
      for (const c of clients) {
        if (new URL(c.url).origin === self.location.origin) {
          return c.focus().then(() => ('navigate' in c ? c.navigate(url) : undefined))
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
