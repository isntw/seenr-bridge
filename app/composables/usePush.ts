import type { PushDevice } from '../../shared/types'

export type PushState =
  | 'unsupported'
  | 'insecure'
  | 'needs-install'
  | 'denied'
  | 'subscribed'
  | 'available'

function isApple(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android device'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  return 'This device'
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function usePush() {
  const state = ref<PushState>('unsupported')
  const devices = ref<PushDevice[]>([])
  const busy = ref(false)

  async function currentSubscription(): Promise<PushSubscription | null> {
    if (!('serviceWorker' in navigator)) return null
    const reg = await navigator.serviceWorker.getRegistration()
    return (await reg?.pushManager.getSubscription()) ?? null
  }

  async function refresh() {
    if (!import.meta.client) return

    if (!window.isSecureContext) return void (state.value = 'insecure')
    if (isApple() && !isStandalone()) return void (state.value = 'needs-install')
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return void (state.value = 'unsupported')
    }
    if (Notification.permission === 'denied') return void (state.value = 'denied')

    state.value = (await currentSubscription()) ? 'subscribed' : 'available'
    if (state.value === 'subscribed') await loadDevices()
  }

  async function loadDevices() {
    try {
      devices.value = await $fetch<PushDevice[]>('/api/push/devices')
    } catch {
      devices.value = []
    }
  }

  async function enable() {
    busy.value = true
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        state.value = permission === 'denied' ? 'denied' : 'available'
        return
      }

      const reg = await navigator.serviceWorker.ready
      const { key } = await $fetch<{ key: string }>('/api/push/key')
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        }))

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } }
      await $fetch('/api/push/subscribe', {
        method: 'POST',
        body: { endpoint: json.endpoint, keys: json.keys, label: deviceLabel() },
      })

      state.value = 'subscribed'
      await loadDevices()
    } finally {
      busy.value = false
    }
  }

  async function disable() {
    busy.value = true
    try {
      const sub = await currentSubscription()
      if (sub) {
        await $fetch('/api/push/subscribe', {
          method: 'DELETE',
          body: { endpoint: sub.endpoint },
        }).catch(() => {})
        await sub.unsubscribe()
      }
      state.value = 'available'
      await loadDevices()
    } finally {
      busy.value = false
    }
  }

  async function forget(id: number) {
    await $fetch(`/api/push/devices/${id}`, { method: 'DELETE' })
    await loadDevices()
    if (!devices.value.length) {
      const sub = await currentSubscription()
      await sub?.unsubscribe()
      state.value = 'available'
    }
  }

  async function test() {
    return await $fetch<{ sent: number; failed: number; pruned: number }>('/api/push/test', {
      method: 'POST',
    })
  }

  return { state, devices, busy, refresh, enable, disable, forget, test }
}
