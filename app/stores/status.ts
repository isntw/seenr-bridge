import { defineStore } from 'pinia'
import type { Status } from '../../shared/types'

export const useStatusStore = defineStore('status', () => {
  const tautulli = ref<Status['tautulli'] | null>(null)
  const webhook = ref(false)
  const users = ref(0)

  let timer: ReturnType<typeof setInterval> | undefined
  let subscribers = 0

  async function refresh() {
    try {
      const s = await $fetch<Status>('/api/status')
      tautulli.value = s.tautulli
      webhook.value = s.webhook
      users.value = s.users
    } catch {
      tautulli.value = { ok: false, message: 'unreachable' }
      webhook.value = false
    }
  }

  // Reference-counted so the layout and the Settings page can both depend on
  // the poll without ever running two intervals.
  function start() {
    subscribers++
    if (timer) return
    refresh()
    timer = setInterval(refresh, 30_000)
  }

  function stop() {
    subscribers = Math.max(0, subscribers - 1)
    if (subscribers === 0 && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }

  return { tautulli, webhook, users, refresh, start, stop }
})
