// Kept in step with shared/version.ts by a test, because this is the only way to
// tell which worker a device is actually running: the version in the UI comes from
// the server, so a stale worker and a current server look identical.
const SW_VERSION = '2.6.8'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('message', (event) => {
  if (event.data !== 'version') return
  event.source?.postMessage({ swVersion: SW_VERSION })
})

self.addEventListener('push', (event) => {
  let p = {}
  try {
    p = (event.data && event.data.json()) || {}
  } catch {
    p = {}
  }

  // No `icon`: the badge already carries the app's identity, and setting both put a
  // second copy of the same mark in the notification. The artwork goes in `image`.
  const options = {
    body: p.body || '',
    image: p.image || undefined,
    badge: '/badge-96.png',
    tag: p.tag || 'seenr-bridge',
    data: { url: p.url || '/dashboard', mute: p.mute || null, join: p.join || null },
    actions: [],
  }

  // Two is Chrome's limit, and two is what there is. "Count me in" only appears for
  // someone else's playback, so the pair never overflows.
  if (p.join) options.actions.push({ action: 'join', title: 'Count me in' })
  if (p.mute) options.actions.push({ action: 'mute', title: 'Mute this show' })

  event.waitUntil(self.registration.showNotification(p.title || 'Seenr Bridge', options))
})

// A silent failure would look exactly like the action having worked, and an expired
// session 401s here — so say so. Unlike a notification image, this fetch does carry
// the session cookie.
async function act(path, body, failure) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(String(res.status))
    return true
  } catch {
    await self.registration.showNotification(failure.title, {
      body: failure.body,
      badge: '/badge-96.png',
      tag: failure.tag,
      data: { url: failure.url },
    })
    return false
  }
}

async function mute(subject) {
  await act('/api/notify/mutes', subject, {
    title: 'Could not mute that show',
    body: 'Open Seenr Bridge and mute it from the Watch together dialog.',
    tag: 'seenr-bridge-mute-failed',
    url: '/settings',
  })
}

async function join(target) {
  const ok = await act(
    '/api/notify/join',
    { rating_key: target.rating_key },
    {
      title: 'Could not count that for you',
      body: 'Open Seenr Bridge and add yourself from the Watch together dialog.',
      tag: 'seenr-bridge-join-failed',
      url: '/dashboard',
    },
  )
  if (!ok) return

  // Confirmation rather than silence: this wrote a share that keeps counting future
  // episodes, which is worth telling someone about and worth linking to.
  await self.registration.showNotification(`Counting ${target.title} for you`, {
    body: 'Also marking it watched in your own Plex.',
    badge: '/badge-96.png',
    tag: 'seenr-bridge-joined',
    data: { url: '/shared' },
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}

  if (event.action === 'mute' && data.mute) {
    event.waitUntil(mute(data.mute))
    return
  }

  if (event.action === 'join' && data.join) {
    event.waitUntil(join(data.join))
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
