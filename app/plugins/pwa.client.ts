export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return
  if (!window.isSecureContext) return

  navigator.serviceWorker.register('/sw.js').catch((e) => {
    console.warn('[pwa] service worker registration failed', e)
  })
})
