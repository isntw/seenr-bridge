export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return
  // Registration requires a secure context; over plain http it always throws,
  // which is the expected state on a LAN address rather than a failure.
  if (!window.isSecureContext) return

  navigator.serviceWorker.register('/sw.js').catch((e) => {
    console.warn('[pwa] service worker registration failed', e)
  })
})
