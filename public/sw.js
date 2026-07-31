self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let p = {}
  try {
    p = (event.data && event.data.json()) || {}
  } catch {
    p = {}
  }

  event.waitUntil(
    self.registration.showNotification(p.title || 'Seenr Bridge', {
      body: p.body || '',
      // The poster when there is one, the app icon otherwise. Safari ignores both
      // this and image, and uses the home-screen icon regardless.
      icon: p.icon || '/icon-192.png',
      image: p.image || undefined,
      badge: '/badge-96.png',
      tag: p.tag || 'seenr-bridge',
      data: { url: p.url || '/dashboard', mute: p.mute || null },
      // iOS reports maxActions: 0 and drops these silently, so the dialog's own
      // switch stays the only route there. Android and desktop get the button.
      actions: p.mute ? [{ action: 'mute', title: 'Mute this show' }] : [],
    }),
  )
})

async function mute(subject) {
  try {
    const res = await fetch('/api/notify/mutes', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subject),
    })
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    // An expired session 401s here, and a silent failure would look like a mute
    // that took. Unlike a notification image, this fetch does carry the cookie.
    await self.registration.showNotification('Could not mute that show', {
      body: 'Open Seenr Bridge and mute it from the Watch together dialog.',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: 'seenr-bridge-mute-failed',
      data: { url: '/settings' },
    })
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}

  if (event.action === 'mute' && data.mute) {
    event.waitUntil(mute(data.mute))
    return
  }

  const url = data.url || '/dashboard'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (new URL(c.url).origin === self.location.origin) {
          return c.focus().then(() => ('navigate' in c ? c.navigate(url) : undefined))
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
