import { VERSION } from '../../shared/version'
import { workerNeedsUpdate } from '../utils/worker-version'

// The worker draws the notification itself — its icon, its image, its action
// buttons — while the title and body come from the server. So a worker left behind
// by an upgrade renders an old-looking notification from a current payload, and the
// version shown in the UI (the server's) says everything is fine.
//
// Asking the worker its own version costs nothing and settles it. One that
// disagrees, or one too old to answer at all, gets replaced: update() refetches
// sw.js bypassing the HTTP cache, and the worker's skipWaiting + clients.claim mean
// the new one takes over immediately rather than on some later launch.
const VERSION_TIMEOUT_MS = 1500

function workerVersion(worker: ServiceWorker): Promise<string> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(''), VERSION_TIMEOUT_MS)

    channel.port1.onmessage = (e: MessageEvent) => {
      clearTimeout(timer)
      resolve(String(e.data?.swVersion || ''))
    }
    worker.postMessage('version', [channel.port2])
  })
}

export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return
  if (!window.isSecureContext) return

  navigator.serviceWorker
    .register('/sw.js')
    .then(async (registration) => {
      // Nothing active yet means a first install: register() is already fetching
      // the current worker, so there is nothing stale to replace.
      const active = registration.active
      if (!active) return

      if (!workerNeedsUpdate(await workerVersion(active), VERSION)) return

      await registration.update()
    })
    .catch((e) => {
      console.warn('[pwa] service worker registration failed', e)
    })
})
